import type { BridgeToExtension, ExtensionToBridge } from "@sidra/protocol";
import { describe, expect, it, vi } from "vitest";
import type { PageIdentity, PageKey } from "./page-key";
import { type NativeBridgePort, SIDRA_NATIVE_HOST } from "./bridge/connection";
import { createSidePanelController } from "./side-panel-controller";

class FakePort implements NativeBridgePort {
  readonly postedMessages: ExtensionToBridge[] = [];
  private readonly messageListeners: Array<(message: unknown) => void> = [];
  private readonly disconnectListeners: Array<() => void> = [];

  onMessage = {
    addListener: (listener: (message: unknown) => void) => {
      this.messageListeners.push(listener);
    }
  };

  onDisconnect = {
    addListener: (listener: () => void) => {
      this.disconnectListeners.push(listener);
    }
  };

  postMessage(message: unknown): void {
    this.postedMessages.push(message as ExtensionToBridge);
  }

  disconnect(): void {
    for (const listener of this.disconnectListeners) listener();
  }

  emitMessage(message: BridgeToExtension): void {
    for (const listener of this.messageListeners) listener(message);
  }
}

function createHarness() {
  return createHarnessWithOptions();
}

type HarnessOptions = {
  initialPage?: PageIdentity;
  clientSessionIds?: string[];
};

class FakeActivePageSource {
  private readonly listeners = new Set<() => void>();
  private snapshot: PageIdentity;

  constructor(initialPage: PageIdentity = pageIdentity("https://example.com/default")) {
    this.snapshot = initialPage;
  }

  getSnapshot = (): PageIdentity => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  start = async (): Promise<void> => undefined;

  emit(identity: PageIdentity): void {
    this.snapshot = identity;
    for (const listener of this.listeners) listener();
  }
}

function createHarnessWithOptions(options: HarnessOptions = {}) {
  const ports: FakePort[] = [];
  const connectNative = vi.fn((hostName: string) => {
    expect(hostName).toBe(SIDRA_NATIVE_HOST);
    const port = new FakePort();
    ports.push(port);
    return port;
  });
  const clientSessionIds = options.clientSessionIds ?? ["client-1"];
  let nextClientSessionIdIndex = 0;
  const initialPage =
    options.initialPage ??
    (options.clientSessionIds ? unsupportedPageIdentity("chrome://newtab") : undefined);
  const activePage = new FakeActivePageSource(initialPage);
  const controller = createSidePanelController({
    connectNative,
    createClientSessionId: () => {
      const clientSessionId = clientSessionIds[nextClientSessionIdIndex] ?? clientSessionIds.at(-1);
      nextClientSessionIdIndex += 1;
      if (!clientSessionId) throw new Error("missing test client session id");
      return clientSessionId;
    },
    activePageTracker: activePage
  });

  return { controller, connectNative, ports, activePage };
}

function createUnavailableBridgeHarness(options: HarnessOptions = {}) {
  const activePage = new FakeActivePageSource(options.initialPage);
  const controller = createSidePanelController({
    connectNative: () => {
      throw new Error("missing host");
    },
    createClientSessionId: () => "client-1",
    activePageTracker: activePage
  });

  return { controller, activePage };
}

function pageIdentity(pageKey: string): PageIdentity {
  return {
    status: "ready",
    pageKey: pageKey as PageKey,
    url: pageKey,
    displayTitle: pageKey
  };
}

function pageIdentityWithTitle(pageKey: string, displayTitle: string): PageIdentity {
  return {
    status: "ready",
    pageKey: pageKey as PageKey,
    url: pageKey,
    displayTitle
  };
}

function unsupportedPageIdentity(url: string): PageIdentity {
  return { status: "unsupported", reason: "unsupported_url", url };
}

function sessionStarted(clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "session.started",
    version: 1,
    clientSessionId,
    bridgeSessionId: "bridge-1"
  };
}

function bridgeReady(): BridgeToExtension {
  return { type: "bridge.ready", version: 1 };
}

function agentTextDelta(clientSessionId: string, text: string): BridgeToExtension {
  return {
    type: "agent.event",
    version: 1,
    clientSessionId,
    event: { type: "assistant.text.delta", text }
  };
}

