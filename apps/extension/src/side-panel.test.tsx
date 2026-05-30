// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

const shutdown = vi.fn();

vi.mock("react-dom/client", () => ({
  createRoot: () => ({
    render: () => undefined
  })
}));

vi.mock("./side-panel-view", () => ({
  SidePanelView: () => null
}));

vi.mock("./side-panel-controller", () => ({
  createChromeSidePanelController: () => ({
    getSnapshot: () => ({
      bridge: {
        availability: { status: "checking", message: "Connecting to Sidra bridge..." },
        connected: true,
        ready: false,
        canUseChat: false
      },
      activePage: { status: "unsupported", reason: "missing_url" },
      activeSession: {
        pageKey: "",
        clientSessionId: "",
        captureMode: "readable",
        sendMode: "capture",
        draftPrompt: "",
        contextState: { status: "none", label: "No context sent yet" },
        transcript: [],
        pendingPromptCount: 0,
        sessionStarted: false,
        starting: false,
        turnInFlight: false,
        canCancelTurn: false,
        quickActions: []
      }
    }),
    subscribe: () => () => undefined,
    sendPrompt: () => false,
    captureAndSend: () => Promise.resolve(false),
    sendQuickAction: () => Promise.resolve(false),
    cancelTurn: () => false,
    respondToPermission: () => false,
    updateDraftPrompt: () => undefined,
    updateCaptureMode: () => undefined,
    updateSendMode: () => undefined,
    newChat: () => undefined,
    retryBridge: () => undefined,
    openSettings: () => undefined,
    shutdown
  })
}));

describe("side panel entrypoint shutdown lifecycle", () => {
  afterEach(() => {
    shutdown.mockClear();
    document.body.innerHTML = "";
    vi.resetModules();
  });

  it("side_panel_pagehide_disconnects_bridge_and_clears_url_sessions", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import("./side-panel");

    window.dispatchEvent(new PageTransitionEvent("pagehide"));

    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it("side_panel_beforeunload_disconnects_bridge_and_clears_url_sessions", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import("./side-panel");

    window.dispatchEvent(new Event("beforeunload"));

    expect(shutdown).toHaveBeenCalledTimes(1);
  });
});
