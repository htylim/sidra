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
          sandbox: "read-only",
          serviceName: "sidra",
          ephemeral: false
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

  it("passes_multimodal_parts_to_codex_turn_start", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(session.send(multimodalSendInput(), new AbortController().signal, ignoredPermissions()));
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
    await events;

    expect(appServer.requests).toContainEqual({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [
          { type: "text", text: "Context boundary before image.", text_elements: [] },
          { type: "image", url: `data:image/png;base64,${pngBase64}` },
          { type: "text", text: "User request:\nDescribe this selected area.", text_elements: [] }
        ],
        cwd: "/tmp/sidra-workspace",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: { type: "readOnly", networkAccess: false }
      }
    });
  });

  it("fails_before_turn_start_when_provider_rejects_images", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.rejectNextRequest = new Error("Invalid params: image input is unsupported");

    await expect(collectAsync(session.send(multimodalSendInput(), new AbortController().signal, ignoredPermissions()))).rejects.toThrow(
      "image input is unsupported"
    );

    expect(appServer.requests).toContainEqual({
      method: "turn/start",
      params: expect.objectContaining({
        threadId: "thread-1",
        input: expect.arrayContaining([{ type: "image", url: `data:image/png;base64,${pngBase64}` }])
      })
    });
    expect(appServer.requests.some((request) => request.method === "turn/interrupt")).toBe(false);
  });

  it("inserts_markdown_paragraph_boundary_between_agent_message_items", async () => {
    const { appServer, events } = await startProviderTurn("Summarize");

    appServer.emitNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "message-1", delta: "First paragraph." }
    });
    appServer.emitNotification({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", item: { type: "webSearch", id: "search-1", query: "example" } }
    });
    appServer.emitNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "message-2", delta: "Second paragraph." }
    });
    appServer.emitNotification({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1" } }
    });

    await expect(events).resolves.toEqual([
      { type: "assistant.text.delta", text: "First paragraph." },
      {
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "search-1",
          toolKind: "web_search",
          phase: "started",
          title: "Search web",
          details: [{ label: "Query", value: "example" }]
        }
      },
      { type: "assistant.text.delta", text: "\n\nSecond paragraph." },
      { type: "assistant.done" }
    ]);
  });

  it("maps_reasoning_summary_delta_to_activity_summary", async () => {
    const appServer = createFakeAppServer();
    appServer.nextResponse = { thread: { id: "thread-1" } };
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(session.send({ prompt: "Think" }, new AbortController().signal, ignoredPermissions()));
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));

    appServer.emitNotification({
      method: "item/reasoning/summaryTextDelta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "Checked the code." }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    await expect(events).resolves.toEqual([
      { type: "assistant.activity", activity: { kind: "reasoning_summary_delta", text: "Checked the code." } },
      { type: "assistant.done" }
    ]);
  });

  it("ignores_raw_reasoning_text_delta", async () => {
    const { appServer, events } = await startProviderTurn("Think");

    appServer.emitNotification({
      method: "item/reasoning/textDelta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "private chain of thought" }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    const collected = await events;
    expect(collected).toEqual([{ type: "assistant.done" }]);
    expect(JSON.stringify(collected)).not.toContain("private chain of thought");
  });

  it("does_not_emit_activity_for_reasoning_started_without_summary", async () => {
    const { appServer, events } = await startProviderTurn("Think");

    appServer.emitNotification({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", item: { type: "reasoning", id: "item-1", content: ["private"] } }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    await expect(events).resolves.toEqual([{ type: "assistant.done" }]);
  });

  it("maps_web_search_item_to_action_activity_with_details", async () => {
    const { appServer, events } = await startProviderTurn("Search");

    appServer.emitNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: { type: "webSearch", id: "item-2", query: "structured logging" }
      }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    await expect(events).resolves.toEqual([
      {
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-2",
          toolKind: "web_search",
          phase: "started",
          title: "Search web",
          details: [{ label: "Query", value: "structured logging" }]
        }
      },
      { type: "assistant.done" }
    ]);
  });

  it("maps_command_started_to_action_activity_with_command_details", async () => {
    const { appServer, events } = await startProviderTurn("Run");

    appServer.emitNotification({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", item: { type: "commandExecution", id: "item-1", command: "pnpm test" } }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    await expect(events).resolves.toEqual([
      {
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-1",
          toolKind: "command",
          phase: "started",
          title: "Run command",
          details: [{ label: "Command", value: "pnpm test" }]
        }
      },
      { type: "assistant.done" }
    ]);
  });

  it("attaches_command_output_delta_to_matching_command_activity", async () => {
    const { appServer, events } = await startProviderTurn("Run");

    appServer.emitNotification({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", item: { type: "commandExecution", id: "item-1", command: "pnpm test" } }
    });
    appServer.emitNotification({
      method: "item/commandExecution/outputDelta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", stream: "stdout", delta: "PASS test suite" }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    await expect(events).resolves.toEqual([
      {
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-1",
          toolKind: "command",
          phase: "started",
          title: "Run command",
          details: [{ label: "Command", value: "pnpm test" }]
        }
      },
      {
        type: "assistant.activity",
        activity: { kind: "command_output_delta", itemId: "item-1", stream: "stdout", text: "PASS test suite" }
      },
      { type: "assistant.done" }
    ]);
  });

  it("marks_tool_activity_complete_when_item_completed", async () => {
    const { appServer, events } = await startProviderTurn("Run");

    appServer.emitNotification({
      method: "item/completed",
      params: { threadId: "thread-1", turnId: "turn-1", item: { type: "commandExecution", id: "item-1", command: "pnpm test" } }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    await expect(events).resolves.toEqual([
      {
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-1",
          toolKind: "command",
          phase: "completed",
          title: "Run command",
          details: [{ label: "Command", value: "pnpm test" }]
        }
      },
      { type: "assistant.done" }
    ]);
  });

  it("maps_mcp_tool_started_and_completed_to_action_activity", async () => {
    const { appServer, events } = await startProviderTurn("Use tool");

    appServer.emitNotification({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", item: { type: "mcpToolCall", id: "item-1", server: "github", tool: "search_issues" } }
    });
    appServer.emitNotification({
      method: "item/completed",
      params: { threadId: "thread-1", turnId: "turn-1", item: { type: "mcpToolCall", id: "item-1", server: "github", tool: "search_issues" } }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    await expect(events).resolves.toEqual([
      {
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-1",
          toolKind: "mcp_tool",
          phase: "started",
          title: "Use MCP tool",
          details: [
            { label: "Server", value: "github" },
            { label: "Tool", value: "search_issues" }
          ]
        }
      },
      {
        type: "assistant.activity",
        activity: {
          kind: "tool",
          itemId: "item-1",
          toolKind: "mcp_tool",
          phase: "completed",
          title: "Use MCP tool",
          details: [
            { label: "Server", value: "github" },
            { label: "Tool", value: "search_issues" }
          ]
        }
      },
      { type: "assistant.done" }
    ]);
  });

  it("caps_activity_detail_and_output_text", async () => {
    const { appServer, events } = await startProviderTurn("Run");
    const longText = "x".repeat(3_000);

    appServer.emitNotification({
      method: "item/started",
      params: { threadId: "thread-1", turnId: "turn-1", item: { type: "commandExecution", id: "item-1", command: longText } }
    });
    appServer.emitNotification({
      method: "item/commandExecution/outputDelta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", stream: "stdout", delta: "y".repeat(9_000) }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    const collected = await events;
    expect(collected[0]).toMatchObject({
      type: "assistant.activity",
      activity: { kind: "tool", details: [{ label: "Command", value: expect.stringMatching(/^x+$/) }] }
    });
    expect(collected[1]).toMatchObject({
      type: "assistant.activity",
      activity: { kind: "command_output_delta", text: expect.stringMatching(/^y+$/) }
    });
    if (collected[0]?.type === "assistant.activity" && collected[0].activity.kind === "tool") {
      expect(collected[0].activity.details[0]?.value.length).toBe(2_000);
    }
    if (collected[1]?.type === "assistant.activity" && collected[1].activity.kind === "command_output_delta") {
      expect(collected[1].activity.text.length).toBe(8_000);
    }
  });

  it("does_not_emit_prompt_page_content_or_raw_private_reasoning_fields", async () => {
    const { appServer, events } = await startProviderTurn("Run");

    appServer.emitNotification({
      method: "item/started",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        item: {
          type: "dynamicToolCall",
          id: "item-1",
          name: "safe_tool",
          prompt: "secret prompt",
          pageContent: "secret page",
          reasoning: "private reasoning",
          chainOfThought: "private chain"
        }
      }
    });
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });

    const serialized = JSON.stringify(await events);
    expect(serialized).not.toContain("secret prompt");
    expect(serialized).not.toContain("secret page");
    expect(serialized).not.toContain("private reasoning");
    expect(serialized).not.toContain("private chain");
    expect(serialized).toContain("safe_tool");
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

describe("Codex App Server thread naming", () => {
  it("starts_threads_with_sidra_service_name_and_explicit_ephemeral_false", async () => {
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });

    await provider.createSession();

    expect(appServer.requests[0]).toEqual({
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

  it("falls_back_to_legacy_thread_start_when_optional_thread_metadata_is_rejected", async () => {
    const appServer = createFakeAppServer();
    appServer.rejectNextRequest = new Error("Invalid params: unknown field serviceName");
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });

    await provider.createSession();

    expect(appServer.requests).toEqual([
      {
        method: "thread/start",
        params: {
          cwd: "/tmp/sidra-workspace",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "read-only",
          serviceName: "sidra",
          ephemeral: false
        }
      },
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

  it("sets_thread_name_before_first_turn_start", async () => {
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(
      session.send(
        { prompt: "Wrapped prompt", displayTitleSource: { prompt: "Summarize this page" } },
        new AbortController().signal,
        ignoredPermissions()
      )
    );
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
    await events;

    expect(appServer.requests.map((request) => request.method)).toEqual(["thread/start", "thread/name/set", "turn/start"]);
  });

  it("builds_thread_name_inside_codex_provider_from_display_title_source", async () => {
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(
      session.send(
        {
          prompt: "The user is viewing this browser page.",
          displayTitleSource: {
            prompt: "Summarize this page",
            pageMetadata: { title: "Research notes", url: "https://example.com/article" }
          }
        },
        new AbortController().signal,
        ignoredPermissions()
      )
    );
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
    await events;

    expect(appServer.requests).toContainEqual({
      method: "thread/name/set",
      params: { threadId: "thread-1", name: "Sidra: Research notes - Summarize this page" }
    });
  });

  it("sets_thread_name_only_once_per_provider_session", async () => {
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();

    await runCompletedSend(appServer, session, { prompt: "First", displayTitleSource: { prompt: "First prompt" } }, "turn-1");
    await runCompletedSend(appServer, session, { prompt: "Second", displayTitleSource: { prompt: "Second prompt" } }, "turn-2");

    expect(appServer.requests.filter((request) => request.method === "thread/name/set")).toHaveLength(1);
  });

  it("continues_turn_start_when_thread_name_set_fails", async () => {
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.rejectNextTimeoutRequest = new Error("secret title failure");

    await runCompletedSend(appServer, session, { prompt: "Prompt", displayTitleSource: { prompt: "Title prompt" } }, "turn-1");

    expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true);
  });

  it("continues_turn_start_when_thread_name_set_does_not_resolve_before_timeout", async () => {
    vi.useFakeTimers();
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.timeoutRequestMode = "hang";
    appServer.nextResponse = { turn: { id: "turn-1" } };

    const events = collectAsync(
      session.send({ prompt: "Prompt", displayTitleSource: { prompt: "Title prompt" } }, new AbortController().signal, ignoredPermissions())
    );
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "thread/name/set")).toBe(true));
    expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));
    appServer.emitNotification({ method: "turn/completed", params: { threadId: "thread-1", turn: { id: "turn-1" } } });
    await events;
    vi.useRealTimers();
  });

  it("does_not_emit_or_log_title_setting_failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();
    appServer.rejectNextTimeoutRequest = new Error("secret title failure");

    await runCompletedSend(appServer, session, { prompt: "Prompt", displayTitleSource: { prompt: "Private title" } }, "turn-1");

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(appServer.responses)).not.toContain("Private title");
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("does_not_set_thread_name_when_display_title_is_absent", async () => {
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();

    await runCompletedSend(appServer, session, { prompt: "Prompt" }, "turn-1");

    expect(appServer.requests.some((request) => request.method === "thread/name/set")).toBe(false);
  });

  it("does_not_set_thread_name_on_second_send_when_first_send_had_no_display_title", async () => {
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const session = await provider.createSession();

    await runCompletedSend(appServer, session, { prompt: "First" }, "turn-1");
    await runCompletedSend(appServer, session, { prompt: "Second", displayTitleSource: { prompt: "Second title" } }, "turn-2");

    expect(appServer.requests.some((request) => request.method === "thread/name/set")).toBe(false);
  });

  it("new_provider_session_can_set_a_fresh_thread_name", async () => {
    const appServer = createFakeAppServer();
    const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
    const firstSession = await provider.createSession();
    await runCompletedSend(appServer, firstSession, { prompt: "First", displayTitleSource: { prompt: "First title" } }, "turn-1");
    appServer.nextResponse = { thread: { id: "thread-2" } };
    const secondSession = await provider.createSession();
    await runCompletedSend(appServer, secondSession, { prompt: "Second", displayTitleSource: { prompt: "Second title" } }, "turn-2");

    expect(appServer.requests).toContainEqual({
      method: "thread/name/set",
      params: { threadId: "thread-1", name: "Sidra: First title" }
    });
    expect(appServer.requests).toContainEqual({
      method: "thread/name/set",
      params: { threadId: "thread-2", name: "Sidra: Second title" }
    });
  });
});

function ignoredPermissions() {
  return {
    async requestPermission() {
      return { decision: "deny" as const };
    }
  };
}

const pngBase64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lw9q9wAAAABJRU5ErkJggg==";

function multimodalSendInput() {
  return {
    prompt: "legacy text must not be used for multimodal turns",
    parts: [
      { kind: "text", text: "Context boundary before image." },
      {
        kind: "image",
        mimeType: "image/png",
        dataBase64: pngBase64,
        byteLength: Buffer.from(pngBase64, "base64").byteLength,
        width: 1,
        height: 1,
        untrustedBoundaryText: "Context boundary before image."
      },
      { kind: "text", text: "User request:\nDescribe this selected area." }
    ],
    displayTitleSource: { prompt: "Describe this selected area." }
  } as Parameters<Awaited<ReturnType<ReturnType<typeof createCodexAppServerProvider>["createSession"]>>["send"]>[0];
}

async function startProviderTurn(prompt: string) {
  const appServer = createFakeAppServer();
  appServer.nextResponse = { thread: { id: "thread-1" } };
  const provider = createCodexAppServerProvider({ appServer, workingDirectory: "/tmp/sidra-workspace" });
  const session = await provider.createSession();
  appServer.nextResponse = { turn: { id: "turn-1" } };
  const events = collectAsync(session.send({ prompt }, new AbortController().signal, ignoredPermissions()));
  await vi.waitFor(() => expect(appServer.requests.some((request) => request.method === "turn/start")).toBe(true));
  return { appServer, events };
}

async function collectAsync<T>(events: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

async function runCompletedSend(
  appServer: ReturnType<typeof createFakeAppServer>,
  session: Awaited<ReturnType<ReturnType<typeof createCodexAppServerProvider>["createSession"]>>,
  input: Parameters<typeof session.send>[0],
  turnId: string
) {
  appServer.nextResponse = { turn: { id: turnId } };
  const previousTurnStartCount = appServer.requests.filter((request) => request.method === "turn/start").length;
  const events = collectAsync(session.send(input, new AbortController().signal, ignoredPermissions()));
  await vi.waitFor(() =>
    expect(appServer.requests.filter((request) => request.method === "turn/start")).toHaveLength(previousTurnStartCount + 1)
  );
  appServer.emitNotification({ method: "turn/completed", params: { threadId: currentThreadIdForTurn(appServer), turn: { id: turnId } } });
  await events;
}

function currentThreadIdForTurn(appServer: ReturnType<typeof createFakeAppServer>): string {
  const latestTurnStart = appServer.requests.findLast((request) => request.method === "turn/start");
  const params = latestTurnStart?.params;
  return typeof params === "object" && params !== null && "threadId" in params && typeof params.threadId === "string"
    ? params.threadId
    : "thread-1";
}

function createFakeAppServer() {
  const notificationHandlers = new Set<(notification: AppServerNotification) => void>();
  const serverRequestHandlers = new Set<(request: { id: number | string; method: string; params?: unknown }) => void>();
  return {
    requests: [] as Array<{ method: string; params: unknown }>,
    responses: [] as Array<{ id: number | string; result: unknown }>,
    nextResponse: { thread: { id: "thread-1" } } as unknown,
    rejectNextRequest: undefined as Error | undefined,
    rejectNextTimeoutRequest: undefined as Error | undefined,
    timeoutRequestMode: "resolve" as "resolve" | "hang",
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
      if (this.rejectNextRequest) {
        const error = this.rejectNextRequest;
        this.rejectNextRequest = undefined;
        throw error;
      }
      return this.nextResponse;
    },
    async requestWithTimeout(method: string, params: unknown, timeoutMs: number) {
      this.requests.push({ method, params });
      if (this.rejectNextTimeoutRequest) {
        const error = this.rejectNextTimeoutRequest;
        this.rejectNextTimeoutRequest = undefined;
        throw error;
      }
      if (this.timeoutRequestMode === "hang") {
        await new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Codex App Server request timed out")), timeoutMs));
      }
      return this.nextResponse;
    }
  };
}
