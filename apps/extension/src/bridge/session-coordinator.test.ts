import { serializedJsonByteLength, type AgentEvent, type BridgeToExtension, type ExtensionToBridge, type SessionErrorCode, type ProviderId } from "@sidra/protocol";
import { describe, expect, it } from "vitest";
import {
  BridgeSessionCoordinator,
  type PromptSubmission,
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

function createHarness(providerId: ProviderId = "codex", hardPayloadByteLimit?: number) {
  const transport = new FakeTransport();
  const coordinator = new BridgeSessionCoordinator({
    clientSessionId: "client-1",
    providerId,
    transport,
    hardPayloadByteLimit
  });

  return { coordinator, transport };
}

function createStartedHarness() {
  const harness = createHarness();
  harness.coordinator.sendPrompt("hello");
  harness.transport.emitMessage(sessionStarted());
  return harness;
}

function sessionStarted(clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "session.started",
    version: 3,
    clientSessionId,
    bridgeSessionId: "bridge-1"
  };
}

function agentEvent(event: AgentEvent, clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "agent.event",
    version: 3,
    clientSessionId,
    event
  };
}

function commandToolActivity(phase: "started" | "completed"): Extract<AgentEvent, { type: "assistant.activity" }>["activity"] {
  return {
    kind: "tool",
    itemId: "command-1",
    toolKind: "command",
    phase,
    title: "Run command",
    details: [{ label: "Command", value: "pnpm test" }]
  };
}

function permissionRequest(requestId = "permission-1", clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "permission.request",
    version: 3,
    clientSessionId,
    request: {
      requestId,
      permissionKey: "shell:ls",
      title: "Run command",
      metadata: { toolName: "shell", commandPreview: "ls" }
    }
  };
}

function sessionError(message: string, code?: SessionErrorCode, clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "session.error",
    version: 3,
    clientSessionId,
    message,
    ...(code ? { code } : {})
  };
}

