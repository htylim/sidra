import type { BridgeToExtension, ExtensionToBridge, PageContext } from "@sidra/protocol";
import { describe, expect, it, vi } from "vitest";
import { BridgeSessionCoordinator, type ProtocolTransport } from "./bridge/session-coordinator";
import type { ProtocolTransportPostResult } from "./bridge/session-coordinator";
import type { PageIdentity, PageKey } from "./page-key";
import { UrlSessionStore } from "./url-session-store";

class FakeTransport implements ProtocolTransport {
  readonly postedMessages: ExtensionToBridge[] = [];
  private readonly messageListeners: Array<(message: BridgeToExtension) => void> = [];
  postResult: ProtocolTransportPostResult = { ok: true };

  post(message: ExtensionToBridge) {
    this.postedMessages.push(message);
    return this.postResult;
  }

  subscribeToMessages(listener: (message: BridgeToExtension) => void): () => void {
    this.messageListeners.push(listener);
    return () => undefined;
  }

  emitMessage(message: BridgeToExtension): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

function createStoreHarness(options: { clientSessionIds?: string[] } = {}) {
  const transport = new FakeTransport();
  const clientSessionIds = options.clientSessionIds ?? ["client-1", "client-2", "client-3"];
  let nextClientSessionIdIndex = 0;
  const store = new UrlSessionStore({
    createClientSessionId: () => {
      const clientSessionId = clientSessionIds[nextClientSessionIdIndex];
      nextClientSessionIdIndex += 1;
      if (!clientSessionId) throw new Error("missing test client session id");
      return clientSessionId;
    },
    createCoordinator: (clientSessionId) =>
      new BridgeSessionCoordinator({
        clientSessionId,
        transport
      })
  });

  return { store, transport };
}

function pageIdentity(pageKey: string): PageIdentity {
  return {
    status: "ready",
    pageKey: pageKey as PageKey,
    url: pageKey,
    displayTitle: pageKey
  };
}

function agentTextDelta(clientSessionId: string, text: string): BridgeToExtension {
  return {
    type: "agent.event",
    version: 2,
    clientSessionId,
    event: { type: "assistant.text.delta", text }
  };
}

function permissionRequest(clientSessionId: string, requestId = "permission-1", permissionKey = "shell:ls"): BridgeToExtension {
  return {
    type: "permission.request",
    version: 2,
    clientSessionId,
    request: {
      requestId,
      permissionKey,
      title: "Run command"
    }
  };
}

function assistantCancelled(clientSessionId: string): BridgeToExtension {
  return {
    type: "agent.event",
    version: 2,
    clientSessionId,
    event: { type: "assistant.cancelled" }
  };
}

function sessionStarted(clientSessionId: string): BridgeToExtension {
  return {
    type: "session.started",
    version: 2,
    clientSessionId,
    bridgeSessionId: `${clientSessionId}-bridge`
  };
}

function sessionsByClientSessionId(store: UrlSessionStore) {
  return new Map(store.getSnapshot().sessions.map((session) => [session.clientSessionId, session]));
}

function readablePageContext(text = "Readable page text that should not be visible in transcript."): PageContext {
  return {
    kind: "readable",
    metadata: {
      url: "https://example.com/article",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    text,
    textLength: text.length,
    extractionMethod: "readability"
  };
}

function metadataOnlyPageContext(): PageContext {
  return {
    kind: "metadata_only",
    metadata: {
      url: "https://example.com/short",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    reason: "no_usable_text"
  };
}

function contentTooLargePageContext(): PageContext {
  return {
    kind: "metadata_only",
    metadata: {
      url: "https://example.com/large",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    reason: "content_too_large"
  };
}

function fullDomPageContext(): PageContext {
  const html = "<html><body><main>Full DOM content</main></body></html>";

  return {
    kind: "full_dom",
    metadata: {
      url: "https://example.com/full-dom",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    html,
    htmlLength: html.length
  };
}

function fullDomTooLargePageContext(): PageContext {
  return {
    kind: "metadata_only",
    metadata: {
      url: "https://example.com/large-dom",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    reason: "full_dom_too_large"
  };
}

describe("UrlSessionStore", () => {
  it("creates_one_url_session_per_page_key_with_distinct_client_session_ids", () => {
    const { store } = createStoreHarness({ clientSessionIds: ["client-1", "client-2"] });
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.getSnapshot().activeSession.clientSessionId).toBe("client-1");
    store.selectPage(pageIdentity("https://example.com/b"));
    expect(store.getSnapshot().activeSession.clientSessionId).toBe("client-2");
  });

  it("restores_unsent_draft_when_returning_to_seen_page_key", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.updateActiveDraftPrompt("draft a");
    store.selectPage(pageIdentity("https://example.com/b"));
    expect(store.getSnapshot().activeSession.draftPrompt).toBe("");
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.getSnapshot().activeSession.draftPrompt).toBe("draft a");
  });

  it("restores_transcript_when_returning_to_seen_page_key", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.sendPrompt("hello")).toBe(true);
    store.selectPage(pageIdentity("https://example.com/b"));
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.getSnapshot().activeSession.draftPrompt).toBe("");
    expect(store.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ role: "user", text: "hello" })
    );
  });

  it("updates_only_the_active_session_draft", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.updateActiveDraftPrompt("draft a");
    store.selectPage(pageIdentity("https://example.com/b"));
    expect(store.getSnapshot().activeSession.draftPrompt).toBe("");
  });

  it("keeps_pending_state_scoped_to_the_active_page_key", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    expect(store.getSnapshot().activeSession).toMatchObject({ starting: true, pendingPromptCount: 1 });
    store.selectPage(pageIdentity("https://example.com/b"));
    expect(store.getSnapshot().activeSession).toMatchObject({ starting: false, pendingPromptCount: 0 });
  });

  it("exposes_turn_in_flight_for_the_active_url_session", () => {
    const { store, transport } = createStoreHarness();

    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));

    expect(store.getSnapshot().activeSession).toMatchObject({
      turnInFlight: true,
      canCancelTurn: true
    });
  });

  it("routes_cancelActiveTurn_to_the_active_url_session_only", () => {
    const { store, transport } = createStoreHarness();

    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));
    store.selectPage(pageIdentity("https://example.com/b"));
    store.sendPrompt("second");
    transport.emitMessage(sessionStarted("client-2"));

    expect(store.cancelActiveTurn()).toBe(true);

    expect(transport.postedMessages).toContainEqual({
      type: "session.cancel",
      version: 2,
      clientSessionId: "client-2"
    });
    expect(transport.postedMessages).not.toContainEqual({
      type: "session.cancel",
      version: 2,
      clientSessionId: "client-1"
    });
  });

  it("stores_permission_request_in_matching_inactive_session_only", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));
    store.selectPage(pageIdentity("https://example.com/b"));

    transport.emitMessage(permissionRequest("client-1"));

    expect(store.getSnapshot().activeSession.transcript).toEqual([]);
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ kind: "permission_request", requestId: "permission-1", status: "pending" })
    );
  });

  it("responds_to_permission_for_the_active_url_session_only", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));
    transport.emitMessage(permissionRequest("client-1"));

    expect(store.respondToActivePermission("permission-1", "deny")).toBe(true);

    expect(transport.postedMessages).toContainEqual({
      type: "permission.respond",
      version: 2,
      clientSessionId: "client-1",
      requestId: "permission-1",
      decision: "deny"
    });
  });

  it("respondToPermission_does_not_cross_url_session_boundary", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));
    transport.emitMessage(permissionRequest("client-1"));
    store.selectPage(pageIdentity("https://example.com/b"));

    expect(store.respondToActivePermission("permission-1", "allow_once")).toBe(false);

    expect(transport.postedMessages).not.toContainEqual(expect.objectContaining({ type: "permission.respond" }));
  });

  it("allow_once_does_not_create_session_approval", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));
    transport.emitMessage(permissionRequest("client-1"));

    store.respondToActivePermission("permission-1", "allow_once");

    expect(store.listActiveSessionApprovals()).toEqual([]);
  });

  it("allow_for_session_records_active_session_approval", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));
    transport.emitMessage(permissionRequest("client-1"));

    store.respondToActivePermission("permission-1", "allow_for_session");

    expect(store.listActiveSessionApprovals()).toEqual([{ permissionKey: "shell:ls", decision: "allow_for_session" }]);
  });

  it("auto_allows_matching_request_from_active_session_approval", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.grantActiveSessionApproval({ permissionKey: "shell:ls", decision: "allow_for_session" });
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));

    transport.emitMessage(permissionRequest("client-1"));

    expect(transport.postedMessages).toContainEqual({
      type: "permission.respond",
      version: 2,
      clientSessionId: "client-1",
      requestId: "permission-1",
      decision: "allow_for_session"
    });
    expect(store.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ kind: "permission_request", status: "allowed_for_session" })
    );
  });

  it("failed_auto_allow_does_not_retry_indefinitely", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.grantActiveSessionApproval({ permissionKey: "shell:ls", decision: "allow_for_session" });
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));
    transport.postResult = { ok: false, error: "post failed" };

    transport.emitMessage(permissionRequest("client-1"));

    expect(transport.postedMessages.filter((message) => message.type === "permission.respond")).toHaveLength(1);
    expect(store.listActiveSessionApprovals()).toEqual([]);
  });

  it("approval_for_one_url_session_does_not_auto_allow_another_session", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.grantActiveSessionApproval({ permissionKey: "shell:ls", decision: "allow_for_session" });
    store.selectPage(pageIdentity("https://example.com/b"));
    store.sendPrompt("second");
    transport.emitMessage(sessionStarted("client-2"));

    transport.emitMessage(permissionRequest("client-2"));

    expect(transport.postedMessages).not.toContainEqual({
      type: "permission.respond",
      version: 2,
      clientSessionId: "client-2",
      requestId: "permission-1",
      decision: "allow_for_session"
    });
    expect(store.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ kind: "permission_request", status: "pending" })
    );
  });

  it("returns_false_when_cancelling_without_an_active_turn", () => {
    const { store } = createStoreHarness();

    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.cancelActiveTurn()).toBe(false);
  });

  it("restores_cancel_state_when_returning_to_running_url_session", () => {
    const { store, transport } = createStoreHarness();

    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));
    store.selectPage(pageIdentity("https://example.com/b"));
    expect(store.getSnapshot().activeSession.turnInFlight).toBe(false);

    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.getSnapshot().activeSession).toMatchObject({
      turnInFlight: true,
      canCancelTurn: true
    });
  });

  it("keeps_other_sessions_running_when_active_session_is_cancelled", () => {
    const { store, transport } = createStoreHarness();

    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));
    store.selectPage(pageIdentity("https://example.com/b"));
    store.sendPrompt("second");
    transport.emitMessage(sessionStarted("client-2"));
    store.cancelActiveTurn();
    transport.emitMessage(assistantCancelled("client-2"));

    const sessions = sessionsByClientSessionId(store);
    expect(sessions.get("client-1")).toMatchObject({ turnInFlight: true, canCancelTurn: true });
    expect(sessions.get("client-2")).toMatchObject({ turnInFlight: false, canCancelTurn: false });
  });

  it("routes_assistant_events_to_matching_inactive_session_without_leaking_to_active_snapshot", () => {
    const harness = createStoreHarness();
    harness.store.selectPage(pageIdentity("https://example.com/a"));
    harness.store.sendPrompt("first");
    harness.transport.emitMessage(sessionStarted("client-1"));
    harness.store.selectPage(pageIdentity("https://example.com/b"));
    harness.transport.emitMessage(agentTextDelta("client-1", "hidden while inactive"));
    expect(harness.store.getSnapshot().activeSession.transcript).toEqual([]);
    harness.store.selectPage(pageIdentity("https://example.com/a"));
    expect(harness.store.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        text: "hidden while inactive"
      })
    );
  });

  it("does_not_show_inactive_session_stream_or_error_in_active_session", () => {
    const harness = createStoreHarness();
    harness.store.selectPage(pageIdentity("https://example.com/a"));
    harness.store.sendPrompt("first");
    harness.transport.emitMessage(sessionStarted("client-1"));
    harness.store.selectPage(pageIdentity("https://example.com/b"));

    harness.transport.emitMessage(agentTextDelta("client-1", "inactive text"));
    harness.transport.emitMessage({
      type: "session.error",
      version: 2,
      clientSessionId: "client-1",
      message: "Inactive failure",
      code: "provider_error"
    });

    expect(harness.store.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("restores_inactive_session_stream_and_error_when_returning_to_that_page", () => {
    const harness = createStoreHarness();
    harness.store.selectPage(pageIdentity("https://example.com/a"));
    harness.store.sendPrompt("first");
    harness.transport.emitMessage(sessionStarted("client-1"));
    harness.store.selectPage(pageIdentity("https://example.com/b"));

    harness.transport.emitMessage(agentTextDelta("client-1", "inactive text"));
    harness.transport.emitMessage({
      type: "session.error",
      version: 2,
      clientSessionId: "client-1",
      message: "Inactive failure",
      code: "provider_error"
    });
    harness.store.selectPage(pageIdentity("https://example.com/a"));

    expect(harness.store.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "inactive text", status: "failed" })
    );
    expect(harness.store.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ kind: "status", tone: "error", text: "Inactive failure" })
    );
  });

  it("updates_cached_sessions_when_an_inactive_coordinator_changes", () => {
    const harness = createStoreHarness();
    harness.store.selectPage(pageIdentity("https://example.com/a"));
    harness.store.sendPrompt("first");
    harness.transport.emitMessage(sessionStarted("client-1"));
    harness.store.selectPage(pageIdentity("https://example.com/b"));
    harness.store.getSnapshot();

    harness.transport.emitMessage(agentTextDelta("client-1", "inactive text"));

    expect(sessionsByClientSessionId(harness.store).get("client-1")?.transcript).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        text: "inactive text"
      })
    );
  });

  it("marks_all_started_sessions_disconnected_when_bridge_disconnects", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    store.selectPage(pageIdentity("https://example.com/b"));
    store.sendPrompt("second");
    store.markBridgeDisconnected();
    const sessions = sessionsByClientSessionId(store);
    expect(sessions.get("client-1")).toMatchObject({
      pageKey: "https://example.com/a",
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      transcript: expect.arrayContaining([expect.objectContaining({ role: "status", text: "Bridge disconnected" })])
    });
    expect(sessions.get("client-2")).toMatchObject({
      pageKey: "https://example.com/b",
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      transcript: expect.arrayContaining([expect.objectContaining({ role: "status", text: "Bridge disconnected" })])
    });
  });

  it("new_chat_routes_to_the_active_url_session_only", () => {
    const harness = createStoreHarness();
    harness.store.selectPage(pageIdentity("https://example.com/a"));
    harness.store.sendPrompt("first");
    harness.store.selectPage(pageIdentity("https://example.com/b"));
    harness.store.sendPrompt("second");
    harness.store.newChat();
    expect(harness.transport.postedMessages).toContainEqual({
      type: "session.reset",
      version: 2,
      clientSessionId: "client-2"
    });
    expect(harness.transport.postedMessages).not.toContainEqual({
      type: "session.reset",
      version: 2,
      clientSessionId: "client-1"
    });
  });

  it("newChat_does_not_post_reset_for_never_started_empty_session", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    store.newChat();

    expect(transport.postedMessages).toEqual([]);
    expect(store.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("newChat_keeps_same_page_key_and_client_session_after_reset", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("first");
    transport.emitMessage(sessionStarted("client-1"));

    store.newChat();

    expect(store.getSnapshot().activeSession).toMatchObject({
      pageKey: "https://example.com/a",
      clientSessionId: "client-1",
      starting: true
    });
  });

  it("newChat_clears_active_transcript_draft_context_and_capture_mode", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.updateActiveCaptureMode("full_dom");
    store.sendPromptWithContext({ prompt: "summarize", pageContext: readablePageContext() });
    transport.emitMessage(sessionStarted("client-1"));
    store.updateActiveDraftPrompt("unsent draft");

    store.newChat();

    expect(store.getSnapshot().activeSession).toMatchObject({
      draftPrompt: "",
      captureMode: "readable",
      contextState: { status: "none", label: "No context sent yet" },
      transcript: []
    });
  });

  it("newChat_preserves_inactive_session_transcript_draft_context_running_state_and_provider_session", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPromptWithContext({ prompt: "a", pageContext: readablePageContext() });
    transport.emitMessage(sessionStarted("client-1"));
    store.updateActiveDraftPrompt("draft a");
    store.selectPage(pageIdentity("https://example.com/b"));
    store.sendPrompt("b");
    transport.emitMessage(sessionStarted("client-2"));
    store.updateActiveDraftPrompt("draft b");

    store.newChat();

    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.getSnapshot().activeSession).toMatchObject({
      pageKey: "https://example.com/a",
      clientSessionId: "client-1",
      draftPrompt: "draft a",
      contextState: { status: "attached" },
      turnInFlight: true,
      canCancelTurn: true
    });
    expect(store.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ kind: "user_message", text: "a" })
    );
    expect(transport.postedMessages).not.toContainEqual({
      type: "session.reset",
      version: 2,
      clientSessionId: "client-1"
    });
  });

  it("newChat_records_reset_post_failure_in_active_session_only", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("a");
    transport.emitMessage(sessionStarted("client-1"));
    store.selectPage(pageIdentity("https://example.com/b"));
    store.sendPrompt("b");
    transport.emitMessage(sessionStarted("client-2"));
    transport.postResult = { ok: false, error: "reset failed" };

    store.newChat();

    expect(store.getSnapshot().activeSession.transcript).toEqual([
      expect.objectContaining({ kind: "status", tone: "error", text: "reset failed" })
    ]);
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.getSnapshot().activeSession.transcript).not.toContainEqual(
      expect.objectContaining({ text: "reset failed" })
    );
  });

  it("newChat_clears_active_session_scoped_approvals_only", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.grantActiveSessionApproval({ permissionKey: "shell:ls", decision: "allow_for_session" });
    store.selectPage(pageIdentity("https://example.com/b"));
    store.grantActiveSessionApproval({ permissionKey: "shell:git", decision: "allow_for_session" });

    store.newChat();

    expect(store.hasActiveSessionApproval("shell:git")).toBe(false);
    expect(store.listActiveSessionApprovals()).toEqual([]);
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.hasActiveSessionApproval("shell:ls")).toBe(true);
    expect(store.listActiveSessionApprovals()).toEqual([
      { permissionKey: "shell:ls", decision: "allow_for_session" }
    ]);
  });

  it("bridge_disconnect_clears_all_session_approvals", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.grantActiveSessionApproval({ permissionKey: "shell:ls", decision: "allow_for_session" });
    store.selectPage(pageIdentity("https://example.com/b"));
    store.grantActiveSessionApproval({ permissionKey: "shell:git", decision: "allow_for_session" });

    store.markBridgeDisconnected();

    expect(store.listActiveSessionApprovals()).toEqual([]);
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.listActiveSessionApprovals()).toEqual([]);
  });

  it("clearAllSessions_removes_in_memory_url_sessions_and_approvals", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.updateActiveDraftPrompt("draft");
    store.grantActiveSessionApproval({ permissionKey: "shell:ls", decision: "allow_for_session" });
    store.selectPage(pageIdentity("https://example.com/b"));

    store.clearAllSessions();

    expect(store.getSnapshot().sessions).toEqual([]);
    expect(store.getSnapshot().activeSession.clientSessionId).toBe("");
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.getSnapshot().activeSession.draftPrompt).toBe("");
    expect(store.listActiveSessionApprovals()).toEqual([]);
  });

  it("clearAllSessions_marks_provider_backed_coordinators_disconnected_before_drop", () => {
    const markBridgeDisconnected = vi.fn();
    const store = new UrlSessionStore({
      createClientSessionId: () => "client-1",
      createCoordinator: (clientSessionId) => ({
        getSnapshot: () => ({
          clientSessionId,
          sessionStarted: true,
          starting: false,
          turnInFlight: false,
          canCancelTurn: false,
          pendingPromptCount: 0,
          transcript: []
        }),
        subscribe: () => () => undefined,
        sendPrompt: () => true,
        newChat: () => undefined,
        markBridgeDisconnected,
        hasProviderState: () => true
      })
    });
    store.selectPage(pageIdentity("https://example.com/a"));

    store.clearAllSessions();

    expect(markBridgeDisconnected).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().sessions).toEqual([]);
  });

  it("clearAllSessions_does_not_emit_transcript_bearing_intermediate_snapshots", () => {
    const { store } = createStoreHarness();
    const snapshots: unknown[] = [];
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("secret prompt");
    store.subscribe(() => snapshots.push(store.getSnapshot()));

    store.clearAllSessions();

    expect(JSON.stringify(snapshots)).not.toContain("secret prompt");
    expect(snapshots).toEqual([
      expect.objectContaining({
        activeSession: expect.objectContaining({ clientSessionId: "", transcript: [] }),
        sessions: []
      })
    ]);
  });

  it("clearAllSessions_disposes_dropped_coordinators_and_transport_subscriptions", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPrompt("secret prompt");

    store.clearAllSessions();
    transport.emitMessage(sessionStarted("client-1"));
    transport.emitMessage(agentTextDelta("client-1", "stale assistant text"));
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("clearAllSessions_disposes_dropped_coordinators_without_provider_state", () => {
    const dispose = vi.fn();
    const store = new UrlSessionStore({
      createClientSessionId: () => "client-1",
      createCoordinator: (clientSessionId) => ({
        getSnapshot: () => ({
          clientSessionId,
          sessionStarted: false,
          starting: false,
          turnInFlight: false,
          canCancelTurn: false,
          pendingPromptCount: 0,
          transcript: []
        }),
        subscribe: () => () => undefined,
        sendPrompt: () => true,
        newChat: () => undefined,
        markBridgeDisconnected: () => undefined,
        hasProviderState: () => false,
        dispose
      })
    });
    store.selectPage(pageIdentity("https://example.com/a"));

    store.clearAllSessions();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("UrlSessionStore context state", () => {
  it("updates_context_state_for_the_active_session_after_readable_context_send", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.sendPromptWithContext({ prompt: "summarize", pageContext: readablePageContext() })).toBe(true);

    expect(store.getSnapshot().activeSession.contextState).toEqual({
      status: "attached",
      label: "Context attached",
      capturedAt: "2026-05-10T12:00:00.000Z"
    });
  });

  it("updates_context_state_for_metadata_only_send", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.sendPromptWithContext({ prompt: "describe", pageContext: metadataOnlyPageContext() })).toBe(true);

    expect(store.getSnapshot().activeSession.contextState).toEqual({
      status: "metadata_only",
      label: "Metadata attached",
      capturedAt: "2026-05-10T12:00:00.000Z",
      reason: "no_usable_text"
    });
  });

  it("updates_context_state_for_content_too_large_metadata_only_send", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.sendPromptWithContext({ prompt: "describe", pageContext: contentTooLargePageContext() })).toBe(true);

    expect(store.getSnapshot().activeSession.contextState).toEqual({
      status: "content_too_large",
      label: "Content too large",
      capturedAt: "2026-05-10T12:00:00.000Z",
      reason: "content_too_large"
    });
  });

  it("updates_context_state_for_full_dom_context_send", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.sendPromptWithContext({ prompt: "describe", pageContext: fullDomPageContext() })).toBe(true);

    expect(store.getSnapshot().activeSession.contextState).toEqual({
      status: "full_dom_attached",
      label: "Full DOM attached",
      capturedAt: "2026-05-10T12:00:00.000Z"
    });
  });

  it("updates_context_state_for_full_dom_too_large_metadata_only_send", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.sendPromptWithContext({ prompt: "describe", pageContext: fullDomTooLargePageContext() })).toBe(true);

    expect(store.getSnapshot().activeSession.contextState).toEqual({
      status: "full_dom_too_large",
      label: "Full DOM skipped: too large",
      capturedAt: "2026-05-10T12:00:00.000Z",
      reason: "full_dom_too_large"
    });
  });

  it("does_not_update_context_state_when_context_submission_is_rejected", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPromptWithContext({ prompt: "describe", pageContext: metadataOnlyPageContext() });
    store.updateActiveDraftPrompt("keep draft");

    expect(store.sendPromptWithContext({ prompt: "   ", pageContext: readablePageContext() })).toBe(false);

    expect(store.getSnapshot().activeSession.contextState).toEqual({
      status: "metadata_only",
      label: "Metadata attached",
      capturedAt: "2026-05-10T12:00:00.000Z",
      reason: "no_usable_text"
    });
    expect(store.getSnapshot().activeSession.draftPrompt).toBe("keep draft");
  });

  it("keeps_context_state_scoped_to_the_url_session", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPromptWithContext({ prompt: "summarize", pageContext: readablePageContext() });
    store.selectPage(pageIdentity("https://example.com/b"));

    expect(store.getSnapshot().activeSession.contextState).toEqual({
      status: "none",
      label: "No context sent yet"
    });
  });

  it("clears_context_state_on_new_chat_for_the_active_session_only", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPromptWithContext({ prompt: "a", pageContext: readablePageContext() });
    store.selectPage(pageIdentity("https://example.com/b"));
    store.sendPromptWithContext({ prompt: "b", pageContext: metadataOnlyPageContext() });
    store.newChat();

    expect(store.getSnapshot().activeSession.contextState).toEqual({
      status: "none",
      label: "No context sent yet"
    });
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.getSnapshot().activeSession.contextState.status).toBe("attached");
  });

  it("records_capture_unavailable_for_the_active_session_without_clearing_draft", () => {
    const { store, transport } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.updateActiveSendMode("send");
    store.updateActiveDraftPrompt("keep this");

    store.recordCaptureUnavailable({ message: "Could not capture this page." });

    expect(transport.postedMessages).toEqual([]);
    expect(store.getSnapshot().activeSession).toMatchObject({
      draftPrompt: "keep this",
      sendMode: "send",
      contextState: {
        status: "capture_unavailable",
        label: "Capture unavailable",
        message: "Could not capture this page."
      }
    });
    expect(store.getSnapshot().activeSession.transcript).toEqual([
      expect.objectContaining({ role: "status", tone: "error", text: "Could not capture this page." })
    ]);
  });

  it("record_capture_unavailable_preserves_default_capture_send_mode", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    store.recordCaptureUnavailable({ message: "Could not capture this page." });

    expect(store.getSnapshot().activeSession.sendMode).toBe("capture");
  });
});

