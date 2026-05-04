import type { BridgeToExtension, ExtensionToBridge, ProviderId } from "@sidra/protocol";
import {
  addAssistantTextDelta,
  addStatusEntry,
  addUserPrompt,
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
};

export class BridgeSessionCoordinator {
  private clientSessionId: string;
  private readonly providerId: ProviderId;
  private readonly transport: ProtocolTransport;
  private readonly listeners = new Set<Listener>();
  private pendingPrompts: string[] = [];
  private startPosted = false;
  private suppressNextSessionStartedStatus = false;
  private snapshot: BridgeSessionCoordinatorSnapshot;

  constructor(options: BridgeSessionCoordinatorOptions) {
    this.clientSessionId = options.clientSessionId;
    this.providerId = options.providerId ?? "codex";
    this.transport = options.transport;
    this.snapshot = this.initialSnapshot();
    this.transport.subscribeToMessages((message) => this.handleBridgeMessage(message));
  }

  getSnapshot = (): BridgeSessionCoordinatorSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  sendPrompt(prompt: string): boolean {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return false;

    if (this.snapshot.sessionStarted) {
      if (!this.postSessionSend(normalizedPrompt)) return false;
      this.setSnapshot({
        ...this.snapshot,
        transcript: addUserPrompt(this.snapshot.transcript, normalizedPrompt),
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

    this.pendingPrompts.push(normalizedPrompt);
    this.setSnapshot({
      ...this.snapshot,
      pendingPromptCount: this.pendingPrompts.length,
      transcript: addUserPrompt(this.snapshot.transcript, normalizedPrompt),
      lastError: undefined
    });
    return true;
  }

  newChat(): void {
    const providerStateMayExist = this.startPosted || this.snapshot.sessionStarted || this.snapshot.starting;
    this.pendingPrompts = [];

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
    this.pendingPrompts = [];
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
    this.pendingPrompts = [];
    this.startPosted = false;
    this.setSnapshot({
      ...this.snapshot,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      transcript: addStatusEntry(this.snapshot.transcript, "Bridge disconnected")
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
        this.clearPendingAfterError(message.message);
        return;
    }
  }

  private flushPendingPrompts(): void {
    while (this.pendingPrompts.length > 0) {
      const prompt = this.pendingPrompts.shift();
      if (prompt === undefined) return;
      this.setSnapshot({ ...this.snapshot, pendingPromptCount: this.pendingPrompts.length });
      if (!this.postSessionSend(prompt)) return;
    }
  }

  private postSessionSend(prompt: string): boolean {
    const result = this.transport.post({
      type: "session.send",
      version: 1,
      clientSessionId: this.snapshot.clientSessionId,
      prompt
    });
    if (!result.ok) this.clearPendingAfterError(result.error);
    return result.ok;
  }

  private clearPendingAfterError(message: string): void {
    this.pendingPrompts = [];
    this.startPosted = false;
    this.suppressNextSessionStartedStatus = false;
    this.setSnapshot({
      ...this.snapshot,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      lastError: message,
      transcript: addStatusEntry(this.snapshot.transcript, message)
    });
  }

  private setSnapshot(snapshot: BridgeSessionCoordinatorSnapshot): void {
    this.snapshot = snapshot;
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
