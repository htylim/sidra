import type { AgentEvent, BridgeToExtension, ProviderId } from "@sidra/protocol";
import { formatPromptForAgent, type BridgeTurnInput } from "./context-prompt.js";

export type AgentSendInput = {
  prompt: string;
};

export type AgentSession = {
  send(input: AgentSendInput, signal: AbortSignal): AsyncIterable<AgentEvent>;
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
  };
};

type BridgeSessionManagerOptions = {
  provider: AgentProvider;
  emit(message: BridgeToExtension): void;
};

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
  private nextBridgeSessionId = 1;

  constructor(private readonly options: BridgeSessionManagerOptions) {}

  async startSession(clientSessionId: string, providerId: ProviderId): Promise<void> {
    await this.enqueueSessionOperation(clientSessionId, () => this.replaceSession(clientSessionId, providerId));
  }

  async sendPrompt(clientSessionId: string, input: BridgeTurnInput): Promise<void> {
    await this.sessionOperations.get(clientSessionId);
    const session = this.sessions.get(clientSessionId);
    if (!session) {
      this.options.emit({
        type: "session.error",
        version: 2,
        clientSessionId,
        message: "Session has not been started",
        code: "session_not_started"
      });
      return;
    }

    if (session.inFlight) {
      this.options.emit({
        type: "session.error",
        version: 2,
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

    const providerInput: AgentSendInput = {
      prompt: formatPromptForAgent(input)
    };

    inFlight.done = this.runProviderSend(clientSessionId, session.providerSession, providerInput, controller).finally(() => {
      if (session.inFlight === inFlight) {
        delete session.inFlight;
      }
    });
    session.inFlight = inFlight;
    await inFlight.done;
  }

  async cancelTurn(clientSessionId: string): Promise<void> {
    await this.sessionOperations.get(clientSessionId);
    const session = this.sessions.get(clientSessionId);
    if (!session?.inFlight) {
      this.options.emit({
        type: "session.error",
        version: 2,
        clientSessionId,
        message: "No in-flight turn to cancel",
        code: "no_in_flight_turn"
      });
      return;
    }

    const inFlight = session.inFlight;
    inFlight.controller.abort();
    await inFlight.done;
    this.options.emit({
      type: "agent.event",
      version: 2,
      clientSessionId,
      event: { type: "assistant.cancelled" }
    });
  }

  async resetSession(clientSessionId: string): Promise<void> {
    await this.enqueueSessionOperation(clientSessionId, async () => {
      const providerId = this.sessions.get(clientSessionId)?.providerId ?? this.options.provider.id;
      await this.replaceSession(clientSessionId, providerId);
    });
  }

  async closeSession(clientSessionId: string): Promise<void> {
    await this.enqueueSessionOperation(clientSessionId, async () => {
      const existing = this.sessions.get(clientSessionId);
      if (!existing) return;

      await this.closeManagedSession(existing);
      if (this.sessions.get(clientSessionId) === existing) {
        this.sessions.delete(clientSessionId);
      }
    });
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

  private async replaceSession(clientSessionId: string, providerId: ProviderId): Promise<void> {
    if (providerId !== this.options.provider.id) {
      this.options.emit({
        type: "session.error",
        version: 2,
        clientSessionId,
        message: "Provider is not available",
        code: "provider_unavailable"
      });
      return;
    }

    const existing = this.sessions.get(clientSessionId);
    if (existing) {
      await this.closeManagedSession(existing);
    }

    const providerSession = await this.options.provider.createSession();
    this.sessions.set(clientSessionId, { providerSession, providerId });
    this.options.emit({
      type: "session.started",
      version: 2,
      clientSessionId,
      bridgeSessionId: `mock-${this.nextBridgeSessionId++}`
    });
  }

  private async closeManagedSession(session: ManagedSession): Promise<void> {
    if (session.inFlight) {
      session.inFlight.controller.abort();
      await session.inFlight.done;
    }
    await session.providerSession.close();
  }

  private async runProviderSend(
    clientSessionId: string,
    providerSession: AgentSession,
    input: AgentSendInput,
    controller: AbortController
  ): Promise<void> {
    try {
      for await (const event of providerSession.send(input, controller.signal)) {
        if (controller.signal.aborted) return;
        this.options.emit({ type: "agent.event", version: 2, clientSessionId, event });
      }
    } catch {
      if (controller.signal.aborted) return;
      this.options.emit({
        type: "session.error",
        version: 2,
        clientSessionId,
        message: "Provider send failed",
        code: "provider_error"
      });
    }
  }
}
