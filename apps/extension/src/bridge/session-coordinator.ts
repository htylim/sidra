import type { BridgeToExtension, ExtensionToBridge, PageContext, ProviderId } from "@sidra/protocol";
import {
  BRIDGE_HARD_PAYLOAD_BYTE_LIMIT,
  BRIDGE_PAYLOAD_TOO_LARGE_MESSAGE,
  exceedsPayloadByteLimit,
  serializedJsonByteLength
} from "@sidra/protocol";
import {
  addAssistantTextDelta,
  addContextMarker,
  addStatusEntry,
  addUserPrompt,
  removeTranscriptEntriesByIds,
  type ContextAttachmentMarker,
  type TranscriptEntry
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
  // Submissions sent before `session.started` must wait for the bridge to create provider state.
  private pendingSubmissions: PreparedPromptSubmission[] = [];
  // Tracks whether the bridge may already have provider state for this session.
  private startPosted = false;
  // New Chat sends `session.reset`, whose success also arrives as `session.started`.
  private suppressNextSessionStartedStatus = false;
  private snapshot: BridgeSessionCoordinatorSnapshot;

  constructor(options: BridgeSessionCoordinatorOptions) {
    this.clientSessionId = options.clientSessionId;
    this.providerId = options.providerId ?? "codex";
    this.transport = options.transport;
    this.hardPayloadByteLimit = options.hardPayloadByteLimit ?? BRIDGE_HARD_PAYLOAD_BYTE_LIMIT;
    this.snapshot = this.initialSnapshot();
    this.transport.subscribeToMessages((message) => this.handleBridgeMessage(message));
  }

  getSnapshot = (): BridgeSessionCoordinatorSnapshot => this.snapshot;

  hasProviderState = (): boolean =>
    this.startPosted || this.snapshot.sessionStarted || this.snapshot.starting;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  sendPrompt(input: SubmissionInput): boolean {
    const submission = this.prepareSubmission(input);
    if (!submission) return false;
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
        version: 1,
        clientSessionId: this.clientSessionId,
        providerId: this.providerId
      });

      if (!result.ok) {
        this.clearPendingAfterError(result.error);
        return false;
      }
    }

    this.pendingSubmissions.push(submission);
    this.setSnapshot({
      ...this.snapshot,
      pendingPromptCount: this.pendingSubmissions.length,
      transcript: this.addSubmissionTranscriptEntries(this.snapshot.transcript, submission),
      lastError: undefined
    });
    return true;
  }

  recordCaptureUnavailable(message: string): void {
    this.setSnapshot({
      ...this.snapshot,
      transcript: addContextMarker(
        this.snapshot.transcript,
        { kind: "capture_unavailable", text: "Could not capture this page" },
        this.createTranscriptEntryId()
      ),
      lastError: message
    });
  }

  newChat(): void {
    const providerStateMayExist = this.startPosted || this.snapshot.sessionStarted || this.snapshot.starting;
    this.pendingSubmissions = [];

    if (!providerStateMayExist) {
      this.startPosted = false;
      this.suppressNextSessionStartedStatus = false;
      this.setSnapshot(this.initialSnapshot());
      return;
    }

    const result = this.transport.post({
      type: "session.reset",
      version: 1,
      clientSessionId: this.clientSessionId
    });

    if (!result.ok) {
      this.startPosted = false;
      this.suppressNextSessionStartedStatus = false;
      this.setSnapshot({
        ...this.initialSnapshot(),
        lastError: result.error,
        transcript: addStatusEntry([], result.error)
      });
      return;
    }

    this.startPosted = true;
    this.suppressNextSessionStartedStatus = true;
    this.setSnapshot({
      ...this.initialSnapshot(),
      starting: true
    });
  }

  reset(clientSessionId: string): void {
    this.clientSessionId = clientSessionId;
    this.pendingSubmissions = [];
    this.startPosted = false;
    this.suppressNextSessionStartedStatus = false;
    this.snapshot = {
      clientSessionId,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      transcript: []
    };
    this.emit();
  }

  markBridgeDisconnected(): void {
    const transcript = this.removePendingTranscriptEntries(this.snapshot.transcript);
    this.pendingSubmissions = [];
    this.startPosted = false;
    this.setSnapshot({
      ...this.snapshot,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      transcript: addStatusEntry(transcript, "Bridge disconnected")
    });
  }

  private initialSnapshot(): BridgeSessionCoordinatorSnapshot {
    return {
      clientSessionId: this.clientSessionId,
      sessionStarted: false,
      starting: false,
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
        if (message.event.type === "assistant.text.delta") {
          this.setSnapshot({
            ...this.snapshot,
            transcript: addAssistantTextDelta(this.snapshot.transcript, message.event.text)
          });
        }
        return;
      case "session.error":
        if (message.clientSessionId !== this.snapshot.clientSessionId) return;
        this.clearPendingAfterError(message.message);
        return;
      case "bridge.error":
        this.clearPendingAfterBridgeError();
        return;
    }
  }

  private flushPendingPrompts(): void {
    while (this.pendingSubmissions.length > 0) {
      const submission = this.pendingSubmissions.shift();
      if (submission === undefined) return;
      this.setSnapshot({ ...this.snapshot, pendingPromptCount: this.pendingSubmissions.length });
      const result = this.postSessionSend(submission);
      if (!result.ok) {
        this.removeFailedSubmissionAfterFlush(submission, result.error);
        return;
      }
    }
  }

  private postSessionSend(submission: PreparedPromptSubmission): ProtocolTransportPostResult {
    return this.transport.post(this.createSessionSendMessage(submission));
  }

  private createSessionSendMessage(submission: PreparedPromptSubmission): ExtensionToBridge {
    return {
      type: "session.send",
      version: 1,
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
      transcript: addStatusEntry(this.snapshot.transcript, message)
    });
  }

  private clearPendingAfterError(message: string): void {
    const transcript = this.removePendingTranscriptEntries(this.snapshot.transcript);
    this.pendingSubmissions = [];
    this.startPosted = false;
    this.suppressNextSessionStartedStatus = false;
    this.setSnapshot({
      ...this.snapshot,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      lastError: message,
      transcript: addStatusEntry(transcript, message)
    });
  }

  private clearPendingAfterBridgeError(): void {
    const transcript = this.removePendingTranscriptEntries(this.snapshot.transcript);
    this.pendingSubmissions = [];
    this.startPosted = false;
    this.suppressNextSessionStartedStatus = false;
    this.setSnapshot({
      ...this.snapshot,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      lastError: undefined,
      transcript
    });
  }

  private removeFailedSubmissionAfterFlush(submission: PreparedPromptSubmission, message: string): void {
    const pendingEntriesToRemove = new Set(this.pendingTranscriptEntryIds());
    pendingEntriesToRemove.add(submission.transcriptEntryIds.promptId);
    if (submission.transcriptEntryIds.markerId) {
      pendingEntriesToRemove.add(submission.transcriptEntryIds.markerId);
    }

    this.pendingSubmissions = [];
    this.startPosted = false;
    this.suppressNextSessionStartedStatus = false;
    this.setSnapshot({
      ...this.snapshot,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      lastError: message,
      transcript: addStatusEntry(
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
    return addUserPrompt(withMarker, submission.prompt, submission.transcriptEntryIds.promptId);
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
    this.snapshot = snapshot;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

let nextTranscriptEntryId = 0;

function markerForPageContext(pageContext: PageContext | undefined): ContextAttachmentMarker | undefined {
  if (!pageContext) return undefined;
  if (pageContext.kind === "metadata_only") {
    if (pageContext.reason === "content_too_large") {
      return { kind: "page_metadata_content_too_large", text: "Page metadata attached; content too large" };
    }

    return { kind: "page_metadata_attached", text: "Page metadata attached" };
  }
  return { kind: "page_context_attached", text: "Page context attached" };
}
