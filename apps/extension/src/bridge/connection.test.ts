import type { BridgeToExtension, ExtensionToBridge } from "@sidra/protocol";
import { describe, expect, it, vi } from "vitest";
import { BridgeConnection, type NativeBridgePort, SIDRA_NATIVE_HOST } from "./connection";

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

  emitMessage(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  emitDisconnect(): void {
    for (const listener of this.disconnectListeners) listener();
  }
}

function startMessage(): ExtensionToBridge {
  return {
    type: "session.start",
    version: 2,
    clientSessionId: "client-1",
    providerId: "codex"
  };
}

function createHarness() {
  const ports: FakePort[] = [];
  const connectNative = vi.fn((hostName: string) => {
    expect(hostName).toBe(SIDRA_NATIVE_HOST);
    const port = new FakePort();
    ports.push(port);
    return port;
  });
  const connection = new BridgeConnection({ connectNative });

  return { connection, connectNative, ports };
}

describe("BridgeConnection", () => {
  it("connects explicitly and enters checking before bridge.ready", () => {
    const { connection, connectNative, ports } = createHarness();

    expect(connection.connect()).toEqual({ ok: true });

    expect(connectNative).toHaveBeenCalledTimes(1);
    expect(ports).toHaveLength(1);
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      ready: false,
      availability: { status: "checking" }
    });
  });

  it("marks bridge.ready as usable chat availability", () => {
    const { connection, ports } = createHarness();

    connection.connect();
    ports[0].emitMessage({ type: "bridge.ready", version: 2 });

    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      ready: true,
      availability: { status: "ready" }
    });
  });

  it("records unavailable state when connectNative throws", () => {
    const connection = new BridgeConnection({
      connectNative: () => {
        throw new Error("missing host");
      }
    });

    expect(connection.connect()).toEqual({ ok: false, error: "missing host" });
    expect(connection.getSnapshot()).toEqual({
      connected: false,
      ready: false,
      setupError: "missing host",
      availability: { status: "unavailable", message: "missing host" }
    });
  });

  it("records unavailable state when the startup port disconnects before readiness", () => {
    const { connection, ports } = createHarness();

    connection.connect();
    ports[0].emitDisconnect();

    expect(connection.getSnapshot()).toMatchObject({
      connected: false,
      ready: false,
      availability: {
        status: "unavailable",
        message: "Sidra cannot connect to the local bridge."
      }
    });
  });

  it("records unavailable state when a ready idle port disconnects", () => {
    const { connection, ports } = createHarness();

    connection.connect();
    ports[0].emitMessage({ type: "bridge.ready", version: 2 });
    ports[0].emitDisconnect();

    expect(connection.getSnapshot()).toMatchObject({
      connected: false,
      ready: false,
      availability: {
        status: "unavailable",
        message: "Sidra cannot connect to the local bridge."
      }
    });
  });

  it("retry opens a fresh native port after unavailable state", () => {
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
    const connection = new BridgeConnection({ connectNative });

    expect(connection.connect()).toEqual({ ok: false, error: "missing host" });
    expect(connection.retry()).toEqual({ ok: true });
    ports[0].emitMessage({ type: "bridge.ready", version: 2 });

    expect(connectNative).toHaveBeenCalledTimes(2);
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      ready: true,
      availability: { status: "ready" }
    });
  });

  it("retry replaces a connected error port", () => {
    const { connection, connectNative, ports } = createHarness();

    connection.connect();
    ports[0].emitMessage({ type: "bridge.error", version: 2, message: "bridge failed" });
    expect(connection.retry()).toEqual({ ok: true });
    ports[0].emitMessage({ type: "bridge.ready", version: 2 });
    ports[1].emitMessage({ type: "bridge.ready", version: 2 });

    expect(connectNative).toHaveBeenCalledTimes(2);
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      ready: true,
      availability: { status: "ready" }
    });
  });

  it("blocks on invalid inbound bridge messages before notifying subscribers", () => {
    const { connection, ports } = createHarness();
    const messageListener = vi.fn();

    connection.subscribeToMessages(messageListener);
    connection.connect();
    ports[0].emitMessage({
      type: "agent.event",
      version: 2,
      clientSessionId: "client-1",
      event: { type: "assistant.text.delta" }
    });

    expect(messageListener).not.toHaveBeenCalled();
    expect(connection.getSnapshot()).toEqual({
      connected: true,
      ready: false,
      setupError: "event is invalid",
      availability: { status: "error", message: "event is invalid", code: "invalid_message" }
    });
  });

  it("connects lazily on the first posted message", () => {
    const { connection, connectNative, ports } = createHarness();

    expect(connectNative).not.toHaveBeenCalled();
    expect(connection.post(startMessage())).toEqual({ ok: true });

    expect(connectNative).toHaveBeenCalledTimes(1);
    expect(ports[0].postedMessages).toEqual([startMessage()]);
    expect(connection.getSnapshot()).toMatchObject({ connected: true, ready: false });
  });

  it("reuses the current port for later posts", () => {
    const { connection, connectNative, ports } = createHarness();

    connection.post(startMessage());
    connection.post({ type: "session.send", version: 2, clientSessionId: "client-1", prompt: "hi" });

    expect(connectNative).toHaveBeenCalledTimes(1);
    expect(ports[0].postedMessages).toHaveLength(2);
  });

  it("publishes bridge.ready as connection readiness", () => {
    const { connection, ports } = createHarness();

    connection.post(startMessage());
    ports[0].emitMessage({ type: "bridge.ready", version: 2 });

    expect(connection.getSnapshot()).toMatchObject({ connected: true, ready: true });
  });

  it("rejects invalid inbound messages before notifying protocol subscribers", () => {
    const { connection, ports } = createHarness();
    const messageListener = vi.fn();

    connection.subscribeToMessages(messageListener);
    connection.post(startMessage());

    expect(() =>
      ports[0].emitMessage({
        type: "agent.event",
        version: 2,
        clientSessionId: "client-1",
        event: { type: "assistant.text.delta" }
      })
    ).not.toThrow();

    expect(messageListener).not.toHaveBeenCalled();
    expect(connection.getSnapshot()).toMatchObject({
      connected: true,
      ready: false,
      setupError: "event is invalid",
      availability: { status: "error", message: "event is invalid", code: "invalid_message" }
    });
  });

  it("publishes disconnect state without mutating transcript state", () => {
    const { connection, ports } = createHarness();

    connection.post(startMessage());
    ports[0].emitMessage({ type: "bridge.ready", version: 2 });
    ports[0].emitDisconnect();

    expect(connection.getSnapshot()).toMatchObject({
      connected: false,
      ready: false,
      availability: { status: "unavailable" }
    });
  });

  it("ignores messages emitted by a stale disconnected port", () => {
    const { connection, ports } = createHarness();

    connection.post(startMessage());
    ports[0].emitDisconnect();
    connection.post({ type: "session.send", version: 2, clientSessionId: "client-1", prompt: "after" });
    ports[0].emitMessage({ type: "bridge.ready", version: 2 });

    expect(connection.getSnapshot()).toMatchObject({ connected: true, ready: false });
  });

  it("returns a failed post result when connectNative throws", () => {
    const connection = new BridgeConnection({
      connectNative: () => {
        throw new Error("missing host");
      }
    });

    expect(connection.post(startMessage())).toEqual({ ok: false, error: "missing host" });
    expect(connection.getSnapshot()).toMatchObject({
      connected: false,
      ready: false,
      setupError: "missing host",
      availability: { status: "unavailable", message: "missing host" }
    });
  });

  it("returns a failed post result when port.postMessage throws", () => {
    const port = new FakePort();
    vi.spyOn(port, "postMessage").mockImplementation(() => {
      throw new Error("post failed");
    });
    const connection = new BridgeConnection({ connectNative: () => port });

    expect(connection.post(startMessage())).toEqual({ ok: false, error: "post failed" });
    expect(connection.getSnapshot()).toMatchObject({
      connected: false,
      ready: false,
      setupError: "post failed",
      availability: { status: "error", message: "post failed" }
    });
  });
});