function readablePageContext(text = "Captured readable page text that must never be shown in transcript."): NonNullable<PromptSubmission["pageContext"]> {
  return {
    kind: "readable",
    metadata: {
      url: "https://example.com/article",
      title: "Article",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    text,
    textLength: text.length,
    extractionMethod: "readability"
  };
}

function metadataOnlyPageContext(): NonNullable<PromptSubmission["pageContext"]> {
  return {
    kind: "metadata_only",
    metadata: {
      url: "https://example.com/short",
      title: "Short",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    reason: "no_usable_text"
  };
}

function contentTooLargePageContext(): NonNullable<PromptSubmission["pageContext"]> {
  return {
    kind: "metadata_only",
    metadata: {
      url: "https://example.com/large",
      title: "Large",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    reason: "content_too_large"
  };
}

function fullDomPageContext(html = "<html><body><main>Secret DOM text</main></body></html>"): NonNullable<PromptSubmission["pageContext"]> {
  return {
    kind: "full_dom",
    metadata: {
      url: "https://example.com/full-dom",
      title: "Full DOM",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    html,
    htmlLength: html.length
  };
}

function fullDomTooLargePageContext(): NonNullable<PromptSubmission["pageContext"]> {
  return {
    kind: "metadata_only",
    metadata: {
      url: "https://example.com/large-dom",
      title: "Large DOM",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    reason: "full_dom_too_large"
  };
}

describe("BridgeSessionCoordinator", () => {
  it("posts session.start before the first session.send", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 3, clientSessionId: "client-1", prompt: "hello" }
    ]);
  });

  it("queues one prompt while waiting for session.started", () => {
    const { coordinator, transport } = createHarness();

    expect(coordinator.sendPrompt("first")).toBe(true);
    expect(coordinator.sendPrompt("second")).toBe(false);

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 1, starting: true });
  });

  it("rejects_second_prompt_while_startup_prompt_is_pending", () => {
    const { coordinator, transport } = createHarness();

    expect(coordinator.sendPrompt("first")).toBe(true);
    expect(coordinator.sendPrompt("second")).toBe(false);

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 1, starting: true });
    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ kind: "user_message", text: "first" })
    ]);
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
      expect.objectContaining({ role: "status", tone: "error", text: "native host unavailable" })
    ]);
  });

  it("flushes the first queued prompt when the session starts", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 3, clientSessionId: "client-1", prompt: "first" }
    ]);
    expect(coordinator.getSnapshot().pendingPromptCount).toBe(0);
  });

  it("exposes_turn_in_flight_after_started_session_send_posts", () => {
    const { coordinator } = createStartedHarness();

    expect(coordinator.getSnapshot()).toMatchObject({
      turnInFlight: true,
      canCancelTurn: true
    });
  });

  it("does_not_expose_cancel_before_queued_startup_prompt_is_flushed", () => {
    const { coordinator } = createHarness();

    coordinator.sendPrompt("hello");

    expect(coordinator.getSnapshot()).toMatchObject({
      turnInFlight: false,
      canCancelTurn: false,
      pendingPromptCount: 1
    });
  });

  it("makes_flushed_startup_prompt_cancelable_immediately_after_session_started", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot()).toMatchObject({
      turnInFlight: true,
      canCancelTurn: true,
      pendingPromptCount: 0
    });
  });

  it("allows_one_prompt_to_queue_behind_reset_session_started", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    coordinator.newChat();
    expect(coordinator.sendPrompt("after reset")).toBe(true);

    expect(coordinator.getSnapshot()).toMatchObject({
      starting: true,
      pendingPromptCount: 1,
      turnInFlight: false,
      canCancelTurn: false
    });
  });

  it("sends_only_the_first_queued_prompt_when_session_starts", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 3, clientSessionId: "client-1", prompt: "first" }
    ]);
    expect(coordinator.getSnapshot().pendingPromptCount).toBe(0);
  });

  it("renders_only_the_sent_queued_prompt_before_the_first_assistant_stream", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");
    transport.emitMessage(sessionStarted());
    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "First response" }));

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ kind: "user_message", text: "first" }),
      expect.objectContaining({ kind: "status", text: "Session started" }),
      expect.objectContaining({ kind: "assistant_turn", markdown: "First response" })
    ]);
  });

  it("reuses the started provider session for later prompts", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    transport.emitMessage(sessionStarted());
    transport.emitMessage(agentEvent({ type: "assistant.done" }));
    coordinator.sendPrompt("second");

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 3, clientSessionId: "client-1", prompt: "first" },
      { type: "session.send", version: 3, clientSessionId: "client-1", prompt: "second" }
    ]);
  });

  it("cancelTurn_posts_session_cancel_for_the_current_client_session", () => {
    const { coordinator, transport } = createStartedHarness();

    expect(coordinator.cancelTurn()).toBe(true);

    expect(transport.postedMessages).toContainEqual({
      type: "session.cancel",
      version: 3,
      clientSessionId: "client-1"
    });
  });

  it("adds_permission_request_to_transcript_for_matching_client_session", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(permissionRequest());

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({
        kind: "permission_request",
        requestId: "permission-1",
        permissionKey: "shell:ls",
        status: "pending"
      })
    );
    expect(coordinator.getSnapshot().turnInFlight).toBe(true);
  });

  it("ignores_permission_request_for_other_client_session", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(permissionRequest("permission-1", "other-client"));

    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ kind: "permission_request" })
    );
  });

  it("respondToPermission_posts_permission_respond_for_matching_pending_request", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(permissionRequest());

    expect(coordinator.respondToPermission("permission-1", "allow_once")).toBe(true);

    expect(transport.postedMessages).toContainEqual({
      type: "permission.respond",
      version: 3,
      clientSessionId: "client-1",
      requestId: "permission-1",
      decision: "allow_once"
    });
    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ kind: "permission_request", requestId: "permission-1" })
    );
    expect(coordinator.getSnapshot().turnInFlight).toBe(true);
  });

  it.each(["allow_once", "allow_for_session", "deny"] as const)(
    "permission_%s_removes_card_without_changing_turn_in_flight",
    (decision) => {
      const { coordinator, transport } = createStartedHarness();
      transport.emitMessage(permissionRequest());

      expect(coordinator.respondToPermission("permission-1", decision)).toBe(true);

      expect(coordinator.getSnapshot().transcript).not.toContainEqual(
        expect.objectContaining({ kind: "permission_request", requestId: "permission-1" })
      );
      expect(coordinator.getSnapshot().turnInFlight).toBe(true);
    }
  );

  it("respondToPermission_returns_false_for_unknown_request", () => {
    const { coordinator, transport } = createStartedHarness();

    expect(coordinator.respondToPermission("missing", "allow_once")).toBe(false);
    expect(transport.postedMessages).not.toContainEqual(expect.objectContaining({ type: "permission.respond" }));
  });

  it("respondToPermission_returns_false_after_request_already_resolved", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(permissionRequest());

    expect(coordinator.respondToPermission("permission-1", "allow_once")).toBe(true);
    expect(coordinator.respondToPermission("permission-1", "deny")).toBe(false);
  });

  it("pending_permission_keeps_turn_in_flight_and_blocks_duplicate_send", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(permissionRequest());

    expect(coordinator.sendPrompt("second")).toBe(false);

    expect(coordinator.getSnapshot().turnInFlight).toBe(true);
    expect(transport.postedMessages.filter((message) => message.type === "session.send")).toHaveLength(1);
  });

  it("ignores_permission_request_when_no_turn_is_in_flight", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    transport.emitMessage(permissionRequest());

    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ kind: "permission_request" })
    );
  });

  it("bridge_error_clears_pending_permission_actionability", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(permissionRequest());

    transport.emitMessage({ type: "bridge.error", version: 3, message: "Bridge failed" });

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "permission_request", requestId: "permission-1", status: "unavailable" })
    );
  });

  it("bridge_disconnect_clears_pending_permission_actionability", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(permissionRequest());

    coordinator.markBridgeDisconnected();

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "permission_request", requestId: "permission-1", status: "unavailable" })
    );
  });

  it("assistant_cancelled_after_permission_only_turn_marks_card_unavailable_and_adds_cancelled_status", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(permissionRequest());

    transport.emitMessage(agentEvent({ type: "assistant.cancelled" }));

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "permission_request", requestId: "permission-1", status: "unavailable" })
    );
    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "status", tone: "cancelled", text: "Assistant turn cancelled" })
    );
  });

  it("cancel_clears_pending_permission_actionability_and_blocks_response", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(permissionRequest());

    coordinator.cancelTurn();

    expect(coordinator.respondToPermission("permission-1", "allow_once")).toBe(false);
    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "permission_request", requestId: "permission-1", status: "unavailable" })
    );
    expect(transport.postedMessages).not.toContainEqual(
      expect.objectContaining({ type: "permission.respond", requestId: "permission-1" })
    );
  });

  it("assistant_done_clears_pending_permission_actionability", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(permissionRequest());

    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    expect(coordinator.respondToPermission("permission-1", "allow_once")).toBe(false);
    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "permission_request", requestId: "permission-1", status: "unavailable" })
    );
  });

  it("ignores_permission_request_after_cancel_is_requested", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.cancelTurn();
    transport.emitMessage(permissionRequest());

    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ kind: "permission_request" })
    );
    expect(transport.postedMessages).not.toContainEqual(expect.objectContaining({ type: "permission.respond" }));
  });

  it("permission_response_then_assistant_done_completes_turn", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(permissionRequest());

    coordinator.respondToPermission("permission-1", "allow_once");
    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    expect(coordinator.getSnapshot().turnInFlight).toBe(false);
    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ kind: "permission_request", requestId: "permission-1" })
    );
  });

  it("keeps_resumed_assistant_output_after_removing_permission_card", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Checking" }));
    transport.emitMessage(permissionRequest());

    coordinator.respondToPermission("permission-1", "allow_once");
    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Allowed" }));
    transport.emitMessage(agentEvent({ type: "assistant.activity", activity: commandToolActivity("started") }));
    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ kind: "user_message", text: "hello" }),
      expect.objectContaining({ kind: "status", text: "Session started" }),
      expect.objectContaining({
        kind: "assistant_turn",
        markdown: "Checking",
        text: "Checking",
        status: "complete"
      }),
      expect.objectContaining({
        kind: "assistant_turn",
        markdown: "Allowed",
        text: "Allowed",
        activity: { reasoningSummary: "", tools: [{ ...commandToolActivity("started"), commandOutput: [] }] },
        status: "complete"
      })
    ]);
  });

  it("permission_denied_provider_error_fails_turn", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(permissionRequest());

    coordinator.respondToPermission("permission-1", "deny");
    transport.emitMessage(sessionError("Permission denied", "provider_error"));

    expect(coordinator.getSnapshot()).toMatchObject({ turnInFlight: false, lastError: "Permission denied" });
    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ kind: "permission_request", requestId: "permission-1" })
    );
    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "status", tone: "error", text: "Permission denied" })
    );
  });

  it("cancelTurn_returns_false_when_no_turn_is_in_flight", () => {
    const { coordinator, transport } = createHarness();

    expect(coordinator.cancelTurn()).toBe(false);

    expect(transport.postedMessages).toEqual([]);
  });

  it("cancelTurn_records_error_when_session_cancel_cannot_post", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.postResult = { ok: false, error: "cancel failed" };

    expect(coordinator.cancelTurn()).toBe(false);

    expect(coordinator.getSnapshot()).toMatchObject({
      turnInFlight: true,
      canCancelTurn: true,
      lastError: "cancel failed"
    });
    expect(coordinator.getSnapshot().transcript.at(-1)).toMatchObject({
      kind: "status",
      tone: "error",
      text: "cancel failed"
    });
  });

  it("keeps_turn_in_flight_true_after_cancel_posts_until_assistant_cancelled_arrives", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.cancelTurn();

    expect(coordinator.getSnapshot().turnInFlight).toBe(true);
    transport.emitMessage(agentEvent({ type: "assistant.cancelled" }));
    expect(coordinator.getSnapshot().turnInFlight).toBe(false);
  });

  it("makes_canCancelTurn_false_after_cancel_posts_until_assistant_cancelled_arrives", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.cancelTurn();

    expect(coordinator.getSnapshot().canCancelTurn).toBe(false);
    transport.emitMessage(agentEvent({ type: "assistant.cancelled" }));
    expect(coordinator.getSnapshot().canCancelTurn).toBe(false);
  });

  it("cancelTurn_returns_false_after_cancel_is_already_requested", () => {
    const { coordinator } = createStartedHarness();

    expect(coordinator.cancelTurn()).toBe(true);
    expect(coordinator.cancelTurn()).toBe(false);
  });

  it("cancelTurn_posts_only_one_session_cancel_for_repeated_cancel_requests", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.cancelTurn();
    coordinator.cancelTurn();

    expect(transport.postedMessages.filter((message) => message.type === "session.cancel")).toHaveLength(1);
  });

  it("clears_turn_in_flight_when_assistant_cancelled_arrives", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.cancelTurn();
    transport.emitMessage(agentEvent({ type: "assistant.cancelled" }));

    expect(coordinator.getSnapshot()).toMatchObject({
      turnInFlight: false,
      canCancelTurn: false
    });
  });

  it("clears_running_state_when_no_in_flight_turn_arrives_after_cancel_request", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.cancelTurn();
    transport.emitMessage(sessionError("No in-flight turn", "no_in_flight_turn"));

    expect(coordinator.getSnapshot()).toMatchObject({
      turnInFlight: false,
      canCancelTurn: false,
      lastError: "No in-flight turn"
    });
    expect(coordinator.getSnapshot().transcript.at(-1)).toMatchObject({
      kind: "status",
      tone: "error",
      text: "No in-flight turn"
    });
  });

  it("suppresses_stale_no_in_flight_turn_after_cancel_races_with_assistant_done", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.cancelTurn();
    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Complete" }));
    transport.emitMessage(agentEvent({ type: "assistant.done" }));
    transport.emitMessage(sessionError("No in-flight turn", "no_in_flight_turn"));

    expect(coordinator.getSnapshot()).toMatchObject({
      turnInFlight: false,
      canCancelTurn: false,
      lastError: undefined
    });
    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ kind: "status", tone: "error", text: "No in-flight turn" })
    );
  });

  it("suppresses_stale_no_in_flight_turn_after_cancel_race_then_new_chat", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.cancelTurn();
    transport.emitMessage(agentEvent({ type: "assistant.done" }));
    coordinator.newChat();
    transport.emitMessage(sessionError("No in-flight turn", "no_in_flight_turn"));

    expect(coordinator.getSnapshot()).toMatchObject({
      starting: true
    });
    expect(coordinator.getSnapshot()).not.toHaveProperty("lastError");
    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ kind: "status", tone: "error", text: "No in-flight turn" })
    );
  });

  it("rejects_busy_duplicate_before_payload_validation", () => {
    const { coordinator } = createHarness("codex", 180);

    expect(coordinator.sendPrompt("first")).toBe(true);
    expect(coordinator.sendPrompt("x".repeat(100))).toBe(false);

    expect(coordinator.getSnapshot()).toMatchObject({
      pendingPromptCount: 1,
      lastError: undefined
    });
    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ kind: "user_message", text: "first" })
    ]);
  });

  it("cancelled_bridge_event_preserves_partial_output_after_ui_cancel", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.cancelTurn();
    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    transport.emitMessage(agentEvent({ type: "assistant.cancelled" }));

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "user", text: "hello" }),
      expect.objectContaining({ role: "status", text: "Session started" }),
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "cancelled" }),
      expect.objectContaining({ kind: "status", tone: "cancelled", text: "Assistant turn cancelled" })
    ]);
  });

  it("does_not_flush_pending_duplicate_prompts_after_cancel_because_duplicates_are_not_queued", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");
    transport.emitMessage(sessionStarted());
    coordinator.cancelTurn();
    transport.emitMessage(agentEvent({ type: "assistant.cancelled" }));

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 3, clientSessionId: "client-1", prompt: "first" },
      { type: "session.cancel", version: 3, clientSessionId: "client-1" }
    ]);
    expect(coordinator.getSnapshot().pendingPromptCount).toBe(0);
  });

  it("rejects_started_session_prompt_after_send_before_first_delta", () => {
    const { coordinator, transport } = createStartedHarness();

    expect(coordinator.sendPrompt("second")).toBe(false);

    expect(transport.postedMessages).not.toContainEqual(
      expect.objectContaining({ type: "session.send", prompt: "second" })
    );
    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ kind: "user_message", text: "second" })
    );
    expect(coordinator.getSnapshot().transcript.at(-1)).toMatchObject({
      kind: "status",
      tone: "error",
      text: "A turn is already in flight for this session"
    });
  });

  it("does not add a started-session prompt to the transcript when session.send cannot post", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    transport.emitMessage(sessionStarted());
    transport.emitMessage(agentEvent({ type: "assistant.done" }));
    expect(coordinator.sendPrompt("accepted after start")).toBe(true);
    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    transport.postResult = { ok: false, error: "send failed" };
    const accepted = coordinator.sendPrompt("unsent after start");

    expect(accepted).toBe(false);
    expect(coordinator.getSnapshot()).toMatchObject({ lastError: "send failed" });
    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "user", text: "first" }),
      expect.objectContaining({ role: "status", text: "Session started" }),
      expect.objectContaining({ role: "user", text: "accepted after start" }),
      expect.objectContaining({ role: "status", tone: "error", text: "send failed" })
    ]);
  });

  it("rejects_oversized_prompt_before_starting_the_bridge_session", () => {
    const { coordinator, transport } = createHarness("codex", 80);

    const accepted = coordinator.sendPrompt("x".repeat(100));

    expect(accepted).toBe(false);
    expect(transport.postedMessages).toEqual([]);
    expect(coordinator.getSnapshot()).toMatchObject({
      pendingPromptCount: 0,
      sessionStarted: false,
      starting: false,
      lastError: "Payload is too large."
    });
    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", tone: "error", text: "Payload is too large." })
    ]);
  });

  it("rejects_oversized_started_session_prompt_without_resetting_provider_state", () => {
    const { coordinator, transport } = createHarness("codex", 160);

    coordinator.sendPrompt("first");
    transport.emitMessage(sessionStarted());
    transport.emitMessage(agentEvent({ type: "assistant.done" }));
    const accepted = coordinator.sendPrompt("x".repeat(200));

    expect(accepted).toBe(false);
    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 3, clientSessionId: "client-1", prompt: "first" }
    ]);
    expect(coordinator.getSnapshot()).toMatchObject({
      pendingPromptCount: 0,
      sessionStarted: true,
      starting: false,
      lastError: "Payload is too large."
    });
    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "user", text: "first" }),
      expect.objectContaining({ role: "status", text: "Session started" }),
      expect.objectContaining({ role: "status", tone: "error", text: "Payload is too large." })
    ]);
  });

  it("ignores session.started for another clientSessionId", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionStarted("other-client"));

    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 1, sessionStarted: false });
    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" }
    ]);
  });

  it("appends assistant deltas to the transcript without knowing React", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionStarted());
    transport.emitMessage({
      type: "agent.event",
      version: 3,
      clientSessionId: "client-1",
      event: { type: "assistant.text.delta", text: "Hi" }
    });

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "user", text: "hello" }),
      expect.objectContaining({ role: "status", text: "Session started" }),
      expect.objectContaining({ role: "assistant", text: "Hi" })
    ]);
  });

  it("clears pending startup state after bridge.error", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");
    transport.emitMessage({ type: "bridge.error", version: 3, message: "bridge failed" });

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
      expect.objectContaining({ role: "status", text: "Bridge disconnected" })
    ]);
  });
});

