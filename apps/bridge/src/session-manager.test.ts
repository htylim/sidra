import { describe, expect, it } from "vitest";
import type { AgentEvent, BridgeToExtension } from "@sidra/protocol";
import { BridgeSessionManager, type AgentProvider, type AgentSendInput, type AgentSession } from "./session-manager.js";

describe("BridgeSessionManager", () => {
  it("creates one provider session per clientSessionId", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider();
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.startSession("page-2", "codex");

    expect(provider.createdSessions).toHaveLength(2);
    expect(emitted).toEqual([
      {
        type: "session.started",
        version: 2,
        clientSessionId: "page-1",
        bridgeSessionId: expect.any(String)
      },
      {
        type: "session.started",
        version: 2,
        clientSessionId: "page-2",
        bridgeSessionId: expect.any(String)
      }
    ]);
  });

  it("closes an existing provider session before replacing it on session.start", async () => {
    const provider = createFakeProvider();
    const manager = new BridgeSessionManager({ provider, emit: () => {} });

    await manager.startSession("page-1", "codex");
    await manager.startSession("page-1", "codex");

    expect(provider.createdSessions).toHaveLength(2);
    expect(provider.createdSessions[0]?.closeCount).toBe(1);
    expect(provider.createdSessions[1]?.closeCount).toBe(0);
  });

  it("keeps the newest session active when same-client starts overlap", async () => {
    const provider = createDeferredProvider();
    const manager = new BridgeSessionManager({ provider, emit: () => {} });
    const firstSession = new FakeAgentSession();
    const secondSession = new FakeAgentSession();

    const firstStart = manager.startSession("page-1", "codex");
    await provider.waitForRequestCount(1);
    const secondStart = manager.startSession("page-1", "codex");

    if (provider.requests.length === 2) {
      provider.requests[1]?.resolve(secondSession);
      provider.requests[0]?.resolve(firstSession);
    } else {
      provider.requests[0]?.resolve(firstSession);
      await firstStart;
      await provider.waitForRequestCount(2);
      provider.requests[1]?.resolve(secondSession);
    }

    await Promise.all([firstStart, secondStart]);
    await manager.sendPrompt("page-1", { prompt: "After restart" });

    expect(firstSession.sentInputs).toEqual([]);
    expect(secondSession.sentInputs).toEqual([{ prompt: "After restart" }]);
  });

  it("emits session_not_started when sending before session.start", async () => {
    const emitted: BridgeToExtension[] = [];
    const manager = new BridgeSessionManager({ provider: createFakeProvider(), emit: (message) => emitted.push(message) });

    await manager.sendPrompt("page-1", { prompt: "Summarize this page" });

    expect(emitted).toEqual([
      {
        type: "session.error",
        version: 2,
        clientSessionId: "page-1",
        message: "Session has not been started",
        code: "session_not_started"
      }
    ]);
  });

  it("streams provider events with the matching clientSessionId", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => new FakeAgentSession(undefined, []));
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    provider.createdSessions[0]?.events.push({ type: "assistant.text.delta", text: "hello" });
    provider.createdSessions[0]?.events.push({ type: "assistant.done" });
    await manager.sendPrompt("page-1", { prompt: "Summarize this page" });

    expect(emitted.slice(1)).toEqual([
      {
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.text.delta", text: "hello" }
      },
      {
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.done" }
      }
    ]);
  });

  it("emits assistant.done when the provider stream ends without a terminal event", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => new FakeAgentSession(undefined, []));
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.sendPrompt("page-1", { prompt: "Summarize this page" });

    expect(emitted).toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.done" }
    });
  });

  it("ends the bridge turn when the provider emits a terminal event before the stream closes", async () => {
    const stream = new ManualAsyncEvents();
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => new FakeAgentSession(stream));
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    const firstSend = manager.sendPrompt("page-1", { prompt: "First" });
    await provider.createdSessions[0]?.waitForSendCount(1);
    stream.push({ type: "assistant.done" });
    await firstSend;
    const secondSend = manager.sendPrompt("page-1", { prompt: "Second" });
    await provider.createdSessions[0]?.waitForSendCount(2);
    stream.finish();
    await secondSend;

    expect(provider.createdSessions[0]?.sentInputs).toEqual([{ prompt: "First" }, { prompt: "Second" }]);
    expect(emitted).toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.done" }
    });
  });

  it("accepts_next_prompt_synchronously_from_terminal_event_handler", async () => {
    const stream = new ManualAsyncEvents();
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => new FakeAgentSession(stream));
    let queuedSecondPrompt = false;
    const manager = new BridgeSessionManager({
      provider,
      emit: (message) => {
        emitted.push(message);
        if (message.type === "agent.event" && message.event.type === "assistant.done" && !queuedSecondPrompt) {
          queuedSecondPrompt = true;
          void manager.sendPrompt("page-1", { prompt: "Second" });
        }
      }
    });

    await manager.startSession("page-1", "codex");
    const firstSend = manager.sendPrompt("page-1", { prompt: "First" });
    await provider.createdSessions[0]?.waitForSendCount(1);
    stream.push({ type: "assistant.done" });
    await provider.createdSessions[0]?.waitForSendCount(2);
    stream.finish();
    await firstSend;

    expect(provider.createdSessions[0]?.sentInputs).toEqual([{ prompt: "First" }, { prompt: "Second" }]);
    expect(emitted).not.toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "A turn is already in flight for this session",
      code: "turn_in_flight"
    });
  });

  it("does not emit provider_error when iterator cleanup throws after a terminal event", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => new FakeAgentSession(new ThrowingReturnEvents([{ type: "assistant.done" }])));
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.sendPrompt("page-1", { prompt: "First" });

    expect(emitted).toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.done" }
    });
    expect(emitted).not.toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Provider send failed",
      code: "provider_error"
    });
  });

  it("rejects unsafe provider events before emitting them", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => new FakeAgentSession(undefined, [unsafeAgentEvent({ type: "assistant.done", reasoning: "private" })]));
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.sendPrompt("page-1", { prompt: "Summarize this page" });

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Provider emitted an unsafe event.",
      code: "unsafe_provider_event"
    });
    expect(emitted).not.toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.done", reasoning: "private" }
    });
  });

  it("emits safe adapter activity events", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() =>
      new FakeAgentSession(undefined, [{ type: "assistant.activity", activity: { kind: "progress", label: "Reading" } }])
    );
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.sendPrompt("page-1", { prompt: "Summarize this page" });

    expect(emitted).toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.activity", activity: { kind: "progress", label: "Reading" } }
    });
  });

  it.each([
    ["reasoning", "private", { type: "assistant.done", reasoning: "private" }],
    ["chainOfThought", "private", { type: "assistant.text.delta", text: "hello", chainOfThought: "private" }],
    ["summary", "free-form details", { type: "assistant.activity", activity: { kind: "progress", label: "Working", summary: "free-form details" } }],
    ["stdout", "raw output", { type: "assistant.activity", activity: { kind: "progress", label: "Working", stdout: "raw output" } }],
    ["stderr", "raw error", { type: "assistant.activity", activity: { kind: "progress", label: "Working", stderr: "raw error" } }],
    ["prompt", "secret prompt", { type: "assistant.activity", activity: { kind: "progress", label: "Working", prompt: "secret prompt" } }],
    ["pageContent", "secret page", { type: "assistant.activity", activity: { kind: "progress", label: "Working", pageContent: "secret page" } }],
    ["prompt", "secret prompt", { type: "assistant.cancelled", prompt: "secret prompt" }],
    ["pageContent", "secret page", { type: "assistant.text.delta", text: "hello", pageContent: "secret page" }]
  ])("does not emit adapter events with private %s fields", async (fieldName, secretValue, event) => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => new FakeAgentSession(undefined, [unsafeAgentEvent(event)]));
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.sendPrompt("page-1", { prompt: "Summarize this page" });

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Provider emitted an unsafe event.",
      code: "unsafe_provider_event"
    });
    expect(emitted).not.toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event
    });
    expect(JSON.stringify(emitted)).not.toContain(fieldName);
    expect(JSON.stringify(emitted)).not.toContain(secretValue);
  });

  it("aborts the turn when an unsafe adapter event is seen", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() =>
      new FakeAgentSession(undefined, [unsafeAgentEvent({ type: "assistant.activity", activity: { kind: "progress", label: "Thinking privately" } })])
    );
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.sendPrompt("page-1", { prompt: "Summarize this page" });

    expect(provider.createdSessions[0]?.sendSignals[0]?.aborted).toBe(true);
    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Provider emitted an unsafe event.",
      code: "unsafe_provider_event"
    });
  });

  it("stops processing provider events after an unsafe event", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() =>
      new FakeAgentSession(undefined, [
        { type: "assistant.text.delta", text: "before" },
        unsafeAgentEvent({ type: "assistant.activity", activity: { kind: "progress", label: "Thinking privately" } }),
        { type: "assistant.text.delta", text: "after" },
        { type: "assistant.done" }
      ])
    );
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.sendPrompt("page-1", { prompt: "Summarize this page" });

    expect(emitted).toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.text.delta", text: "before" }
    });
    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Provider emitted an unsafe event.",
      code: "unsafe_provider_event"
    });
    expect(emitted).not.toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.text.delta", text: "after" }
    });
    expect(emitted).not.toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.done" }
    });
  });

  it("emits_session_scoped_provider_start_failed_when_provider_session_creation_rejects", async () => {
    const emitted: BridgeToExtension[] = [];
    const manager = new BridgeSessionManager({
      provider: createRejectingProvider(new Error("secret provider startup detail")),
      emit: (message) => emitted.push(message)
    });

    await expect(manager.startSession("page-1", "codex")).resolves.toBeUndefined();

    expect(emitted).toEqual([
      {
        type: "session.error",
        version: 2,
        clientSessionId: "page-1",
        message: "Provider session failed to start.",
        code: "provider_start_failed"
      }
    ]);
    expect(JSON.stringify(emitted)).not.toContain("secret provider startup detail");
  });

  it("does not leave a closed provider session active when replacement creation rejects", async () => {
    const emitted: BridgeToExtension[] = [];
    let shouldReject = false;
    const provider = createFakeProvider(() => {
      if (shouldReject) throw new Error("secret replacement detail");
      return new FakeAgentSession();
    });
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    shouldReject = true;
    await expect(manager.startSession("page-1", "codex")).resolves.toBeUndefined();
    await manager.sendPrompt("page-1", { prompt: "After failed replacement" });

    expect(provider.createdSessions[0]?.closeCount).toBe(1);
    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Provider session failed to start.",
      code: "provider_start_failed"
    });
    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Session has not been started",
      code: "session_not_started"
    });
  });

  it("emits generic provider_error when provider send throws", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => new ThrowingAgentSession(new Error("secret send detail")));
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.sendPrompt("page-1", { prompt: "Summarize this page" });

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Provider send failed",
      code: "provider_error"
    });
    expect(JSON.stringify(emitted)).not.toContain("secret send detail");
  });

  it("does not emit provider_error when provider send throws after abort", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => new ThrowingAfterAbortSession());
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    const send = manager.sendPrompt("page-1", { prompt: "Summarize this page" });
    await provider.createdSessions[0]?.waitForSendCount(1);
    await manager.closeSession("page-1");
    await send;

    expect(emitted).not.toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Provider send failed",
      code: "provider_error"
    });
  });

  it("rejects a second prompt in the same client session while one is in flight", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => new FakeAgentSession(new ManualAsyncEvents()));
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    const session = provider.createdSessions[0];
    const firstSend = manager.sendPrompt("page-1", { prompt: "First" });
    await session?.waitForSendCount(1);

    await manager.sendPrompt("page-1", { prompt: "Second" });
    session?.stream?.finish();
    await firstSend;

    expect(session?.sentInputs).toEqual([{ prompt: "First" }]);
    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "A turn is already in flight for this session",
      code: "turn_in_flight"
    });
  });

  it("allows different client sessions to stream concurrently", async () => {
    const emitted: BridgeToExtension[] = [];
    const firstStream = new ManualAsyncEvents();
    const secondStream = new ManualAsyncEvents();
    let createCount = 0;
    const provider = createFakeProvider(() => {
      const stream = createCount === 0 ? firstStream : secondStream;
      createCount += 1;
      return new FakeAgentSession(stream);
    });
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.startSession("page-2", "codex");
    const firstSend = manager.sendPrompt("page-1", { prompt: "First" });
    const secondSend = manager.sendPrompt("page-2", { prompt: "Second" });
    await Promise.all([provider.createdSessions[0]?.waitForSendCount(1), provider.createdSessions[1]?.waitForSendCount(1)]);

    secondStream.push({ type: "assistant.text.delta", text: "second" });
    secondStream.push({ type: "assistant.done" });
    secondStream.finish();
    await secondSend;
    firstStream.push({ type: "assistant.done" });
    firstStream.finish();
    await firstSend;

    expect(emitted).toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-2",
      event: { type: "assistant.text.delta", text: "second" }
    });
  });

  it("suppresses stale stream events after replacing a session", async () => {
    const emitted: BridgeToExtension[] = [];
    const firstStream = new ManualAsyncEvents();
    let createCount = 0;
    const provider = createFakeProvider(() => {
      const session = new FakeAgentSession(createCount === 0 ? firstStream : undefined);
      session.finishStreamOnAbort = true;
      createCount += 1;
      return session;
    });
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    const firstSend = manager.sendPrompt("page-1", { prompt: "First" });
    await provider.createdSessions[0]?.waitForSendCount(1);
    await manager.startSession("page-1", "codex");
    firstStream.push({ type: "assistant.text.delta", text: "stale" });
    firstStream.finish();
    await firstSend;

    expect(provider.createdSessions[0]?.sendSignals[0]?.aborted).toBe(true);
    expect(emitted).not.toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.text.delta", text: "stale" }
    });
  });
});

