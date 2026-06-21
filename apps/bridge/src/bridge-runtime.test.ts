import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createProviderFromEnvironment, runBridgeFromEnvironment } from "./bridge-runtime.js";
import type { RunningCodexAppServer } from "./codex-app-server-process.js";

describe("bridge runtime composition", () => {
  it("does_not_create_a_codex_provider_without_an_explicit_workspace_root", async () => {
    const startCodexAppServer = vi.fn();

    const provider = await createProviderFromEnvironment({}, { startCodexAppServer });

    expect(provider).toBeUndefined();
    expect(startCodexAppServer).not.toHaveBeenCalled();
  });

  it("creates_codex_provider_from_explicit_workspace_root", async () => {
    const appServer = createFakeRunningAppServer();
    const startCodexAppServer = vi.fn(async () => appServer);

    const provider = await createProviderFromEnvironment(
      { SIDRA_CODEX_WORKSPACE_ROOT: "/tmp/sidra-workspace" },
      { startCodexAppServer }
    );

    expect(provider?.id).toBe("codex");
    expect(startCodexAppServer).toHaveBeenCalledWith({ clientInfo: { name: "sidra-bridge", version: "0.0.0" } });
    expect(appServer.client.requests).toContainEqual({ method: "account/read", params: { refreshToken: true } });
    await provider?.createSession();
    expect(appServer.client.requests).toContainEqual({
      method: "thread/start",
      params: {
        cwd: "/tmp/sidra-workspace",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "read-only",
        serviceName: "sidra",
        ephemeral: false
      }
    });
  });

  it("allows_direct_runtime_provider_callers_to_close_the_app_server", async () => {
    const appServer = createFakeRunningAppServer();
    const startCodexAppServer = vi.fn(async () => appServer);

    const provider = await createProviderFromEnvironment(
      { SIDRA_CODEX_WORKSPACE_ROOT: "/tmp/sidra-workspace" },
      { startCodexAppServer }
    );
    provider?.close();

    expect(appServer.close).toHaveBeenCalledOnce();
  });

  it("fails_closed_when_codex_auth_is_required", async () => {
    const appServer = createFakeRunningAppServer({ accountResponse: { account: null, requiresOpenaiAuth: true } });
    const startCodexAppServer = vi.fn(async () => appServer);

    await expect(
      createProviderFromEnvironment({ SIDRA_CODEX_WORKSPACE_ROOT: "/tmp/sidra-workspace" }, { startCodexAppServer })
    ).rejects.toThrow("Codex authentication is required");
    expect(appServer.close).toHaveBeenCalledOnce();
  });

  it("accepts_existing_chatgpt_account_even_when_openai_auth_is_required", async () => {
    const appServer = createFakeRunningAppServer({
      accountResponse: { account: { type: "chatgpt", email: "user@example.com" }, requiresOpenaiAuth: true }
    });
    const startCodexAppServer = vi.fn(async () => appServer);

    const provider = await createProviderFromEnvironment(
      { SIDRA_CODEX_WORKSPACE_ROOT: "/tmp/sidra-workspace" },
      { startCodexAppServer }
    );

    expect(provider?.id).toBe("codex");
  });

  it("passes_the_configured_provider_to_native_messaging", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const appServer = createFakeRunningAppServer();
    const startCodexAppServer = vi.fn(async () => appServer);

    await runBridgeFromEnvironment(input, output, { SIDRA_CODEX_WORKSPACE_ROOT: "/tmp/sidra-workspace" }, { startCodexAppServer });

    input.write(encodeNativeMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" }));
    await waitForRequest(appServer.client.requests, "thread/start");
    expect(appServer.client.requests.find((request) => request.method === "thread/start")?.params).toMatchObject({
      cwd: "/tmp/sidra-workspace"
    });
  });

  it("closes_the_app_server_when_native_input_closes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const appServer = createFakeRunningAppServer();
    const startCodexAppServer = vi.fn(async () => appServer);

    await runBridgeFromEnvironment(input, output, { SIDRA_CODEX_WORKSPACE_ROOT: "/tmp/sidra-workspace" }, { startCodexAppServer });
    input.end();
    await new Promise((resolve) => setImmediate(resolve));

    expect(appServer.close).toHaveBeenCalledOnce();
  });

  it("runBridgeFromEnvironment_emits_bridge_error_when_codex_auth_is_required", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 1);
    const appServer = createFakeRunningAppServer({ accountResponse: { account: null, requiresOpenaiAuth: true } });

    await runBridgeFromEnvironment(
      input,
      output,
      { SIDRA_CODEX_WORKSPACE_ROOT: "/tmp/sidra-workspace" },
      { startCodexAppServer: vi.fn(async () => appServer) }
    );

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 4, message: "Codex setup failed.", code: "codex_setup_failed" }
    ]);
  });

  it("runBridgeFromEnvironment_emits_bridge_error_when_codex_app_server_start_fails", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 1);

    await runBridgeFromEnvironment(
      input,
      output,
      { SIDRA_CODEX_WORKSPACE_ROOT: "/tmp/sidra-workspace" },
      {
        startCodexAppServer: vi.fn(async () => {
          throw new Error("spawn failed with private stderr");
        })
      }
    );

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 4, message: "Codex setup failed.", code: "codex_setup_failed" }
    ]);
  });

  it("runBridgeFromEnvironment_emits_bridge_error_when_sidra_codex_workspace_root_is_missing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 1);

    await runBridgeFromEnvironment(input, output, {}, { startCodexAppServer: vi.fn() });

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 4, message: "Codex setup failed.", code: "codex_setup_failed" }
    ]);
  });

  it("runBridgeFromEnvironment_emits_bridge_ready_after_codex_setup_succeeds", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 1);
    const appServer = createFakeRunningAppServer();

    await runBridgeFromEnvironment(
      input,
      output,
      { SIDRA_CODEX_WORKSPACE_ROOT: "/tmp/sidra-workspace" },
      { startCodexAppServer: vi.fn(async () => appServer) }
    );

    await expect(messages).resolves.toEqual([{ type: "bridge.ready", version: 4 }]);
  });

  it("runBridgeFromEnvironment_keeps_native_connection_alive_after_provider_setup_error", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 1);

    await runBridgeFromEnvironment(input, output, {}, { startCodexAppServer: vi.fn() });

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 4, message: "Codex setup failed.", code: "codex_setup_failed" }
    ]);

    input.write(encodeNativeMessage({ type: "heartbeat", version: 4 }));

    await expect(collectNativeMessagesUntilIdle(output, 20)).resolves.toEqual([]);
  });

  it("runBridgeFromEnvironment_does_not_emit_bridge_ready_after_provider_setup_error", async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    await runBridgeFromEnvironment(input, output, {}, { startCodexAppServer: vi.fn() });

    const messages = await collectNativeMessagesUntilIdle(output, 20);
    expect(messages).not.toContainEqual({ type: "bridge.ready", version: 4 });
  });

  it("runBridgeFromEnvironment_rejects_chat_commands_after_provider_setup_error_without_provider_unavailable_fallback", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);

    await runBridgeFromEnvironment(input, output, {}, { startCodexAppServer: vi.fn() });
    input.write(encodeNativeMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" }));

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 4, message: "Codex setup failed.", code: "codex_setup_failed" },
      { type: "bridge.error", version: 4, message: "Codex setup failed.", code: "codex_setup_failed" }
    ]);
  });

  it("runBridgeFromEnvironment_reports_invalid_message_after_provider_setup_error", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);

    await runBridgeFromEnvironment(input, output, {}, { startCodexAppServer: vi.fn() });
    input.write(encodeNativeMessage({ type: "session.delete", version: 4, clientSessionId: "page-1" }));

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 4, message: "Codex setup failed.", code: "codex_setup_failed" },
      { type: "bridge.error", version: 4, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("runBridgeFromEnvironment_routes_speech_credentials_after_provider_setup_error", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);

    await runBridgeFromEnvironment(
      input,
      output,
      {},
      {
        startCodexAppServer: vi.fn(),
        createSpeechManager: ({ emit }) => ({
          async synthesize() {},
          async cancel() {},
          async getCredentialStatus() {
            emit({ type: "speech.credentials.status", version: 4, configured: false });
          },
          async saveCredentials() {},
          async testCredentials() {},
          async removeCredentials() {},
          async cancelAll() {}
        })
      }
    );
    input.write(encodeNativeMessage({ type: "speech.credentials.status", version: 4 }));

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 4, message: "Codex setup failed.", code: "codex_setup_failed" },
      { type: "speech.credentials.status", version: 4, configured: false }
    ]);
  });
});

