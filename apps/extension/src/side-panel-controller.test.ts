import type { BridgeToExtension, ExtensionToBridge } from "@sidra/protocol";
import { describe, expect, it, vi } from "vitest";
import { type NativeBridgePort, SIDRA_NATIVE_HOST } from "./bridge/connection";
import { createSidePanelController } from "./side-panel-controller";

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
    for (const listener of this.disconnectListeners) listener();
  }

  emitMessage(message: BridgeToExtension): void {
    for (const listener of this.messageListeners) listener(message);
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
  const controller = createSidePanelController({
    connectNative,
    createClientSessionId: () => "client-1"
  });

  return { controller, connectNative, ports };
}

function sessionStarted(): BridgeToExtension {
  return {
    type: "session.started",
    version: 1,
    clientSessionId: "client-1",
    bridgeSessionId: "bridge-1"
  };
}

function bridgeReady(): BridgeToExtension {
  return { type: "bridge.ready", version: 1 };
}

describe("SidePanelController", () => {
  it("connects to the native bridge when the controller is created", () => {
    const { connectNative } = createHarness();

    expect(connectNative).toHaveBeenCalledTimes(1);
  });

  it("exposes chat as blocked until bridge.ready arrives", () => {
    const { controller } = createHarness();

    expect(controller.getSnapshot().bridge).toMatchObject({
      canUseChat: false,
      availability: { status: "checking" }
    });
  });

  it("enables chat after bridge.ready", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());

    expect(controller.getSnapshot().bridge).toMatchObject({
      canUseChat: true,
      availability: { status: "ready" }
    });
  });

  it("does not send prompts while bridge is unavailable", () => {
    const connectNative = vi.fn(() => {
      throw new Error("missing host");
    });
    const controller = createSidePanelController({
      connectNative,
      createClientSessionId: () => "client-1"
    });

    expect(controller.sendPrompt("hello")).toBe(false);
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
    expect(connectNative).toHaveBeenCalledTimes(1);
  });

  it("does not send prompts while bridge reports a blocking error", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

    expect(controller.sendPrompt("hello")).toBe(false);
    expect(ports[0].postedMessages).toEqual([]);
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("clears the blocking bridge error after retry succeeds", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });
    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());

    expect(controller.getSnapshot().bridge).toMatchObject({
      setupError: undefined,
      canUseChat: true,
      availability: { status: "ready" }
    });
  });

  it("does not keep queued prompts that failed before bridge.error recovery", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    expect(controller.sendPrompt("unsent")).toBe(true);
    ports[0].emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);

    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());

    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
    expect(controller.sendPrompt("after retry")).toBe(true);
    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
  });

  it("blocks new prompts after bridge disconnect until retry succeeds", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    expect(controller.sendPrompt("first")).toBe(true);
    ports[0].emitMessage(sessionStarted());
    ports[0].disconnect();

    expect(controller.sendPrompt("second")).toBe(false);
    expect(ports).toHaveLength(1);
    expect(controller.getSnapshot().bridge.canUseChat).toBe(false);

    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());

    expect(controller.sendPrompt("second")).toBe(true);
    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
  });

  it("blocks prompts after a ready idle bridge disconnects", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    ports[0].disconnect();

    expect(controller.getSnapshot().bridge.canUseChat).toBe(false);
    expect(controller.sendPrompt("hello")).toBe(false);
    expect(ports[0].postedMessages).toEqual([]);
  });

  it("retryBridge reconnects without recreating the controller", () => {
    const { controller, connectNative, ports } = createHarness();
    const firstSessionId = controller.getSnapshot().activeSession.clientSessionId;

    ports[0].disconnect();
    controller.retryBridge();

    expect(connectNative).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().activeSession.clientSessionId).toBe(firstSessionId);
  });

  it("retryBridge returns to usable chat after bridge.ready", () => {
    const ports: FakePort[] = [];
    const connectNative = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("missing host");
      })
      .mockImplementation(() => {
        const port = new FakePort();
        ports.push(port);
        return port;
      });
    const controller = createSidePanelController({
      connectNative,
      createClientSessionId: () => "client-1"
    });

    expect(controller.getSnapshot().bridge.canUseChat).toBe(false);
    controller.retryBridge();
    ports[0].emitMessage(bridgeReady());

    expect(controller.getSnapshot().bridge.canUseChat).toBe(true);
  });

  it("queues the first prompt until the bridge session starts", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    expect(controller.sendPrompt("hello")).toBe(true);

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(controller.getSnapshot().activeSession).toMatchObject({
      pendingPromptCount: 1,
      sessionStarted: false,
      starting: true
    });

    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "hello" }
    ]);
  });

  it("flushes queued prompts in order after session.started", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    controller.sendPrompt("second");
    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
  });

  it("starts a new provider session before sending after retrying a native bridge disconnect", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    ports[0].disconnect();
    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());
    controller.sendPrompt("second");

    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);

    ports[1].emitMessage(sessionStarted());

    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
  });

  it("renders user and assistant transcript entries through the controller snapshot", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage({
      type: "agent.event",
      version: 1,
      clientSessionId: "client-1",
      event: { type: "assistant.text.delta", text: "Hi" }
    });

    expect(controller.getSnapshot().activeSession.transcript).toEqual([
      { role: "user", text: "hello" },
      { role: "status", text: "Session started" },
      { role: "assistant", text: "Hi" }
    ]);
  });

  it("rejects blank prompts without changing the snapshot", () => {
    const { controller, connectNative } = createHarness();
    const before = controller.getSnapshot();

    expect(controller.sendPrompt("   ")).toBe(false);

    expect(controller.getSnapshot()).toEqual(before);
    expect(connectNative).toHaveBeenCalledTimes(1);
  });

  it("returns the same snapshot object until controller state changes", () => {
    const { controller, ports } = createHarness();
    const initial = controller.getSnapshot();

    expect(controller.getSnapshot()).toBe(initial);

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");
    const afterPrompt = controller.getSnapshot();

    expect(afterPrompt).not.toBe(initial);
    expect(controller.getSnapshot()).toBe(afterPrompt);

    ports[0].emitMessage(sessionStarted());
    const afterStarted = controller.getSnapshot();

    expect(afterStarted).not.toBe(afterPrompt);
    expect(controller.getSnapshot()).toBe(afterStarted);
  });

  it("surfaces bridge errors as setup state without exposing protocol details to the view", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");
    ports[0].emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

    expect(controller.getSnapshot().bridge).toEqual({
      connected: true,
      ready: false,
      setupError: "bridge failed",
      canUseChat: false,
      availability: { status: "error", message: "bridge failed", code: undefined }
    });
  });
});

