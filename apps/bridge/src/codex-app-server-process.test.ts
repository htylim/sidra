import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCodexAppServer } from "./codex-app-server-process.js";

describe("startCodexAppServer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("spawns_codex_app_server_and_initializes_the_client", async () => {
    vi.stubEnv("SIDRA_CODEX_WORKSPACE_ROOT", "/tmp/sidra-workspace");
    const child = createFakeChild();
    const spawn = vi.fn(() => child.process);

    const started = startCodexAppServer({ spawn, clientInfo: { name: "sidra", version: "0.0.0" } });
    const initializeRequest = await child.readInputMessage();
    child.writeOutputMessage({ id: initializeRequest.id, result: { userAgent: "Codex" } });
    const appServer = await started;

    expect(spawn).toHaveBeenCalledWith("codex", ["app-server"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: expect.not.objectContaining({ SIDRA_CODEX_WORKSPACE_ROOT: expect.any(String) })
    });
    expect(initializeRequest).toEqual({
      id: 1,
      method: "initialize",
      params: {
        clientInfo: { name: "sidra", version: "0.0.0" },
        capabilities: { experimentalApi: false, requestAttestation: false }
      }
    });
    expect(await child.readInputMessage()).toEqual({ method: "initialized" });
    expect(appServer.client).toBeDefined();
  });

  it("close_kills_the_spawned_process", async () => {
    const child = createFakeChild();
    const started = startCodexAppServer({
      spawn: () => child.process,
      clientInfo: { name: "sidra", version: "0.0.0" }
    });
    const initializeRequest = await child.readInputMessage();
    child.writeOutputMessage({ id: initializeRequest.id, result: { userAgent: "Codex" } });
    const appServer = await started;

    appServer.close();

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects_when_initialize_fails", async () => {
    const child = createFakeChild();
    const started = startCodexAppServer({
      spawn: () => child.process,
      clientInfo: { name: "sidra", version: "0.0.0" }
    });
    const initializeRequest = await child.readInputMessage();
    child.writeOutputMessage({ id: initializeRequest.id, error: { message: "not authenticated" } });

    await expect(started).rejects.toThrow("not authenticated");
  });

  it("kills_the_process_when_initialize_fails", async () => {
    const child = createFakeChild();
    const started = startCodexAppServer({
      spawn: () => child.process,
      clientInfo: { name: "sidra", version: "0.0.0" }
    });
    const initializeRequest = await child.readInputMessage();
    child.writeOutputMessage({ id: initializeRequest.id, error: { message: "not authenticated" } });

    await expect(started).rejects.toThrow("not authenticated");
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("rejects_when_the_process_exits_before_initialize_completes", async () => {
    const child = createFakeChild();
    const started = startCodexAppServer({
      spawn: () => child.process,
      clientInfo: { name: "sidra", version: "0.0.0" }
    });
    await child.readInputMessage();

    child.process.emit("exit", 1);

    await expect(started).rejects.toThrow("Codex App Server connection closed");
  });
});

function createFakeChild() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const kill = vi.fn();
  const process = Object.assign(new EventEmitter(), { stdin, stdout, stderr, kill });
  return {
    process,
    kill,
    writeOutputMessage(message: unknown) {
      stdout.write(`${JSON.stringify(message)}\n`);
    },
    readInputMessage() {
      return readJsonLine(stdin);
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
