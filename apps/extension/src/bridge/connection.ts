import { parseBridgeToExtension, type BridgeToExtension, type ExtensionToBridge } from "@sidra/protocol";

export const SIDRA_NATIVE_HOST = "com.sidra.agent_bridge";

export type NativeBridgePort = {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
};

export type BridgeAvailability =
  | { status: "checking"; message: string }
  | { status: "ready" }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string; code?: string };

export type BridgeConnectionSnapshot = {
  connected: boolean;
  ready: boolean;
  setupError?: string;
  availability: BridgeAvailability;
};

export type PostResult = { ok: true } | { ok: false; error: string };

type Listener = () => void;
type MessageListener = (message: BridgeToExtension) => void;

type BridgeConnectionOptions = {
  connectNative(application: string): NativeBridgePort;
  hostName?: string;
};

const checkingAvailability: BridgeAvailability = {
  status: "checking",
  message: "Connecting to Sidra bridge..."
};

const bridgeUnavailableMessage = "Sidra cannot connect to the local bridge.";

/**
 * Owns the extension's Native Messaging port.
 *
 * This is the only extension boundary that opens `chrome.runtime.connectNative`.
 * It validates raw bridge messages, tracks readiness, and exposes transport
 * state without leaking Chrome port details into application or React code.
 */
export class BridgeConnection {
  private readonly connectNative: BridgeConnectionOptions["connectNative"];
  private readonly hostName: string;
  private readonly listeners = new Set<Listener>();
  private readonly messageListeners = new Set<MessageListener>();
  private port: NativeBridgePort | null = null;
  private snapshot: BridgeConnectionSnapshot = {
    connected: false,
    ready: false,
    availability: checkingAvailability
  };

  constructor(options: BridgeConnectionOptions) {
    this.connectNative = options.connectNative;
    this.hostName = options.hostName ?? SIDRA_NATIVE_HOST;
  }

  getSnapshot = (): BridgeConnectionSnapshot => this.snapshot;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeToMessages = (listener: MessageListener): (() => void) => {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  };

  post(message: ExtensionToBridge): PostResult {
    const connectResult = this.connect();
    if (!connectResult.ok) return connectResult;
    const port = this.port;
    if (!port) return { ok: false, error: bridgeUnavailableMessage };

    try {
      port.postMessage(message);
      return { ok: true };
    } catch (error) {
      const message = errorMessage(error, "Bridge post failed");
      this.port = null;
      this.setSnapshot({
        connected: false,
        ready: false,
        setupError: message,
        availability: { status: "error", message }
      });
      return { ok: false, error: message };
    }
  }

  connect(): PostResult {
    if (this.port) return { ok: true };

    try {
      const port = this.connectNative(this.hostName);
      this.port = port;
      port.onMessage.addListener((message) => this.handleMessage(port, message));
      port.onDisconnect.addListener(() => this.handleDisconnect(port));
      this.setSnapshot({ connected: true, ready: false, availability: checkingAvailability });
      return { ok: true };
    } catch (error) {
      const message = errorMessage(error, bridgeUnavailableMessage);
      this.setSnapshot({
        connected: false,
        ready: false,
        setupError: message,
        availability: { status: "unavailable", message }
      });
      return { ok: false, error: message };
    }
  }

  retry(): PostResult {
    const stalePort = this.port;
    this.port = null;
    stalePort?.disconnect();
    return this.connect();
  }

  disconnect(): void {
    const currentPort = this.port;
    this.port = null;
    currentPort?.disconnect();
    this.setUnavailableSnapshot(bridgeUnavailableMessage);
  }

  private handleMessage(port: NativeBridgePort, message: unknown): void {
    if (this.port !== port) return;

    const parsed = parseBridgeToExtension(message);
    if (!parsed.ok) {
      this.setSnapshot({
        connected: true,
        ready: false,
        setupError: parsed.error,
        availability: { status: "error", message: parsed.error, code: "invalid_message" }
      });
      return;
    }

    if (parsed.value.type === "bridge.ready") {
      this.setSnapshot({ connected: true, ready: true, availability: { status: "ready" } });
    }

    if (parsed.value.type === "bridge.error") {
      this.setSnapshot({
        connected: true,
        ready: false,
        setupError: parsed.value.message,
        availability: { status: "error", message: parsed.value.message, code: parsed.value.code }
      });
    }

    for (const listener of this.messageListeners) listener(parsed.value);
  }

  private handleDisconnect(port: NativeBridgePort): void {
    if (this.port !== port) return;
    this.port = null;
    this.setUnavailableSnapshot(bridgeUnavailableMessage);
  }

  private setSnapshot(snapshot: BridgeConnectionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private setUnavailableSnapshot(message: string): void {
    this.setSnapshot({
      connected: false,
      ready: false,
      setupError: message,
      availability: { status: "unavailable", message }
    });
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
