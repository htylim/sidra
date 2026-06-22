import type { PageContext, PermissionDecision, PromptEffort, ProviderId } from "@sidra/protocol";
import { createChromeActivePageTracker } from "./active-page";
import {
  CaptureService,
  createChromeCaptureService,
  type BuildComposerAttachmentResult,
  type CaptureDocumentResult,
  type CaptureGateway,
  type CapturedTabDocument
} from "./capture-service";
import type { CaptureMode } from "./capture-mode";
import type { PageIdentity } from "./page-key";
import {
  createChromePageSelectionService,
  type PageSelectionCaptureResult,
  type PageSelectionMode
} from "./page-selection-service";
import { BridgeConnection, type BridgeAvailability, type NativeBridgePort } from "./bridge/connection";
import { BridgeSessionCoordinator } from "./bridge/session-coordinator";
import {
  createChromeSettingsStore,
  createDefaultSettingsSource,
  type QuickAction,
  type SidraSettings,
  type SettingsStore
} from "./settings-store";
import type { TranscriptEntry, UserPromptDisplay } from "./transcript";
import {
  MediaSourceSpeechPlaybackGateway,
  TranscriptSpeechController,
  type TranscriptSpeechPlaybackGateway,
  type TranscriptSpeechSnapshot
} from "./transcript-speech-controller";
import {
  UrlSessionStore,
  type ContextState,
  type SendMode,
  type UrlSessionSnapshot
} from "./url-session-store";

export type PageSelectionCaptureState =
  | { status: "idle" }
  | { status: "selecting"; requestId: string; mode: PageSelectionMode }
  | { status: "failed"; message: string };

