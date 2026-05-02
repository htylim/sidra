import type { BridgeToExtension, ExtensionToBridge, ProviderId } from "@sidra/protocol";

export const SIDRA_NATIVE_HOST = "com.sidra.agent_bridge";

export type ChatMessage = { role: "user" | "assistant" | "status"; text: string };

export type BridgeSessionState = {
  clientSessionId: string;
  connected: boolean;
  bridgeReady: boolean;
  sessionStarted: boolean;
  starting: boolean;
  pendingPromptCount: number;
  messages: ChatMessage[];
  lastError?: string;
};

export type NativeBridgePort = {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
};

type BridgeSessionClientOptions = {
  connectNative(application: string): NativeBridgePort;
  createClientSessionId(): string;
  hostName?: string;
  providerId?: ProviderId;
};

type Listener = () => void;

export class BridgeSessionClient {
  private readonly connectNative: BridgeSessionClientOptions["connectNative"];
  private readonly createClientSessionId: BridgeSessionClientOptions["createClientSessionId"];
  private readonly hostName: string;
  private readonly providerId: ProviderId;
  private readonly listeners = new Set<Listener>();
  private pendingPrompts: string[] = [];
  private port: NativeBridgePort | null = null;
  private startPosted = false;
  private state: BridgeSessionState;

  constructor(options: BridgeSessionClientOptions) {
    this.connectNative = options.connectNative;
    this.createClientSessionId = options.createClientSessionId;
    this.hostName = options.hostName ?? SIDRA_NATIVE_HOST;
    this.providerId = options.providerId ?? "codex";
    this.state = this.initialState(this.createClientSessionId());
  }

  getSnapshot = (): BridgeSessionState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  sendPrompt(prompt: string): boolean {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return false;

    this.setState({
      messages: [...this.state.messages, { role: "user", text: normalizedPrompt }],
      lastError: undefined
    });

    if (this.state.sessionStarted) {
      return this.postSessionSend(normalizedPrompt);
    }

    this.pendingPrompts.push(normalizedPrompt);
    this.setState({ pendingPromptCount: this.pendingPrompts.length });

    if (!this.startPosted) {
      this.startPosted = true;
      this.setState({ starting: true });
      this.postBridgeMessage({
        type: "session.start",
        version: 1,
        clientSessionId: this.state.clientSessionId,
        providerId: this.providerId
      });
    } else {
      this.ensurePort();
    }

    return true;
  }

  retryBridge(): void {
    this.ensurePort();
  }

  reset(): void {
    this.pendingPrompts = [];
    this.startPosted = false;
    this.state = {
      ...this.initialState(this.createClientSessionId()),
      connected: this.port !== null,
      bridgeReady: this.port !== null && this.state.bridgeReady
    };
    this.emit();
  }

  private initialState(clientSessionId: string): BridgeSessionState {
    return {
      clientSessionId,
      connected: false,
      bridgeReady: false,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      messages: []
    };
  }

  private ensurePort(): NativeBridgePort | null {
    if (this.port) return this.port;

    try {
      const port = this.connectNative(this.hostName);
      this.port = port;
      port.onMessage.addListener((message) => this.handleBridgeMessage(message as BridgeToExtension));
      port.onDisconnect.addListener(() => this.handleDisconnect(port));
      this.setState({ connected: true, bridgeReady: false, lastError: undefined });
      return port;
    } catch (error) {
      this.handleBridgeFailure(errorMessage(error, "Bridge unavailable"));
      return null;
    }
  }

  private handleBridgeMessage(message: BridgeToExtension): void {
    switch (message.type) {
      case "bridge.ready":
        this.setState({ connected: true, bridgeReady: true });
        return;
      case "session.started":
        if (message.clientSessionId !== this.state.clientSessionId || !this.startPosted) return;
        this.setState({
          sessionStarted: true,
          starting: false,
          messages: [...this.state.messages, { role: "status", text: "Session started" }]
        });
        this.flushPendingPrompts();
        return;
      case "agent.event":
        if (message.clientSessionId !== this.state.clientSessionId) return;
        if (message.event.type === "assistant.text.delta") {
          this.setState({
            messages: [...this.state.messages, { role: "assistant", text: message.event.text }]
          });
        }
        return;
      case "session.error":
        if (message.clientSessionId !== this.state.clientSessionId) return;
        this.clearPendingAfterError(message.message);
        return;
      case "bridge.error":
        this.clearPendingAfterError(message.message);
        return;
    }
  }

  private handleDisconnect(port: NativeBridgePort): void {
    if (this.port !== port) return;

    this.port = null;
    this.pendingPrompts = [];
    this.startPosted = false;
    this.setState({
      connected: false,
      bridgeReady: false,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      messages: [...this.state.messages, { role: "status", text: "Bridge disconnected" }]
    });
  }

  private flushPendingPrompts(): void {
    while (this.pendingPrompts.length > 0) {
      const prompt = this.pendingPrompts.shift();
      if (prompt === undefined) return;
      this.setState({ pendingPromptCount: this.pendingPrompts.length });
      if (!this.postSessionSend(prompt)) return;
    }
  }

  private postSessionSend(prompt: string): boolean {
    return this.postBridgeMessage({
      type: "session.send",
      version: 1,
      clientSessionId: this.state.clientSessionId,
      prompt
    });
  }

  private postBridgeMessage(message: ExtensionToBridge): boolean {
    const port = this.ensurePort();
    if (!port) return false;

    try {
      port.postMessage(message);
      return true;
    } catch (error) {
      this.handleBridgeFailure(errorMessage(error, "Bridge post failed"));
      return false;
    }
  }

  private clearPendingAfterError(message: string): void {
    this.pendingPrompts = [];
    this.startPosted = false;
    this.setState({
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      lastError: message,
      messages: [...this.state.messages, { role: "status", text: message }]
    });
  }

  private handleBridgeFailure(message: string): void {
    this.pendingPrompts = [];
    this.port = null;
    this.startPosted = false;
    this.setState({
      connected: false,
      bridgeReady: false,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      lastError: message,
      messages: [...this.state.messages, { role: "status", text: message }]
    });
  }

  private setState(patch: Partial<BridgeSessionState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createChromeBridgeSessionClient(): BridgeSessionClient {
  return new BridgeSessionClient({
    connectNative: (hostName) => chrome.runtime.connectNative(hostName),
    createClientSessionId: () => `sidra-${crypto.randomUUID()}`
  });
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}
