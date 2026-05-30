// @vitest-environment jsdom

import {
  BRIDGE_PAYLOAD_TOO_LARGE_CODE,
  type BridgeToExtension,
  type ExtensionToBridge,
  type PageContext
} from "@sidra/protocol";
import { describe, expect, it, vi } from "vitest";
import type { PageIdentity, PageKey } from "./page-key";
import { type NativeBridgePort, SIDRA_NATIVE_HOST } from "./bridge/connection";
import { createSidePanelController } from "./side-panel-controller";
import type { CaptureDocumentResult, CaptureGateway, CaptureResult, CapturedTabDocument } from "./capture-service";
import type { CaptureMode } from "./capture-mode";
import {
  DEFAULT_SUMMARIZE_PAGE_QUICK_ACTION_PROMPT,
  DEFAULT_QUICK_ACTIONS_SETTINGS,
  DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS,
  type QuickActionsSettings,
  type SidraSettings,
  type SettingsStore
} from "./settings-store";

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
  captureService?: FakeCaptureService;
  captureGateway?: CaptureGateway;
  settingsStore?: Pick<SettingsStore, "start" | "getSnapshot" | "whenReady" | "subscribe">;
  openOptionsPage?: () => void;
};

class FakeCaptureService {
  captureCalls = 0;
  buildCalls: Array<{ document: CapturedTabDocument; mode?: CaptureMode }> = [];
  onBuildPageContext?: () => void;
  nextDocumentResult: CaptureDocumentResult | undefined;
  nextBuiltPageContext: PageContext | undefined;
  nextResult: CaptureResult = {
    status: "captured",
    pageIdentity: pageIdentity("https://example.com/captured"),
    pageContext: readablePageContext()
  };

  async captureActivePageContext(): Promise<CaptureResult> {
    this.captureCalls += 1;
    return this.nextResult;
  }

  async captureActivePageDocument(): Promise<CaptureDocumentResult> {
    this.captureCalls += 1;
    if (this.nextDocumentResult) return this.nextDocumentResult;
    if (this.nextResult.status === "unavailable") return this.nextResult;
    return (
      {
        status: "captured",
        pageIdentity: this.nextResult.pageIdentity,
        capturedDocument: capturedDocument()
      }
    );
  }

  async buildPageContextForCapturedDocument(
    document: CapturedTabDocument,
    mode?: CaptureMode
  ): Promise<PageContext> {
    this.buildCalls.push({ document, mode });
    this.onBuildPageContext?.();
    return this.nextBuiltPageContext ?? (this.nextResult.status === "captured" ? this.nextResult.pageContext : readablePageContext());
  }
}

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
    activePageTracker: activePage,
    captureService: options.captureService,
    captureGateway: options.captureGateway,
    settingsStore: options.settingsStore,
    openOptionsPage: options.openOptionsPage
  });

  return { controller, connectNative, ports, activePage };
}