describe("UrlSessionStore send mode state", () => {
  it("new_url_session_defaults_to_capture_send", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.getSnapshot().activeSession.sendMode).toBe("capture");
  });

  it("successful_context_send_switches_active_session_to_plain_send", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.sendPromptWithContext({ prompt: "summarize", pageContext: readablePageContext() })).toBe(true);

    expect(store.getSnapshot().activeSession.sendMode).toBe("send");
  });

  it("accepted_metadata_only_context_send_switches_active_session_to_plain_send", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.sendPromptWithContext({ prompt: "describe", pageContext: metadataOnlyPageContext() })).toBe(true);

    expect(store.getSnapshot().activeSession.sendMode).toBe("send");
  });

  it("rejected_context_send_preserves_send_mode", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.updateActiveSendMode("send");

    expect(store.sendPromptWithContext({ prompt: "   ", pageContext: readablePageContext() })).toBe(false);

    expect(store.getSnapshot().activeSession.sendMode).toBe("send");
  });

  it("rejected_context_send_preserves_default_capture_send_mode", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.sendPromptWithContext({ prompt: "   ", pageContext: readablePageContext() })).toBe(false);

    expect(store.getSnapshot().activeSession.sendMode).toBe("capture");
  });

  it("manual_send_mode_before_context_is_preserved_for_plain_send", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    store.updateActiveSendMode("send");
    expect(store.sendPrompt("plain")).toBe(true);

    expect(store.getSnapshot().activeSession.sendMode).toBe("send");
  });

  it("send_mode_is_scoped_per_url_session", () => {
    const { store } = createStoreHarness({ clientSessionIds: ["client-a", "client-b"] });
    store.selectPage(pageIdentity("https://example.com/a"));
    store.sendPromptWithContext({ prompt: "summarize", pageContext: readablePageContext() });
    store.selectPage(pageIdentity("https://example.com/b"));

    expect(store.getSnapshot().activeSession.sendMode).toBe("capture");

    const sessions = sessionsByClientSessionId(store);
    expect(sessions.get("client-a")?.sendMode).toBe("send");
    expect(sessions.get("client-b")?.sendMode).toBe("capture");
  });

  it("new_chat_resets_send_mode_to_capture", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.updateActiveSendMode("send");

    store.newChat();

    expect(store.getSnapshot().activeSession.sendMode).toBe("capture");
  });
});

