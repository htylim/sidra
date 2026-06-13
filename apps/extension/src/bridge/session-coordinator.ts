import type {
  BridgeToExtension,
  ExtensionToBridge,
  PageContext,
  PermissionDecision,
  PermissionRequest,
  ProviderId,
  SessionErrorCode
} from "@sidra/protocol";
import {
  BRIDGE_HARD_PAYLOAD_BYTE_LIMIT,
  BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE,
  exceedsPayloadByteLimit,
  serializedJsonByteLength
} from "@sidra/protocol";
import {
  addAssistantActivity,
  addAssistantTextDelta,
  addContextMarker,
  addErrorStatusEntry,
  addPermissionRequest,
  addStatusEntry,
  addUserPrompt,
  cancelAssistantTurn,
  completeAssistantTurn,
  failAssistantTurn,
  markPendingPermissionRequestsUnavailable,
  removeTranscriptEntriesByIds,
  resolvePermissionRequest,
  type ContextAttachmentMarker,
  type TranscriptEntry,
  type UserPromptDisplay
} from "../transcript";

export type ProtocolTransportPostResult = { ok: true } | { ok: false; error: string };

export type ProtocolTransport = {
  post(message: ExtensionToBridge): ProtocolTransportPostResult;
  subscribeToMessages(listener: (message: BridgeToExtension) => void): () => void;
};

export type BridgeSessionCoordinatorSnapshot = {
  clientSessionId: string;
  sessionStarted: boolean;
  starting: boolean;
  turnInFlight: boolean;
  canCancelTurn: boolean;
  pendingPromptCount: number;
  transcript: TranscriptEntry[];
  lastError?: string;
};

type Listener = () => void;

type BridgeSessionCoordinatorOptions = {
  clientSessionId: string;
  providerId?: ProviderId;
  transport: ProtocolTransport;
  hardPayloadByteLimit?: number;
};

export type PromptSubmission = {
  prompt: string;
  pageContext?: PageContext;
  contextMarker?: ContextAttachmentMarker;
  userPromptDisplay?: UserPromptDisplay;
  transcriptEntryIds?: {
    markerId?: string;
    promptId: string;
  };
};

type PreparedPromptSubmission = PromptSubmission & {
  transcriptEntryIds: {
    markerId?: string;
    promptId: string;
  };
  transcriptEntriesVisible: boolean;
};

type SubmissionInput = string | PromptSubmission;

/**
 * Owns one extension-side provider session from the side panel's point of view.
 *
 * React code sends application intents here. This coordinator handles the
 * protocol ordering: start the bridge session, queue prompts until
 * `session.started`, then turn bridge events into transcript state.
 */
export class BridgeSessionCoordinator {
  private clientSessionId: string;
  private readonly providerId: ProviderId;
  private readonly transport: ProtocolTransport;
  private readonly hardPayloadByteLimit: number;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeTransport: () => void;
  // Submissions sent before `session.started` must wait for the bridge to create provider state.
  private pendingSubmissions: PreparedPromptSubmission[] = [];
  // Tracks whether the bridge may already have provider state for this session.
  private startPosted = false;
  // A sent prompt owns the current provider turn until a terminal event or error arrives.
  private turnInFlight = false;
  // A posted cancel remains pending until the bridge reports a terminal event.
  private cancelRequested = false;
  // Native Messaging can deliver a stale no-in-flight error after a cancel races with natural completion.
  private suppressNextNoInFlightAfterCancelTerminal = false;
  // New Chat sends `session.reset`, whose success also arrives as `session.started`.
  private suppressNextSessionStartedStatus = false;
  // Reset can race already-posted startup messages because protocol v3 has no request id.
  private startupResultsToIgnore = 0;
  // Reset can also race a terminal result from an old in-flight turn.
  private terminalTurnErrorsToIgnore = 0;
  private readonly pendingPermissionKeysByRequestId = new Map<string, string>();
  private snapshot: BridgeSessionCoordinatorSnapshot;