describe("BridgeSessionManager page context prompt formatting", () => {
  it("passes_formatted_untrusted_prompt_to_the_provider_session", async () => {
    const provider = createFakeProvider();
    const manager = new BridgeSessionManager({ provider, emit: () => {} });

    await manager.startSession("page-1", "codex");
    await manager.sendPrompt("page-1", {
      prompt: "Summarize this",
      pageContext: readablePageContext()
    });

    expect(provider.createdSessions[0]?.sentInputs).toEqual([
      {
        prompt: expect.stringContaining("Untrusted page context JSON:")
      }
    ]);
    expect(provider.createdSessions[0]?.sentInputs[0]?.prompt).toContain("User request:\nSummarize this");
  });

  it("does_not_pass_raw_page_context_to_the_provider_session", async () => {
    const provider = createFakeProvider();
    const manager = new BridgeSessionManager({ provider, emit: () => {} });

    await manager.startSession("page-1", "codex");
    await manager.sendPrompt("page-1", {
      prompt: "Summarize this",
      pageContext: readablePageContext()
    });

    expect(provider.createdSessions[0]?.sentInputs[0]).not.toHaveProperty("pageContext");
  });
});

describe("BridgeSessionManager cancellation", () => {
  it("aborts the active provider send for the target client session", async () => {
    const stream = new ManualAsyncEvents();
    const provider = createFakeProvider(() => {
      const session = new FakeAgentSession(stream);
      session.finishStreamOnAbort = true;
      return session;
    });
    const manager = new BridgeSessionManager({ provider, emit: () => {} });

    await manager.startSession("page-1", "codex");
    const send = manager.sendPrompt("page-1", { prompt: "First" });
    await provider.createdSessions[0]?.waitForSendCount(1);
    await manager.cancelTurn("page-1");
    await send;

    expect(provider.createdSessions[0]?.sendSignals[0]?.aborted).toBe(true);
  });

  it("emits assistant.cancelled for the target client session", async () => {
    const emitted: BridgeToExtension[] = [];
    const stream = new ManualAsyncEvents();
    const provider = createFakeProvider(() => {
      const session = new FakeAgentSession(stream);
      session.finishStreamOnAbort = true;
      return session;
    });
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    const send = manager.sendPrompt("page-1", { prompt: "First" });
    await provider.createdSessions[0]?.waitForSendCount(1);
    await manager.cancelTurn("page-1");
    await send;

    expect(emitted).toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.cancelled" }
    });
  });

  it("does not cancel an in-flight turn in another client session", async () => {
    const firstStream = new ManualAsyncEvents();
    const secondStream = new ManualAsyncEvents();
    let createCount = 0;
    const provider = createFakeProvider(() => {
      const session = new FakeAgentSession(createCount === 0 ? firstStream : secondStream);
      session.finishStreamOnAbort = true;
      createCount += 1;
      return session;
    });
    const manager = new BridgeSessionManager({ provider, emit: () => {} });

    await manager.startSession("page-1", "codex");
    await manager.startSession("page-2", "codex");
    const firstSend = manager.sendPrompt("page-1", { prompt: "First" });
    const secondSend = manager.sendPrompt("page-2", { prompt: "Second" });
    await Promise.all([provider.createdSessions[0]?.waitForSendCount(1), provider.createdSessions[1]?.waitForSendCount(1)]);
    await manager.cancelTurn("page-1");
    secondStream.finish();
    await Promise.all([firstSend, secondSend]);

    expect(provider.createdSessions[0]?.sendSignals[0]?.aborted).toBe(true);
    expect(provider.createdSessions[1]?.sendSignals[0]?.aborted).toBe(false);
  });

  it("allows a later prompt after cancellation completes", async () => {
    const stream = new ManualAsyncEvents();
    const provider = createFakeProvider(() => {
      const session = new FakeAgentSession(stream, [{ type: "assistant.done" }]);
      session.finishStreamOnAbort = true;
      return session;
    });
    const manager = new BridgeSessionManager({ provider, emit: () => {} });

    await manager.startSession("page-1", "codex");
    const firstSend = manager.sendPrompt("page-1", { prompt: "First" });
    await provider.createdSessions[0]?.waitForSendCount(1);
    await manager.cancelTurn("page-1");
    await firstSend;
    await manager.sendPrompt("page-1", { prompt: "Second" });

    expect(provider.createdSessions[0]?.sentInputs).toEqual([{ prompt: "First" }, { prompt: "Second" }]);
  });

  it("emits session.error when cancelling a session with no in-flight turn", async () => {
    const emitted: BridgeToExtension[] = [];
    const manager = new BridgeSessionManager({ provider: createFakeProvider(), emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.cancelTurn("page-1");

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "No in-flight turn to cancel",
      code: "no_in_flight_turn"
    });
  });

  it("serializes cancel before reset for the same client session", async () => {
    const stream = new ManualAsyncEvents();
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider(() => {
      const session = new FakeAgentSession(stream);
      session.finishStreamOnAbort = true;
      return session;
    });
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    const send = manager.sendPrompt("page-1", { prompt: "First" });
    await provider.createdSessions[0]?.waitForSendCount(1);
    const cancel = manager.cancelTurn("page-1");
    const reset = manager.resetSession("page-1");
    await Promise.all([cancel, reset, send]);

    expect(emitted).toEqual([
      expect.objectContaining({ type: "session.started", clientSessionId: "page-1" }),
      expect.objectContaining({ type: "agent.event", event: { type: "assistant.cancelled" } }),
      expect.objectContaining({ type: "session.started", clientSessionId: "page-1" })
    ]);
    expect(provider.createdSessions).toHaveLength(2);
  });
});