async function waitForControllerSettings(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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

function pageIdentity(pageKey: string): Extract<PageIdentity, { status: "ready" }> {
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

function readablePageContext(text = "Readable captured article text that should not appear in transcript.") {
  return {
    kind: "readable" as const,
    metadata: {
      url: "https://example.com/captured",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    text,
    textLength: text.length,
    extractionMethod: "readability" as const
  };
}

function fallbackBodyPageContext(text = "Fallback body text that is long enough to be treated as readable context.") {
  return {
    ...readablePageContext(text),
    extractionMethod: "body_inner_text" as const
  };
}

function metadataOnlyPageContext() {
  return {
    kind: "metadata_only" as const,
    metadata: {
      url: "https://example.com/short",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    reason: "no_usable_text" as const
  };
}

function contentTooLargePageContext() {
  return {
    kind: "metadata_only" as const,
    metadata: {
      url: "https://example.com/large",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    reason: "content_too_large" as const
  };
}

function fullDomPageContext(html = "<html><body><main>Full DOM content</main></body></html>") {
  return {
    kind: "full_dom" as const,
    metadata: {
      url: "https://example.com/full-dom",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    html,
    htmlLength: html.length
  };
}

function fullDomTooLargePageContext() {
  return {
    kind: "metadata_only" as const,
    metadata: {
      url: "https://example.com/large-dom",
      capturedAt: "2026-05-10T12:00:00.000Z"
    },
    reason: "full_dom_too_large" as const
  };
}

function capturedDocument(overrides: Partial<CapturedTabDocument> = {}): CapturedTabDocument {
  return {
    documentUrl: "https://example.com/current",
    title: "Captured title",
    html: articleHtml({ text: longText("Readable article text") }),
    bodyInnerText: longText("Fallback body text"),
    capturedAt: "2026-05-10T12:00:00.000Z",
    canonicalUrl: undefined,
    siteName: "Example Site",
    excerpt: "Captured excerpt",
    byline: "Captured Author",
    language: "en",
    ...overrides
  };
}

function articleHtml(input: { text: string }) {
  return `<!doctype html><html><head><title>HTML title</title></head><body><article><h1>Article</h1><p>${input.text}</p></article></body></html>`;
}

function longText(seed: string) {
  return `${seed} `.repeat(12).trim();
}

function textOfLength(seed: string, length: number) {
  return seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
}

class FakeControllerCaptureGateway implements CaptureGateway {
  constructor(private readonly document: CapturedTabDocument) {}

  async queryActiveTab() {
    return { id: 7, url: this.document.documentUrl, title: this.document.title };
  }

  async readTabDocument() {
    return this.document;
  }
}

class FakeSettingsStore implements Pick<SettingsStore, "start" | "getSnapshot" | "whenReady" | "subscribe"> {
  startCount = 0;
  private readonly listeners = new Set<() => void>();
  private readyPromise: Promise<void> = Promise.resolve();
  private resolveReady: (() => void) | undefined;
  private readableContentLimitCharacters: number;
  private domContentLimitCharacters: number;
  private quickActions: QuickActionsSettings;

  constructor(
    readableContentLimitCharacters: number,
    domContentLimitCharacters = DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS,
    quickActions: QuickActionsSettings = DEFAULT_QUICK_ACTIONS_SETTINGS
  ) {
    this.readableContentLimitCharacters = readableContentLimitCharacters;
    this.domContentLimitCharacters = domContentLimitCharacters;
    this.quickActions = quickActions;
  }

  async start(): Promise<void> {
    this.startCount += 1;
  }

  async whenReady(): Promise<void> {
    await this.readyPromise;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): SidraSettings {
    return {
      readableContentLimitCharacters: this.readableContentLimitCharacters,
      domContentLimitCharacters: this.domContentLimitCharacters,
      quickActions: this.quickActions
    };
  }

  setLimit(readableContentLimitCharacters: number): void {
    this.readableContentLimitCharacters = readableContentLimitCharacters;
    this.emit();
  }

  setDomLimit(domContentLimitCharacters: number): void {
    this.domContentLimitCharacters = domContentLimitCharacters;
    this.emit();
  }

  setQuickActions(quickActions: QuickActionsSettings): void {
    this.quickActions = quickActions;
    this.emit();
  }

  holdReadiness(): void {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  resolveReadiness(): void {
    this.resolveReady?.();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

function unsupportedPageIdentity(url: string): PageIdentity {
  return { status: "unsupported", reason: "unsupported_url", url };
}

function sessionStarted(clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "session.started",
    version: 2,
    clientSessionId,
    bridgeSessionId: "bridge-1"
  };
}

function bridgeReady(): BridgeToExtension {
  return { type: "bridge.ready", version: 2 };
}

function agentTextDelta(clientSessionId: string, text: string): BridgeToExtension {
  return {
    type: "agent.event",
    version: 2,
    clientSessionId,
    event: { type: "assistant.text.delta", text }
  };
}

function permissionRequest(clientSessionId = "client-1", requestId = "permission-1"): BridgeToExtension {
  return {
    type: "permission.request",
    version: 2,
    clientSessionId,
    request: {
      requestId,
      permissionKey: "shell:ls",
      title: "Run command"
    }
  };
}

function agentDone(clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "agent.event",
    version: 2,
    clientSessionId,
    event: { type: "assistant.done" }
  };
}

function assistantCancelled(clientSessionId = "client-1"): BridgeToExtension {
  return {
    type: "agent.event",
    version: 2,
    clientSessionId,
    event: { type: "assistant.cancelled" }
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

    ports[0].emitMessage({ type: "bridge.error", version: 2, message: "bridge failed" });

    expect(controller.sendPrompt("hello")).toBe(false);
    expect(ports[0].postedMessages).toEqual([]);
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
  });

  it("clears the blocking bridge error after retry succeeds", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage({ type: "bridge.error", version: 2, message: "bridge failed" });
    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());

    expect(controller.getSnapshot().bridge).toMatchObject({
      setupError: undefined,
      canUseChat: true,
      availability: { status: "ready" }
    });
  });

  it("retryBridge_after_connected_error_clears_session_scoped_approvals", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage(permissionRequest("client-1", "permission-1"));
    controller.respondToPermission("permission-1", "allow_for_session");
    ports[0].emitMessage({ type: "bridge.error", version: 2, message: "bridge failed" });

    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());
    controller.sendPrompt("second");
    ports[1].emitMessage(sessionStarted());
    ports[1].emitMessage(permissionRequest("client-1", "permission-2"));

    expect(ports[1].postedMessages).not.toContainEqual({
      type: "permission.respond",
      version: 2,
      clientSessionId: "client-1",
      requestId: "permission-2",
      decision: "allow_for_session"
    });
  });

  it("does not keep queued prompts that failed before bridge.error recovery", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    expect(controller.sendPrompt("unsent")).toBe(true);
    ports[0].emitMessage({ type: "bridge.error", version: 2, message: "bridge failed" });

    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);

    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());

    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
    expect(controller.sendPrompt("after retry")).toBe(true);
    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" }
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
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" }
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

  it("shutdown_disconnects_bridge_and_clears_url_sessions", () => {
    const { controller, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    controller.updateDraftPrompt("draft");
    controller.sendPrompt("first");

    (controller as typeof controller & { shutdown(): void }).shutdown();

    expect(controller.getSnapshot().activeSession.clientSessionId).toBe("");
    expect(controller.getSnapshot().activeSession.draftPrompt).toBe("");
    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
    expect(controller.getSnapshot().bridge.connected).toBe(false);
  });

  it("shutdown_is_idempotent_and_ignores_later_source_updates", () => {
    const { controller, ports, activePage } = createHarness();
    ports[0].emitMessage(bridgeReady());

    controller.shutdown();
    controller.shutdown();
    activePage.emit(pageIdentity("https://example.com/after-shutdown"));

    expect(controller.getSnapshot().activeSession.clientSessionId).toBe("");
    expect(controller.getSnapshot().activePage).not.toMatchObject({ pageKey: "https://example.com/after-shutdown" });
  });

  it("shutdown_prevents_in_flight_capture_from_recreating_sessions", async () => {
    let resolveCapture: ((result: CaptureDocumentResult) => void) | undefined;
    const captureService = new FakeCaptureService();
    captureService.captureActivePageDocument = () =>
      new Promise<CaptureDocumentResult>((resolve) => {
        resolveCapture = resolve;
      });
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());

    const send = controller.captureAndSend("summarize");
    controller.shutdown();
    resolveCapture?.({
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/captured-after-shutdown"),
      capturedDocument: capturedDocument()
    });

    await expect(send).resolves.toBe(false);
    expect(controller.getSnapshot().activeSession.clientSessionId).toBe("");
    expect(ports[0].postedMessages).toEqual([]);
  });

  it("shutdown_ignores_late_settings_readiness", async () => {
    const settingsStore = new FakeSettingsStore(1_000);
    settingsStore.holdReadiness();
    const { controller, ports } = createHarnessWithOptions({ settingsStore });
    ports[0].emitMessage(bridgeReady());
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.shutdown();
    listener.mockClear();
    settingsStore.resolveReadiness();
    await waitForControllerSettings();

    expect(listener).not.toHaveBeenCalled();
  });

  it("native_disconnect_preserves_visible_url_sessions_and_marks_them_disconnected", () => {
    const { controller, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    controller.updateDraftPrompt("draft");
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());

    ports[0].disconnect();

    expect(controller.getSnapshot().activeSession).toMatchObject({
      clientSessionId: "client-1",
      draftPrompt: "",
      sessionStarted: false,
      starting: false
    });
    expect(controller.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ role: "status", text: "Bridge disconnected" })
    );
  });

  it("retry_after_native_disconnect_preserves_visible_url_sessions", () => {
    const { controller, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    controller.updateDraftPrompt("draft");
    ports[0].disconnect();

    controller.retryBridge();
    ports[1].emitMessage(bridgeReady());

    expect(controller.getSnapshot().activeSession).toMatchObject({
      clientSessionId: "client-1",
      draftPrompt: "draft"
    });
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
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" }
    ]);
    expect(controller.getSnapshot().activeSession).toMatchObject({
      pendingPromptCount: 1,
      sessionStarted: false,
      starting: true
    });

    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 2, clientSessionId: "client-1", prompt: "hello" }
    ]);
  });

  it("rejects a second prompt while the current turn is queued", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    expect(controller.sendPrompt("first")).toBe(true);
    expect(controller.sendPrompt("second")).toBe(false);
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage({
      type: "agent.event",
      version: 2,
      clientSessionId: "client-1",
      event: { type: "assistant.done" }
    });

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 2, clientSessionId: "client-1", prompt: "first" }
    ]);
  });

  it("exposes_active_session_turn_in_flight_after_send_is_flushed", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");
    ports[0].emitMessage(sessionStarted());

    expect(controller.getSnapshot().activeSession).toMatchObject({
      turnInFlight: true,
      canCancelTurn: true
    });
  });

  it("exposes_canCancelTurn_only_after_provider_turn_is_in_flight", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");

    expect(controller.getSnapshot().activeSession).toMatchObject({
      turnInFlight: false,
      canCancelTurn: false,
      pendingPromptCount: 1
    });

    ports[0].emitMessage(sessionStarted());

    expect(controller.getSnapshot().activeSession).toMatchObject({
      turnInFlight: true,
      canCancelTurn: true
    });
  });

  it("cancelTurn_posts_session_cancel_for_the_active_session", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");
    ports[0].emitMessage(sessionStarted());

    expect(controller.cancelTurn()).toBe(true);

    expect(ports[0].postedMessages).toContainEqual({
      type: "session.cancel",
      version: 2,
      clientSessionId: "client-1"
    });
  });

  it("cancelTurn_returns_false_when_the_active_session_has_no_cancelable_turn", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());

    expect(controller.cancelTurn()).toBe(false);
    expect(ports[0].postedMessages).toEqual([]);
  });

  it("sendPrompt_returns_false_when_active_session_is_running", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());

    expect(controller.sendPrompt("second")).toBe(false);
    expect(ports[0].postedMessages).not.toContainEqual(
      expect.objectContaining({ type: "session.send", prompt: "second" })
    );
  });

  it("exposes_permission_request_card_in_active_session_snapshot", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage(permissionRequest());

    expect(controller.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ kind: "permission_request", requestId: "permission-1", status: "pending" })
    );
  });

  it("respondToPermission_posts_response_for_active_session_request", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage(permissionRequest());

    expect(controller.respondToPermission("permission-1", "allow_once")).toBe(true);

    expect(ports[0].postedMessages).toContainEqual({
      type: "permission.respond",
      version: 2,
      clientSessionId: "client-1",
      requestId: "permission-1",
      decision: "allow_once"
    });
  });

  it("respondToPermission_returns_false_when_active_request_is_missing", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());

    expect(controller.respondToPermission("missing", "allow_once")).toBe(false);
    expect(ports[0].postedMessages).not.toContainEqual(expect.objectContaining({ type: "permission.respond" }));
  });

  it("respondToPermission_records_allow_for_session_for_active_session", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage(permissionRequest("client-1", "permission-1"));
    controller.respondToPermission("permission-1", "allow_for_session");
    ports[0].emitMessage(agentDone());
    controller.sendPrompt("second");
    ports[0].emitMessage(permissionRequest("client-1", "permission-2"));

    expect(ports[0].postedMessages).toContainEqual({
      type: "permission.respond",
      version: 2,
      clientSessionId: "client-1",
      requestId: "permission-2",
      decision: "allow_for_session"
    });
  });

  it("pending_permission_request_keeps_send_and_capture_blocked_for_same_session", async () => {
    const captureService = new FakeCaptureService();
    const { controller, ports } = createHarnessWithOptions({ captureService });

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage(permissionRequest());

    expect(controller.sendPrompt("second")).toBe(false);
    await expect(controller.captureAndSend("capture")).resolves.toBe(false);
    expect(captureService.captureCalls).toBe(0);
  });

  it("pending_permission_request_does_not_block_other_url_session", () => {
    const { controller, ports, activePage } = createHarnessWithOptions({
      clientSessionIds: ["client-1", "client-2"],
      initialPage: pageIdentity("https://example.com/a")
    });

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted("client-1"));
    ports[0].emitMessage(permissionRequest("client-1"));
    activePage.emit(pageIdentity("https://example.com/b"));

    expect(controller.sendPrompt("second")).toBe(true);

    expect(ports[0].postedMessages).toContainEqual({
      type: "session.start",
      version: 2,
      clientSessionId: "client-2",
      providerId: "codex"
    });
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
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" }
    ]);

    ports[1].emitMessage(sessionStarted());

    expect(ports[1].postedMessages).toEqual([
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 2, clientSessionId: "client-1", prompt: "second" }
    ]);
  });

  it("renders user and assistant transcript entries through the controller snapshot", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage({
      type: "agent.event",
      version: 2,
      clientSessionId: "client-1",
      event: { type: "assistant.text.delta", text: "Hi" }
    });

    expect(controller.getSnapshot().activeSession.transcript).toEqual([
      expect.objectContaining({ role: "user", text: "hello" }),
      expect.objectContaining({ role: "status", text: "Session started" }),
      expect.objectContaining({ role: "assistant", text: "Hi" })
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
    ports[0].emitMessage({ type: "bridge.error", version: 2, message: "bridge failed" });

    expect(controller.getSnapshot().bridge).toEqual({
      connected: true,
      ready: false,
      setupError: "bridge failed",
      canUseChat: false,
      availability: { status: "error", message: "bridge failed", code: undefined }
    });
  });

  it("surfaces_payload_too_large_bridge_error_without_marking_page_context_too_large", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage({
      type: "bridge.error",
      version: 2,
      message: "Payload is too large.",
      code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
    });

    expect(controller.getSnapshot().bridge.availability).toEqual({
      status: "error",
      message: "Payload is too large.",
      code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
    });
    expect(controller.getSnapshot().activeSession.contextState).toEqual({
      status: "none",
      label: "No context sent yet"
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
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.reset", version: 2, clientSessionId: "client-1" }
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
      version: 2,
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

    ports[0].emitMessage({ type: "bridge.ready", version: 2 });
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
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 2, clientSessionId: "client-1", prompt: "first" },
      { type: "session.reset", version: 2, clientSessionId: "client-1" }
    ]);

    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 2, clientSessionId: "client-1", prompt: "first" },
      { type: "session.reset", version: 2, clientSessionId: "client-1" },
      { type: "session.send", version: 2, clientSessionId: "client-1", prompt: "after reset" }
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

  it("newChat_keeps_same_page_key_and_client_session_after_reset", () => {
    const { controller, ports } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/a")
    });
    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());

    controller.newChat();

    expect(controller.getSnapshot().activeSession).toMatchObject({
      pageKey: "https://example.com/a",
      clientSessionId: "client-1",
      starting: true
    });
  });

  it("newChat_clears_active_transcript_draft_context_and_capture_mode", async () => {
    const { controller, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    controller.updateCaptureMode("full_dom");
    controller.updateDraftPrompt("unsent draft");
    await controller.captureAndSend("summarize");
    ports[0].emitMessage(sessionStarted());
    controller.updateDraftPrompt("unsent draft");

    controller.newChat();

    expect(controller.getSnapshot().activeSession).toMatchObject({
      draftPrompt: "",
      captureMode: "readable",
      contextState: { status: "none", label: "No context sent yet" },
      transcript: []
    });
  });

  it("newChat_resets_after_completed_turn_and_uses_fresh_provider_session", () => {
    const { controller, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage({
      type: "agent.event",
      version: 2,
      clientSessionId: "client-1",
      event: { type: "assistant.done" }
    });

    controller.newChat();
    controller.sendPrompt("after reset");

    expect(ports[0].postedMessages).toEqual([
      { type: "session.start", version: 2, clientSessionId: "client-1", providerId: "codex" },
      { type: "session.send", version: 2, clientSessionId: "client-1", prompt: "first" },
      { type: "session.reset", version: 2, clientSessionId: "client-1" }
    ]);

    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toContainEqual({
      type: "session.send",
      version: 2,
      clientSessionId: "client-1",
      prompt: "after reset"
    });
  });

  it("newChat_preserves_inactive_session_transcript_draft_context_running_state_and_provider_session", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/a"),
      pageContext: readablePageContext()
    };
    const { controller, activePage, ports } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/a"),
      clientSessionIds: ["client-a", "client-b"],
      captureService
    });
    ports[0].emitMessage(bridgeReady());
    await controller.captureAndSend("a");
    ports[0].emitMessage(sessionStarted("client-a"));
    controller.updateDraftPrompt("draft a");
    activePage.emit(pageIdentity("https://example.com/b"));
    controller.sendPrompt("b");
    ports[0].emitMessage(sessionStarted("client-b"));
    controller.updateDraftPrompt("draft b");

    controller.newChat();
    activePage.emit(pageIdentity("https://example.com/a"));

    expect(controller.getSnapshot().activeSession).toMatchObject({
      pageKey: "https://example.com/a",
      clientSessionId: "client-a",
      draftPrompt: "draft a",
      contextState: { status: "attached" },
      turnInFlight: true,
      canCancelTurn: true
    });
    expect(controller.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ kind: "user_message", text: "a" })
    );
    expect(ports[0].postedMessages).not.toContainEqual({
      type: "session.reset",
      version: 2,
      clientSessionId: "client-a"
    });
  });

  it("newChat_restores_empty_state_quick_actions_after_reset", async () => {
    const { controller, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    await waitForControllerSettings();
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    expect(controller.getSnapshot().activeSession.quickActions).toEqual([]);

    controller.newChat();

    expect(controller.getSnapshot().activeSession.transcript).toEqual([]);
    expect(controller.getSnapshot().activeSession.quickActions).toEqual([
      { id: "summarize-page", label: "Summarize this page" }
    ]);
  });

  it("newChat_records_reset_post_failure_in_active_session_only", () => {
    const { controller, activePage, ports } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/a"),
      clientSessionIds: ["client-a", "client-b"]
    });
    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("a");
    ports[0].emitMessage(sessionStarted("client-a"));
    activePage.emit(pageIdentity("https://example.com/b"));
    controller.sendPrompt("b");
    ports[0].emitMessage(sessionStarted("client-b"));
    ports[0].postMessage = vi.fn(() => {
      throw new Error("reset failed");
    });

    controller.newChat();

    expect(controller.getSnapshot().activeSession.transcript).toEqual([
      expect.objectContaining({ kind: "status", tone: "error", text: "reset failed" })
    ]);
    activePage.emit(pageIdentity("https://example.com/a"));
    expect(controller.getSnapshot().activeSession.transcript).not.toContainEqual(
      expect.objectContaining({ text: "reset failed" })
    );
  });

  it("records_reset_post_failure_as_error_status_entry", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    const failingPostMessage = vi.fn(() => {
      throw new Error("reset failed");
    });
    ports[0].postMessage = failingPostMessage;

    controller.newChat();

    expect(controller.getSnapshot().activeSession.transcript).toEqual([
      expect.objectContaining({ kind: "status", tone: "error", text: "reset failed" })
    ]);
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

  it("preserves_active_page_favicon_url_in_controller_snapshot", () => {
    const { controller, activePage } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/a")
    });

    activePage.emit({
      ...pageIdentityWithTitle("https://example.com/a", "Page A"),
      favIconUrl: "https://example.com/favicon.ico"
    });

    expect(controller.getSnapshot().activePage).toMatchObject({
      status: "ready",
      favIconUrl: "https://example.com/favicon.ico"
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
    expect(controller.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ role: "user", text: "page a" })
    );
  });

  it("sends_first_prompt_with_the_active_page_client_session_id", () => {
    const { controller, activePage, ports } = createHarnessWithOptions({ clientSessionIds: ["client-a"] });
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("hello");
    expect(ports[0].postedMessages).toContainEqual({
      type: "session.start",
      version: 2,
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

  it("allows_other_url_sessions_to_send_while_one_session_is_running", () => {
    const { controller, activePage, ports } = createHarnessWithOptions({
      clientSessionIds: ["client-a", "client-b"]
    });

    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    expect(controller.sendPrompt("page a")).toBe(true);
    ports[0].emitMessage(sessionStarted("client-a"));
    activePage.emit(pageIdentity("https://example.com/b"));

    expect(controller.sendPrompt("page b")).toBe(true);

    expect(ports[0].postedMessages).toContainEqual({
      type: "session.start",
      version: 2,
      clientSessionId: "client-b",
      providerId: "codex"
    });
  });

  it("restores_cancel_state_when_returning_to_running_url_session", () => {
    const { controller, activePage, ports } = createHarnessWithOptions({
      clientSessionIds: ["client-a", "client-b"]
    });

    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/a"));
    controller.sendPrompt("page a");
    ports[0].emitMessage(sessionStarted("client-a"));
    activePage.emit(pageIdentity("https://example.com/b"));
    expect(controller.getSnapshot().activeSession.turnInFlight).toBe(false);

    activePage.emit(pageIdentity("https://example.com/a"));

    expect(controller.getSnapshot().activeSession).toMatchObject({
      turnInFlight: true,
      canCancelTurn: true
    });
  });

  it("keeps_cancelled_partial_output_in_the_active_session_after_bridge_cancelled_event", () => {
    const { controller, ports } = createHarness();

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("hello");
    ports[0].emitMessage(sessionStarted());
    controller.cancelTurn();
    ports[0].emitMessage(agentTextDelta("client-1", "Partial"));
    ports[0].emitMessage(assistantCancelled());

    expect(controller.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ kind: "assistant_turn", markdown: "Partial", status: "cancelled" })
    );
    expect(controller.getSnapshot().activeSession.transcript).toContainEqual(
      expect.objectContaining({ kind: "status", tone: "cancelled", text: "Assistant turn cancelled" })
    );
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
      version: 2,
      clientSessionId: "client-b"
    });
    expect(ports[0].postedMessages).not.toContainEqual({
      type: "session.reset",
      version: 2,
      clientSessionId: "client-a"
    });
  });
});

