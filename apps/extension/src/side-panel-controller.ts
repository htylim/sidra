import type { ProviderId } from "@sidra/protocol";
import { BridgeConnection, type NativeBridgePort } from "./bridge/connection";
import { BridgeSessionCoordinator } from "./bridge/session-coordinator";
import type { TranscriptEntry } from "./transcript";

export type SidePanelSnapshot = {
  bridge: {
    connected: boolean;
    ready: boolean;
    setupError?: string;
  };
  activeSession: {
    clientSessionId: string;
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
  newChat(): void;
  retryBridge(): void;
};

type SidePanelControllerOptions = {
  connectNative(application: string): NativeBridgePort;
  createClientSessionId(): string;
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
  const coordinator = new BridgeSessionCoordinator({
    clientSessionId: options.createClientSessionId(),
    providerId: options.providerId,
    transport: connection
  });
  const listeners = new Set<() => void>();
  let bridgeConnected = connection.getSnapshot().connected;
  let bridgeSnapshot = connection.getSnapshot();
  let activeSessionSnapshot = coordinator.getSnapshot();
  let snapshot = createSnapshot(bridgeSnapshot, activeSessionSnapshot);

  const refreshSnapshot = () => {
    const nextBridgeSnapshot = connection.getSnapshot();
    const nextActiveSessionSnapshot = coordinator.getSnapshot();
    if (nextBridgeSnapshot === bridgeSnapshot && nextActiveSessionSnapshot === activeSessionSnapshot) return;

    bridgeSnapshot = nextBridgeSnapshot;
    activeSessionSnapshot = nextActiveSessionSnapshot;
    snapshot = createSnapshot(bridgeSnapshot, activeSessionSnapshot);
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
      const activeSession = coordinator.getSnapshot();
      if (
        activeSession.sessionStarted ||
        activeSession.starting ||
        activeSession.pendingPromptCount > 0
      ) {
        coordinator.markBridgeDisconnected();
        return;
      }
    }

    emit();
  });
  coordinator.subscribe(emit);

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
    sendPrompt: (prompt) => coordinator.sendPrompt(prompt),
    newChat: () => coordinator.newChat(),
    retryBridge: () => connection.retry()
  };
}

function createSnapshot(
  bridge: ReturnType<BridgeConnection["getSnapshot"]>,
  activeSession: ReturnType<BridgeSessionCoordinator["getSnapshot"]>
): SidePanelSnapshot {
  return {
    bridge: {
      connected: bridge.connected,
      ready: bridge.ready,
      setupError: bridge.setupError ?? activeSession.lastError
    },
    activeSession: {
      clientSessionId: activeSession.clientSessionId,
      transcript: activeSession.transcript,
      pendingPromptCount: activeSession.pendingPromptCount,
      sessionStarted: activeSession.sessionStarted,
      starting: activeSession.starting
    }
  };
}

export function createChromeSidePanelController(): SidePanelController {
  return createSidePanelController({
    connectNative: (hostName) => chrome.runtime.connectNative(hostName),
    createClientSessionId: () => `sidra-${crypto.randomUUID()}`
  });
}
