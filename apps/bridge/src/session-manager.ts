import { randomUUID } from "node:crypto";
import {
  PROTOCOL_VERSION,
  parseAgentEvent,
  type AgentEvent,
  type BridgeToExtension,
  type PageContextMetadata,
  type PermissionDecision,
  type PermissionRequest,
  type PermissionRequestMetadata,
  type PromptEffort,
  type ProviderId
} from "@sidra/protocol";
import { formatPromptForAgent, formatPromptForAgentParts, type AgentInputPart, type BridgeTurnInput } from "./context-prompt.js";

export type SafeProviderTurnEvent = AgentEvent;

export type ProviderDisplayTitleSource = {
  prompt: string;
  pageMetadata?: Pick<PageContextMetadata, "title" | "canonicalUrl" | "url">;
};

export type AgentSendInput = {
  prompt: string;
  parts?: AgentInputPart[];
  promptEffort?: PromptEffort;
  displayTitleSource?: ProviderDisplayTitleSource;
};

export type ProviderPermissionRequest = {
  permissionKey: string;
  title: string;
  description?: string;
  metadata?: PermissionRequestMetadata;
};

export type ProviderPermissionDecision = {
  decision: PermissionDecision;
};

export type AgentPermissionRequester = {
  requestPermission(request: ProviderPermissionRequest): Promise<ProviderPermissionDecision>;
};

export type AgentSession = {
  send(input: AgentSendInput, signal: AbortSignal, permissions: AgentPermissionRequester): AsyncIterable<SafeProviderTurnEvent>;
  close(): Promise<void>;
};

export type AgentProvider = {
  id: ProviderId;
  createSession(): Promise<AgentSession>;
};

export type AgentSessionOptions = {
  clientSessionId: string;
  providerId: ProviderId;
};

export type ManagedSession = {
  providerSession: AgentSession;
  providerId: ProviderId;
  inFlight?: {
    controller: AbortController;
    done: Promise<void>;
    pendingPermission?: PendingPermission;
  };
};

type PendingPermission = {
  requestId: string;
  resolve(decision: ProviderPermissionDecision): void;
  reject(error: Error): void;
};

type BridgeSessionManagerOptions = {
  provider?: AgentProvider;
  emit(message: BridgeToExtension): void;
};

export type ConnectionCleanupReason = "heartbeat_timeout" | "native_disconnect" | "manual_shutdown";

/**
 * Owns bridge-side provider sessions and turn lifecycle.
 *
 * The extension identifies sessions with `clientSessionId`; this manager maps
 * those ids to provider sessions, enforces one in-flight turn per session, and
 * owns cancellation, reset, and close behavior.
 */
