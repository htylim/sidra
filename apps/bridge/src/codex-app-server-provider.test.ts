import { describe, expect, it, vi } from "vitest";
import { createCodexAppServerProvider } from "./codex-app-server-provider.js";
import type { AppServerNotification } from "./codex-app-server-client.js";

describe("createCodexAppServerProvider", () => {
  it("creates_one_codex_thread_per_provider_session_with_restricted_defaults", async () => {
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });

    const session = await provider.createSession();

    expect(session).toBeDefined();
    expect(appServer.requests).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: "/tmp/sidra-workspace",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "read-only"
        }
      }
    ]);
  });

  it("starts_a_turn_and_streams_safe_assistant_text_until_turn_completion", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(session.send({ prompt: "Summarize" }, new AbortController().signal, ignoredPermissions()));
    await vi.waitFor(() => {
      expect(appServer.requests).toContainEqual({
        method: "turn/start",
        params: {
          threadId: "thread-1",
          input: [{ type: "text", text: "Summarize", text_elements: [] }],
          cwd: "/tmp/sidra-workspace",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandboxPolicy: { type: "readOnly", networkAccess: false }
        }
      });
    });

    appServer.emitNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Hello" }
    });
    appServer.emitNotification({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1" } }
    });

    await expect(events).resolves.toEqual([{ type: "assistant.text.delta", text: "Hello" }, { type: "assistant.done" }]);
  });

  it("maps_tool_item_lifecycle_to_safe_activity_without_raw_fields", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(session.send({ prompt: "Run" }, new AbortController().signal, ignoredPermissions()));
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));

    appServer.emitNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        startedAtMs: 1,
        item: { type: "commandExecution", id: "item-1", command: "cat secret.txt", aggregatedOutput: "secret output" }
      }
    });
    appServer.emitNotification({
      method: "item/completed",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        completedAtMs: 2,
        item: { type: "commandExecution", id: "item-1", command: "cat secret.txt", aggregatedOutput: "secret output" }
      }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    const collected = await events;
    expect(collected).toEqual([
      { type: "assistant.activity", activity: { kind: "tool", phase: "started", label: "Tool started" } },
      { type: "assistant.activity", activity: { kind: "tool", phase: "finished", label: "Tool finished" } },
      { type: "assistant.done" }
    ]);
    expect(JSON.stringify(collected)).not.toContain("secret");
    expect(JSON.stringify(collected)).not.toContain("cat secret.txt");
  });

  it("maps_reasoning_and_web_search_items_to_safe_progress_activity", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(session.send({ prompt: "Think" }, new AbortController().signal, ignoredPermissions()));
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));

    appServer.emitNotification({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", startedAtMs: 1, item: { type: "reasoning", id: "item-1", content: ["private"] } }
    });
    appServer.emitNotification({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", startedAtMs: 2, item: { type: "webSearch", id: "item-2", query: "secret" } }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    const collected = await events;
    expect(collected).toEqual([
      { type: "assistant.activity", activity: { kind: "progress", label: "Working" } },
      { type: "assistant.activity", activity: { kind: "progress", label: "Searching" } },
      { type: "assistant.done" }
    ]);
    expect(JSON.stringify(collected)).not.toContain("private");
    expect(JSON.stringify(collected)).not.toContain("secret");
  });

  it("ignores_notifications_for_other_threads_or_turns", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(session.send({ prompt: "Summarize" }, new AbortController().signal, ignoredPermissions()));
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));

    appServer.emitNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "other-thread", turnId: "turn-1", itemId: "item-1", delta: "Wrong" }
    });
    appServer.emitNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "other-turn", itemId: "item-1", delta: "Wrong" }
    });
    appServer.emitNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Right" }
    });
    appServer.emitNotification({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1" } }
    });

    await expect(events).resolves.toEqual([{ type: "assistant.text.delta", text: "Right" }, { type: "assistant.done" }]);
  });

  it("interrupts_the_running_turn_when_cancelled", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };
    const controller = new AbortController();

    const events = collectAsync(session.send({ prompt: "Summarize" }, controller.signal, ignoredPermissions()));
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));
    controller.abort();

    await expect(events).resolves.toEqual([{ type: "assistant.cancelled" }]);
    expect(appServer.requests).toContainEqual({ method: "turn/interrupt", params: { threadId: "thread-1", turnId: "turn-1" } });
  });

  it("maps_command_approval_requests_to_provider_permissions", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };
    const permissionRequests: unknown[] = [];

    const events = collectAsync(
      session.send({ prompt: "Run ls" }, new AbortController().signal, {
        async requestPermission(request) {
          permissionRequests.push(request);
          return { decision: "allow_for_session" };
        }
      })
    );
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));

    appServer.emitServerRequest({
      id: 99,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        startedAtMs: 1,
        command: "ls -la",
        reason: "Needs command access"
      }
    });
    await vi.waitFor(() => expect(appServer.responses).toContainEqual({ id: 99, result: { decision: "acceptForSession" } }));
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    expect(permissionRequests).toEqual([
      {
        permissionKey: "command:item-1",
        title: "Approve command",
        description: "Needs command access",
        metadata: { toolName: "Command", commandPreview: "ls -la" }
      }
    ]);
    await expect(events).resolves.toEqual([{ type: "assistant.done" }]);
  });

  it("maps_file_change_approval_denial_to_decline", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(
      session.send({ prompt: "Edit file" }, new AbortController().signal, {
        async requestPermission() {
          return { decision: "deny" };
        }
      })
    );
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));

    appServer.emitServerRequest({
      id: 100,
      method: "item/fileChange/requestApproval",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-2",
        startedAtMs: 1,
        reason: "Needs write access"
      }
    });
    await vi.waitFor(() => expect(appServer.responses).toContainEqual({ id: 100, result: { decision: "decline" } }));
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    await expect(events).resolves.toEqual([{ type: "assistant.done" }]);
  });

  it("maps_tool_user_input_requests_to_provider_permissions", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };
    const permissionRequests: unknown[] = [];

    const events = collectAsync(
      session.send({ prompt: "Ask" }, new AbortController().signal, {
        async requestPermission(request) {
          permissionRequests.push(request);
          return { decision: "allow_once" };
        }
      })
    );
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));

    appServer.emitServerRequest({
      id: 101,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-3",
        questions: [
          {
            id: "choice",
            header: "Mode",
            question: "Which mode?",
            isOther: false,
            isSecret: false,
            options: [{ label: "Fast", description: "Use fast mode" }]
          }
        ]
      }
    });
    await vi.waitFor(() =>
      expect(appServer.responses).toContainEqual({
        id: 101,
        result: { answers: { choice: { answers: ["Fast"] } } }
      })
    );
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    expect(permissionRequests).toEqual([
      {
        permissionKey: "tool-input:item-3",
        title: "Answer tool input request",
        description: "Which mode?",
        metadata: { toolName: "Tool input" }
      }
    ]);
    await expect(events).resolves.toEqual([{ type: "assistant.done" }]);
  });

  it("maps_denied_tool_user_input_to_empty_answers", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(
      session.send({ prompt: "Ask" }, new AbortController().signal, {
        async requestPermission() {
          return { decision: "deny" };
        }
      })
    );
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));

    appServer.emitServerRequest({
      id: 102,
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-4",
        questions: [{ id: "choice", header: "Mode", question: "Which mode?", isOther: false, isSecret: false, options: null }]
      }
    });
    await vi.waitFor(() => expect(appServer.responses).toContainEqual({ id: 102, result: { answers: { choice: { answers: [] } } } }));
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    await expect(events).resolves.toEqual([{ type: "assistant.done" }]);
  });

  it("rejects_the_turn_when_app_server_emits_matching_error", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(session.send({ prompt: "Fail" }, new AbortController().signal, ignoredPermissions()));
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));

    appServer.emitNotification({
      method: "error",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        willRetry: false,
        error: { message: "Codex failed" }
      }
    });

    await expect(events).rejects.toThrow("Codex failed");
  });

  it("close_unsubscribes_the_codex_thread", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();

    await session.close();

    expect(appServer.requests).toContainEqual({ method: "thread/unsubscribe", params: { threadId: "thread-1" } });
  });
});