describe("SidePanelController newChat", () => {
  it("clears the active transcript and pending prompts", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    controller.sendPrompt("second");
    controller.newChat();

    expect(controller.getSnapshot().activeSession).toMatchObject({
      pendingPromptCount: 0,
      sessionStarted: false,
      starting: true,
      transcript: []
    });
    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.reset", version: 1, clientSessionId: "client-1" }
    ]);
  });

  it("sends session.reset for the active clientSessionId when provider state may exist", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    controller.newChat();

    expect(ports[0].postedMessages).toContainEqual({
      type: "session.reset",
      version: 1,
      clientSessionId: "client-1"
    });
  });

  it("does not send reset for a never-started empty session", () => {
    const { controller, connectNative } = createHarness();

    controller.newChat();

    expect(connectNative).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("keeps bridge connection state when clearing local session state", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage({ type: "bridge.ready", version: 1 });
    controller.sendPrompt("first");
    controller.newChat();

    expect(controller.getSnapshot().bridge).toEqual({
      connected: true,
      ready: true,
      setupError: undefined,
      canUseChat: true,
      availability: { status: "ready" }
    });
  });

  it("uses the fresh session.started event after reset before sending later prompts", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    controller.newChat();
    controller.sendPrompt("after reset");

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.reset", version: 1, clientSessionId: "client-1" }
    ]);

    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.reset", version: 1, clientSessionId: "client-1" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "after reset" }
    ]);
  });

  it("keeps the visible chat empty when reset session.started arrives with no queued prompt", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    controller.newChat();
    ports[0].emitMessage(sessionStarted());

    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
    expect(controller.getSnapshot().activeSession).toMatchObject({
      sessionStarted: true,
      starting: false,
      pendingPromptCount: 0
    });
  });
});