describe("BridgeSessionManager reset and close", () => {
  it("reset closes the old provider session and creates a fresh provider session", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider();
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.resetSession("page-1");

    expect(provider.createdSessions).toHaveLength(2);
    expect(provider.createdSessions[0]?.closeCount).toBe(1);
    expect(provider.createdSessions[1]?.closeCount).toBe(0);
    expect(emitted).toEqual([
      {
        type: "session.started",
        version: 2,
        clientSessionId: "page-1",
        bridgeSessionId: expect.any(String)
      },
      {
        type: "session.started",
        version: 2,
        clientSessionId: "page-1",
        bridgeSessionId: expect.any(String)
      }
    ]);
  });

  it("reset aborts an in-flight turn before creating the fresh provider session", async () => {
    const stream = new ManualAsyncEvents();
    const provider = createFakeProvider(() => {
      const session = new FakeAgentSession(stream);
      session.finishStreamOnAbort = true;
      return session;
    });
    const manager = new BridgeSessionManager({ provider, emit: () => {} });

    await manager.startSession("page-1", "codex");
    const send = manager.sendPrompt("page-1", { prompt: "First" });
    await provider.createdSessions[0]?.waitForSendCount(1);
    await manager.resetSession("page-1");
    await send;

    expect(provider.createdSessions).toHaveLength(2);
    expect(provider.createdSessions[0]?.sendSignals[0]?.aborted).toBe(true);
    expect(provider.createdSessions[0]?.closeCount).toBe(1);
  });

  it("close aborts an in-flight turn and closes the provider session", async () => {
    const stream = new ManualAsyncEvents();
    const provider = createFakeProvider(() => {
      const session = new FakeAgentSession(stream);
      session.finishStreamOnAbort = true;
      return session;
    });
    const manager = new BridgeSessionManager({ provider, emit: () => {} });

    await manager.startSession("page-1", "codex");
    const send = manager.sendPrompt("page-1", { prompt: "First" });
    await provider.createdSessions[0]?.waitForSendCount(1);
    await manager.closeSession("page-1");
    await send;

    expect(provider.createdSessions[0]?.sendSignals[0]?.aborted).toBe(true);
    expect(provider.createdSessions[0]?.closeCount).toBe(1);
  });

  it("close removes the provider session so later send returns session_not_started", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createFakeProvider();
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });

    await manager.startSession("page-1", "codex");
    await manager.closeSession("page-1");
    await manager.sendPrompt("page-1", { prompt: "After close" });

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Session has not been started",
      code: "session_not_started"
    });
  });

  it("reset and close do not affect another client session", async () => {
    const provider = createFakeProvider();
    const manager = new BridgeSessionManager({ provider, emit: () => {} });

    await manager.startSession("page-1", "codex");
    await manager.startSession("page-2", "codex");
    await manager.resetSession("page-1");
    await manager.closeSession("page-1");
    await manager.sendPrompt("page-2", { prompt: "Still active" });

    expect(provider.createdSessions[0]?.closeCount).toBe(1);
    expect(provider.createdSessions[1]?.closeCount).toBe(0);
    expect(provider.createdSessions[2]?.closeCount).toBe(1);
    expect(provider.createdSessions[1]?.sentInputs).toEqual([{ prompt: "Still active" }]);
  });

  it("close is idempotent when the client session does not exist", async () => {
    const provider = createFakeProvider();
    const manager = new BridgeSessionManager({ provider, emit: () => {} });

    await manager.closeSession("missing-page");

    expect(provider.createdSessions).toHaveLength(0);
  });

  it("serializes reset followed by close for the same client session", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createDeferredProvider();
    const manager = new BridgeSessionManager({ provider, emit: (message) => emitted.push(message) });
    const firstSession = new FakeAgentSession();
    const secondSession = new FakeAgentSession();

    const start = manager.startSession("page-1", "codex");
    await provider.waitForRequestCount(1);
    provider.requests[0]?.resolve(firstSession);
    await start;

    const reset = manager.resetSession("page-1");
    await provider.waitForRequestCount(2);
    const close = manager.closeSession("page-1");
    provider.requests[1]?.resolve(secondSession);
    await Promise.all([reset, close]);
    await manager.sendPrompt("page-1", { prompt: "After close" });

    expect(firstSession.closeCount).toBe(1);
    expect(secondSession.closeCount).toBe(1);
    expect(secondSession.sentInputs).toEqual([]);
    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Session has not been started",
      code: "session_not_started"
    });
  });
});

