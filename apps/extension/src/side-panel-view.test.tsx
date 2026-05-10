import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SidePanelSnapshot } from "./side-panel-controller";
import { SidePanelView } from "./side-panel-view";

function createSnapshot(bridge: SidePanelSnapshot["bridge"]): SidePanelSnapshot {
  return {
    bridge,
    activeSession: {
      clientSessionId: "client-1",
      transcript: [],
      pendingPromptCount: 0,
      sessionStarted: false,
      starting: false
    }
  };
}

function renderSnapshot(bridge: SidePanelSnapshot["bridge"]): string {
  return renderToStaticMarkup(
    <SidePanelView
      snapshot={createSnapshot(bridge)}
      onSendPrompt={() => false}
      onNewChat={() => undefined}
      onRetryBridge={() => undefined}
    />
  );
}

const checkingBridge: SidePanelSnapshot["bridge"] = {
  connected: true,
  ready: false,
  setupError: undefined,
  canUseChat: false,
  availability: { status: "checking", message: "Connecting to Sidra bridge..." }
};

describe("SidePanelView bridge setup", () => {
  it("renders checking setup panel and disables prompt controls", () => {
    const markup = renderSnapshot(checkingBridge);

    expect(markup).toContain("Connecting to Sidra bridge...");
    expect(markup).toContain("<textarea");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("Capture + Send");
  });

  it("renders bridge error panel with retry", () => {
    const markup = renderSnapshot({
      connected: true,
      ready: false,
      setupError: "bridge failed",
      canUseChat: false,
      availability: { status: "error", message: "bridge failed", code: "invalid_message" }
    });

    expect(markup).toContain("Bridge setup needs attention");
    expect(markup).toContain("bridge failed");
    expect(markup).toContain("Retry");
  });

  it("renders unavailable bridge panel with retry", () => {
    const markup = renderSnapshot({
      connected: false,
      ready: false,
      setupError: "Sidra cannot connect to the local bridge.",
      canUseChat: false,
      availability: {
        status: "unavailable",
        message: "Sidra cannot connect to the local bridge."
      }
    });

    expect(markup).toContain("Sidra cannot connect to the local bridge.");
    expect(markup).toContain("Retry");
  });

  it("renders empty chat only when chat is usable", () => {
    const blockedMarkup = renderSnapshot(checkingBridge);
    const readyMarkup = renderSnapshot({
      connected: true,
      ready: true,
      setupError: undefined,
      canUseChat: true,
      availability: { status: "ready" }
    });

    expect(blockedMarkup).not.toContain("Ask anything about this page");
    expect(readyMarkup).toContain("Ask anything about this page");
  });

  it("keeps Retry as the only action in blocked chat state", () => {
    const markup = renderSnapshot({
      connected: false,
      ready: false,
      setupError: "Sidra cannot connect to the local bridge.",
      canUseChat: false,
      availability: {
        status: "unavailable",
        message: "Sidra cannot connect to the local bridge."
      }
    });

    expect(markup).toContain("Retry");
    expect(markup).not.toContain("Summarize this page");
    expect(markup).toContain("disabled=\"\"");
  });
});