describe("SidePanelController", () => {
  it("connects to the native bridge when the controller is created", () => {
    const { connectNative } = createHarness();

    expect(connectNative).toHaveBeenCalledTimes(1);
  });

  it("exposes chat as blocked until bridge.ready arrives", () => {
    const { controller } = createHarness();

    expect(controller.getSnapshot().bridge).toMatchObject({
      canUseChat: false,
      availability: { status: "checking" }
    });
  });

  it("enables chat after bridge.ready", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());

    expect(controller.getSnapshot().bridge).toMatchObject({
      canUseChat: true,
      availability: { status: "ready" }
    });
  });

  it("keeps chat blocked when bridge is ready but the active page is unsupported", () => {
    const { controller, ports } = createHarnessWithOptions({
      initialPage: unsupportedPageIdentity("chrome://extensions")
    });

    ports[0].emitMessage(bridgeReady());

    expect(controller.getSnapshot().bridge).toMatchObject({
      availability: { status: "ready" },
      canUseChat: false
    });
    expect(controller.sendPrompt("hello")).toBe(false);
  });

  it("does not send prompts while bridge is unavailable", () => {
    const connectNative = vi.fn(() => {
      throw new Error("missing host");
    });
    const controller = createSidePanelController({
      connectNative,
      createClientSessionId: () => "client-1"
    });

    expect(controller.sendPrompt("hello")).toBe(false);
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
    expect(connectNative).toHaveBeenCalledTimes(1);
  });

  it("does not send prompts while bridge reports a blocking error", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

    expect(controller.sendPrompt("hello")).toBe(false);
    expect(ports[0].postedMessages).toEqual([]);
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("clears the blocking bridge error after retry succeeds", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });
    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());

    expect(controller.getSnapshot().bridge).toMatchObject({
      setupError: undefined,
      canUseChat: true,
      availability: { status: "ready" }
    });
  });

  it("does not keep queued prompts that failed before bridge.error recovery", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    expect(controller.sendPrompt("unsent")).toBe(true);
    ports[0].emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);

    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());

    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
    expect(controller.sendPrompt("after retry")).toBe(true);
    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
  });

  it("blocks new prompts after bridge disconnect until retry succeeds", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    expect(controller.sendPrompt("first")).toBe(true);
    ports[0].emitMessage(sessionStarted());
    ports[0].disconnect();

    expect(controller.sendPrompt("second")).toBe(false);
    expect(ports).toHaveLength(1);
    expect(controller.getSnapshot().bridge.canUseChat).toBe(false);

    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());

    expect(controller.sendPrompt("second")).toBe(true);
    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
  });

  it("blocks prompts after a ready idle bridge disconnects", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    ports[0].disconnect();

    expect(controller.getSnapshot().bridge.canUseChat).toBe(false);
    expect(controller.sendPrompt("hello")).toBe(false);
    expect(ports[0].postedMessages).toEqual([]);
  });

  it("retryBridge reconnects without recreating the controller", () => {
    const { controller, connectNative, ports } = createHarness();
    const firstSessionId = controller.getSnapshot().activeSession.clientSessionId;

    ports[0].disconnect();
    controller.retryBridge();

    expect(connectNative).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().activeSession.clientSessionId).toBe(firstSessionId);
  });

  it("retryBridge returns to usable chat after bridge.ready", () => {
    const ports: FakePort[] = [];
    const connectNative = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("missing host");
      })
      .mockImplementation(() => {
        const port = new FakePort();
        ports.push(port);
        return port;
      });
    const controller = createSidePanelController({
      connectNative,
      createClientSessionId: () => "client-1",
      activePageTracker: new FakeActivePageSource(pageIdentity("https://example.com/a"))
    });

    expect(controller.getSnapshot().bridge.canUseChat).toBe(false);
    controller.retryBridge();
    ports[0].emitMessage(bridgeReady());

    expect(controller.getSnapshot().bridge.canUseChat).toBe(true);
  });

  it("queues the first prompt until the bridge session starts", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    expect(controller.sendPrompt("hello")).toBe(true);

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(controller.getSnapshot().activeSession).toMatchObject({
      pendingPromptCount: 1,
      sessionStarted: false,
      starting: true
    });

    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "hello" }
    ]);
  });

  it("flushes queued prompts in order after session.started", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    controller.sendPrompt("second");
    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
  });

  it("starts a new provider session before sending after retrying a native bridge disconnect", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    ports[0].disconnect();
    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());
    controller.sendPrompt("second");

    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" }
    ]);

    ports[1].emitMessage(sessionStarted());

    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "second" }
    ]);
  });

  it("renders user and assistant transcript entries through the controller snapshot", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage({
      type: "agent.event",
      version: 1,
      clientSessionId: "client-1",
      event: { type: "assistant.text.delta", text: "Hi" }
    });

    expect(controller.getSnapshot().activeSession.transcript).toEqual([
      { role: "user", text: "hello" },
      { role: "status", text: "Session started" },
      { role: "assistant", text: "Hi" }
    ]);
  });

  it("rejects blank prompts without changing the snapshot", () => {
    const { controller, connectNative } = createHarness();
    const before = controller.getSnapshot();

    expect(controller.sendPrompt("   ")).toBe(false);

    expect(controller.getSnapshot()).toEqual(before);
    expect(connectNative).toHaveBeenCalledTimes(1);
  });

  it("returns the same snapshot object until controller state changes", () => {
    const { controller, ports } = createHarness();
    const initial = controller.getSnapshot();

    expect(controller.getSnapshot()).toBe(initial);

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");
    const afterPrompt = controller.getSnapshot();

    expect(afterPrompt).not.toBe(initial);
    expect(controller.getSnapshot()).toBe(afterPrompt);

    ports[0].emitMessage(sessionStarted());
    const afterStarted = controller.getSnapshot();

    expect(afterStarted).not.toBe(afterPrompt);
    expect(controller.getSnapshot()).toBe(afterStarted);
  });

  it("surfaces bridge errors as setup state without exposing protocol details to the view", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");
    ports[0].emitMessage({ type: "bridge.error", version: 1, message: "bridge failed" });

    expect(controller.getSnapshot().bridge).toEqual({
      connected: true,
      ready: false,
      setupError: "bridge failed",
      canUseChat: false,
      availability: { status: "error", message: "bridge failed", code: undefined }
    });
  });
});