describe("SidePanelController Capture + Send", () => {
  it("exposes_readable_capture_mode_by_default", () => {
    const { controller } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/a")
    });

    expect(controller.getSnapshot().activeSession.captureMode).toBe("readable");
  });

  it("updates_capture_mode_for_the_active_session", () => {
    const { controller } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/a")
    });

    controller.updateCaptureMode("full_dom");

    expect(controller.getSnapshot().activeSession.captureMode).toBe("full_dom");
  });

  it("captureAndSend_does_not_capture_when_active_session_is_running", async () => {
    const captureService = new FakeCaptureService();
    const { controller, ports } = createHarnessWithOptions({ captureService });

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());

    await expect(controller.captureAndSend("second")).resolves.toBe(false);
    expect(captureService.captureCalls).toBe(0);
  });

  it("captureAndSend_does_not_capture_when_active_session_has_a_queued_startup_prompt", async () => {
    const captureService = new FakeCaptureService();
    const { controller, ports } = createHarnessWithOptions({ captureService });

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");

    await expect(controller.captureAndSend("second")).resolves.toBe(false);
    expect(captureService.captureCalls).toBe(0);
  });

  it("captureAndSend_does_not_capture_when_cancel_is_already_requested", async () => {
    const captureService = new FakeCaptureService();
    const { controller, ports } = createHarnessWithOptions({ captureService });

    ports[0].emitMessage(bridgeReady());
    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());
    controller.cancelTurn();

    await expect(controller.captureAndSend("second")).resolves.toBe(false);
    expect(captureService.captureCalls).toBe(0);
  });

  it("does_not_capture_on_controller_creation_or_active_page_changes", async () => {
    const captureService = new FakeCaptureService();
    const { activePage } = createHarnessWithOptions({ captureService });

    activePage.emit(pageIdentity("https://example.com/a"));
    activePage.emit(pageIdentity("https://example.com/b"));

    expect(captureService.captureCalls).toBe(0);
  });

  it("capture_and_send_posts_readable_page_context_to_the_active_session", async () => {
    const captureService = new FakeCaptureService();
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());

    await expect(controller.captureAndSend(" summarize ")).resolves.toBe(true);
    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toContainEqual({
      type: "session.send",
      version: 2,
      clientSessionId: "client-1",
      prompt: "summarize",
      pageContext: captureService.nextResult.status === "captured" ? captureService.nextResult.pageContext : undefined
    });
    expect(controller.getSnapshot().activeSession.contextState.status).toBe("attached");
  });

  it("capture_and_send_posts_fallback_body_text_as_readable_context", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/fallback"),
      pageContext: fallbackBodyPageContext()
    };
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());

    await controller.captureAndSend("summarize");
    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toContainEqual(
      expect.objectContaining({
        type: "session.send",
        pageContext: expect.objectContaining({ extractionMethod: "body_inner_text" })
      })
    );
  });

  it("capture_and_send_posts_full_dom_context_when_capture_mode_is_full_dom", async () => {
    const captureService = new FakeCaptureService();
    const document = capturedDocument({ html: "<html><body>Full DOM</body></html>" });
    const pageContext = fullDomPageContext(document.html);
    captureService.nextDocumentResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/full-dom"),
      capturedDocument: document
    };
    captureService.nextBuiltPageContext = pageContext;
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());
    controller.updateCaptureMode("full_dom");

    await controller.captureAndSend("summarize");
    ports[0].emitMessage(sessionStarted());

    expect(captureService.buildCalls).toEqual([{ document, mode: "full_dom" }]);
    expect(ports[0].postedMessages).toContainEqual({
      type: "session.send",
      version: 2,
      clientSessionId: "client-1",
      prompt: "summarize",
      pageContext
    });
    expect(controller.getSnapshot().activeSession.contextState.status).toBe("full_dom_attached");
  });

  it("capture_and_send_returns_to_readable_context_after_full_dom_is_disabled", async () => {
    const captureService = new FakeCaptureService();
    const document = capturedDocument();
    captureService.nextDocumentResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/readable"),
      capturedDocument: document
    };
    captureService.nextBuiltPageContext = readablePageContext();
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());
    controller.updateCaptureMode("full_dom");
    controller.updateCaptureMode("readable");

    await controller.captureAndSend("summarize");

    expect(captureService.buildCalls.at(-1)).toEqual({ document, mode: "readable" });
    expect(controller.getSnapshot().activeSession.contextState.status).toBe("attached");
  });

  it("capture_and_send_marks_full_dom_too_large_without_sending_raw_html", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextDocumentResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/large-dom"),
      capturedDocument: capturedDocument({ html: "<html>Raw oversized DOM</html>" })
    };
    captureService.nextBuiltPageContext = fullDomTooLargePageContext();
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());
    controller.updateCaptureMode("full_dom");

    await controller.captureAndSend("describe");

    expect(controller.getSnapshot().activeSession.contextState).toMatchObject({
      status: "full_dom_too_large",
      label: "Full DOM skipped: too large"
    });
    expect(controller.getSnapshot().activeSession.transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Full DOM skipped; content too large" }),
      expect.objectContaining({ role: "user", text: "describe" })
    ]);
    expect(controller.getSnapshot().activeSession.transcript.map((entry) => entry.text).join("\n")).not.toContain(
      "Raw oversized DOM"
    );
  });

  it("capture_and_send_uses_live_dom_limit_from_composed_settings_store", async () => {
    const html = "<html><body>Full DOM content</body></html>";
    const settingsStore = new FakeSettingsStore(1_000, html.length);
    const { controller, ports } = createHarnessWithOptions({
      captureGateway: new FakeControllerCaptureGateway(capturedDocument({ html })),
      settingsStore
    });
    ports[0].emitMessage(bridgeReady());
    controller.updateCaptureMode("full_dom");

    await controller.captureAndSend("first");
    expect(controller.getSnapshot().activeSession.contextState.status).toBe("full_dom_attached");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage({
      type: "agent.event",
      version: 2,
      clientSessionId: "client-1",
      event: { type: "assistant.done" }
    });

    settingsStore.setDomLimit(html.length - 1);
    await controller.captureAndSend("second");

    expect(controller.getSnapshot().activeSession.contextState.status).toBe("full_dom_too_large");
  });

  it("keeps_full_dom_capture_mode_scoped_to_the_url_session", async () => {
    const { controller, ports, activePage } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/a"),
      clientSessionIds: ["client-a", "client-b"]
    });
    ports[0].emitMessage(bridgeReady());
    controller.updateCaptureMode("full_dom");
    activePage.emit(pageIdentity("https://example.com/b"));

    expect(controller.getSnapshot().activeSession.captureMode).toBe("readable");

    activePage.emit(pageIdentity("https://example.com/a"));
    expect(controller.getSnapshot().activeSession.captureMode).toBe("full_dom");
  });

  it("capture_and_send_uses_capture_mode_from_the_captured_canonical_url_session", async () => {
    const captureService = new FakeCaptureService();
    const existingDocument = capturedDocument({ html: "<html>Existing canonical DOM</html>" });
    captureService.nextDocumentResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/canonical"),
      capturedDocument: existingDocument
    };
    const { controller, ports, activePage } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/canonical"),
      captureService
    });
    ports[0].emitMessage(bridgeReady());
    controller.updateCaptureMode("full_dom");
    activePage.emit(pageIdentity("https://example.com/stale"));
    controller.updateCaptureMode("readable");

    await controller.captureAndSend("summarize");

    expect(captureService.buildCalls.at(-1)).toEqual({ document: existingDocument, mode: "full_dom" });
  });

  it("capture_and_send_carries_full_dom_mode_to_new_canonical_url_session", async () => {
    const captureService = new FakeCaptureService();
    const canonicalDocument = capturedDocument({ html: "<html>New canonical DOM</html>" });
    captureService.nextDocumentResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/canonical-new"),
      capturedDocument: canonicalDocument
    };
    const { controller, ports } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/pre-capture"),
      captureService
    });
    ports[0].emitMessage(bridgeReady());
    controller.updateCaptureMode("full_dom");

    await controller.captureAndSend("summarize");

    expect(captureService.buildCalls.at(-1)).toEqual({ document: canonicalDocument, mode: "full_dom" });
    expect(controller.getSnapshot().activeSession).toMatchObject({
      pageKey: "https://example.com/canonical-new",
      captureMode: "full_dom"
    });
  });

  it("capture_and_send_keeps_sending_to_the_captured_session_when_active_page_changes_during_context_build", async () => {
    const captureService = new FakeCaptureService();
    const capturedDocumentSnapshot = capturedDocument({ html: "<html>Captured page</html>" });
    captureService.nextDocumentResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/captured-during-build"),
      capturedDocument: capturedDocumentSnapshot
    };
    captureService.nextBuiltPageContext = readablePageContext();
    const { controller, ports, activePage } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/captured-during-build"),
      clientSessionIds: ["client-captured", "client-other"],
      captureService
    });
    ports[0].emitMessage(bridgeReady());
    captureService.onBuildPageContext = () => {
      activePage.emit(pageIdentity("https://example.com/other"));
    };

    await controller.captureAndSend("summarize");

    expect(ports[0].postedMessages).toContainEqual({
      type: "session.start",
      version: 2,
      clientSessionId: "client-captured",
      providerId: "codex"
    });
    expect(ports[0].postedMessages).not.toContainEqual({
      type: "session.start",
      version: 2,
      clientSessionId: "client-other",
      providerId: "codex"
    });
    expect(controller.getSnapshot().activeSession.pageKey).toBe("https://example.com/captured-during-build");
  });

  it("capture_and_send_recomputes_the_url_session_from_captured_canonical_url", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/canonical"),
      pageContext: readablePageContext()
    };
    const { controller, ports } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/stale"),
      captureService
    });
    ports[0].emitMessage(bridgeReady());

    await controller.captureAndSend("summarize");

    expect(controller.getSnapshot().activePage).toMatchObject({ pageKey: "https://example.com/canonical" });
  });

  it("capture_and_send_routes_to_the_tab_active_at_click_time", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/click-time"),
      pageContext: readablePageContext()
    };
    const { controller, ports, activePage } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/old"),
      captureService
    });
    ports[0].emitMessage(bridgeReady());
    activePage.emit(pageIdentity("https://example.com/tracker-snapshot"));

    await controller.captureAndSend("summarize");

    expect(controller.getSnapshot().activeSession.pageKey).toBe("https://example.com/click-time");
  });

  it("capture_and_send_marks_metadata_only_without_sending_raw_page_text", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/short"),
      pageContext: metadataOnlyPageContext()
    };
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());

    await controller.captureAndSend("describe");

    expect(controller.getSnapshot().activeSession.contextState.status).toBe("metadata_only");
    expect(controller.getSnapshot().activeSession.transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Page metadata attached" }),
      expect.objectContaining({ role: "user", text: "describe" })
    ]);
  });

  it("capture_and_send_marks_content_too_large_without_sending_raw_page_text", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/large"),
      pageContext: contentTooLargePageContext()
    };
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());

    await controller.captureAndSend("describe");

    expect(controller.getSnapshot().activeSession.contextState).toMatchObject({
      status: "content_too_large",
      label: "Content too large"
    });
    expect(controller.getSnapshot().activeSession.transcript).toEqual([
      expect.objectContaining({ role: "status", text: "Page metadata attached; content too large" }),
      expect.objectContaining({ role: "user", text: "describe" })
    ]);
    expect(controller.getSnapshot().activeSession.transcript.map((entry) => entry.text).join("\n")).not.toContain(
      "Raw oversized article text"
    );
  });

  it("capture_and_send_uses_initial_stored_readable_limit_from_composed_settings_store", async () => {
    const oversizedText = textOfLength("Oversized readable article text. ", 1_100);
    const settingsStore = new FakeSettingsStore(1_000);
    const { controller, ports } = createHarnessWithOptions({
      captureGateway: new FakeControllerCaptureGateway(capturedDocument({ html: articleHtml({ text: oversizedText }) })),
      settingsStore
    });
    ports[0].emitMessage(bridgeReady());

    await controller.captureAndSend("summarize");
    ports[0].emitMessage(sessionStarted());

    expect(settingsStore.startCount).toBe(1);
    expect(controller.getSnapshot().activeSession.contextState.status).toBe("content_too_large");
    const sendMessage = ports[0].postedMessages.find((message) => message.type === "session.send");
    expect(sendMessage).toEqual(
      expect.objectContaining({
        type: "session.send",
        pageContext: expect.objectContaining({
          kind: "metadata_only",
          reason: "content_too_large"
        })
      })
    );
    expect(sendMessage).not.toHaveProperty("pageContext.text");
  });

  it("capture_and_send_uses_live_readable_limit_from_composed_settings_store", async () => {
    const selectedText = textOfLength("Readable article text. ", 1_100);
    const settingsStore = new FakeSettingsStore(1_200);
    const { controller, ports } = createHarnessWithOptions({
      captureGateway: new FakeControllerCaptureGateway(capturedDocument({ html: articleHtml({ text: selectedText }) })),
      settingsStore
    });
    ports[0].emitMessage(bridgeReady());

    await controller.captureAndSend("first");
    expect(controller.getSnapshot().activeSession.contextState.status).toBe("attached");
    ports[0].emitMessage(sessionStarted());
    ports[0].emitMessage({
      type: "agent.event",
      version: 2,
      clientSessionId: "client-1",
      event: { type: "assistant.done" }
    });

    settingsStore.setLimit(1_000);
    await controller.captureAndSend("second");

    expect(controller.getSnapshot().activeSession.contextState.status).toBe("content_too_large");
  });

  it("capture_and_send_reports_capture_unavailable_without_posting_prompt", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "unavailable",
      pageIdentity: pageIdentity("https://example.com/a"),
      message: "Could not capture this page."
    };
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());

    await expect(controller.captureAndSend("summarize")).resolves.toBe(false);

    expect(ports[0].postedMessages).toEqual([]);
    expect(controller.getSnapshot().activeSession.transcript).toEqual([
      expect.objectContaining({ role: "status", tone: "error", text: "Could not capture this page." })
    ]);
  });

  it("captureAndSend_records_capture_unavailable_as_error_status_entry", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "unavailable",
      pageIdentity: pageIdentity("https://example.com/a"),
      message: "Could not capture this page."
    };
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());

    await controller.captureAndSend("summarize");

    expect(controller.getSnapshot().activeSession.transcript).toEqual([
      expect.objectContaining({ kind: "status", role: "status", tone: "error", text: "Could not capture this page." })
    ]);
  });

  it("capture_and_send_preserves_the_draft_when_capture_is_unavailable", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "unavailable",
      pageIdentity: pageIdentity("https://example.com/a"),
      message: "Could not capture this page."
    };
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());
    controller.updateDraftPrompt("keep draft");

    await controller.captureAndSend("keep draft");

    expect(controller.getSnapshot().activeSession.draftPrompt).toBe("keep draft");
  });

  it("capture_and_send_records_capture_unavailable_for_the_captured_ready_identity_not_the_stale_tracker_identity", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "unavailable",
      pageIdentity: pageIdentity("https://example.com/captured-ready"),
      message: "Could not capture this page."
    };
    const { controller, ports } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/stale"),
      captureService
    });
    ports[0].emitMessage(bridgeReady());

    await controller.captureAndSend("summarize");

    expect(controller.getSnapshot().activeSession.pageKey).toBe("https://example.com/captured-ready");
    expect(controller.getSnapshot().activeSession.contextState.status).toBe("capture_unavailable");
  });

  it("capture_and_send_updates_to_unsupported_capture_result_without_mutating_the_previous_ready_session", async () => {
    const captureService = new FakeCaptureService();
    captureService.nextResult = {
      status: "unavailable",
      pageIdentity: unsupportedPageIdentity("chrome://extensions"),
      message: "Could not capture this page."
    };
    const { controller, ports } = createHarnessWithOptions({
      initialPage: pageIdentity("https://example.com/ready"),
      captureService
    });
    ports[0].emitMessage(bridgeReady());
    controller.updateDraftPrompt("ready draft");

    await controller.captureAndSend("ready draft");

    expect(controller.getSnapshot().activePage).toMatchObject({ status: "unsupported" });
    expect(controller.getSnapshot().activeSession.clientSessionId).toBe("");
  });

  it("capture_and_send_does_not_capture_when_chat_is_blocked", async () => {
    const captureService = new FakeCaptureService();
    const { controller } = createHarnessWithOptions({ captureService });

    await expect(controller.captureAndSend("summarize")).resolves.toBe(false);

    expect(captureService.captureCalls).toBe(0);
  });

  it("plain_send_prompt_remains_available_without_page_context", () => {
    const captureService = new FakeCaptureService();
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());

    expect(controller.sendPrompt("plain")).toBe(true);
    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toContainEqual({
      type: "session.send",
      version: 2,
      clientSessionId: "client-1",
      prompt: "plain"
    });
    expect(captureService.captureCalls).toBe(0);
  });
});