  constructor(options: BridgeSessionCoordinatorOptions) {
    this.clientSessionId = options.clientSessionId;
    this.providerId = options.providerId ?? "codex";
    this.transport = options.transport;
    this.hardPayloadByteLimit = options.hardPayloadByteLimit ?? BRIDGE_HARD_PAYLOAD_BYTE_LIMIT;
    this.snapshot = this.initialSnapshot();
    this.unsubscribeTransport = this.transport.subscribeToMessages((message) => this.handleBridgeMessage(message));
  }

  getSnapshot = (): BridgeSessionCoordinatorSnapshot => this.snapshot;

  hasProviderState = (): boolean =>
    this.startPosted || this.snapshot.sessionStarted || this.snapshot.starting || this.turnInFlight;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  sendPrompt(input: SubmissionInput): boolean {
    const submission = this.prepareSubmission(input);
    if (!submission) return false;
    if (this.pendingSubmissions.length > 0 || this.cancelRequested) return false;
    if (this.turnInFlight) {
      this.recordLocalSubmissionError("A turn is already in flight for this session");
      return false;
    }
    const payloadPreflight = this.validateSessionSendPayload(submission);
    if (!payloadPreflight.ok) {
      this.recordLocalSubmissionError(payloadPreflight.error);
      return false;
    }

    if (this.snapshot.sessionStarted) {
      const result = this.postSessionSend(submission);
      if (!result.ok) {
        this.clearPendingAfterError(result.error);
        return false;
      }
      this.turnInFlight = true;
      this.cancelRequested = false;
      this.setSnapshot({
        ...this.snapshot,
        transcript: this.addSubmissionTranscriptEntries(this.snapshot.transcript, submission),
        lastError: undefined
      });
      return true;
    }

    if (!this.startPosted) {
      this.startPosted = true;
      this.setSnapshot({ ...this.snapshot, starting: true, lastError: undefined });
      const result = this.transport.post({
        type: "session.start",
        version: 3,
        clientSessionId: this.clientSessionId,
        providerId: this.providerId
      });

      if (!result.ok) {
        this.clearPendingAfterError(result.error);
        return false;
      }
    }

    const shouldShowQueuedSubmission = this.pendingSubmissions.length === 0;
    const queuedSubmission = { ...submission, transcriptEntriesVisible: shouldShowQueuedSubmission };
    this.pendingSubmissions.push(queuedSubmission);
    this.setSnapshot({
      ...this.snapshot,
      pendingPromptCount: this.pendingSubmissions.length,
      transcript: shouldShowQueuedSubmission
        ? this.addSubmissionTranscriptEntries(this.snapshot.transcript, queuedSubmission)
        : this.snapshot.transcript,
      lastError: undefined
    });
    return true;
  }

  cancelTurn(): boolean {
    if (!this.turnInFlight || !this.snapshot.sessionStarted || this.cancelRequested) return false;

    const result = this.transport.post({
      type: "session.cancel",
      version: 3,
      clientSessionId: this.clientSessionId
    });
    if (!result.ok) {
      this.recordLocalSubmissionError(result.error);
      return false;
    }

    this.cancelRequested = true;
    this.suppressNextNoInFlightAfterCancelTerminal = false;
    this.clearPendingPermissionRequests();
    this.setSnapshot({
      ...this.snapshot,
      transcript: markPendingPermissionRequestsUnavailable(this.snapshot.transcript),
      lastError: undefined
    });
    return true;
  }

  respondToPermission(requestId: string, decision: PermissionDecision): boolean {
    if (this.cancelRequested || !this.pendingPermissionKeysByRequestId.has(requestId) || !this.snapshot.sessionStarted) {
      return false;
    }

    const result = this.transport.post({
      type: "permission.respond",
      version: 3,
      clientSessionId: this.clientSessionId,
      requestId,
      decision
    });
    if (!result.ok) {
      this.recordLocalSubmissionError(result.error);
      return false;
    }

    this.pendingPermissionKeysByRequestId.delete(requestId);
    this.setSnapshot({
      ...this.snapshot,
      transcript: resolvePermissionRequest(this.snapshot.transcript, requestId, decision),
      lastError: undefined
    });
    return true;
  }