describe("SidePanelController newChat", () => {
  it("clears the active transcript and pending prompts", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    controller.sendPrompt("second");
    controller.newChat();

    expect(controller.getSnapshot().activeSession).toMatchObject({
      pendingPromptCount: 0,
      sessionStarted: false,
      starting: true,
      transcript: []
    });
    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.reset", version: 1, clientSessionId: "client-1" }
    ]);
  });

  it("sends session.reset for the active clientSessionId when provider state may exist", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    controller.newChat();

    expect(ports[0].postedMessages).toContainEqual({
      type: "session.reset",
      version: 1,
      clientSessionId: "client-1"
    });
  });

  it("does not send reset for a never-started empty session", () => {
    const { controller, connectNative } = createHarness();

    controller.newChat();

    expect(connectNative).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("keeps bridge connection state when clearing local session state", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage({ type: "bridge.ready", version: 1 });
    controller.sendPrompt("first");
    controller.newChat();

    expect(controller.getSnapshot().bridge).toEqual({
      connected: true,
      ready: true,
      setupError: undefined,
      canUseChat: true,
      availability: { status: "ready" }
    });
  });

  it("uses the fresh session.started event after reset before sending later prompts", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    controller.newChat();
    controller.sendPrompt("after reset");

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.reset", version: 1, clientSessionId: "client-1" }
    ]);

    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 1, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "first" },
      { type: "session.reset", version: 1, clientSessionId: "client-1" },
      { type: "session.send", version: 1, clientSessionId: "client-1", prompt: "after reset" }
    ]);
  });

  it("keeps the visible chat empty when reset session.started arrives with no queued prompt", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    controller.newChat();
    ports[0].emitMessage(sessionStarted());

    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
    expect(controller.getSnapshot().activeSession).toMatchObject({
      sessionStarted: true,
      starting: false,
      pendingPromptCount: 0
    });
  });
});

