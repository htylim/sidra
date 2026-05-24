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
        sandbox: "read-only"
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

    input.write(encodeNativeMessage({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex" }));
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

async function waitForRequest(requests: Array<{ method: string }>, method: string): Promise<void> {
  await vi.waitFor(() => expect(requests.some((request) => request.method === method)).toBe(true));
}