export type SidePanelSnapshot = {
  bridge: {
    availability: BridgeAvailability;
    connected: boolean;
    ready: boolean;
    setupError?: string;
    canUseChat: boolean;
  };
  display: {
    accentColor: string;
    promptEffort: PromptEffort;
    promptFontSizePx: number;
    responseFontSizePx: number;
  };
  speech: TranscriptSpeechSnapshot;
  pageSelection: PageSelectionCaptureState;
  activePage: PageIdentity;
  activeSession: {
    pageKey: string;
    clientSessionId: string;
    captureMode: CaptureMode;
    sendMode: SendMode;
    draftPrompt: string;
    contextState: ContextState;
    contextAttachments: UrlSessionSnapshot["contextAttachments"];
    transcript: TranscriptEntry[];
    pendingPromptCount: number;
    sessionStarted: boolean;
    starting: boolean;
    turnInFlight: boolean;
    canCancelTurn: boolean;
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
  startPageSelection(mode: PageSelectionMode): Promise<boolean>;
  cancelPageSelection(): boolean;
  removeContextAttachment(attachmentId: string): boolean;
  clearContextAttachments(): boolean;
  cancelTurn(): boolean;
  respondToPermission(requestId: string, decision: PermissionDecision): boolean;
  updateCaptureMode(captureMode: CaptureMode): void;
  updateSendMode(sendMode: SendMode): void;
  updatePromptEffort(promptEffort: PromptEffort): void;
  updateDraftPrompt(text: string): void;
  toggleSpeechForTranscriptEntry(entryId: string, text: string): boolean;
  newChat(): void;
  retryBridge(): void;
  shutdown(): void;
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
  buildContextAttachmentForSelection(input: {
    id: string;
    pageIdentity: Extract<PageIdentity, { status: "ready" }>;
    selectionResult: Extract<PageSelectionCaptureResult, { status: "captured" }>;
    capturedAt: string;
  }): Promise<BuildComposerAttachmentResult>;
};

type PageSelectionServiceLike = {
  start(mode: PageSelectionMode): Promise<PageSelectionCaptureResult>;
  shutdown(): void;
};

type SidePanelControllerOptions = {
  connectNative(application: string): NativeBridgePort;
  createClientSessionId(): string;
  activePageTracker?: ActivePageSource;
  captureService?: CaptureServiceLike;
  pageSelectionService?: PageSelectionServiceLike;
  captureGateway?: CaptureGateway;
  settingsStore?: ControllerSettingsInput;
  speechPlaybackGateway?: TranscriptSpeechPlaybackGateway;
  createSpeechRequestId?: () => string;
  openOptionsPage?: () => void;
  providerId?: ProviderId;
  createContextAttachmentId?: () => string;
};

type ControllerSettingsInput = Pick<SettingsStore, "start" | "getSnapshot" | "whenReady" | "subscribe"> &
  Partial<Pick<SettingsStore, "savePromptEffort">>;
type ControllerSettingsSource = Pick<SettingsStore, "start" | "getSnapshot" | "whenReady" | "subscribe" | "savePromptEffort">;

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
  const settingsStore = createControllerSettingsSource(options.settingsStore);
  const captureService =
    options.captureService ??
    (options.captureGateway
      ? new CaptureService({ gateway: options.captureGateway, settings: settingsStore })
      : createChromeCaptureService(settingsStore));
  const pageSelectionService = options.pageSelectionService ?? createChromePageSelectionService();
  const createContextAttachmentId = options.createContextAttachmentId ?? (() => `attachment-${crypto.randomUUID()}`);
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
  const speechController = new TranscriptSpeechController({
    transport: connection,
    playback: options.speechPlaybackGateway ?? new MediaSourceSpeechPlaybackGateway(),
    settings: settingsSnapshot.transcriptSpeech,
    createRequestId: options.createSpeechRequestId
  });
  let settingsReady = false;
  let pageSelectionState: PageSelectionCaptureState = { status: "idle" };
  let nextPageSelectionStateId = 0;
  urlSessionStore.selectPage(activePageSnapshot);
  let urlSessionSnapshot = urlSessionStore.getSnapshot();
  let speechSnapshot = speechController.getSnapshot();
  let snapshot = createSnapshot(
    bridgeSnapshot,
    activePageSnapshot,
    urlSessionSnapshot,
    settingsSnapshot,
    settingsReady,
    speechSnapshot,
    pageSelectionState
  );
  let snapshotSettingsSnapshot = settingsSnapshot;
  let snapshotSettingsReady = settingsReady;
  let snapshotSpeechSnapshot = speechSnapshot;
  let snapshotPageSelectionState: PageSelectionCaptureState = pageSelectionState;
  let shutdownStarted = false;
  let pendingPromptEffort: PromptEffort | undefined;
  let promptEffortSaveQueue: Promise<void> = Promise.resolve();

  const applySettingsSnapshot = (nextSettingsSnapshot: SidraSettings) => {
    if (pendingPromptEffort && nextSettingsSnapshot.promptEffort !== pendingPromptEffort) {
      settingsSnapshot = { ...nextSettingsSnapshot, promptEffort: pendingPromptEffort };
    } else {
      if (pendingPromptEffort && nextSettingsSnapshot.promptEffort === pendingPromptEffort) {
        pendingPromptEffort = undefined;
      }
      settingsSnapshot = nextSettingsSnapshot;
    }
    speechController.updateSettings(settingsSnapshot.transcriptSpeech);
  };

  const refreshSnapshot = () => {
    const nextBridgeSnapshot = connection.getSnapshot();
    const nextUrlSessionSnapshot = urlSessionStore.getSnapshot();
    const nextSpeechSnapshot = speechController.getSnapshot();
    if (
      nextBridgeSnapshot === bridgeSnapshot &&
      activePageSnapshot === snapshot.activePage &&
      snapshotsMatch(nextUrlSessionSnapshot, urlSessionSnapshot) &&
      settingsSnapshot === snapshotSettingsSnapshot &&
      settingsReady === snapshotSettingsReady &&
      nextSpeechSnapshot === snapshotSpeechSnapshot &&
      pageSelectionState === snapshotPageSelectionState
    ) {
      return;
    }

    bridgeSnapshot = nextBridgeSnapshot;
    urlSessionSnapshot = nextUrlSessionSnapshot;
    speechSnapshot = nextSpeechSnapshot;
    snapshot = createSnapshot(
      bridgeSnapshot,
      activePageSnapshot,
      urlSessionSnapshot,
      settingsSnapshot,
      settingsReady,
      speechSnapshot,
      pageSelectionState
    );
    snapshotSettingsSnapshot = settingsSnapshot;
    snapshotSettingsReady = settingsReady;
    snapshotSpeechSnapshot = speechSnapshot;
    snapshotPageSelectionState = pageSelectionState;
  };

  const emit = () => {
    refreshSnapshot();
    for (const listener of listeners) listener();
  };

  const setPageSelectionState = (state: PageSelectionCaptureState) => {
    pageSelectionState = state;
    emit();
  };

  const unsubscribeConnection = connection.subscribe(() => {
    const connected = connection.getSnapshot().connected;
    const disconnected = bridgeConnected && !connected;
    bridgeConnected = connected;

    if (disconnected) {
      urlSessionStore.markBridgeDisconnected();
      speechController.stopLocalSpeech();
    }

    emit();
  });
  const unsubscribeActivePageTracker = activePageTracker.subscribe(() => {
    const previousActivePageSnapshot = activePageSnapshot;
    activePageSnapshot = activePageTracker.getSnapshot();
    if (!activePageIdentityMatches(previousActivePageSnapshot, activePageSnapshot)) {
      speechController.stopActiveSpeech();
      if (pageSelectionState.status === "selecting") {
        pageSelectionService.shutdown();
        pageSelectionState = { status: "failed", message: "The page changed before selection completed." };
      }
    }
    urlSessionStore.selectPage(activePageSnapshot);
    emit();
  });
  const unsubscribeUrlSessionStore = urlSessionStore.subscribe(emit);
  const unsubscribeSettingsStore = settingsStore.subscribe(() => {
    applySettingsSnapshot(settingsStore.getSnapshot());
    emit();
  });
  const unsubscribeSpeechController = speechController.subscribe(emit);
  connection.connect();
  void settingsStore.start();
  void settingsStore.whenReady().then(() => {
    if (shutdownStarted) return;
    applySettingsSnapshot(settingsStore.getSnapshot());
    settingsReady = true;
    emit();
  });
  void activePageTracker.start();
  bridgeConnected = connection.getSnapshot().connected;
  refreshSnapshot();

  const captureAndSendCommand = async (prompt: string, userPromptDisplay?: UserPromptDisplay) => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) return false;

    refreshSnapshot();
    if (!snapshot.bridge.canUseChat) return false;
    if (activeSessionIsBusy(snapshot.activeSession)) return false;

    const promptEffort = settingsSnapshot.promptEffort;
    const preCaptureMode = snapshot.activeSession.captureMode;
    const preCaptureSendMode = snapshot.activeSession.sendMode;
    const preCaptureAttachmentPageKey = activePageSnapshot.status === "ready" ? activePageSnapshot.pageKey : undefined;
    const preCaptureAttachments = urlSessionStore.listActiveContextAttachments();
    const captureResult = await captureService.captureActivePageDocument();
    if (shutdownStarted) return false;
    if (captureResult.status === "captured") {
      activePageSnapshot = captureResult.pageIdentity;
      urlSessionStore.selectPage(captureResult.pageIdentity, {
        initialCaptureMode: preCaptureMode,
        initialSendMode: preCaptureSendMode
      });
      const capturedSessionMode = urlSessionStore.getSnapshot().activeSession.captureMode;
      const pageContext = await captureService.buildPageContextForCapturedDocument(
        captureResult.capturedDocument,
        capturedSessionMode
      );
      if (shutdownStarted) return false;
      activePageSnapshot = captureResult.pageIdentity;
      urlSessionStore.selectPage(captureResult.pageIdentity);
      const usePreCaptureAttachments =
        preCaptureAttachmentPageKey !== undefined && preCaptureAttachmentPageKey !== captureResult.pageIdentity.pageKey;
      const accepted = usePreCaptureAttachments
        ? urlSessionStore.sendPromptWithExternalContextAttachments({
            prompt: normalizedPrompt,
            pageContext,
            promptEffort,
            attachments: preCaptureAttachments,
            userPromptDisplay
          })
        : urlSessionStore.sendPromptWithContext({
            prompt: normalizedPrompt,
            pageContext,
            promptEffort,
            userPromptDisplay
          });
      if (accepted && preCaptureAttachmentPageKey && usePreCaptureAttachments) {
        urlSessionStore.clearContextAttachmentsForPage(preCaptureAttachmentPageKey);
      }
      emit();
      return accepted;
    }

    activePageSnapshot = captureResult.pageIdentity;
    urlSessionStore.selectPage(captureResult.pageIdentity, { initialSendMode: preCaptureSendMode });
    if (captureResult.pageIdentity.status === "ready") {
      urlSessionStore.updateActiveDraftPrompt(normalizedPrompt);
      urlSessionStore.recordCaptureUnavailable({ message: captureResult.message });
    }
    emit();
    return false;
  };

  const startPageSelectionCommand = async (mode: PageSelectionMode): Promise<boolean> => {
    refreshSnapshot();
    if (shutdownStarted) return false;
    if (activeSessionIsBusy(snapshot.activeSession)) return false;
    if (activePageSnapshot.status !== "ready") {
      setPageSelectionState({ status: "failed", message: "Page selection is unavailable on this page." });
      return false;
    }

    const selectionPage = activePageSnapshot;
    const requestId = `page-selection-${++nextPageSelectionStateId}`;
    setPageSelectionState({ status: "selecting", requestId, mode });

    const result = await pageSelectionService.start(mode);
    if (shutdownStarted) return false;
    if (pageSelectionState.status !== "selecting" || pageSelectionState.requestId !== requestId) return false;

    if (result.status === "unavailable") {
      setPageSelectionState({ status: "failed", message: result.message });
      return false;
    }

    if (!activePageIdentityMatches(selectionPage, activePageSnapshot) || activePageSnapshot.status !== "ready") {
      setPageSelectionState({ status: "failed", message: "The page changed before selection completed." });
      return false;
    }

    const attachmentResult = buildContextAttachmentForSelection({
      captureService,
      result,
      pageIdentity: activePageSnapshot,
      attachmentId: createContextAttachmentId()
    });
    const resolvedAttachmentResult = await attachmentResult;
    if (resolvedAttachmentResult.status === "rejected") {
      setPageSelectionState({ status: "failed", message: resolvedAttachmentResult.message });
      return false;
    }

    if (!urlSessionStore.appendActiveContextAttachment(resolvedAttachmentResult.attachment)) {
      setPageSelectionState({ status: "failed", message: "Remove an attachment before adding another." });
      return false;
    }

    setPageSelectionState({ status: "idle" });
    return true;
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
      if (activeSessionIsBusy(snapshot.activeSession)) return false;
      return urlSessionStore.sendPrompt({ prompt, promptEffort: settingsSnapshot.promptEffort });
    },
    captureAndSend: captureAndSendCommand,
    sendQuickAction: async (actionId) => {
      refreshSnapshot();
      if (activeSessionIsBusy(snapshot.activeSession)) return false;
      const action = settingsSnapshot.quickActions.actions.find((candidate) => candidate.id === actionId);
      const visible = snapshot.activeSession.quickActions.some((candidate) => candidate.id === actionId);
      if (!action || !visible) return false;
      return await captureAndSendCommand(action.prompt, { kind: "quick_action", label: action.label });
    },
    startPageSelection: startPageSelectionCommand,
    cancelPageSelection: () => {
      if (pageSelectionState.status !== "selecting") return false;
      pageSelectionService.shutdown();
      setPageSelectionState({ status: "idle" });
      return true;
    },
    removeContextAttachment: (attachmentId) => urlSessionStore.removeActiveContextAttachment(attachmentId),
    clearContextAttachments: () => urlSessionStore.clearActiveContextAttachments(),
    cancelTurn: () => {
      const cancelled = urlSessionStore.cancelActiveTurn();
      emit();
      return cancelled;
    },
    respondToPermission: (requestId, decision) => {
      const accepted = urlSessionStore.respondToActivePermission(requestId, decision);
      emit();
      return accepted;
    },
    updateCaptureMode: (captureMode) => urlSessionStore.updateActiveCaptureMode(captureMode),
    updateSendMode: (sendMode) => urlSessionStore.updateActiveSendMode(sendMode),
    updatePromptEffort: (promptEffort) => {
      pendingPromptEffort = promptEffort;
      if (settingsSnapshot.promptEffort !== promptEffort) {
        settingsSnapshot = { ...settingsSnapshot, promptEffort };
        emit();
      }
      promptEffortSaveQueue = promptEffortSaveQueue
        .catch(() => undefined)
        .then(() => settingsStore.savePromptEffort(promptEffort))
        .catch(() => undefined);
      void promptEffortSaveQueue;
    },
    updateDraftPrompt: (text) => urlSessionStore.updateActiveDraftPrompt(text),
    toggleSpeechForTranscriptEntry: (entryId, text) => speechController.toggleSpeech({ entryId, text }),
    newChat: () => {
      speechController.stopActiveSpeech();
      urlSessionStore.newChat();
    },
    retryBridge: () => {
      urlSessionStore.markBridgeDisconnected();
      connection.retry();
      emit();
    },
    shutdown: () => {
      if (shutdownStarted) return;
      shutdownStarted = true;
      unsubscribeConnection();
      unsubscribeActivePageTracker();
      unsubscribeUrlSessionStore();
      unsubscribeSettingsStore();
      unsubscribeSpeechController();
      pageSelectionService.shutdown();
      urlSessionStore.clearAllSessions();
      speechController.dispose();
      connection.disconnect();
      emit();
    },
    openSettings: () => options.openOptionsPage?.()
  };
}