function createFakeRunningAppServer(options: { accountResponse?: unknown } = {}): RunningCodexAppServer & {
  client: RunningCodexAppServer["client"] & { requests: Array<{ method: string; params: unknown }> };
} {
  const notificationHandlers = new Set<(notification: never) => void>();
  const serverRequestHandlers = new Set<(request: never) => void>();
  const client = {
    requests: [] as Array<{ method: string; params: unknown }>,
    async request(method: string, params: unknown) {
      this.requests.push({ method, params });
      if (method === "account/read") return options.accountResponse ?? { account: { id: "account-1" }, requiresOpenaiAuth: false };
      if (method === "thread/start") return { thread: { id: "thread-1" } };
      return {};
    },
    async requestWithTimeout(method: string, params: unknown) {
      return this.request(method, params);
    },
    onNotification(handler: (notification: never) => void) {
      notificationHandlers.add(handler);
      return () => notificationHandlers.delete(handler);
    },
    onServerRequest(handler: (request: never) => void) {
      serverRequestHandlers.add(handler);
      return () => serverRequestHandlers.delete(handler);
    },
    respond() {}
  } as RunningCodexAppServer["client"] & { requests: Array<{ method: string; params: unknown }> };
  return { client, process: {} as RunningCodexAppServer["process"], close: vi.fn() };
}

