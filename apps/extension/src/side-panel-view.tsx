import { useEffect, useState } from "react";
import type { PermissionDecision } from "@sidra/protocol";
import type { CaptureMode } from "./capture-mode";
import { CurrentPageCard } from "./current-page-card";
import { SidraIcon } from "./sidra-icon";
import type { SidePanelSnapshot } from "./side-panel-controller";
import { TranscriptView } from "./transcript-view";

export function SidePanelView(props: {
  snapshot: SidePanelSnapshot;
  onSendPrompt(prompt: string): boolean;
  onCaptureAndSend(prompt: string): boolean | Promise<boolean>;
  onQuickAction(actionId: string): boolean | Promise<boolean>;
  onCancelTurn(): boolean;
  onRespondToPermission(requestId: string, decision: PermissionDecision): boolean;
  onDraftPromptChange(text: string): void;
  onCaptureModeChange(captureMode: CaptureMode): void;
  onNewChat(): void;
  onRetryBridge(): void;
  onOpenSettings(): void;
}) {
  const [promptOptionsOpen, setPromptOptionsOpen] = useState(false);
  const bridgeBlocked = props.snapshot.bridge.availability.status !== "ready";
  const pageUnsupported = props.snapshot.activePage.status === "unsupported";
  const chatUnavailable = !props.snapshot.bridge.canUseChat || pageUnsupported;
  const turnRunning = props.snapshot.activeSession.turnInFlight;
  const promptEntryDisabled =
    chatUnavailable || turnRunning || props.snapshot.activeSession.pendingPromptCount > 0;
  const cancelDisabled = !props.snapshot.activeSession.canCancelTurn;
  const draftPrompt = props.snapshot.activeSession.draftPrompt;
  const sendFullDom = props.snapshot.activeSession.captureMode === "full_dom";

  useEffect(() => {
    if (promptEntryDisabled) setPromptOptionsOpen(false);
  }, [promptEntryDisabled]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (cancelDisabled) return;
      props.onCancelTurn();
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [cancelDisabled, props.onCancelTurn]);

  function sendPrompt() {
    if (promptEntryDisabled) return;

    const prompt = draftPrompt.trim();
    if (!prompt) return;

    void props.onCaptureAndSend(prompt);
  }

  const pageCard = getPageCardDisplay(props.snapshot);

  return (
    <main className="panel">
      <header className="header">
        <div className="brand-mark">S</div>
        <h1>Sidra</h1>
        <button type="button" className="toolbar-button" aria-label="Settings" onClick={props.onOpenSettings}>
          <SidraIcon name="settings" />
        </button>
        <button type="button" className="toolbar-button" aria-label="New chat" onClick={props.onNewChat}>
          <SidraIcon name="plus" />
        </button>
      </header>

      <CurrentPageCard title={pageCard.title} statusLabel={pageCard.statusLabel} favIconUrl={pageCard.favIconUrl} />

      <section className="chat" aria-live="polite">
        {bridgeBlocked ? (
          <BridgeSetupPanel
            availability={props.snapshot.bridge.availability}
            onRetryBridge={props.onRetryBridge}
          />
        ) : props.snapshot.activePage.status === "unsupported" ? (
          <UnsupportedPagePanel reason={props.snapshot.activePage.reason} />
        ) : props.snapshot.activeSession.transcript.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <SidraIcon name="sparkle" />
            </div>
            <h2>Ask anything about this page</h2>
            <p>Use the actions below or ask your own question.</p>
            {props.snapshot.activeSession.quickActions.length > 0 ? (
              <div className="quick-action-grid" role="group" aria-label="Quick actions">
                {props.snapshot.activeSession.quickActions.map((action) => (
                  <button
                    type="button"
                    className="quick-action-button"
                    key={action.id}
                    disabled={promptEntryDisabled}
                    onClick={() => {
                      if (promptEntryDisabled) return;
                      void props.onQuickAction(action.id);
                    }}
                  >
                    <SidraIcon name="sparkle" className="quick-action-icon" />
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <TranscriptView
            entries={props.snapshot.activeSession.transcript}
            onRespondToPermission={props.onRespondToPermission}
          />
        )}
      </section>

      <footer className="composer">
        <textarea
          value={draftPrompt}
          placeholder="Ask about this page"
          disabled={promptEntryDisabled}
          onChange={(event) => props.onDraftPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendPrompt();
            }
          }}
        />
        <div className="composer-actions">
          <button
            type="button"
            className="options-button"
            aria-label="Prompt options"
            aria-expanded={promptOptionsOpen}
            aria-controls="prompt-options-popover"
            disabled={promptEntryDisabled}
            onClick={() => setPromptOptionsOpen((open) => !open)}
          >
            <SidraIcon name="settings" />
          </button>
          {promptOptionsOpen && !promptEntryDisabled ? (
            <div className="prompt-options-popover" id="prompt-options-popover" role="group" aria-label="Prompt options">
              <label className="prompt-option-toggle">
                <input
                  type="checkbox"
                  checked={sendFullDom}
                  disabled={promptEntryDisabled}
                  onChange={(event) => {
                    if (promptEntryDisabled) return;
                    props.onCaptureModeChange(event.currentTarget.checked ? "full_dom" : "readable");
                  }}
                />
                <span>Send Full DOM</span>
              </label>
            </div>
          ) : null}
          <button
            type="button"
            className={`send-button${turnRunning ? " cancel-button" : ""}`}
            onClick={turnRunning ? props.onCancelTurn : sendPrompt}
            disabled={turnRunning ? cancelDisabled : promptEntryDisabled}
          >
            {turnRunning ? "Cancel" : "Capture + Send"}
          </button>
        </div>
      </footer>
    </main>
  );
}

function getPageCardDisplay(snapshot: SidePanelSnapshot): { title: string; statusLabel: string; favIconUrl?: string } {
  if (snapshot.activePage.status === "unsupported") {
    return {
      title: snapshot.activePage.title?.trim() || snapshot.activePage.url || "No active page",
      statusLabel: unsupportedPageLabel(snapshot.activePage.reason),
      favIconUrl: snapshot.activePage.favIconUrl
    };
  }

  return {
    title: snapshot.activePage.displayTitle || snapshot.activePage.url,
    statusLabel: snapshot.activeSession.contextState.label,
    favIconUrl: snapshot.activePage.favIconUrl
  };
}

function unsupportedPageLabel(reason: Extract<SidePanelSnapshot["activePage"], { status: "unsupported" }>["reason"]): string {
  if (reason === "missing_url") return "No active page URL";
  if (reason === "active_tab_unavailable") return "Active page unavailable";
  return "This page cannot be captured";
}

function UnsupportedPagePanel(props: {
  reason: Extract<SidePanelSnapshot["activePage"], { status: "unsupported" }>["reason"];
}) {
  return (
    <div className="setup-panel unsupported">
      <div className="setup-icon">
        <SidraIcon name="alert" />
      </div>
      <h2>Capture unavailable</h2>
      <p>{unsupportedPageLabel(props.reason)}</p>
    </div>
  );
}

function BridgeSetupPanel(props: {
  availability: SidePanelSnapshot["bridge"]["availability"];
  onRetryBridge(): void;
}) {
  const retryable =
    props.availability.status === "unavailable" || props.availability.status === "error";
  const heading =
    props.availability.status === "error" ? "Bridge setup needs attention" : "Sidra bridge setup";
  const message = props.availability.status === "ready" ? "" : props.availability.message;

  return (
    <div className={`setup-panel ${props.availability.status}`}>
      <div className="setup-icon">
        <SidraIcon name="alert" />
      </div>
      <h2>{heading}</h2>
      <p>{message}</p>
      {retryable ? (
        <button type="button" className="retry-button" onClick={props.onRetryBridge}>
          Retry
        </button>
      ) : null}
    </div>
  );
}
