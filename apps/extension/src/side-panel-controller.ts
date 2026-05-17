import type { PageContext, ProviderId } from "@sidra/protocol";
import { createChromeActivePageTracker } from "./active-page";
import {
  CaptureService,
  createChromeCaptureService,
  type CaptureDocumentResult,
  type CaptureGateway,
  type CapturedTabDocument
} from "./capture-service";
import type { CaptureMode } from "./capture-mode";
import type { PageIdentity } from "./page-key";
import { BridgeConnection, type BridgeAvailability, type NativeBridgePort } from "./bridge/connection";
import { BridgeSessionCoordinator } from "./bridge/session-coordinator";
import {
  createChromeSettingsStore,
  createDefaultSettingsSource,
  type QuickAction,
  type SidraSettings,
  type SettingsStore
} from "./settings-store";
import type { TranscriptEntry } from "./transcript";
import { UrlSessionStore, type ContextState } from "./url-session-store";

export type SidePanelSnapshot = {
  bridge: {
    availability: BridgeAvailability;
    connected: boolean;
    ready: boolean;
    setupError?: string;
    canUseChat: boolean;
  };
  activePage: PageIdentity;
  activeSession: {
    pageKey: string;
    clientSessionId: string;
    captureMode: CaptureMode;
    draftPrompt: string;
    contextState: ContextState;
    transcript: TranscriptEntry[];
    pendingPromptCount: number;
    sessionStarted: boolean;
    starting: boolean;
    quickActions: VisibleQuickAction[];
  };
};

export type VisibleQuickAction = {
  id: string;
  label: string;
};

export type SidePanelController = {
  getSnapshot(): SidePanelSnapshot;
  subscribe(listener: () => void): () => void;
  sendPrompt(prompt: string): boolean;
  captureAndSend(prompt: string): Promise<boolean>;
  sendQuickAction(actionId: string): Promise<boolean>;
  updateCaptureMode(captureMode: CaptureMode): void;
  updateDraftPrompt(text: string): void;
  newChat(): void;
  retryBridge(): void;
  openSettings(): void;
};

type ActivePageSource = {
  getSnapshot(): PageIdentity;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
};

type CaptureServiceLike = {
  captureActivePageDocument(): Promise<CaptureDocumentResult>;
  buildPageContextForCapturedDocument(
    capturedDocument: CapturedTabDocument,
    mode?: CaptureMode
  ): Promise<PageContext>;
};

type SidePanelControllerOptions = {
  connectNative(application: string): NativeBridgePort;
  createClientSessionId(): string;
  activePageTracker?: ActivePageSource;
  captureService?: CaptureServiceLike;
  captureGateway?: CaptureGateway;
  settingsStore?: Pick<SettingsStore, "start" | "getSnapshot" | "whenReady" | "subscribe">;
  openOptionsPage?: () => void;
  providerId?: ProviderId;
};

type ControllerSettingsSource = Pick<SettingsStore, "start" | "getSnapshot" | "whenReady" | "subscribe">;

/**
 * Composes the bridge transport and session coordinator into the side panel API.
 *
 * React receives a stable view snapshot and sends user intents here; protocol
 * sequencing stays behind the bridge/session boundary.
 */
