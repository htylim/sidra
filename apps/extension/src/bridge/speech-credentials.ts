import { PROTOCOL_VERSION, type BridgeToExtension, type ExtensionToBridge, type SpeechCredentialStatus } from "@sidra/protocol";
import type { BridgeConnectionSnapshot, PostResult } from "./connection";

type Listener = () => void;

export type SpeechCredentialClientSnapshot = {
  status: SpeechCredentialStatus;
  busy: boolean;
  error?: string;
  successMessage?: string;
  disconnectGeneration: number;
};

export type SpeechCredentialTransport = {
  post(message: ExtensionToBridge): PostResult;
  subscribe(listener: Listener): () => void;
  subscribeToMessages(listener: (message: BridgeToExtension) => void): () => void;
  getSnapshot(): BridgeConnectionSnapshot;
};

export class SpeechCredentialClient {
  private readonly transport: SpeechCredentialTransport;
  private readonly listeners = new Set<Listener>();
  private readonly unsubscribeTransportMessages: () => void;
  private readonly unsubscribeTransportState: () => void;
  private snapshot: SpeechCredentialClientSnapshot = {
    status: { configured: false },
    busy: false,
    disconnectGeneration: 0
  };

  constructor(options: { transport: SpeechCredentialTransport }) {
    this.transport = options.transport;
    this.unsubscribeTransportMessages = this.transport.subscribeToMessages((message) => this.handleBridgeMessage(message));
    this.unsubscribeTransportState = this.transport.subscribe(() => this.handleTransportStateChange());
  }

  getSnapshot = (): SpeechCredentialClientSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  dispose(): void {
    this.unsubscribeTransportMessages();
    this.unsubscribeTransportState();
    this.listeners.clear();
  }

  requestStatus(): PostResult {
    return this.postCredentialMessage({ type: "speech.credentials.status", version: PROTOCOL_VERSION });
  }

  saveApiKey(apiKey: string): PostResult {
    return this.postCredentialMessage({ type: "speech.credentials.save", version: PROTOCOL_VERSION, apiKey });
  }

  testApiKey(apiKey?: string): PostResult {
    return this.postCredentialMessage(
      apiKey === undefined
        ? { type: "speech.credentials.test", version: PROTOCOL_VERSION }
        : { type: "speech.credentials.test", version: PROTOCOL_VERSION, apiKey }
    );
  }

  removeApiKey(): PostResult {
    return this.postCredentialMessage({ type: "speech.credentials.remove", version: PROTOCOL_VERSION });
  }

  private postCredentialMessage(message: ExtensionToBridge): PostResult {
    const result = this.transport.post(message);
    if (!result.ok) {
      this.setSnapshot({ ...this.snapshot, busy: false, error: result.error, successMessage: undefined });
      return result;
    }

    this.setSnapshot({ ...this.snapshot, busy: true, error: undefined, successMessage: undefined });
    return result;
  }

  private handleBridgeMessage(message: BridgeToExtension): void {
    switch (message.type) {
      case "speech.credentials.status":
      case "speech.credentials.saved":
      case "speech.credentials.removed":
        this.setSnapshot({
          ...this.snapshot,
          status: credentialStatusFromBridgeMessage(message),
          busy: false,
          error: undefined,
          successMessage: credentialSuccessMessage(message)
        });
        return;
      case "speech.credentials.tested":
        this.setSnapshot({
          ...this.snapshot,
          busy: false,
          error: undefined,
          successMessage: "OpenAI API key test succeeded."
        });
        return;
      case "speech.credentials.error":
        this.setSnapshot({ ...this.snapshot, busy: false, error: message.message, successMessage: undefined });
        return;
      default:
        return;
    }
  }

  private handleTransportStateChange(): void {
    const transportSnapshot = this.transport.getSnapshot();
    if (transportSnapshot.availability.status === "error") {
      this.setSnapshot({
        ...this.snapshot,
        busy: false,
        error: transportSnapshot.setupError ?? transportSnapshot.availability.message,
        successMessage: undefined
      });
      return;
    }

    if (transportSnapshot.connected) return;
    this.setSnapshot({
      ...this.snapshot,
      busy: false,
      error: "Sidra bridge disconnected.",
      successMessage: undefined,
      disconnectGeneration: this.snapshot.disconnectGeneration + 1
    });
  }

  private setSnapshot(snapshot: SpeechCredentialClientSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

function credentialStatusFromBridgeMessage(
  message: Extract<BridgeToExtension, { type: "speech.credentials.status" | "speech.credentials.saved" | "speech.credentials.removed" }>
): SpeechCredentialStatus {
  if (!message.configured) return { configured: false };
  return { configured: true, source: message.source, redactedKey: message.redactedKey };
}

function credentialSuccessMessage(
  message: Extract<BridgeToExtension, { type: "speech.credentials.status" | "speech.credentials.saved" | "speech.credentials.removed" }>
): string | undefined {
  if (message.type === "speech.credentials.saved") return "OpenAI API key saved.";
  if (message.type === "speech.credentials.removed") {
    return message.configured ? "OpenAI API key removed. Using environment key." : "OpenAI API key removed.";
  }
  return undefined;
}