function createSnapshot(
  bridge: ReturnType<BridgeConnection["getSnapshot"]>,
  activePage: PageIdentity,
  urlSessions: ReturnType<UrlSessionStore["getSnapshot"]>,
  settings: SidraSettings,
  settingsReady: boolean,
  speech: TranscriptSpeechSnapshot,
  pageSelection: PageSelectionCaptureState
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
    display: {
      accentColor: settings.accentColor,
      promptEffort: settings.promptEffort,
      promptFontSizePx: settings.promptFontSizePx,
      responseFontSizePx: settings.responseFontSizePx
    },
    speech,
    pageSelection,
    activePage,
    activeSession: {
      pageKey: activeSession.pageKey,
      clientSessionId: activeSession.clientSessionId,
      captureMode: activeSession.captureMode,
      sendMode: activeSession.sendMode,
      draftPrompt: activeSession.draftPrompt,
      contextState: activeSession.contextState,
      contextAttachments: activeSession.contextAttachments,
      transcript: activeSession.transcript,
      pendingPromptCount: activeSession.pendingPromptCount,
      sessionStarted: activeSession.sessionStarted,
      starting: activeSession.starting,
      turnInFlight: activeSession.turnInFlight,
      canCancelTurn: activeSession.canCancelTurn,
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

function buildContextAttachmentForSelection(input: {
  captureService: CaptureServiceLike;
  result: Extract<PageSelectionCaptureResult, { status: "captured" }>;
  pageIdentity: Extract<PageIdentity, { status: "ready" }>;
  attachmentId: string;
}): Promise<BuildComposerAttachmentResult> {
  return input.captureService.buildContextAttachmentForSelection({
    id: input.attachmentId,
    pageIdentity: input.pageIdentity,
    selectionResult: input.result,
    capturedAt: new Date().toISOString()
  });
}

function activeSessionIsBusy(input: {
  pendingPromptCount: number;
  turnInFlight: boolean;
}): boolean {
  return input.pendingPromptCount > 0 || input.turnInFlight;
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

function activePageIdentityMatches(first: PageIdentity, second: PageIdentity): boolean {
  if (first.status !== second.status) return false;
  if (first.status === "ready" && second.status === "ready") return first.pageKey === second.pageKey;
  if (first.status === "unsupported" && second.status === "unsupported") {
    return first.reason === second.reason && first.url === second.url;
  }
  return true;
}

function createControllerSettingsSource(settingsStore?: ControllerSettingsInput): ControllerSettingsSource {
  if (!settingsStore) return createDefaultControllerSettingsSource();
  return {
    getSnapshot: settingsStore.getSnapshot.bind(settingsStore),
    start: settingsStore.start.bind(settingsStore),
    whenReady: settingsStore.whenReady.bind(settingsStore),
    subscribe: settingsStore.subscribe.bind(settingsStore),
    savePromptEffort: settingsStore.savePromptEffort?.bind(settingsStore) ?? (async () => undefined)
  };
}

function createDefaultControllerSettingsSource(): ControllerSettingsSource {
  const defaultSettingsSource = createDefaultSettingsSource();
  return {
    getSnapshot: defaultSettingsSource.getSnapshot,
    start: async () => undefined,
    whenReady: defaultSettingsSource.whenReady,
    savePromptEffort: async () => undefined,
    subscribe: () => () => undefined
  };
}

function snapshotsMatch(
  first: ReturnType<UrlSessionStore["getSnapshot"]>,
  second: ReturnType<UrlSessionStore["getSnapshot"]>
): boolean {
  return first.activeSession === second.activeSession && first.sessions === second.sessions;
}