export function createSidePanelController(options: SidePanelControllerOptions): SidePanelController {
  const connection = new BridgeConnection({ connectNative: options.connectNative });
  const activePageTracker =
    options.activePageTracker ??
    ({
      getSnapshot: () => ({ status: "unsupported", reason: "missing_url" }),
      subscribe: () => () => undefined,
      start: async () => undefined
    } satisfies ActivePageSource);
  const settingsStore = options.settingsStore ?? createDefaultControllerSettingsSource();
  const captureService =
    options.captureService ??
    (options.captureGateway
      ? new CaptureService({ gateway: options.captureGateway, settings: settingsStore })
      : createChromeCaptureService(settingsStore));
  const urlSessionStore = new UrlSessionStore({
    createClientSessionId: options.createClientSessionId,
    createCoordinator: (clientSessionId) =>
      new BridgeSessionCoordinator({
        clientSessionId,
        providerId: options.providerId,
        transport: connection
      })
  });
  const listeners = new Set<() => void>();
  let bridgeConnected = connection.getSnapshot().connected;
  let bridgeSnapshot = connection.getSnapshot();
  let activePageSnapshot = activePageTracker.getSnapshot();
  let settingsSnapshot = settingsStore.getSnapshot();
  let settingsReady = false;
  urlSessionStore.selectPage(activePageSnapshot);
  let urlSessionSnapshot = urlSessionStore.getSnapshot();
  let snapshot = createSnapshot(bridgeSnapshot, activePageSnapshot, urlSessionSnapshot, settingsSnapshot, settingsReady);
  let snapshotSettingsSnapshot = settingsSnapshot;
  let snapshotSettingsReady = settingsReady;

  const refreshSnapshot = () => {
    const nextBridgeSnapshot = connection.getSnapshot();
    const nextUrlSessionSnapshot = urlSessionStore.getSnapshot();
    if (
      nextBridgeSnapshot === bridgeSnapshot &&
      activePageSnapshot === snapshot.activePage &&
      snapshotsMatch(nextUrlSessionSnapshot, urlSessionSnapshot) &&
      settingsSnapshot === snapshotSettingsSnapshot &&
      settingsReady === snapshotSettingsReady
    ) {
      return;
    }

    bridgeSnapshot = nextBridgeSnapshot;
    urlSessionSnapshot = nextUrlSessionSnapshot;
    snapshot = createSnapshot(bridgeSnapshot, activePageSnapshot, urlSessionSnapshot, settingsSnapshot, settingsReady);
    snapshotSettingsSnapshot = settingsSnapshot;
    snapshotSettingsReady = settingsReady;
  };

  const emit = () => {
    refreshSnapshot();
    for (const listener of listeners) listener();
  };

  connection.subscribe(() => {
    const connected = connection.getSnapshot().connected;
    const disconnected = bridgeConnected && !connected;
    bridgeConnected = connected;

    if (disconnected) {
      urlSessionStore.markBridgeDisconnected();
    }

    emit();
  });
  activePageTracker.subscribe(() => {
    activePageSnapshot = activePageTracker.getSnapshot();
    urlSessionStore.selectPage(activePageSnapshot);
    emit();
  });
  urlSessionStore.subscribe(emit);
  settingsStore.subscribe(() => {
    settingsSnapshot = settingsStore.getSnapshot();
    emit();
  });
  connection.connect();
  void settingsStore.start();
  void settingsStore.whenReady().then(() => {
    settingsSnapshot = settingsStore.getSnapshot();
    settingsReady = true;
    emit();
  });
  void activePageTracker.start();
  bridgeConnected = connection.getSnapshot().connected;
  refreshSnapshot();

  const captureAndSendCommand = async (prompt: string) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return false;

    refreshSnapshot();
    if (!snapshot.bridge.canUseChat) return false;

    const preCaptureMode = snapshot.activeSession.captureMode;
    const captureResult = await captureService.captureActivePageDocument();
    if (captureResult.status === "captured") {
      activePageSnapshot = captureResult.pageIdentity;
      urlSessionStore.selectPage(captureResult.pageIdentity, { initialCaptureMode: preCaptureMode });
      const capturedSessionMode = urlSessionStore.getSnapshot().activeSession.captureMode;
      const pageContext = await captureService.buildPageContextForCapturedDocument(
        captureResult.capturedDocument,
        capturedSessionMode
      );
      activePageSnapshot = captureResult.pageIdentity;
      urlSessionStore.selectPage(captureResult.pageIdentity);
      const accepted = urlSessionStore.sendPromptWithContext({
        prompt: normalizedPrompt,
        pageContext
      });
      emit();
      return accepted;
    }

    activePageSnapshot = captureResult.pageIdentity;
    urlSessionStore.selectPage(captureResult.pageIdentity);
    if (captureResult.pageIdentity.status === "ready") {
      urlSessionStore.updateActiveDraftPrompt(normalizedPrompt);
      urlSessionStore.recordCaptureUnavailable({ message: captureResult.message });
    }
    emit();
    return false;
  };

  return {
    getSnapshot: () => {
      refreshSnapshot();
      return snapshot;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sendPrompt: (prompt) => {
      refreshSnapshot();
      if (!snapshot.bridge.canUseChat) return false;
      return urlSessionStore.sendPrompt(prompt);
    },
    captureAndSend: captureAndSendCommand,
    sendQuickAction: async (actionId) => {
      refreshSnapshot();
      const action = settingsSnapshot.quickActions.actions.find((candidate) => candidate.id === actionId);
      const visible = snapshot.activeSession.quickActions.some((candidate) => candidate.id === actionId);
      if (!action || !visible) return false;
      return await captureAndSendCommand(action.prompt);
    },
    updateCaptureMode: (captureMode) => urlSessionStore.updateActiveCaptureMode(captureMode),
    updateDraftPrompt: (text) => urlSessionStore.updateActiveDraftPrompt(text),
    newChat: () => urlSessionStore.newChat(),
    retryBridge: () => connection.retry(),
    openSettings: () => options.openOptionsPage?.()
  };
}