describe("BridgeSessionCoordinator rich assistant events", () => {
  it("appends_assistant_text_deltas_to_a_streaming_turn", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Hi" }));
    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: " there" }));

    expect(coordinator.getSnapshot().transcript.at(-1)).toMatchObject({
      kind: "assistant_turn",
      markdown: "Hi there",
      status: "streaming"
    });
  });

  it("marks_current_assistant_turn_complete_on_assistant_done", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Done" }));
    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    expect(coordinator.getSnapshot().transcript.at(-1)).toMatchObject({
      kind: "assistant_turn",
      markdown: "Done",
      status: "complete"
    });
  });

  it("adds_safe_activity_to_the_current_assistant_turn", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.activity", activity: { kind: "reasoning_summary_delta", text: "Reading" } }));

    expect(coordinator.getSnapshot().transcript.at(-1)).toMatchObject({
      kind: "assistant_turn",
      activity: { reasoningSummary: "Reading", tools: [] }
    });
  });

  it("marks_current_assistant_turn_cancelled_and_preserves_partial_output", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    transport.emitMessage(agentEvent({ type: "assistant.cancelled" }));

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "user", text: "hello" }),
      expect.objectContaining({ role: "status", text: "Session started" }),
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "cancelled" }),
      expect.objectContaining({ kind: "status", tone: "cancelled", text: "Assistant turn cancelled" })
    ]);
  });

  it("appends_cancelled_status_when_assistant_cancelled_arrives_before_first_delta", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.cancelled" }));

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "status", tone: "cancelled", text: "Assistant turn cancelled" })
    );
  });

  it("records_session_error_as_error_status_entry", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(sessionError("Provider failed", "provider_error"));

    expect(coordinator.getSnapshot().transcript.at(-1)).toMatchObject({
      kind: "status",
      tone: "error",
      text: "Provider failed"
    });
  });

  it("marks_streaming_assistant_turn_failed_when_provider_error_arrives_after_partial_output", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    transport.emitMessage(sessionError("Provider failed", "provider_error"));

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "failed" })
    );
    expect(coordinator.getSnapshot().transcript.at(-1)).toMatchObject({ tone: "error", text: "Provider failed" });
  });

  it("marks_activity_only_assistant_turn_failed_when_terminal_session_error_arrives", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.activity", activity: { kind: "reasoning_summary_delta", text: "Working" } }));
    transport.emitMessage(sessionError("Provider failed", "provider_error"));

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", activity: { reasoningSummary: "Working", tools: [] }, status: "failed" })
    );
  });

  it("marks_streaming_assistant_turn_failed_for_unsafe_provider_event_without_clearing_session_state", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    transport.emitMessage(sessionError("Unsafe provider event", "unsafe_provider_event"));

    expect(coordinator.getSnapshot()).toMatchObject({ sessionStarted: true, starting: false });
    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "failed" })
    );
  });

  it("marks_streaming_assistant_turn_failed_for_unknown_error_during_running_turn", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    transport.emitMessage(sessionError("Unknown failure", "unknown_error"));

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "failed" })
    );
  });

  it("keeps_streaming_assistant_turn_active_for_nonterminal_session_error", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    transport.emitMessage(sessionError("Turn in flight", "turn_in_flight"));

    expect(coordinator.getSnapshot()).toMatchObject({ sessionStarted: true });
    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "streaming" })
    );
    expect(coordinator.getSnapshot().transcript.at(-1)).toMatchObject({ tone: "error", text: "Turn in flight" });
  });

  it("keeps_later_deltas_attached_to_the_current_turn_after_turn_in_flight_rejects_a_second_prompt", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    expect(coordinator.sendPrompt("second")).toBe(false);
    transport.emitMessage(sessionError("Turn in flight", "turn_in_flight"));
    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: " output" }));

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial output", status: "streaming" })
    );
    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ kind: "user_message", text: "second" })
    );
  });

  it("rejects_context_prompts_without_leaving_context_markers_when_an_assistant_turn_is_streaming", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    expect(coordinator.sendPrompt({ prompt: "second", pageContext: readablePageContext() })).toBe(false);

    expect(transport.postedMessages).not.toContainEqual(
      expect.objectContaining({ type: "session.send", prompt: "second" })
    );
    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ role: "status", text: "Page context attached" })
    );
    expect(coordinator.getSnapshot().transcript).not.toContainEqual(
      expect.objectContaining({ role: "user", text: "second" })
    );
  });

  it("completes_current_streaming_turn_when_second_prompt_was_rejected_locally", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    expect(coordinator.sendPrompt("second")).toBe(false);
    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "complete" })
    );
  });

  it("clears_started_session_when_session_not_started_error_arrives", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(sessionError("Session missing", "session_not_started"));

    expect(coordinator.getSnapshot()).toMatchObject({ sessionStarted: false, starting: false });
  });

  it("marks_streaming_assistant_turn_failed_when_session_not_started_arrives_after_partial_output", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    transport.emitMessage(sessionError("Session missing", "session_not_started"));

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "failed" })
    );
  });

  it("keeps_started_session_state_when_nonfatal_session_error_arrives", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(sessionError("No turn", "no_in_flight_turn"));

    expect(coordinator.getSnapshot()).toMatchObject({ sessionStarted: true, starting: false });
  });

  it("clears_pending_startup_state_when_fatal_startup_error_arrives", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionError("Provider failed to start", "provider_start_failed"));

    expect(coordinator.getSnapshot()).toMatchObject({
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0
    });
    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ kind: "status", tone: "error", text: "Provider failed to start" })
    ]);
  });

  it("recordCaptureUnavailable_adds_error_status_entry", () => {
    const { coordinator } = createHarness();

    coordinator.recordCaptureUnavailable("Could not capture this page.");

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ kind: "status", tone: "error", text: "Could not capture this page." })
    ]);
  });

  it("marks_streaming_assistant_turn_failed_when_bridge_disconnects", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    coordinator.markBridgeDisconnected();

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "failed" })
    );
    expect(coordinator.getSnapshot().transcript.at(-1)).toMatchObject({ text: "Bridge disconnected" });
  });

  it("marks_streaming_assistant_turn_failed_when_bridge_error_arrives", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Partial" }));
    transport.emitMessage({ type: "bridge.error", version: 3, message: "Bridge failed" });

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "failed" })
    );
  });

  it("ignores_agent_events_for_another_client_session", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "Hidden" }, "other-client"));

    expect(coordinator.getSnapshot().transcript).not.toContainEqual(expect.objectContaining({ text: "Hidden" }));
  });

  it("ignores_unsolicited_agent_events_before_a_turn_is_in_flight", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "stale" }));
    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 1, sessionStarted: false, starting: true });
    expect(coordinator.getSnapshot().transcript).toEqual([expect.objectContaining({ kind: "user_message", text: "first" })]);
    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" }
    ]);
  });

  it("ignores_stale_agent_events_after_new_chat_clears_the_current_turn", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.newChat();
    transport.emitMessage(agentEvent({ type: "assistant.text.delta", text: "stale" }));
    transport.emitMessage(agentEvent({ type: "assistant.cancelled" }));

    expect(coordinator.getSnapshot().transcript).toEqual([]);
  });

  it("ignores_the_old_start_ack_when_new_chat_resets_during_startup", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("old");
    coordinator.newChat();
    coordinator.sendPrompt("fresh");
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 1, sessionStarted: false, starting: true });
    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.reset", version: 3, clientSessionId: "client-1" }
    ]);

    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 0, sessionStarted: true, starting: false });
    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.reset", version: 3, clientSessionId: "client-1" },
      { type: "session.send", version: 3, clientSessionId: "client-1", prompt: "fresh" }
    ]);
  });

  it("ignores_the_old_start_error_when_new_chat_resets_during_startup", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("old");
    coordinator.newChat();
    coordinator.sendPrompt("fresh");
    transport.emitMessage(sessionError("Old start failed", "provider_start_failed"));

    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 1, sessionStarted: false, starting: true });
    expect(coordinator.getSnapshot().transcript).toEqual([expect.objectContaining({ kind: "user_message", text: "fresh" })]);

    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toContainEqual({
      type: "session.send",
      version: 3,
      clientSessionId: "client-1",
      prompt: "fresh"
    });
  });

  it("ignores_multiple_old_start_acks_when_new_chat_resets_twice_during_startup", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("old");
    coordinator.newChat();
    coordinator.newChat();
    coordinator.sendPrompt("fresh");
    transport.emitMessage(sessionStarted());
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 1, sessionStarted: false, starting: true });
    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.reset", version: 3, clientSessionId: "client-1" },
      { type: "session.reset", version: 3, clientSessionId: "client-1" }
    ]);

    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 0, sessionStarted: true, starting: false });
    expect(transport.postedMessages).toContainEqual({
      type: "session.send",
      version: 3,
      clientSessionId: "client-1",
      prompt: "fresh"
    });
  });

  it("ignores_stale_terminal_turn_error_after_new_chat_resets_a_running_turn", () => {
    const { coordinator, transport } = createStartedHarness();

    coordinator.newChat();
    coordinator.sendPrompt("fresh");
    transport.emitMessage(sessionError("Old turn failed", "provider_error"));

    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 1, sessionStarted: false, starting: true });
    expect(coordinator.getSnapshot().transcript).toEqual([expect.objectContaining({ kind: "user_message", text: "fresh" })]);
  });

  it("ignores_session_errors_for_another_client_session", () => {
    const { coordinator, transport } = createStartedHarness();

    transport.emitMessage(sessionError("Other failure", "provider_error", "other-client"));

    expect(coordinator.getSnapshot().transcript).not.toContainEqual(expect.objectContaining({ text: "Other failure" }));
  });
});

