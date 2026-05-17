import type { ProviderId } from "@sidra/protocol";
import { createChromeActivePageTracker } from "./active-page";
import { CaptureService, createChromeCaptureService, type CaptureGateway, type CaptureResult } from "./capture-service";
import type { PageIdentity } from "./page-key";
import { BridgeConnection, type BridgeAvailability, type NativeBridgePort } from "./bridge/connection";
import { BridgeSessionCoordinator } from "./bridge/session-coordinator";
import { createChromeSettingsStore, type SettingsStore } from "./settings-store";
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
    draftPrompt: string;
    contextState: ContextState;
    transcript: TranscriptEntry[];
    pendingPromptCount: number;
    sessionStarted: boolean;
    starting: boolean;
  };
};

export type SidePanelController = {
  getSnapshot(): SidePanelSnapshot;
  subscribe(listener: () => void): () => void;
  sendPrompt(prompt: string): boolean;
  captureAndSend(prompt: string): Promise<boolean>;
  updateDraftPrompt(text: string): void;
  newChat(): void;
  retryBridge(): void;
};

type ActivePageSource = {
  getSnapshot(): PageIdentity;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
};

type CaptureServiceLike = {
  captureActivePageContext(): Promise<CaptureResult>;
};

type SidePanelControllerOptions = {
  connectNative(application: string): NativeBridgePort;
  createClientSessionId(): string;
  activePageTracker?: ActivePageSource;
  captureService?: CaptureServiceLike;
  captureGateway?: CaptureGateway;
  settingsStore?: Pick<SettingsStore, "start" | "getSnapshot" | "whenReady">;
  providerId?: ProviderId;
};

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
  const settingsStore = options.settingsStore;
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
  urlSessionStore.selectPage(activePageSnapshot);
  let urlSessionSnapshot = urlSessionStore.getSnapshot();
  let snapshot = createSnapshot(bridgeSnapshot, activePageSnapshot, urlSessionSnapshot);

  const refreshSnapshot = () => {
    const nextBridgeSnapshot = connection.getSnapshot();
    const nextUrlSessionSnapshot = urlSessionStore.getSnapshot();
    if (
      nextBridgeSnapshot === bridgeSnapshot &&
      activePageSnapshot === snapshot.activePage &&
      snapshotsMatch(nextUrlSessionSnapshot, urlSessionSnapshot)
    ) {
      return;
    }

    bridgeSnapshot = nextBridgeSnapshot;
    urlSessionSnapshot = nextUrlSessionSnapshot;
    snapshot = createSnapshot(bridgeSnapshot, activePageSnapshot, urlSessionSnapshot);
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
  connection.connect();
  void settingsStore?.start();
  void activePageTracker.start();
  bridgeConnected = connection.getSnapshot().connected;
  refreshSnapshot();

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
    captureAndSend: async (prompt) => {
      const normalizedPrompt = prompt.trim();
      if (!normalizedPrompt) return false;

      refreshSnapshot();
      if (!snapshot.bridge.canUseChat) return false;

      const captureResult = await captureService.captureActivePageContext();
      if (captureResult.status === "captured") {
        activePageSnapshot = captureResult.pageIdentity;
        urlSessionStore.selectPage(captureResult.pageIdentity);
        const accepted = urlSessionStore.sendPromptWithContext({
          prompt: normalizedPrompt,
          pageContext: captureResult.pageContext
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
    },
    updateDraftPrompt: (text) => urlSessionStore.updateActiveDraftPrompt(text),
    newChat: () => urlSessionStore.newChat(),
    retryBridge: () => connection.retry()
  };
}

function createSnapshot(
  bridge: ReturnType<BridgeConnection["getSnapshot"]>,
  activePage: PageIdentity,
  urlSessions: ReturnType<UrlSessionStore["getSnapshot"]>
): SidePanelSnapshot {
  const activeSession = urlSessions.activeSession;
  return {
    bridge: {
      availability: bridge.availability,
      connected: bridge.connected,
      ready: bridge.ready,
      setupError: bridge.setupError,
      canUseChat: bridge.availability.status === "ready" && activePage.status === "ready"
    },
    activePage,
    activeSession: {
      pageKey: activeSession.pageKey,
      clientSessionId: activeSession.clientSessionId,
      draftPrompt: activeSession.draftPrompt,
      contextState: activeSession.contextState,
      transcript: activeSession.transcript,
      pendingPromptCount: activeSession.pendingPromptCount,
      sessionStarted: activeSession.sessionStarted,
      starting: activeSession.starting
    }
  };
}

export function createChromeSidePanelController(): SidePanelController {
  const settingsStore = createChromeSettingsStore();
  return createSidePanelController({
    connectNative: (hostName) => chrome.runtime.connectNative(hostName),
    createClientSessionId: () => `sidra-${crypto.randomUUID()}`,
    activePageTracker: createChromeActivePageTracker(),
    settingsStore
  });
}

function snapshotsMatch(
  first: ReturnType<UrlSessionStore["getSnapshot"]>,
  second: ReturnType<UrlSessionStore["getSnapshot"]>
): boolean {
  return first.activeSession === second.activeSession && first.sessions === second.sessions;
}