describe("SidePanelController URL sessions", () => {
  it("selects_the_initial_active_page_session_before_bridge_ready", () => {
    const { controller } = createHarnessWithOptions({ initialPage: pageIdentity("https://example.com/a") });
    expect(controller.getSnapshot().bridge.canUseChat).toBe(false);
    expect(controller.getSnapshot().activeSession.pageKey).toBe("https://example.com/a");
  });

  it("switches_active_page_session_while_bridge_is_unavailable", () => {
    const { controller, activePage } = createUnavailableBridgeHarness();
    activePage.emit(pageIdentity("https://example.com/a"));
    activePage.emit(pageIdentity("https://example.com/b"));
    expect(controller.getSnapshot().bridge.canUseChat).toBe(false);
    expect(controller.getSnapshot().activeSession.pageKey).toBe("https://example.com/b");
  });

  it("unsupported_active_page_does_not_expose_the_previous_page_transcript", () => {
    const { controller, activePage, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("page a");
    activePage.emit(unsupportedPageIdentity("chrome://extensions"));
    expect(controller.getSnapshot().activePage).toMatchObject({
      status: "unsupported",
      reason: "unsupported_url"
    });
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("refreshes_active_page_metadata_when_the_page_key_stays_the_same", () => {
    const { controller, activePage } = createHarnessWithOptions({
      initialPage: pageIdentityWithTitle("https://example.com/a", "Old title")
    });

    activePage.emit(pageIdentityWithTitle("https://example.com/a", "New title"));

    expect(controller.getSnapshot().activePage).toMatchObject({
      status: "ready",
      displayTitle: "New title"
    });
  });

  it("refreshes_unsupported_page_details_when_the_page_stays_unsupported", () => {
    const { controller, activePage } = createHarnessWithOptions({
      initialPage: { status: "unsupported", reason: "missing_url" }
    });

    activePage.emit(unsupportedPageIdentity("chrome://extensions"));

    expect(controller.getSnapshot().activePage).toMatchObject({
      status: "unsupported",
      reason: "unsupported_url",
      url: "chrome://extensions"
    });
  });

  it("switches_visible_transcript_when_active_page_changes", () => {
    const { controller, activePage, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("page a");
    activePage.emit(pageIdentity("https://example.com/b"));
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("restores_unsent_draft_when_returning_to_seen_page", () => {
    const { controller, activePage, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.updateDraftPrompt("draft a");
    activePage.emit(pageIdentity("https://example.com/b"));
    expect(controller.getSnapshot().activeSession.draftPrompt).toBe("");
    activePage.emit(pageIdentity("https://example.com/a"));
    expect(controller.getSnapshot().activeSession.draftPrompt).toBe("draft a");
  });

  it("restores_transcript_when_returning_to_seen_page", () => {
    const { controller, activePage, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("page a");
    activePage.emit(pageIdentity("https://example.com/b"));
    activePage.emit(pageIdentity("https://example.com/a"));
    expect(controller.getSnapshot().activeSession.transcript).toContainEqual({ role: "user", text: "page a" });
  });

  it("sends_first_prompt_with_the_active_page_client_session_id", () => {
    const { controller, activePage, ports } = createHarnessWithOptions({ clientSessionIds: ["client-a"] });
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("hello");
    expect(ports[0].postedMessages).toContainEqual({
      type: "session.start",
      version: 1,
      clientSessionId: "client-a",
      providerId: "codex"
    });
  });

  it("reuses_the_existing_client_session_id_for_returning_page", () => {
    const { controller, activePage, ports } = createHarnessWithOptions({
      clientSessionIds: ["client-a", "client-b"]
    });
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("first");
    activePage.emit(pageIdentity("https://example.com/b"));
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("second");
    expect(controller.getSnapshot().activeSession.clientSessionId).toBe("client-a");
  });

  it("does_not_show_inactive_session_errors_or_agent_events_in_active_session", () => {
    const { controller, activePage, ports } = createHarnessWithOptions({
      clientSessionIds: ["client-a", "client-b"]
    });
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("first");
    activePage.emit(pageIdentity("https://example.com/b"));
    ports[0].emitMessage(agentTextDelta("client-a", "inactive text"));
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("switches_visible_running_state_when_active_page_changes", () => {
    const { controller, activePage, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("pending");
    expect(controller.getSnapshot().activeSession.pendingPromptCount).toBe(1);
    activePage.emit(pageIdentity("https://example.com/b"));
    expect(controller.getSnapshot().activeSession.pendingPromptCount).toBe(0);
  });

  it("keeps_bridge_retry_and_blocking_setup_state_global_while_preserving_url_sessions", () => {
    const { controller, activePage, ports } = createHarness();
    activePage.emit(pageIdentity("https://example.com/a"));
    ports[0].disconnect();
    controller.retryBridge();
    activePage.emit(pageIdentity("https://example.com/b"));
    activePage.emit(pageIdentity("https://example.com/a"));
    expect(controller.getSnapshot().activeSession.pageKey).toBe("https://example.com/a");
  });

  it("new_chat_routes_to_the_active_url_session_only", () => {
    const { controller, activePage, ports } = createHarnessWithOptions({
      clientSessionIds: ["client-a", "client-b"]
    });
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("first");
    activePage.emit(pageIdentity("https://example.com/b"));
    controller.sendPrompt("second");
    controller.newChat();
    expect(ports[0].postedMessages).toContainEqual({
      type: "session.reset",
      version: 1,
      clientSessionId: "client-b"
    });
    expect(ports[0].postedMessages).not.toContainEqual({
      type: "session.reset",
      version: 1,
      clientSessionId: "client-a"
    });
  });
});
