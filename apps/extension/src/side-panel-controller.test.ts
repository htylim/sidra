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
