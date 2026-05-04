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

describe("SidePanelController", () => {
  it("queues the first prompt until the bridge session starts", () => {
    const { controller, ports } = createHarness();

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

    controller.sendPrompt("first");
    controller.sendPrompt("second");
    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
  });

  it("starts a new provider session before sending after the native bridge disconnects", () => {
    const { controller, ports } = createHarness();

    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    ports[0].disconnect();
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
    expect(connectNative).not.toHaveBeenCalled();
  });

  it("returns the same snapshot object until controller state changes", () => {
    const { controller, ports } = createHarness();
    const initial = controller.getSnapshot();

    expect(controller.getSnapshot()).toBe(initial);

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

    controller.sendPrompt("hello");
    ports[0].emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

    expect(controller.getSnapshot().bridge).toEqual({
      connected: true,
      ready: false,
      setupError: "bridge failed"
    });
  });
});

describe("SidePanelController newChat", () => {
  it("clears the active transcript and pending prompts", () => {
    const { controller, ports } = createHarness();

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

    expect(connectNative).not.toHaveBeenCalled();
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("keeps bridge connection state when clearing local session state", () => {
    const { controller, ports } = createHarness();

    controller.sendPrompt("first");
    ports[0].emitMessage({ type: "bridge.ready", version: 1 });
    controller.newChat();

    expect(controller.getSnapshot().bridge).toEqual({
      connected: true,
      ready: true,
      setupError: undefined
    });
  });

  it("uses the fresh session.started event after reset before sending later prompts", () => {
    const { controller, ports } = createHarness();

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