describe("BridgeSessionCoordinator page context", () => {
  it("queued_startup_prompt_uses_effort_selected_at_send_time", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({ prompt: "first", promptEffort: "high" } as PromptSubmission & { promptEffort: string });
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toContainEqual({
      type: "session.send",
      version: 3,
      clientSessionId: "client-1",
      prompt: "first",
      promptEffort: "high"
    });
  });

  it("payload_preflight_includes_prompt_effort", () => {
    const messageWithoutPromptEffort = {
      type: "session.send" as const,
      version: 3 as const,
      clientSessionId: "client-1",
      prompt: "a"
    };
    const byteLength = serializedJsonByteLength(messageWithoutPromptEffort);
    if (!byteLength.ok) throw new Error("test message must be serializable");
    const { coordinator, transport } = createHarness("codex", byteLength.byteLength);

    expect(coordinator.sendPrompt({ prompt: "a", promptEffort: "xhigh" } as PromptSubmission & { promptEffort: string })).toBe(false);

    expect(transport.postedMessages).toEqual([]);
    expect(coordinator.getSnapshot().lastError).toBe("Payload is too large.");
  });

  it("sends_page_context_with_the_matching_session_send_message", () => {
    const { coordinator, transport } = createHarness();
    const pageContext = readablePageContext();

    coordinator.sendPrompt({ prompt: "summarize", pageContext });
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toContainEqual({
      type: "session.send",
      version: 3,
      clientSessionId: "client-1",
      prompt: "summarize",
      pageContext
    });
  });

  it("adds_context_marker_before_user_prompt_without_dumping_page_text", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({
      prompt: "summarize",
      pageContext: readablePageContext("Secret captured body text that should stay out.")
    });
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Page context attached" }),
      expect.objectContaining({ role: "user", text: "summarize" }),
      expect.objectContaining({ role: "status", text: "Session started" })
    ]);
    expect(coordinator.getSnapshot().transcript.map((entry) => entry.text).join("\n")).not.toContain(
      "Secret captured body text"
    );
  });

  it("adds_content_too_large_marker_before_user_prompt_without_dumping_page_text", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({
      prompt: "summarize",
      pageContext: contentTooLargePageContext()
    });
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Page metadata attached; content too large" }),
      expect.objectContaining({ role: "user", text: "summarize" }),
      expect.objectContaining({ role: "status", text: "Session started" })
    ]);
    expect(coordinator.getSnapshot().transcript.map((entry) => entry.text).join("\n")).not.toContain(
      "Captured readable page text"
    );
  });

  it("adds_full_dom_attached_marker_before_user_prompt_without_dumping_html", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({
      prompt: "summarize",
      pageContext: fullDomPageContext("<html><body>Secret DOM content</body></html>")
    });
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Full DOM attached" }),
      expect.objectContaining({ role: "user", text: "summarize" }),
      expect.objectContaining({ role: "status", text: "Session started" })
    ]);
    expect(coordinator.getSnapshot().transcript.map((entry) => entry.text).join("\n")).not.toContain(
      "Secret DOM content"
    );
  });

  it("adds_full_dom_too_large_marker_before_user_prompt_without_dumping_html", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({
      prompt: "summarize",
      pageContext: fullDomTooLargePageContext()
    });
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Full DOM skipped; content too large" }),
      expect.objectContaining({ role: "user", text: "summarize" }),
      expect.objectContaining({ role: "status", text: "Session started" })
    ]);
    expect(coordinator.getSnapshot().transcript.map((entry) => entry.text).join("\n")).not.toContain(
      "<html"
    );
  });

  it("queues_context_submissions_until_session_started", () => {
    const { coordinator, transport } = createHarness();
    const pageContext = metadataOnlyPageContext();

    coordinator.sendPrompt({ prompt: "what is this", pageContext });

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 3, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(coordinator.getSnapshot().pendingPromptCount).toBe(1);

    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toContainEqual({
      type: "session.send",
      version: 3,
      clientSessionId: "client-1",
      prompt: "what is this",
      pageContext
    });
  });

  it("removes_pending_context_marker_when_bridge_disconnects_before_session_started", () => {
    const { coordinator } = createHarness();

    coordinator.sendPrompt({ prompt: "summarize", pageContext: readablePageContext() });
    coordinator.markBridgeDisconnected();

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Bridge disconnected" })
    ]);
  });

  it("removes_pending_context_marker_when_session_error_arrives_before_session_started", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({ prompt: "summarize", pageContext: readablePageContext() });
    transport.emitMessage({
      type: "session.error",
      version: 3,
      clientSessionId: "client-1",
      message: "session failed"
    });

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "session failed" })
    ]);
  });

  it("removes_pending_context_marker_when_queued_send_fails_during_flush", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({ prompt: "summarize", pageContext: readablePageContext() });
    transport.postResult = { ok: false, error: "send failed" };
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Session started" }),
      expect.objectContaining({ role: "status", text: "send failed" })
    ]);
  });

  it("removes_only_the_matching_pending_entries_when_duplicate_prompt_text_exists", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("duplicate");
    transport.emitMessage(sessionStarted());
    coordinator.markBridgeDisconnected();
    coordinator.sendPrompt({ prompt: "duplicate", pageContext: readablePageContext() });
    transport.emitMessage({ type: "bridge.error", version: 3, message: "bridge failed" });

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "user", text: "duplicate" }),
      expect.objectContaining({ role: "status", text: "Session started" }),
      expect.objectContaining({ role: "status", text: "Bridge disconnected" })
    ]);
  });

  it("keeps_flushed_submission_entries_when_a_later_context_send_is_rejected", () => {
    const { coordinator, transport } = createHarness();

    expect(coordinator.sendPrompt({ prompt: "first", pageContext: readablePageContext() })).toBe(true);
    expect(coordinator.sendPrompt({ prompt: "second", pageContext: metadataOnlyPageContext() })).toBe(false);
    transport.emitMessage(sessionStarted());
    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Page context attached" }),
      expect.objectContaining({ role: "user", text: "first" }),
      expect.objectContaining({ role: "status", text: "Session started" })
    ]);
  });

  it("records_capture_unavailable_status_without_posting_protocol_message", () => {
    const { coordinator, transport } = createHarness();

    coordinator.recordCaptureUnavailable("Could not capture this page.");

    expect(transport.postedMessages).toEqual([]);
    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", tone: "error", text: "Could not capture this page." })
    ]);
  });

  it("keeps_plain_send_prompt_without_a_context_marker", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("plain");
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "user", text: "plain" }),
      expect.objectContaining({ role: "status", text: "Session started" })
    ]);
  });

  it("adds_quick_action_display_metadata_to_queued_submission_transcript", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({
      prompt: "Full quick action prompt",
      pageContext: readablePageContext(),
      userPromptDisplay: { kind: "quick_action", label: "Summarize" }
    });
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Page context attached" }),
      expect.objectContaining({
        role: "user",
        text: "Full quick action prompt",
        display: { kind: "quick_action", label: "Summarize" }
      }),
      expect.objectContaining({ role: "status", text: "Session started" })
    ]);
  });

  it("adds_quick_action_display_metadata_to_started_session_submission_transcript", () => {
    const { coordinator, transport } = createStartedHarness();
    transport.emitMessage(agentEvent({ type: "assistant.done" }));

    coordinator.sendPrompt({
      prompt: "Full quick action prompt",
      userPromptDisplay: { kind: "quick_action", label: "Summarize" }
    });

    expect(coordinator.getSnapshot().transcript).toContainEqual(
      expect.objectContaining({
        role: "user",
        text: "Full quick action prompt",
        display: { kind: "quick_action", label: "Summarize" }
      })
    );
  });

  it("still_posts_full_quick_action_prompt_to_the_bridge", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({
      prompt: "Full quick action prompt",
      pageContext: readablePageContext(),
      userPromptDisplay: { kind: "quick_action", label: "Summarize" }
    });
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toContainEqual(
      expect.objectContaining({
        type: "session.send",
        prompt: "Full quick action prompt"
      })
    );
  });
});