  recordCaptureUnavailable(message: string): void {
    this.setSnapshot({
      ...this.snapshot,
      transcript: addErrorStatusEntry(this.snapshot.transcript, message, this.createTranscriptEntryId()),
      lastError: message
    });
  }

  newChat(): void {
    const providerStateMayExist = this.startPosted || this.snapshot.sessionStarted || this.snapshot.starting || this.turnInFlight;
    const resetDuringStartup = this.snapshot.starting && !this.snapshot.sessionStarted;
    const resetDuringTurn = this.turnInFlight;
    const shouldSuppressStaleNoInFlight =
      this.cancelRequested || this.suppressNextNoInFlightAfterCancelTerminal;
    this.pendingSubmissions = [];
    this.clearPendingPermissionRequests();
    this.turnInFlight = false;
    this.cancelRequested = false;
    this.suppressNextNoInFlightAfterCancelTerminal = shouldSuppressStaleNoInFlight;

    if (!providerStateMayExist) {
      this.startPosted = false;
      this.suppressNextSessionStartedStatus = false;
      this.startupResultsToIgnore = 0;
      this.terminalTurnErrorsToIgnore = 0;
      this.setSnapshot(this.initialSnapshot());
      return;
    }

    const result = this.transport.post({
      type: "session.reset",
      version: 3,
      clientSessionId: this.clientSessionId
    });

    if (!result.ok) {
      this.startPosted = false;
      this.turnInFlight = false;
      this.cancelRequested = false;
      this.suppressNextNoInFlightAfterCancelTerminal = shouldSuppressStaleNoInFlight;
      this.suppressNextSessionStartedStatus = false;
      this.startupResultsToIgnore = 0;
      this.terminalTurnErrorsToIgnore = 0;
      this.setSnapshot({
        ...this.initialSnapshot(),
        lastError: result.error,
        transcript: addErrorStatusEntry([], result.error)
      });
      return;
    }

    this.startPosted = true;
    this.suppressNextSessionStartedStatus = true;
    if (resetDuringStartup) this.startupResultsToIgnore += 1;
    if (resetDuringTurn) this.terminalTurnErrorsToIgnore += 1;
    this.setSnapshot({
      ...this.initialSnapshot(),
      starting: true
    });
  }

  reset(clientSessionId: string): void {
    this.clientSessionId = clientSessionId;
    this.pendingSubmissions = [];
    this.clearPendingPermissionRequests();
    this.startPosted = false;
    this.turnInFlight = false;
    this.cancelRequested = false;
    this.suppressNextNoInFlightAfterCancelTerminal = false;
    this.suppressNextSessionStartedStatus = false;
    this.startupResultsToIgnore = 0;
    this.terminalTurnErrorsToIgnore = 0;
    this.snapshot = {
      clientSessionId,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      turnInFlight: false,
      canCancelTurn: false,
      transcript: []
    };
    this.emit();
  }

  markBridgeDisconnected(): void {
    const transcript = this.removePendingTranscriptEntries(this.snapshot.transcript);
    this.pendingSubmissions = [];
    this.clearPendingPermissionRequests();
    this.startPosted = false;
    this.turnInFlight = false;
    this.cancelRequested = false;
    this.suppressNextNoInFlightAfterCancelTerminal = false;
    this.suppressNextSessionStartedStatus = false;
    this.startupResultsToIgnore = 0;
    this.terminalTurnErrorsToIgnore = 0;
    this.setSnapshot({
      ...this.snapshot,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      transcript: addStatusEntry(failAssistantTurn(markPendingPermissionRequestsUnavailable(transcript)), "Bridge disconnected")
    });
  }

  dispose(): void {
    this.unsubscribeTransport();
    this.listeners.clear();
    this.pendingSubmissions = [];
    this.clearPendingPermissionRequests();
    this.startPosted = false;
    this.turnInFlight = false;
    this.cancelRequested = false;
    this.suppressNextNoInFlightAfterCancelTerminal = false;
    this.suppressNextSessionStartedStatus = false;
    this.startupResultsToIgnore = 0;
    this.terminalTurnErrorsToIgnore = 0;
    this.snapshot = this.initialSnapshot();
  }