export class BridgeSessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly sessionOperations = new Map<string, Promise<void>>();
  private readonly sessionGenerations = new Map<string, number>();
  private readonly startingClientSessionIds = new Set<string>();
  private cleanupGeneration = 0;
  private closeAllOperation: Promise<void> | undefined;
  private connectionClosed = false;
  private nextBridgeSessionId = 1;

  constructor(private readonly options: BridgeSessionManagerOptions) {}

  async startSession(clientSessionId: string, providerId: ProviderId): Promise<void> {
    if (this.connectionClosed) {
      this.emitSessionNotStarted(clientSessionId);
      return;
    }
    const operationGeneration = this.cleanupGeneration;
    const sessionGeneration = this.getSessionGeneration(clientSessionId);
    this.startingClientSessionIds.add(clientSessionId);
    await this.enqueueSessionOperation(clientSessionId, () =>
      this.replaceSession(clientSessionId, providerId, operationGeneration, sessionGeneration)
    ).finally(() => {
      this.startingClientSessionIds.delete(clientSessionId);
    });
  }

  async sendPrompt(clientSessionId: string, input: BridgeTurnInput): Promise<void> {
    if (this.connectionClosed) {
      this.emitSessionNotStarted(clientSessionId);
      return;
    }
    await this.sessionOperations.get(clientSessionId);
    if (this.connectionClosed) {
      this.emitSessionNotStarted(clientSessionId);
      return;
    }
    const session = this.sessions.get(clientSessionId);
    if (!session) {
      this.emitSessionNotStarted(clientSessionId);
      return;
    }

    if (session.inFlight) {
      this.options.emit({
        type: "session.error",
        version: PROTOCOL_VERSION,
        clientSessionId,
        message: "A turn is already in flight for this session",
        code: "turn_in_flight"
      });
      return;
    }

    const controller = new AbortController();
    const inFlight: ManagedSession["inFlight"] = {
      controller,
      done: Promise.resolve()
    };

    const pageMetadata = pickTitlePageMetadata(input.pageContext?.metadata);
    const displayTitleSource: ProviderDisplayTitleSource = pageMetadata
      ? { prompt: input.prompt, pageMetadata }
      : { prompt: input.prompt };
    const providerInput: AgentSendInput = {
      prompt: formatPromptForAgent(input),
      parts: formatPromptForAgentParts(input),
      ...(input.promptEffort ? { promptEffort: input.promptEffort } : {}),
      displayTitleSource
    };

    const clearInFlight = () => {
      if (session.inFlight === inFlight) {
        delete session.inFlight;
      }
    };

    session.inFlight = inFlight;
    inFlight.done = this.runProviderSend(
      clientSessionId,
      session,
      providerInput,
      controller,
      inFlight,
      clearInFlight
    ).finally(clearInFlight);
    await inFlight.done;
  }

  async cancelTurn(clientSessionId: string): Promise<void> {
    if (this.connectionClosed) {
      this.emitSessionNotStarted(clientSessionId);
      return;
    }
    await this.enqueueSessionOperation(clientSessionId, async () => {
      if (this.connectionClosed) {
        this.emitSessionNotStarted(clientSessionId);
        return;
      }
      const session = this.sessions.get(clientSessionId);
      if (!session?.inFlight) {
        this.options.emit({
          type: "session.error",
          version: PROTOCOL_VERSION,
          clientSessionId,
          message: "No in-flight turn to cancel",
          code: "no_in_flight_turn"
        });
        return;
      }

      const inFlight = session.inFlight;
      inFlight.controller.abort();
      this.rejectPendingPermission(inFlight);
      if (this.sessions.get(clientSessionId) !== session) return;
      this.options.emit({
        type: "agent.event",
        version: PROTOCOL_VERSION,
        clientSessionId,
        event: { type: "assistant.cancelled" }
      });
    });
  }

  async resetSession(clientSessionId: string): Promise<void> {
    if (this.connectionClosed) {
      this.emitSessionNotStarted(clientSessionId);
      return;
    }
    const operationGeneration = this.cleanupGeneration;
    const sessionGeneration = this.advanceSessionGeneration(clientSessionId);
    await this.enqueueSessionOperation(clientSessionId, async () => {
      const providerId = this.sessions.get(clientSessionId)?.providerId ?? this.options.provider?.id;
      if (!providerId) {
        this.emitProviderUnavailable(clientSessionId);
        return;
      }
      await this.replaceSession(clientSessionId, providerId, operationGeneration, sessionGeneration);
    });
  }

  async closeSession(clientSessionId: string): Promise<void> {
    this.advanceSessionGeneration(clientSessionId);
    this.sessionOperations.delete(clientSessionId);
    const existing = this.sessions.get(clientSessionId);
    if (!existing) return;

    if (this.sessions.get(clientSessionId) === existing) {
      this.sessions.delete(clientSessionId);
    }
    this.closeManagedSession(existing);
  }

  async closeAllSessions(reason: ConnectionCleanupReason): Promise<void> {
    void reason;
    if (this.closeAllOperation) return this.closeAllOperation;

    this.connectionClosed = true;
    const cleanupGeneration = ++this.cleanupGeneration;
    for (const clientSessionId of this.startingClientSessionIds) {
      this.emitSessionNotStarted(clientSessionId);
    }
    this.startingClientSessionIds.clear();
    this.sessionOperations.clear();
    this.closeAllOperation = this.closeAllSessionsForGeneration(cleanupGeneration).finally(() => {
      if (this.closeAllOperation) this.closeAllOperation = undefined;
    });
    return this.closeAllOperation;
  }

  async respondToPermission(clientSessionId: string, requestId: string, decision: PermissionDecision): Promise<void> {
    if (this.connectionClosed) {
      this.emitPermissionNotFound(clientSessionId);
      return;
    }
    await this.sessionOperations.get(clientSessionId)?.catch(() => {});
    if (this.connectionClosed) {
      this.emitPermissionNotFound(clientSessionId);
      return;
    }
    const session = this.sessions.get(clientSessionId);
    const inFlight = session?.inFlight;
    const pendingPermission = inFlight?.pendingPermission;
    if (!inFlight || !pendingPermission || pendingPermission.requestId !== requestId) {
      this.emitPermissionNotFound(clientSessionId);
      return;
    }

    delete inFlight.pendingPermission;
    pendingPermission.resolve({ decision });
  }

  private async enqueueSessionOperation(clientSessionId: string, operation: () => Promise<void>): Promise<void> {
    // Destructive lifecycle operations for one session must run in order, but
    // unrelated sessions should still be able to progress independently.
    const previousOperation = this.sessionOperations.get(clientSessionId) ?? Promise.resolve();
    const nextOperation = previousOperation.catch(() => {}).then(operation);
    this.sessionOperations.set(clientSessionId, nextOperation);
    try {
      await nextOperation;
    } finally {
      if (this.sessionOperations.get(clientSessionId) === nextOperation) {
        this.sessionOperations.delete(clientSessionId);
      }
    }
  }

  private async replaceSession(
    clientSessionId: string,
    providerId: ProviderId,
    operationGeneration: number,
    sessionGeneration: number
  ): Promise<void> {
    if (this.cleanupGeneration !== operationGeneration) return;
    if (this.getSessionGeneration(clientSessionId) !== sessionGeneration) return;
    if (!this.options.provider || providerId !== this.options.provider.id) {
      this.emitProviderUnavailable(clientSessionId);
      return;
    }

    const existing = this.sessions.get(clientSessionId);
    if (existing) {
      if (this.sessions.get(clientSessionId) === existing) {
        this.sessions.delete(clientSessionId);
      }
      await this.closeManagedSessionForReplacement(existing);
    }

    let providerSession: AgentSession;
    try {
      providerSession = await this.options.provider.createSession();
    } catch {
      if (
        this.connectionClosed ||
        this.cleanupGeneration !== operationGeneration ||
        this.getSessionGeneration(clientSessionId) !== sessionGeneration
      ) {
        return;
      }
      this.options.emit({
        type: "session.error",
        version: PROTOCOL_VERSION,
        clientSessionId,
        message: "Provider session failed to start.",
        code: "provider_start_failed"
      });
      return;
    }

    if (
      this.cleanupGeneration !== operationGeneration ||
      this.getSessionGeneration(clientSessionId) !== sessionGeneration
    ) {
      this.closeManagedSession({ providerSession, providerId });
      return;
    }

    this.sessions.set(clientSessionId, { providerSession, providerId });
    this.options.emit({
      type: "session.started",
      version: PROTOCOL_VERSION,
      clientSessionId,
      bridgeSessionId: `mock-${this.nextBridgeSessionId++}`
    });
  }

  private closeManagedSession(session: ManagedSession): void {
    if (session.inFlight) {
      session.inFlight.controller.abort();
      this.rejectPendingPermission(session.inFlight);
    }
    try {
      void session.providerSession.close().catch(() => {
        // A failed provider close must not leave a stale session reusable.
      });
    } catch {
      // A failed provider close must not leave a stale session reusable.
    }
  }

  private async closeManagedSessionForReplacement(session: ManagedSession): Promise<void> {
    if (session.inFlight) {
      session.inFlight.controller.abort();
      this.rejectPendingPermission(session.inFlight);
    }
    try {
      await session.providerSession.close();
    } catch {
      // A failed provider close must not block replacement.
    }
  }

  private async closeAllSessionsForGeneration(cleanupGeneration: number): Promise<void> {
    const sessionsToClose = Array.from(this.sessions.values());
    this.sessions.clear();

    for (const session of sessionsToClose) this.closeManagedSession(session);

    if (this.cleanupGeneration !== cleanupGeneration) return;
    const lateSessionsToClose = Array.from(this.sessions.values());
    this.sessions.clear();
    for (const session of lateSessionsToClose) this.closeManagedSession(session);
  }

  private getSessionGeneration(clientSessionId: string): number {
    return this.sessionGenerations.get(clientSessionId) ?? 0;
  }

  private advanceSessionGeneration(clientSessionId: string): number {
    const nextGeneration = this.getSessionGeneration(clientSessionId) + 1;
    this.sessionGenerations.set(clientSessionId, nextGeneration);
    return nextGeneration;
  }

  private emitSessionNotStarted(clientSessionId: string): void {
    this.options.emit({
      type: "session.error",
      version: PROTOCOL_VERSION,
      clientSessionId,
      message: "Session has not been started",
      code: "session_not_started"
    });
  }

  private emitPermissionNotFound(clientSessionId: string): void {
    this.options.emit({
      type: "session.error",
      version: PROTOCOL_VERSION,
      clientSessionId,
      message: "Permission request was not found.",
      code: "permission_not_found"
    });
  }

  private emitProviderUnavailable(clientSessionId: string): void {
    this.options.emit({
      type: "session.error",
      version: PROTOCOL_VERSION,
      clientSessionId,
      message: "Provider is not available",
      code: "provider_unavailable"
    });
  }

  private async runProviderSend(
    clientSessionId: string,
    session: ManagedSession,
    input: AgentSendInput,
    controller: AbortController,
    inFlight: NonNullable<ManagedSession["inFlight"]>,
    clearInFlight: () => void
  ): Promise<void> {
    let terminalEventEmitted = false;
    const permissionRequester: AgentPermissionRequester = {
      requestPermission: (request) => this.requestProviderPermission(clientSessionId, session, inFlight, request)
    };
    try {
      for await (const event of session.providerSession.send(input, controller.signal, permissionRequester)) {
        if (controller.signal.aborted) return;
        const safeEvent = parseAgentEvent(event);
        if (!safeEvent.ok) {
          controller.abort();
          this.rejectPendingPermission(inFlight);
          clearInFlight();
          this.options.emit({
            type: "session.error",
            version: PROTOCOL_VERSION,
            clientSessionId,
            message: "Provider emitted an unsafe event.",
            code: "unsafe_provider_event"
          });
          return;
        }
        if (safeEvent.value.type === "assistant.done" || safeEvent.value.type === "assistant.cancelled") {
          terminalEventEmitted = true;
          this.rejectPendingPermission(inFlight);
          clearInFlight();
          this.options.emit({ type: "agent.event", version: PROTOCOL_VERSION, clientSessionId, event: safeEvent.value });
          return;
        }
        this.options.emit({ type: "agent.event", version: PROTOCOL_VERSION, clientSessionId, event: safeEvent.value });
      }
      if (!terminalEventEmitted && !controller.signal.aborted) {
        this.rejectPendingPermission(inFlight);
        clearInFlight();
        this.options.emit({
          type: "agent.event",
          version: PROTOCOL_VERSION,
          clientSessionId,
          event: { type: "assistant.done" }
        });
      }
    } catch {
      if (controller.signal.aborted || terminalEventEmitted) return;
      this.rejectPendingPermission(inFlight);
      clearInFlight();
      this.options.emit({
        type: "session.error",
        version: PROTOCOL_VERSION,
        clientSessionId,
        message: "Provider send failed",
        code: "provider_error"
      });
    }
  }

  private requestProviderPermission(
    clientSessionId: string,
    session: ManagedSession,
    inFlight: NonNullable<ManagedSession["inFlight"]>,
    providerRequest: ProviderPermissionRequest
  ): Promise<ProviderPermissionDecision> {
    if (inFlight.controller.signal.aborted || session.inFlight !== inFlight) {
      return Promise.reject(new Error("permission request is stale"));
    }
    if (inFlight.pendingPermission) {
      return Promise.reject(new Error("permission request already pending"));
    }

    const requestId = randomUUID();
    const request = this.toSafePermissionRequest(requestId, providerRequest);
    if (!request) {
      return Promise.reject(new Error("permission request is invalid"));
    }

    return new Promise<ProviderPermissionDecision>((resolve, reject) => {
      inFlight.pendingPermission = {
        requestId,
        resolve,
        reject
      };
      this.options.emit({
        type: "permission.request",
        version: PROTOCOL_VERSION,
        clientSessionId,
        request
      });
    });
  }

  private rejectPendingPermission(inFlight: NonNullable<ManagedSession["inFlight"]>) {
    const pendingPermission = inFlight.pendingPermission;
    if (!pendingPermission) return;
    delete inFlight.pendingPermission;
    pendingPermission.reject(new Error("permission request ended"));
  }

  private toSafePermissionRequest(requestId: string, providerRequest: ProviderPermissionRequest): PermissionRequest | null {
    if (!isNonEmptyString(providerRequest.permissionKey) || !isNonEmptyString(providerRequest.title)) return null;
    if (providerRequest.description !== undefined && typeof providerRequest.description !== "string") return null;

    const request: PermissionRequest = {
      requestId,
      permissionKey: providerRequest.permissionKey,
      title: providerRequest.title
    };
    if (providerRequest.description !== undefined) request.description = providerRequest.description;

    const metadata = providerRequest.metadata;
    if (metadata !== undefined) {
      if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) return null;
      const safeMetadata: PermissionRequestMetadata = {};
      if (typeof metadata.toolName === "string") safeMetadata.toolName = metadata.toolName;
      if (typeof metadata.commandPreview === "string") safeMetadata.commandPreview = metadata.commandPreview;
      if (safeMetadata.toolName !== undefined || safeMetadata.commandPreview !== undefined) {
        request.metadata = safeMetadata;
      }
    }

    return request;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function pickTitlePageMetadata(
  metadata: PageContextMetadata | undefined
): Pick<PageContextMetadata, "title" | "canonicalUrl" | "url"> | undefined {
  if (!metadata) return undefined;

  const pageMetadata: Pick<PageContextMetadata, "title" | "canonicalUrl" | "url"> = {
    url: metadata.url
  };
  if (metadata.title !== undefined) pageMetadata.title = metadata.title;
  if (metadata.canonicalUrl !== undefined) pageMetadata.canonicalUrl = metadata.canonicalUrl;
  return pageMetadata;
}
