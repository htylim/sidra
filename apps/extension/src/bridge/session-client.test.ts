import type { BridgeToExtension, ExtensionToBridge } from "@sidra/protocol";
import { describe, expect, it, vi } from "vitest";
import { BridgeSessionClient, type NativeBridgePort, SIDRA_NATIVE_HOST } from "./session-client";

class FakePort implements NativeBridgePort {
  readonly postedMessages: ExtensionToBridge[] = [];
  private readonly messageListeners: Array<(message: unknown) => void> = [];
  private readonly disconnectListeners: Array<() => void> = [];

  onMessage = {
    addListener: (listener: (message: unknown) => void) => {
      this.messageListeners.push(listener);
    }
  };

  onDisconnect = {
    addListener: (listener: () => void) => {
      this.disconnectListeners.push(listener);
    }
  };

  postMessage(message: unknown): void {
    this.postedMessages.push(message as ExtensionToBridge);
  }

  disconnect(): void {
    this.emitDisconnect();
  }

  emitMessage(message: BridgeToExtension): void {
    for (const listener of this.messageListeners) listener(message);
  }

  emitDisconnect(): void {
    for (const listener of this.disconnectListeners) listener();
  }
}

function createHarness() {
  const ports: FakePort[] = [];
  const connectNative = vi.fn((hostName: string) => {
    expect(hostName).toBe(SIDRA_NATIVE_HOST);
    const port = new FakePort();
    ports.push(port);
    return port;
  });
  let sessionIdSequence = 0;
  const client = new BridgeSessionClient({
    connectNative,
    createClientSessionId: () => `client-${++sessionIdSequence}`
  });

  return { client, connectNative, ports };
}

function sessionStarted(clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "session.started",
    version: 1,
    clientSessionId,
    bridgeSessionId: "bridge-1"
  };
}

describe("BridgeSessionClient", () => {
  it("queues the first prompt until the provider session has started", () => {
    const { client, ports } = createHarness();

    client.sendPrompt("hello");

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(client.getSnapshot()).toMatchObject({
      pendingPromptCount: 1,
      sessionStarted: false,
      starting: true
    });

    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "hello" }
    ]);
    expect(client.getSnapshot()).toMatchObject({
      pendingPromptCount: 0,
      sessionStarted: true,
      starting: false
    });
  });

  it("flushes multiple prompts sent during startup in order", () => {
    const { client, ports } = createHarness();

    client.sendPrompt("first");
    client.sendPrompt("second");

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(client.getSnapshot().pendingPromptCount).toBe(2);

    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
    expect(client.getSnapshot().pendingPromptCount).toBe(0);
  });

  it("reuses the started provider session for subsequent prompts", () => {
    const { client, ports } = createHarness();

    client.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    client.sendPrompt("second");

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
  });

  it("resets bridge and session state after disconnect", () => {
    const { client, connectNative, ports } = createHarness();

    client.sendPrompt("before disconnect");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitDisconnect();

    expect(client.getSnapshot()).toMatchObject({
      connected: false,
      bridgeReady: false,
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0
    });

    client.sendPrompt("after disconnect");

    expect(connectNative).toHaveBeenCalledTimes(2);
    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
  });

  it("clears pending state after bridge errors", () => {
    const { client, ports } = createHarness();

    client.sendPrompt("first");
    client.sendPrompt("second");
    ports[0].emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

    expect(client.getSnapshot()).toMatchObject({
      pendingPromptCount: 0,
      sessionStarted: false,
      starting: false,
      lastError: "bridge failed"
    });

    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(client.getSnapshot().sessionStarted).toBe(false);
  });
});