  private initialSnapshot(): BridgeSessionCoordinatorSnapshot {
    return {
      clientSessionId: this.clientSessionId,
      sessionStarted: false,
      starting: false,
      turnInFlight: false,
      canCancelTurn: false,
      pendingPromptCount: 0,
      transcript: []
    };
  }

  private handleBridgeMessage(message: BridgeToExtension): void {
    switch (message.type) {
      case "bridge.ready":
        return;
      case "session.started":
        if (message.clientSessionId !== this.snapshot.clientSessionId || !this.startPosted) return;
        if (this.startupResultsToIgnore > 0) {
          this.startupResultsToIgnore -= 1;
          return;
        }
        this.terminalTurnErrorsToIgnore = 0;
        const nextTranscript = this.suppressNextSessionStartedStatus
          ? this.snapshot.transcript
          : addStatusEntry(this.snapshot.transcript, "Session started");
        this.suppressNextSessionStartedStatus = false;
        this.setSnapshot({
          ...this.snapshot,
          sessionStarted: true,
          starting: false,
          transcript: nextTranscript
        });
        this.flushPendingPrompts();
        return;
      case "agent.event":
        if (message.clientSessionId !== this.snapshot.clientSessionId) return;
        if (!this.turnInFlight) return;
        if (message.event.type === "assistant.text.delta") {
          this.turnInFlight = true;
          this.setSnapshot({
            ...this.snapshot,
            transcript: addAssistantTextDelta(this.snapshot.transcript, message.event.text)
          });
          return;
        }
        if (message.event.type === "assistant.activity") {
          this.turnInFlight = true;
          this.setSnapshot({
            ...this.snapshot,
            transcript: addAssistantActivity(this.snapshot.transcript, message.event.activity)
          });
          return;
        }
        if (message.event.type === "assistant.done") {
          this.clearRunningTurnAfterTerminalEvent();
          this.setSnapshot({
            ...this.snapshot,
            transcript: completeAssistantTurn(markPendingPermissionRequestsUnavailable(this.snapshot.transcript))
          });
          this.flushPendingPrompts();
          return;
        }
        if (message.event.type === "assistant.cancelled") {
          this.clearRunningTurnAfterTerminalEvent();
          const transcriptWithUnavailablePermissions = markPendingPermissionRequestsUnavailable(this.snapshot.transcript);
          const transcript = cancelAssistantTurn(transcriptWithUnavailablePermissions);
          this.setSnapshot({
            ...this.snapshot,
            transcript:
              transcript === transcriptWithUnavailablePermissions
                ? appendCancelledStatus(transcriptWithUnavailablePermissions)
                : transcript
          });
          this.flushPendingPrompts();
        }
        return;
      case "permission.request":
        if (message.clientSessionId !== this.snapshot.clientSessionId) return;
        this.handlePermissionRequest(message.request);
        return;
      case "session.error":
        if (message.clientSessionId !== this.snapshot.clientSessionId) return;
        this.handleSessionError(message.message, message.code);
        return;
      case "bridge.error":
        this.clearPendingAfterBridgeError();
        return;
    }
  }

  private flushPendingPrompts(): void {
    if (!this.snapshot.sessionStarted) return;
    if (this.turnInFlight) return;
    while (this.pendingSubmissions.length > 0) {
      const submission = this.pendingSubmissions.shift();
      if (submission === undefined) return;
      this.setSnapshot({ ...this.snapshot, pendingPromptCount: this.pendingSubmissions.length });
      const result = this.postSessionSend(submission);
      if (!result.ok) {
        this.removeFailedSubmissionAfterFlush(submission, result.error);
        return;
      }
      this.turnInFlight = true;
      this.cancelRequested = false;
      if (!submission.transcriptEntriesVisible) {
        submission.transcriptEntriesVisible = true;
        this.setSnapshot({
          ...this.snapshot,
          transcript: this.addSubmissionTranscriptEntries(this.snapshot.transcript, submission),
          lastError: undefined
        });
      } else {
        this.setSnapshot({ ...this.snapshot, lastError: undefined });
      }
      return;
    }
  }