function encodeNativeMessage(message: unknown) {
  const encoded = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(encoded.length, 0);
  return Buffer.concat([header, encoded]);
}

function collectNativeMessages(output: PassThrough, expectedCount: number) {
  const messages: unknown[] = [];
  let buffer = Buffer.alloc(0);

  return new Promise<unknown[]>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedCount} native messages`)), 1_000);

    output.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4) {
        const messageLength = buffer.readUInt32LE(0);
        if (buffer.length < messageLength + 4) return;

        const raw = buffer.subarray(4, messageLength + 4).toString("utf8");
        buffer = buffer.subarray(messageLength + 4);
        messages.push(JSON.parse(raw));

        if (messages.length === expectedCount) {
          clearTimeout(timeout);
          resolve(messages);
          return;
        }
      }
    });
  });
}

function collectNativeMessagesUntilIdle(output: PassThrough, idleMs: number) {
  const messages: unknown[] = [];
  let buffer = Buffer.alloc(0);

  return new Promise<unknown[]>((resolve) => {
    let idleTimer = setTimeout(() => resolve(messages), idleMs);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        output.off("data", onData);
        resolve(messages);
      }, idleMs);
    };

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4) {
        const messageLength = buffer.readUInt32LE(0);
        if (buffer.length < messageLength + 4) break;

        const raw = buffer.subarray(4, messageLength + 4).toString("utf8");
        buffer = buffer.subarray(messageLength + 4);
        messages.push(JSON.parse(raw));
      }

      resetIdleTimer();
    };

    output.on("data", onData);
  });
}

async function waitForRequest(requests: Array<{ method: string }>, method: string): Promise<void> {
  await vi.waitFor(() => expect(requests.some((request) => request.method === method)).toBe(true));
}