describe("SidePanelController quick actions", () => {
  it("exposes_default_quick_actions_for_empty_sessions", async () => {
    const { controller, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    await waitForControllerSettings();

    expect(controller.getSnapshot().activeSession.quickActions).toEqual([
      { id: "summarize-page", label: "Summarize this page" }
    ]);
  });

  it("does_not_expose_quick_actions_when_settings_disable_them", async () => {
    const settingsStore = new FakeSettingsStore(1_000, DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS, {
      enabled: false,
      actions: DEFAULT_QUICK_ACTIONS_SETTINGS.actions
    });
    const { controller, ports } = createHarnessWithOptions({ settingsStore });
    ports[0].emitMessage(bridgeReady());
    await waitForControllerSettings();

    expect(controller.getSnapshot().activeSession.quickActions).toEqual([]);
  });

  it("exposes_custom_quick_actions_from_settings", async () => {
    const settingsStore = new FakeSettingsStore(1_000, DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS, {
      enabled: true,
      actions: [
        { id: "explain", label: "Explain", prompt: "Explain this" },
        { id: "questions", label: "Find questions", prompt: "Find open questions" }
      ]
    });
    const { controller, ports } = createHarnessWithOptions({ settingsStore });
    ports[0].emitMessage(bridgeReady());
    await waitForControllerSettings();

    expect(controller.getSnapshot().activeSession.quickActions).toEqual([
      { id: "explain", label: "Explain" },
      { id: "questions", label: "Find questions" }
    ]);
  });

  it("updates_quick_actions_when_settings_change_live", async () => {
    const settingsStore = new FakeSettingsStore(1_000);
    const { controller, ports } = createHarnessWithOptions({ settingsStore });
    ports[0].emitMessage(bridgeReady());
    await waitForControllerSettings();

    settingsStore.setQuickActions({
      enabled: true,
      actions: [{ id: "translate", label: "Translate", prompt: "Translate this" }]
    });

    expect(controller.getSnapshot().activeSession.quickActions).toEqual([
      { id: "translate", label: "Translate" }
    ]);
  });

  it("does_not_expose_quick_actions_before_initial_settings_load", async () => {
    const settingsStore = new FakeSettingsStore(1_000);
    settingsStore.holdReadiness();
    const { controller, ports } = createHarnessWithOptions({ settingsStore });
    ports[0].emitMessage(bridgeReady());

    expect(controller.getSnapshot().activeSession.quickActions).toEqual([]);

    settingsStore.resolveReadiness();
    await waitForControllerSettings();

    expect(controller.getSnapshot().activeSession.quickActions).toEqual([
      { id: "summarize-page", label: "Summarize this page" }
    ]);
  });

  it("does_not_expose_quick_actions_when_the_active_session_has_transcript", async () => {
    const { controller, ports } = createHarness();
    ports[0].emitMessage(bridgeReady());
    await waitForControllerSettings();

    controller.sendPrompt("hello");

    expect(controller.getSnapshot().activeSession.quickActions).toEqual([]);
  });

  it("sendQuickAction_sends_the_configured_prompt_through_capture_and_send", async () => {
    const captureService = new FakeCaptureService();
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());
    await waitForControllerSettings();

    await expect(controller.sendQuickAction("summarize-page")).resolves.toBe(true);
    ports[0].emitMessage(sessionStarted());

    expect(ports[0].postedMessages).toContainEqual(
      expect.objectContaining({
        type: "session.send",
        clientSessionId: "client-1",
        prompt: DEFAULT_SUMMARIZE_PAGE_QUICK_ACTION_PROMPT
      })
    );
    expect(captureService.captureCalls).toBe(1);
  });

  it("sendQuickAction_returns_false_for_unknown_or_hidden_action", async () => {
    const captureService = new FakeCaptureService();
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());
    await waitForControllerSettings();

    await expect(controller.sendQuickAction("missing")).resolves.toBe(false);
    controller.sendPrompt("hello");
    await expect(controller.sendQuickAction("summarize-page")).resolves.toBe(false);

    expect(captureService.captureCalls).toBe(0);
  });

  it("sendQuickAction_returns_false_when_active_session_is_running", async () => {
    const captureService = new FakeCaptureService();
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());
    await waitForControllerSettings();

    controller.sendPrompt("first");
    ports[0].emitMessage(sessionStarted());

    await expect(controller.sendQuickAction("summarize-page")).resolves.toBe(false);
    expect(captureService.captureCalls).toBe(0);
  });

  it("quick_action_capture_and_send_uses_active_session_capture_mode", async () => {
    const captureService = new FakeCaptureService();
    const document = capturedDocument({ html: "<html><body>Full DOM</body></html>" });
    captureService.nextDocumentResult = {
      status: "captured",
      pageIdentity: pageIdentity("https://example.com/full-dom"),
      capturedDocument: document
    };
    captureService.nextBuiltPageContext = fullDomPageContext(document.html);
    const { controller, ports } = createHarnessWithOptions({ captureService });
    ports[0].emitMessage(bridgeReady());
    await waitForControllerSettings();
    controller.updateCaptureMode("full_dom");

    await controller.sendQuickAction("summarize-page");

    expect(captureService.buildCalls.at(-1)).toEqual({ document, mode: "full_dom" });
  });

  it("openSettings_opens_the_extension_options_page_through_the_controller_boundary", () => {
    const openOptionsPage = vi.fn();
    const { controller } = createHarnessWithOptions({ openOptionsPage });

    controller.openSettings();

    expect(openOptionsPage).toHaveBeenCalledTimes(1);
  });
});
