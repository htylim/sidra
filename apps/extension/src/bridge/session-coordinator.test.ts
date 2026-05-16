import type { BridgeToExtension, ExtensionToBridge, ProviderId } from "@sidra/protocol";
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

function createHarness(providerId: ProviderId = "codex") {
  const transport = new FakeTransport();
  const coordinator = new BridgeSessionCoordinator({
    clientSessionId: "client-1",
    providerId,
    transport
  });

  return { coordinator, transport };
}

function sessionStarted(clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "session.started",
    version: 1,
    clientSessionId,
    bridgeSessionId: "bridge-1"
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

describe("BridgeSessionCoordinator", () => {
  it("posts session.start before the first session.send", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "hello" }
    ]);
  });

  it("queues prompts while waiting for session.started", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 2, starting: true });
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
      { role: "status", text: "native host unavailable" }
    ]);
  });

  it("flushes queued prompts in original order", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
    expect(coordinator.getSnapshot().pendingPromptCount).toBe(0);
  });

  it("reuses the started provider session for later prompts", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    transport.emitMessage(sessionStarted());
    coordinator.sendPrompt("second");

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
  });

  it("does not add a started-session prompt to the transcript when session.send cannot post", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    transport.emitMessage(sessionStarted());
    expect(coordinator.sendPrompt("accepted after start")).toBe(true);

    transport.postResult = { ok: false, error: "send failed" };
    const accepted = coordinator.sendPrompt("unsent after start");

    expect(accepted).toBe(false);
    expect(coordinator.getSnapshot()).toMatchObject({ lastError: "send failed" });
    expect(coordinator.getSnapshot().transcript).toEqual([
      { role: "user", text: "first" },
      { role: "status", text: "Session started" },
      { role: "user", text: "accepted after start" },
      { role: "status", text: "send failed" }
    ]);
  });

  it("ignores session.started for another clientSessionId", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionStarted("other-client"));

    expect(coordinator.getSnapshot()).toMatchObject({ pendingPromptCount: 1, sessionStarted: false });
    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
  });

  it("appends assistant deltas to the transcript without knowing React", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("hello");
    transport.emitMessage(sessionStarted());
    transport.emitMessage({
      type: "agent.event",
      version: 1,
      clientSessionId: "client-1",
      event: { type: "assistant.text.delta", text: "Hi" }
    });

    expect(coordinator.getSnapshot().transcript).toEqual([
      { role: "user", text: "hello" },
      { role: "status", text: "Session started" },
      { role: "assistant", text: "Hi" }
    ]);
  });

  it("clears pending startup state after bridge.error", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("first");
    coordinator.sendPrompt("second");
    transport.emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

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
      { role: "status", text: "Bridge disconnected" }
    ]);
  });
});

describe("BridgeSessionCoordinator page context", () => {
  it("sends_page_context_with_the_matching_session_send_message", () => {
    const { coordinator, transport } = createHarness();
    const pageContext = readablePageContext();

    coordinator.sendPrompt({ prompt: "summarize", pageContext });
    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toContainEqual({
      type: "session.send",
      version: 1,
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

  it("queues_context_submissions_until_session_started", () => {
    const { coordinator, transport } = createHarness();
    const pageContext = metadataOnlyPageContext();

    coordinator.sendPrompt({ prompt: "what is this", pageContext });

    expect(transport.postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(coordinator.getSnapshot().pendingPromptCount).toBe(1);

    transport.emitMessage(sessionStarted());

    expect(transport.postedMessages).toContainEqual({
      type: "session.send",
      version: 1,
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
      { role: "status", text: "Bridge disconnected" }
    ]);
  });

  it("removes_pending_context_marker_when_session_error_arrives_before_session_started", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({ prompt: "summarize", pageContext: readablePageContext() });
    transport.emitMessage({
      type: "session.error",
      version: 1,
      clientSessionId: "client-1",
      message: "session failed"
    });

    expect(coordinator.getSnapshot().transcript).toEqual([
      { role: "status", text: "session failed" }
    ]);
  });

  it("removes_pending_context_marker_when_queued_send_fails_during_flush", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({ prompt: "summarize", pageContext: readablePageContext() });
    transport.postResult = { ok: false, error: "send failed" };
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot().transcript).toEqual([
      { role: "status", text: "Session started" },
      { role: "status", text: "send failed" }
    ]);
  });

  it("removes_only_the_matching_pending_entries_when_duplicate_prompt_text_exists", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt("duplicate");
    transport.emitMessage(sessionStarted());
    coordinator.markBridgeDisconnected();
    coordinator.sendPrompt({ prompt: "duplicate", pageContext: readablePageContext() });
    transport.emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "user", text: "duplicate" }),
      expect.objectContaining({ role: "status", text: "Session started" }),
      expect.objectContaining({ role: "status", text: "Bridge disconnected" })
    ]);
  });

  it("keeps_flushed_submission_entries_when_a_later_queued_context_send_fails", () => {
    const { coordinator, transport } = createHarness();

    coordinator.sendPrompt({ prompt: "first", pageContext: readablePageContext() });
    coordinator.sendPrompt({ prompt: "second", pageContext: metadataOnlyPageContext() });
    const originalPost = transport.post.bind(transport);
    let sendCount = 0;
    transport.post = (message) => {
      if (message.type === "session.send") {
        sendCount += 1;
        if (sendCount === 2) return { ok: false, error: "second failed" };
      }
      return originalPost(message);
    };
    transport.emitMessage(sessionStarted());

    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Page context attached" }),
      expect.objectContaining({ role: "user", text: "first" }),
      expect.objectContaining({ role: "status", text: "Session started" }),
      { role: "status", text: "second failed" }
    ]);
  });

  it("records_capture_unavailable_status_without_posting_protocol_message", () => {
    const { coordinator, transport } = createHarness();

    coordinator.recordCaptureUnavailable("Could not capture this page.");

    expect(transport.postedMessages).toEqual([]);
    expect(coordinator.getSnapshot().transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Could not capture this page" })
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
});