  private postSessionSend(submission: PreparedPromptSubmission): ProtocolTransportPostResult {
    return this.transport.post(this.createSessionSendMessage(submission));
  }

  private createSessionSendMessage(submission: PreparedPromptSubmission): ExtensionToBridge {
    return {
      type: "session.send",
      version: 3,
      clientSessionId: this.snapshot.clientSessionId,
      prompt: submission.prompt,
      ...(submission.pageContext ? { pageContext: submission.pageContext } : {})
    };
  }

  private validateSessionSendPayload(submission: PreparedPromptSubmission): ProtocolTransportPostResult {
    const payloadSize = serializedJsonByteLength(this.createSessionSendMessage(submission));
    if (!payloadSize.ok) return { ok: false, error: "Message must be valid JSON" };
    if (exceedsPayloadByteLimit(payloadSize.byteLength, this.hardPayloadByteLimit)) {
      return { ok: false, error: BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE };
    }
    return { ok: true };
  }

  private recordLocalSubmissionError(message: string): void {
    this.setSnapshot({
      ...this.snapshot,
      lastError: message,
      transcript: addErrorStatusEntry(this.snapshot.transcript, message)
    });
  }

  private clearPendingAfterError(message: string, tone: "neutral" | "error" = "error"): void {
    const transcript = this.removePendingTranscriptEntries(this.snapshot.transcript);
    this.pendingSubmissions = [];
    this.clearPendingPermissionRequests();
    this.startPosted = false;
    this.turnInFlight = false;
    this.cancelRequested = false;
    this.suppressNextNoInFlightAfterCancelTerminal = false;
    this.suppressNextSessionStartedStatus = false;
    this.startupResultsToIgnore = 0;
    this.terminalTurnErrorsToIgnore = 0;
    this.setSnapshot({
      ...this.snapshot,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      lastError: message,
      transcript: tone === "error" ? addErrorStatusEntry(transcript, message) : addStatusEntry(transcript, message)
    });
  }

  private handleSessionError(message: string, code: SessionErrorCode | undefined): void {
    const effectiveCode = code ?? "unknown_error";
    if (effectiveCode === "no_in_flight_turn") {
      if (this.cancelRequested) {
        const transcript = failAssistantTurn(markPendingPermissionRequestsUnavailable(this.snapshot.transcript));
        this.clearPendingPermissionRequests();
        this.turnInFlight = false;
        this.cancelRequested = false;
        this.suppressNextNoInFlightAfterCancelTerminal = false;
        this.setSnapshot({
          ...this.snapshot,
          lastError: message,
          transcript: addErrorStatusEntry(transcript, message)
        });
        return;
      }

      if (this.suppressNextNoInFlightAfterCancelTerminal) {
        this.suppressNextNoInFlightAfterCancelTerminal = false;
        return;
      }
    }

    const terminalTurnError = this.isTerminalTurnError(effectiveCode);
    const fatalStartupError = this.isFatalStartupError(effectiveCode);
    if (this.shouldIgnoreStaleSessionError(terminalTurnError, fatalStartupError)) return;

    if (fatalStartupError) {
      this.clearPendingAfterError(message, "error");
      return;
    }

    if (effectiveCode === "session_not_started") {
      const transcript = failAssistantTurn(markPendingPermissionRequestsUnavailable(this.snapshot.transcript));
      this.pendingSubmissions = [];
      this.clearPendingPermissionRequests();
      this.startPosted = false;
      this.turnInFlight = false;
      this.cancelRequested = false;
      this.suppressNextNoInFlightAfterCancelTerminal = false;
      this.suppressNextSessionStartedStatus = false;
      this.startupResultsToIgnore = 0;
      this.terminalTurnErrorsToIgnore = 0;
      this.setSnapshot({
        ...this.snapshot,
        sessionStarted: false,
        starting: false,
        pendingPromptCount: 0,
        lastError: message,
        transcript: addErrorStatusEntry(transcript, message)
      });
      return;
    }

    const transcript = terminalTurnError
      ? failAssistantTurn(markPendingPermissionRequestsUnavailable(this.snapshot.transcript))
      : this.snapshot.transcript;
    if (terminalTurnError) {
      this.clearPendingPermissionRequests();
      this.clearRunningTurnAfterTerminalEvent();
    }
    this.setSnapshot({
      ...this.snapshot,
      lastError: message,
      transcript: addErrorStatusEntry(transcript, message)
    });
    if (terminalTurnError) this.flushPendingPrompts();
  }

