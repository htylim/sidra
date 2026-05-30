// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidePanelView } from "./side-panel-view";

const { mockController, shutdown } = vi.hoisted(() => {
  const shutdownMock = vi.fn();
  const snapshot = {
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
  };

  return {
    shutdown: shutdownMock,
    mockController: {
      getSnapshot: vi.fn(() => snapshot),
      subscribe: vi.fn(() => () => undefined),
      sendPrompt: vi.fn(() => false),
      captureAndSend: vi.fn(() => Promise.resolve(false)),
      sendQuickAction: vi.fn(() => Promise.resolve(false)),
      cancelTurn: vi.fn(() => false),
      respondToPermission: vi.fn(() => false),
      updateDraftPrompt: vi.fn(() => undefined),
      updateCaptureMode: vi.fn(() => undefined),
      newChat: vi.fn(() => undefined),
      retryBridge: vi.fn(() => undefined),
      openSettings: vi.fn(() => undefined),
      shutdown: shutdownMock
    }
  };
});

let capturedSidePanelViewProps: ComponentProps<typeof SidePanelView> | undefined;

vi.mock("./side-panel-view", () => ({
  SidePanelView: (props: ComponentProps<typeof SidePanelView>) => {
    capturedSidePanelViewProps = props;
    return null;
  }
}));

vi.mock("./side-panel-controller", () => ({
  createChromeSidePanelController: () => mockController
}));

describe("side panel entrypoint shutdown lifecycle", () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedSidePanelViewProps = undefined;
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

  it("passes_the_controller_contract_to_the_side_panel_view", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    await import("./side-panel");

    await waitFor(() => expect(capturedSidePanelViewProps).toBeDefined());
    const props = capturedSidePanelViewProps;

    expect(props?.snapshot).toBe(mockController.getSnapshot());
    expect(props?.onSendPrompt).toBe(mockController.sendPrompt);
    expect(props?.onCaptureAndSend).toBe(mockController.captureAndSend);
    expect(props?.onQuickAction).toBe(mockController.sendQuickAction);
    expect(props?.onCancelTurn).toBe(mockController.cancelTurn);
    expect(props?.onRespondToPermission).toBe(mockController.respondToPermission);
    expect(props?.onDraftPromptChange).toBe(mockController.updateDraftPrompt);
    expect(props?.onCaptureModeChange).toBe(mockController.updateCaptureMode);
    expect(props?.onNewChat).toBe(mockController.newChat);
    expect(props?.onRetryBridge).toBe(mockController.retryBridge);
    expect(props?.onOpenSettings).toBe(mockController.openSettings);
  });
});