describe("UrlSessionStore capture mode state", () => {
  it("new_url_sessions_default_to_readable_capture_mode", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    expect(store.getSnapshot().activeSession.captureMode).toBe("readable");
  });

  it("updates_capture_mode_for_the_active_url_session", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));

    store.updateActiveCaptureMode("full_dom");

    expect(store.getSnapshot().activeSession.captureMode).toBe("full_dom");
  });

  it("keeps_capture_mode_scoped_to_the_url_session", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.updateActiveCaptureMode("full_dom");
    store.selectPage(pageIdentity("https://example.com/b"));

    expect(store.getSnapshot().activeSession.captureMode).toBe("readable");

    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.getSnapshot().activeSession.captureMode).toBe("full_dom");
  });

  it("resets_capture_mode_to_readable_on_new_chat_for_the_active_session_only", () => {
    const { store } = createStoreHarness();
    store.selectPage(pageIdentity("https://example.com/a"));
    store.updateActiveCaptureMode("full_dom");
    store.selectPage(pageIdentity("https://example.com/b"));
    store.updateActiveCaptureMode("full_dom");

    store.newChat();

    expect(store.getSnapshot().activeSession.captureMode).toBe("readable");
    store.selectPage(pageIdentity("https://example.com/a"));
    expect(store.getSnapshot().activeSession.captureMode).toBe("full_dom");
  });
});