  private isFatalStartupError(code: SessionErrorCode): boolean {
    return (
      this.snapshot.starting &&
      !this.snapshot.sessionStarted &&
      !this.turnInFlight &&
      !this.hasStreamingAssistantTurn() &&
      code !== "turn_in_flight" &&
      code !== "no_in_flight_turn"
    );
  }

  private isTerminalTurnError(code: SessionErrorCode): boolean {
    return code === "provider_error" || code === "unsafe_provider_event" || code === "unknown_error";
  }

  private shouldIgnoreStaleSessionError(terminalTurnError: boolean, fatalStartupError: boolean): boolean {
    if (fatalStartupError && this.startupResultsToIgnore > 0) {
      this.startupResultsToIgnore -= 1;
      return true;
    }
    if (terminalTurnError && this.terminalTurnErrorsToIgnore > 0) {
      this.terminalTurnErrorsToIgnore -= 1;
      return true;
    }
    return false;
  }

  private hasStreamingAssistantTurn(): boolean {
    return this.snapshot.transcript.some((entry) => entry.kind === "assistant_turn" && entry.status === "streaming");
  }

  private clearPendingAfterBridgeError(): void {
    const transcript = this.removePendingTranscriptEntries(this.snapshot.transcript);
    this.pendingSubmissions = [];
    this.clearPendingPermissionRequests();
    this.startPosted = false;
    this.turnInFlight = false;
    this.cancelRequested = false;
    this.suppressNextNoInFlightAfterCancelTerminal = false;
    this.suppressNextSessionStartedStatus = false;
    this.startupResultsToIgnore = 0;
    this.terminalTurnErrorsToIgnore = 0;
    this.setSnapshot({
      ...this.snapshot,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      lastError: undefined,
      transcript: failAssistantTurn(markPendingPermissionRequestsUnavailable(transcript))
    });
  }

  private removeFailedSubmissionAfterFlush(submission: PreparedPromptSubmission, message: string): void {
    const pendingEntriesToRemove = new Set(this.pendingTranscriptEntryIds());
    pendingEntriesToRemove.add(submission.transcriptEntryIds.promptId);
    if (submission.transcriptEntryIds.markerId) {
      pendingEntriesToRemove.add(submission.transcriptEntryIds.markerId);
    }

    this.pendingSubmissions = [];
    this.clearPendingPermissionRequests();
    this.startPosted = false;
    this.turnInFlight = false;
    this.cancelRequested = false;
    this.suppressNextNoInFlightAfterCancelTerminal = false;
    this.suppressNextSessionStartedStatus = false;
    this.startupResultsToIgnore = 0;
    this.terminalTurnErrorsToIgnore = 0;
    this.setSnapshot({
      ...this.snapshot,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      lastError: message,
      transcript: addErrorStatusEntry(
        removeTranscriptEntriesByIds(this.snapshot.transcript, pendingEntriesToRemove),
        message
      )
    });
  }

