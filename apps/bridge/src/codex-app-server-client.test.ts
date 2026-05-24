import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { CodexAppServerClient } from "./codex-app-server-client.js";

describe("CodexAppServerClient", () => {
  it("initialize_sends_initialize_request_then_initialized_notification", async () => {
    const peer = createPeer();
    const client = new CodexAppServerClient(peer.clientStreams);

    const initialized = client.initialize({ name: "sidra", version: "0.0.0" });
    const initializeRequest = await peer.readMessage();
    peer.writeMessage({ id: initializeRequest.id, result: { userAgent: "Codex", codexHome: "/tmp/codex" } });
    await initialized;

    expect(initializeRequest).toEqual({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "sidra", version: "0.0.0" },
        capabilities: { experimentalApi: false, requestAttestation: false }
      }
    });
    expect(await peer.readMessage()).toEqual({ method: "initialized" });
  });

  it("request_resolves_the_matching_response_without_blocking_notifications", async () => {
    const notification = vi.fn();
    const peer = createPeer();
    const client = new CodexAppServerClient({ ...peer.clientStreams, onNotification: notification });

    const response = client.request("thread/start", { cwd: "/tmp/workspace" });
    const request = await peer.readMessage();
    peer.writeMessage({ method: "thread/status/changed", params: { threadId: "thread-1", status: "running" } });
    peer.writeMessage({ id: request.id, result: { thread: { id: "thread-1" } } });

    await expect(response).resolves.toEqual({ thread: { id: "thread-1" } });
    expect(notification).toHaveBeenCalledWith({
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: "running" }
    });
  });

  it("supports_runtime_notification_subscriptions", async () => {
    const peer = createPeer();
    const client = new CodexAppServerClient(peer.clientStreams);
    const notification = vi.fn();

    const unsubscribe = client.onNotification(notification);
    peer.writeMessage({ method: "thread/status/changed", params: { threadId: "thread-1", status: "running" } });
    await new Promise((resolve) => setImmediate(resolve));
    unsubscribe();
    peer.writeMessage({ method: "thread/status/changed", params: { threadId: "thread-1", status: "done" } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(notification).toHaveBeenCalledOnce();
    expect(notification).toHaveBeenCalledWith({
      method: "thread/status/changed",
      params: { threadId: "thread-1", status: "running" }
    });
  });


  it("routes_server_requests_and_sends_responses", async () => {
    const serverRequest = vi.fn();
    const peer = createPeer();
    const client = new CodexAppServerClient({ ...peer.clientStreams, onServerRequest: serverRequest });

    peer.writeMessage({
      id: 22,
      method: "item/commandExecution/requestApproval",
      params: { command: "ls" }
    });
    client.respond(22, { decision: "accept" });

    expect(serverRequest).toHaveBeenCalledWith({
      id: 22,
      method: "item/commandExecution/requestApproval",
      params: { command: "ls" }
    });
    expect(await peer.readMessage()).toEqual({ id: 22, result: { decision: "accept" } });
  });

  it("rejects_pending_requests_when_the_app_server_stream_closes", async () => {
    const peer = createPeer();
    const client = new CodexAppServerClient(peer.clientStreams);

    const response = client.request("thread/start", {});
    peer.serverOutput.end();

    await expect(response).rejects.toThrow("Codex App Server connection closed");
  });

  it("reports_invalid_app_server_messages", async () => {
    const protocolError = vi.fn();
    const peer = createPeer();
    new CodexAppServerClient({ ...peer.clientStreams, onProtocolError: protocolError });

    peer.serverOutput.write("{bad json}\n");
    peer.writeMessage({ result: { missing: "id" } });

    await new Promise((resolve) => setImmediate(resolve));

    expect(protocolError).toHaveBeenCalledTimes(2);
  });
});

function createPeer() {
  const clientInput = new PassThrough();
  const clientOutput = new PassThrough();

  return {
    serverOutput: clientInput,
    clientStreams: {
      input: clientInput,
      output: clientOutput
    },
    writeMessage(message: unknown) {
      clientInput.write(`${JSON.stringify(message)}\n`);
    },
    readMessage() {
      return readJsonLine(clientOutput);
    }
  };
}

function readJsonLine(stream: PassThrough): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      stream.off("data", onData);
      resolve(JSON.parse(buffer.slice(0, newlineIndex)));
    };
    stream.on("data", onData);
  });
}
