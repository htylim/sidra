import { parseBridgeToExtension, type BridgeToExtension, type ExtensionToBridge } from "@sidra/protocol";

export const SIDRA_NATIVE_HOST = "com.sidra.agent_bridge";

export type NativeBridgePort = {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
};

export type BridgeConnectionSnapshot = {
  connected: boolean;
  ready: boolean;
  setupError?: string;
};

export type PostResult = { ok: true } | { ok: false; error: string };

type Listener = () => void;
type MessageListener = (message: BridgeToExtension) => void;

type BridgeConnectionOptions = {
  connectNative(application: string): NativeBridgePort;
  hostName?: string;
};

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
  private snapshot: BridgeConnectionSnapshot = { connected: false, ready: false };

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
    const portResult = this.ensurePort();
    if (!portResult.ok) return portResult;

    try {
      portResult.port.postMessage(message);
      return { ok: true };
    } catch (error) {
      const message = errorMessage(error, "Bridge post failed");
      this.port = null;
      this.setSnapshot({ connected: false, ready: false, setupError: message });
      return { ok: false, error: message };
    }
  }

  retry(): void {
    this.ensurePort();
  }

  disconnect(): void {
    this.port?.disconnect();
    this.port = null;
    this.setSnapshot({ connected: false, ready: false });
  }

  private ensurePort(): { ok: true; port: NativeBridgePort } | { ok: false; error: string } {
    if (this.port) return { ok: true, port: this.port };

    try {
      const port = this.connectNative(this.hostName);
      this.port = port;
      port.onMessage.addListener((message) => this.handleMessage(port, message));
      port.onDisconnect.addListener(() => this.handleDisconnect(port));
      this.setSnapshot({ connected: true, ready: false });
      return { ok: true, port };
    } catch (error) {
      const message = errorMessage(error, "Bridge unavailable");
      this.setSnapshot({ connected: false, ready: false, setupError: message });
      return { ok: false, error: message };
    }
  }

  private handleMessage(port: NativeBridgePort, message: unknown): void {
    if (this.port !== port) return;

    const parsed = parseBridgeToExtension(message);
    if (!parsed.ok) {
      this.setSnapshot({ ...this.snapshot, setupError: parsed.error });
      return;
    }

    if (parsed.value.type === "bridge.ready") {
      this.setSnapshot({ connected: true, ready: true });
    }

    for (const listener of this.messageListeners) listener(parsed.value);
  }

  private handleDisconnect(port: NativeBridgePort): void {
    if (this.port !== port) return;
    this.port = null;
    this.setSnapshot({ connected: false, ready: false });
  }

  private setSnapshot(snapshot: BridgeConnectionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
