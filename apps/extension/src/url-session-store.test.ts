import type { BridgeToExtension, ExtensionToBridge } from "@sidra/protocol";
import { describe, expect, it } from "vitest";
import { BridgeSessionCoordinator, type ProtocolTransport } from "./bridge/session-coordinator";
import type { PageIdentity, PageKey } from "./page-key";
import { UrlSessionStore } from "./url-session-store";

class FakeTransport implements ProtocolTransport {
  readonly postedMessages: ExtensionToBridge[] = [];
  private readonly messageListeners: Array<(message: BridgeToExtension) => void> = [];

  post(message: ExtensionToBridge) {
    this.postedMessages.push(message);
    return { ok: true as const };
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
    version: 1,
    clientSessionId,
    event: { type: "assistant.text.delta", text }
  };
}

function sessionsByClientSessionId(store: UrlSessionStore) {
  return new Map(store.getSnapshot().sessions.map((session) => [session.clientSessionId, session]));
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
    expect(store.getSnapshot().activeSession.transcript).toContainEqual({ role: "user", text: "hello" });
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

  it("routes_assistant_events_to_matching_inactive_session_without_leaking_to_active_snapshot", () => {
    const harness = createStoreHarness();
    harness.store.selectPage(pageIdentity("https://example.com/a"));
    harness.store.sendPrompt("first");
    harness.store.selectPage(pageIdentity("https://example.com/b"));
    harness.transport.emitMessage(agentTextDelta("client-1", "hidden while inactive"));
    expect(harness.store.getSnapshot().activeSession.transcript).toEqual([]);
    harness.store.selectPage(pageIdentity("https://example.com/a"));
    expect(harness.store.getSnapshot().activeSession.transcript).toContainEqual({
      role: "assistant",
      text: "hidden while inactive"
    });
  });

  it("updates_cached_sessions_when_an_inactive_coordinator_changes", () => {
    const harness = createStoreHarness();
    harness.store.selectPage(pageIdentity("https://example.com/a"));
    harness.store.sendPrompt("first");
    harness.store.selectPage(pageIdentity("https://example.com/b"));
    harness.store.getSnapshot();

    harness.transport.emitMessage(agentTextDelta("client-1", "inactive text"));

    expect(sessionsByClientSessionId(harness.store).get("client-1")?.transcript).toContainEqual({
      role: "assistant",
      text: "inactive text"
    });
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
      transcript: expect.arrayContaining([{ role: "status", text: "Bridge disconnected" }])
    });
    expect(sessions.get("client-2")).toMatchObject({
      pageKey: "https://example.com/b",
      sessionStarted: false,
      starting: false,
      pendingPromptCount: 0,
      transcript: expect.arrayContaining([{ role: "status", text: "Bridge disconnected" }])
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
      version: 1,
      clientSessionId: "client-2"
    });
    expect(harness.transport.postedMessages).not.toContainEqual({
      type: "session.reset",
      version: 1,
      clientSessionId: "client-1"
    });
  });
});