function createFakeProvider(createSession: () => FakeAgentSession = () => new FakeAgentSession()) {
  const createdSessions: FakeAgentSession[] = [];
  const provider: AgentProvider & { createdSessions: FakeAgentSession[] } = {
    id: "codex",
    createdSessions,
    async createSession() {
      const session = createSession();
      createdSessions.push(session);
      return session;
    }
  };
  return provider;
}

function createRejectingProvider(error: unknown): AgentProvider {
  return {
    id: "codex",
    async createSession() {
      throw error;
    }
  };
}

function createDeferredProvider() {
  const requests: Array<Deferred<FakeAgentSession>> = [];
  const createdSessions: FakeAgentSession[] = [];
  const waiters: Array<() => void> = [];
  const provider: AgentProvider & {
    createdSessions: FakeAgentSession[];
    requests: Array<Deferred<FakeAgentSession>>;
    waitForRequestCount(count: number): Promise<void>;
  } = {
    id: "codex",
    createdSessions,
    requests,
    async createSession() {
      const request = deferred<FakeAgentSession>();
      requests.push(request);
      while (waiters.length > 0) {
        waiters.shift()?.();
      }
      const session = await request.promise;
      createdSessions.push(session);
      return session;
    },
    async waitForRequestCount(count: number) {
      if (requests.length >= count) return;
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };
  return provider;
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function unsafeAgentEvent(value: unknown): AgentEvent {
  return value as AgentEvent;
}

class FakeAgentSession implements AgentSession {
  readonly events: AgentEvent[];
  readonly sentInputs: AgentSendInput[] = [];
  readonly sendSignals: AbortSignal[] = [];
  private readonly sendWaiters: Array<() => void> = [];
  closeCount = 0;
  finishStreamOnAbort = false;

  constructor(readonly stream?: ManualAsyncEvents, events: AgentEvent[] = [{ type: "assistant.done" }]) {
    this.events = events;
  }

  send(input: AgentSendInput, signal: AbortSignal): AsyncIterable<AgentEvent> {
    this.sentInputs.push(input);
    this.sendSignals.push(signal);
    if (this.stream && this.finishStreamOnAbort) {
      signal.addEventListener("abort", () => this.stream?.finish(), { once: true });
    }
    this.resolveSendWaiters();
    return this.stream ?? this.iterateEvents();
  }

  async close() {
    this.closeCount += 1;
  }

  async waitForSendCount(count: number) {
    if (this.sentInputs.length >= count) return;
    await new Promise<void>((resolve) => this.sendWaiters.push(resolve));
  }

  private async *iterateEvents() {
    for (const event of this.events) {
      yield event;
    }
  }

  protected resolveSendWaiters() {
    while (this.sendWaiters.length > 0) {
      this.sendWaiters.shift()?.();
    }
  }
}

class ThrowingAgentSession implements AgentSession {
  constructor(private readonly error: unknown) {}

  async *send(): AsyncIterable<AgentEvent> {
    throw this.error;
  }

  async close() {}
}

class ThrowingAfterAbortSession extends FakeAgentSession {
  override async *send(input: AgentSendInput, signal: AbortSignal): AsyncIterable<AgentEvent> {
    this.sentInputs.push(input);
    this.sendSignals.push(signal);
    this.resolveSendWaiters();
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    throw new Error("throw after abort");
  }
}

class ManualAsyncEvents implements AsyncIterable<AgentEvent> {
  private readonly events: AgentEvent[] = [];
  private readonly pending: Array<(result: IteratorResult<AgentEvent>) => void> = [];
  private finished = false;

  push(event: AgentEvent) {
    const resolve = this.pending.shift();
    if (resolve) {
      resolve({ done: false, value: event });
      return;
    }
    this.events.push(event);
  }

  finish() {
    this.finished = true;
    while (this.pending.length > 0) {
      this.pending.shift()?.({ done: true, value: undefined });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return {
      next: () => {
        const event = this.events.shift();
        if (event) return Promise.resolve({ done: false, value: event });
        if (this.finished) return Promise.resolve({ done: true, value: undefined });
        return new Promise<IteratorResult<AgentEvent>>((resolve) => this.pending.push(resolve));
      }
    };
  }
}

class ThrowingReturnEvents implements AsyncIterable<AgentEvent> {
  constructor(private readonly events: AgentEvent[]) {}

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return {
      next: () => {
        const event = this.events.shift();
        if (event) return Promise.resolve({ done: false, value: event });
        return Promise.resolve({ done: true, value: undefined });
      },
      return: () => Promise.reject(new Error("cleanup failed"))
    };
  }
}

function readablePageContext() {
  return {
    kind: "readable" as const,
    metadata: {
      url: "https://example.com/article",
      title: "Example article",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    text: "Captured page text",
    textLength: "Captured page text".length,
    extractionMethod: "readability" as const
  };
}