  private prepareSubmission(input: SubmissionInput): PreparedPromptSubmission | null {
    const prompt = typeof input === "string" ? input : input.prompt;
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return null;

    const pageContext = typeof input === "string" ? undefined : input.pageContext;
    const contextMarker =
      typeof input === "string" ? undefined : input.contextMarker ?? markerForPageContext(pageContext);
    return {
      prompt: normalizedPrompt,
      pageContext,
      contextMarker,
      userPromptDisplay: typeof input === "string" ? undefined : input.userPromptDisplay,
      transcriptEntriesVisible: false,
      transcriptEntryIds: {
        markerId: contextMarker ? this.createTranscriptEntryId() : undefined,
        promptId: this.createTranscriptEntryId()
      }
    };
  }

  private addSubmissionTranscriptEntries(
    transcript: TranscriptEntry[],
    submission: PreparedPromptSubmission
  ): TranscriptEntry[] {
    const withMarker =
      submission.contextMarker && submission.transcriptEntryIds.markerId
        ? addContextMarker(transcript, submission.contextMarker, submission.transcriptEntryIds.markerId)
        : transcript;
    return addUserPrompt(
      withMarker,
      submission.prompt,
      submission.transcriptEntryIds.promptId,
      submission.userPromptDisplay
    );
  }

  private handlePermissionRequest(request: PermissionRequest): void {
    if (!this.turnInFlight || this.cancelRequested) return;
    if (this.pendingPermissionKeysByRequestId.has(request.requestId)) return;

    this.pendingPermissionKeysByRequestId.set(request.requestId, request.permissionKey);
    this.setSnapshot({
      ...this.snapshot,
      transcript: addPermissionRequest(this.snapshot.transcript, request, this.createTranscriptEntryId())
    });
  }

  private removePendingTranscriptEntries(transcript: TranscriptEntry[]): TranscriptEntry[] {
    return removeTranscriptEntriesByIds(transcript, new Set(this.pendingTranscriptEntryIds()));
  }

  private pendingTranscriptEntryIds(): string[] {
    return this.pendingSubmissions.flatMap((submission) => {
      const ids = [submission.transcriptEntryIds.promptId];
      if (submission.transcriptEntryIds.markerId) ids.push(submission.transcriptEntryIds.markerId);
      return ids;
    });
  }

  private createTranscriptEntryId(): string {
    return `entry-${++nextTranscriptEntryId}`;
  }


  private setSnapshot(snapshot: BridgeSessionCoordinatorSnapshot): void {
    this.snapshot = this.withRuntimeState(snapshot);
    this.emit();
  }

  private withRuntimeState(snapshot: BridgeSessionCoordinatorSnapshot): BridgeSessionCoordinatorSnapshot {
    return {
      ...snapshot,
      turnInFlight: this.turnInFlight,
      canCancelTurn: this.turnInFlight && !this.cancelRequested && snapshot.sessionStarted
    };
  }

  private clearRunningTurnAfterTerminalEvent(): void {
    const hadCancelRequested = this.cancelRequested;
    this.turnInFlight = false;
    this.cancelRequested = false;
    this.clearPendingPermissionRequests();
    if (hadCancelRequested) this.suppressNextNoInFlightAfterCancelTerminal = true;
  }

  private clearPendingPermissionRequests(): void {
    this.pendingPermissionKeysByRequestId.clear();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

let nextTranscriptEntryId = 0;

function markerForPageContext(pageContext: PageContext | undefined): ContextAttachmentMarker | undefined {
  if (!pageContext) return undefined;
  if (pageContext.kind === "metadata_only") {
    if (pageContext.reason === "full_dom_too_large") {
      return { kind: "full_dom_too_large", text: "Full DOM skipped; content too large" };
    }

    if (pageContext.reason === "content_too_large") {
      return { kind: "page_metadata_content_too_large", text: "Page metadata attached; content too large" };
    }

    return { kind: "page_metadata_attached", text: "Page metadata attached" };
  }
  if (pageContext.kind === "full_dom") {
    return { kind: "full_dom_attached", text: "Full DOM attached" };
  }
  return { kind: "page_context_attached", text: "Page context attached" };
}

function appendCancelledStatus(transcript: TranscriptEntry[]): TranscriptEntry[] {
  return [...transcript, { kind: "status", role: "status", tone: "cancelled", text: "Assistant turn cancelled" }];
}