function ignoredPermissions() {
  return {
    async requestPermission() {
      return { decision: "deny" as const };
    }
  };
}

async function collectAsync<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function createFakeAppServer() {
  const notificationHandlers = new Set<(notification: AppServerNotification) => void>();
  const serverRequestHandlers = new Set<(request: { id: number | string; method: string; params?: unknown }) => void>();
  return {
    requests: [] as Array<{ method: string; params: unknown }>,
    responses: [] as Array<{ id: number | string; result: unknown }>,
    nextResponse: { thread: { id: "thread-1" } } as unknown,
    onNotification(handler: (notification: AppServerNotification) => void) {
      notificationHandlers.add(handler);
      return () => notificationHandlers.delete(handler);
    },
    onServerRequest(handler: (request: { id: number | string; method: string; params?: unknown }) => void) {
      serverRequestHandlers.add(handler);
      return () => serverRequestHandlers.delete(handler);
    },
    emitNotification(notification: AppServerNotification) {
      for (const handler of notificationHandlers) handler(notification);
    },
    emitServerRequest(request: { id: number | string; method: string; params?: unknown }) {
      for (const handler of serverRequestHandlers) handler(request);
    },
    respond(id: number | string, result: unknown) {
      this.responses.push({ id, result });
    },
    async request(method: string, params: unknown) {
      this.requests.push({ method, params });
      return this.nextResponse;
    }
  };
}