function createSnapshot(
  bridge: ReturnType<BridgeConnection["getSnapshot"]>,
  activePage: PageIdentity,
  urlSessions: ReturnType<UrlSessionStore["getSnapshot"]>,
  settings: SidraSettings,
  settingsReady: boolean
): SidePanelSnapshot {
  const activeSession = urlSessions.activeSession;
  const canUseChat = bridge.availability.status === "ready" && activePage.status === "ready";
  return {
    bridge: {
      availability: bridge.availability,
      connected: bridge.connected,
      ready: bridge.ready,
      setupError: bridge.setupError,
      canUseChat
    },
    activePage,
    activeSession: {
      pageKey: activeSession.pageKey,
      clientSessionId: activeSession.clientSessionId,
      captureMode: activeSession.captureMode,
      draftPrompt: activeSession.draftPrompt,
      contextState: activeSession.contextState,
      transcript: activeSession.transcript,
      pendingPromptCount: activeSession.pendingPromptCount,
      sessionStarted: activeSession.sessionStarted,
      starting: activeSession.starting,
      quickActions: deriveVisibleQuickActions({
        activePage,
        canUseChat,
        settings,
        settingsReady,
        transcript: activeSession.transcript
      })
    }
  };
}

export function createChromeSidePanelController(): SidePanelController {
  const settingsStore = createChromeSettingsStore();
  return createSidePanelController({
    connectNative: (hostName) => chrome.runtime.connectNative(hostName),
    createClientSessionId: () => `sidra-${crypto.randomUUID()}`,
    activePageTracker: createChromeActivePageTracker(),
    settingsStore,
    openOptionsPage: () => chrome.runtime.openOptionsPage()
  });
}

function deriveVisibleQuickActions(input: {
  activePage: PageIdentity;
  canUseChat: boolean;
  settings: SidraSettings;
  settingsReady: boolean;
  transcript: TranscriptEntry[];
}): VisibleQuickAction[] {
  if (!input.settingsReady) return [];
  if (!input.canUseChat) return [];
  if (input.activePage.status !== "ready") return [];
  if (input.transcript.length > 0) return [];
  if (!input.settings.quickActions.enabled) return [];
  return input.settings.quickActions.actions.map(toVisibleQuickAction);
}

function toVisibleQuickAction(action: QuickAction): VisibleQuickAction {
  return {
    id: action.id,
    label: action.label
  };
}

function createDefaultControllerSettingsSource(): ControllerSettingsSource {
  const defaultSettingsSource = createDefaultSettingsSource();
  return {
    getSnapshot: defaultSettingsSource.getSnapshot,
    start: async () => undefined,
    whenReady: defaultSettingsSource.whenReady,
    subscribe: () => () => undefined
  };
}

function snapshotsMatch(
  first: ReturnType<UrlSessionStore["getSnapshot"]>,
  second: ReturnType<UrlSessionStore["getSnapshot"]>
): boolean {
  return first.activeSession === second.activeSession && first.sessions === second.sessions;
}
