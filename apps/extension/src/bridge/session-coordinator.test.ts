import type { BridgeToExtension, ExtensionToBridge, ProviderId } from "@sidra/protocol";
import { describe, expect, it } from "vitest";
import {
  BridgeSessionCoordinator,
  type ProtocolTransport,
  type ProtocolTransportPostResult
} from "./session-coordinator";

class FakeTransport implements ProtocolTransport {
  readonly postedMessages: ExtensionToBridge[] = [];
  private readonly messageListeners: Array<(message: BridgeToExtension) => void> = [];
  postResult: ProtocolTransportPostResult = { ok: true };

  post(message: ExtensionToBridge): ProtocolTransportPostResult {
    this.postedMessages.push(message);
    return this.postResult;
  }

  subscribeToMessages(listener: (message: BridgeToExtension) => void): () => void {
    this.messageListeners.push(listener);
    return () => {};
  }

  emitMessage(message: BridgeToExtension): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

function createHarness(providerId: ProviderId = "codex") {
  const transport = new FakeTransport();
  const coordinator = new BridgeSessionCoordinator({
    clientSessionId: "client-1",
    providerId,
    transport
  });

  return { coordinator, transport };
}

function sessionStarted(clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "session.started",
    version: 1,
    clientSessionId,
    bridgeSessionId: "bridge-1"
  };
}

describe("BridgeSessionCoordinator", () => {
  it("posts session.start before the first session.send", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "hello" }
    ]);
  });

  it("queues prompts while waiting for session.started", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 2, starting: true });
  });

  it("does not add the first prompt to the transcript when session.start cannot post", () => {
    const { coordinator, transport } = createHarness();
    transport.postResult = { ok: false, error: "native host unavailable" };

    const accepted = coordinator.sendPrompt("hello");

    expect(accepted).toBe(false);
    expect(coordinator.getSnapshot()).toMatchObject({
      pendingPromptCount: 0,
      sessionStarted: false,
      starting: false,
      lastError: "native host unavailable"
    });
    expect(coordinator.getSnapshot().transcript).toEqual([
      { role: "status", text: "native host unavailable" }
    ]);
  });

  it("flushes queued prompts in original order", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
    expect(coordinator.getSnapshot().pendingPromptCount).toBe(0);
  });

  it("reuses the started provider session for later prompts", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    transport.emitMessage(sessionStarted());
    coordinator.sendPrompt("second");

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
  });

  it("does not add a started-session prompt to the transcript when session.send cannot post", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    transport.emitMessage(sessionStarted());
    expect(coordinator.sendPrompt("accepted after start")).toBe(true);

    transport.postResult = { ok: false, error: "send failed" };
    const accepted = coordinator.sendPrompt("unsent after start");

    expect(accepted).toBe(false);
    expect(coordinator.getSnapshot()).toMatchObject({ lastError: "send failed" });
    expect(coordinator.getSnapshot().transcript).toEqual([
      { role: "user", text: "first" },
      { role: "status", text: "Session started" },
      { role: "user", text: "accepted after start" },
      { role: "status", text: "send failed" }
    ]);
  });

  it("ignores session.started for another clientSessionId", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionStarted("other-client"));

    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 1, sessionStarted: false });
    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
  });

  it("appends assistant deltas to the transcript without knowing React", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionStarted());
    transport.emitMessage({
      type: "agent.event",
      version: 1,
      clientSessionId: "client-1",
      event: { type: "assistant.text.delta", text: "Hi" }
    });

    expect(coordinator.getSnapshot().transcript).toEqual([
      { role: "user", text: "hello" },
      { role: "status", text: "Session started" },
      { role: "assistant", text: "Hi" }
    ]);
  });

  it("clears pending startup state after bridge.error", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");
    transport.emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

    expect(coordinator.getSnapshot()).toMatchObject({
      pendingPromptCount: 0,
      sessionStarted: false,
      starting: false,
      lastError: undefined
    });
    expect(coordinator.getSnapshot().transcript).toEqual([]);
  });

  it("removes queued prompt entries when the bridge disconnects before session.started", () => {
    const { coordinator } = createHarness();

    coordinator.sendPrompt("unsent");
    coordinator.markBridgeDisconnected();

    expect(coordinator.getSnapshot().transcript).toEqual([
      { role: "status", text: "Bridge disconnected" }
    ]);
  });
});
