import { useEffect, useState } from "react";
import type { PermissionDecision } from "@sidra/protocol";
import type { CaptureMode } from "./capture-mode";
import { CurrentPageCard } from "./current-page-card";
import { SidraIcon } from "./sidra-icon";
import type { SidePanelSnapshot } from "./side-panel-controller";
import type { SendMode } from "./url-session-store";
import { TranscriptView, type TranscriptClipboardGateway, type TranscriptWaitingState } from "./transcript-view";

type ChatWorkState = "idle" | "queued_startup_prompt" | "turn_running" | "cancel_requested";
type ChatWaitingState = TranscriptWaitingState;

export function SidePanelView(props: {
  snapshot: SidePanelSnapshot;
  onSendPrompt(prompt: string): boolean;
  onCaptureAndSend(prompt: string): boolean | Promise<boolean>;
  onQuickAction(actionId: string): boolean | Promise<boolean>;
  onCancelTurn(): boolean;
  onRespondToPermission(requestId: string, decision: PermissionDecision): boolean;
  onDraftPromptChange(text: string): void;
  onCaptureModeChange(captureMode: CaptureMode): void;
  onSendModeChange(sendMode: SendMode): void;
  onNewChat(): void;
  onRetryBridge(): void;
  onOpenSettings(): void;
  onToggleSpeechForTranscriptEntry(entryId: string, text: string): boolean;
  clipboard?: TranscriptClipboardGateway;
}) {
  const [sendModeMenuOpen, setSendModeMenuOpen] = useState(false);
  const bridgeBlocked = props.snapshot.bridge.availability.status !== "ready";
  const pageUnsupported = props.snapshot.activePage.status === "unsupported";
  const chatUnavailable = !props.snapshot.bridge.canUseChat || pageUnsupported;
  const chatWorkState = getChatWorkState(props.snapshot.activeSession);
  const showCancelButton =
    chatWorkState === "turn_running" || chatWorkState === "cancel_requested";
  const promptEntryDisabled = chatUnavailable || chatWorkState !== "idle";
  const cancelDisabled = chatWorkState !== "turn_running";
  const waitingState = chatUnavailable
    ? { kind: "idle" } satisfies ChatWaitingState
    : getTranscriptWaitingState(props.snapshot.activeSession, chatWorkState);
  const draftPrompt = props.snapshot.activeSession.draftPrompt;
  const sendFullDom = props.snapshot.activeSession.captureMode === "full_dom";
  const sendMode = props.snapshot.activeSession.sendMode;
  const sendActionLabel = sendMode === "capture" ? "Capture + Send" : "Send";

  useEffect(() => {
    if (promptEntryDisabled) {
      setSendModeMenuOpen(false);
    }
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

  function submitPrompt() {
    if (promptEntryDisabled) return;

    const prompt = draftPrompt.trim();
    if (!prompt) return;

    if (sendMode === "capture") {
      void props.onCaptureAndSend(prompt);
      return;
    }

    props.onSendPrompt(prompt);
  }

  function selectSendMode(nextSendMode: SendMode) {
    props.onSendModeChange(nextSendMode);
    setSendModeMenuOpen(false);
  }

  const pageCard = getPageCardDisplay(props.snapshot);

  return (
    <main className="panel">
      <header className="header">
        <div className="brand-mark">S</div>
        <h1>Sidra</h1>
        <button
          type="button"
          className="toolbar-button"
          aria-label="Settings"
          title="Settings"
          onClick={props.onOpenSettings}
        >
          <SidraIcon name="settings" />
        </button>
        <button type="button" className="toolbar-button" aria-label="New chat" title="New chat" onClick={props.onNewChat}>
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
            promptFontSizePx={props.snapshot.display.promptFontSizePx}
            responseFontSizePx={props.snapshot.display.responseFontSizePx}
            waitingState={waitingState}
            speech={props.snapshot.speech}
            onRespondToPermission={props.onRespondToPermission}
            onToggleSpeechForTranscriptEntry={props.onToggleSpeechForTranscriptEntry}
            clipboard={props.clipboard}
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
              submitPrompt();
            }
          }}
        />
        <div className="composer-actions">
          <label className="composer-dom-toggle">
            <input
              type="checkbox"
              checked={sendFullDom}
              disabled={promptEntryDisabled}
              onChange={(event) => {
                if (promptEntryDisabled) return;
                props.onCaptureModeChange(event.currentTarget.checked ? "full_dom" : "readable");
              }}
            />
            <span>Send DOM</span>
          </label>
          {showCancelButton ? (
            <button
              type="button"
              className="send-button cancel-button"
              onClick={props.onCancelTurn}
              disabled={cancelDisabled}
            >
              Cancel
            </button>
          ) : (
            <div className="send-split-button">
              <button
                type="button"
                className="send-button split-main-button"
                onClick={submitPrompt}
                disabled={promptEntryDisabled}
              >
                {sendActionLabel}
              </button>
              <button
                type="button"
                className="send-mode-menu-button"
                aria-label="Choose send mode"
                aria-expanded={sendModeMenuOpen}
                aria-controls="send-mode-menu"
                disabled={promptEntryDisabled}
                onClick={() => {
                  setSendModeMenuOpen((open) => !open);
                }}
              >
                <SidraIcon name="chevron-down" />
              </button>
              {sendModeMenuOpen && !promptEntryDisabled ? (
                <div className="send-mode-menu" id="send-mode-menu" role="group" aria-label="Send mode">
                  <button
                    type="button"
                    className="send-mode-menu-item"
                    aria-pressed={sendMode === "capture"}
                    onClick={() => selectSendMode("capture")}
                  >
                    <SidraIcon name="check" className="send-mode-check" />
                    <span>Capture + Send</span>
                  </button>
                  <button
                    type="button"
                    className="send-mode-menu-item"
                    aria-pressed={sendMode === "send"}
                    onClick={() => selectSendMode("send")}
                  >
                    <SidraIcon name="check" className="send-mode-check" />
                    <span>Send</span>
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </footer>
    </main>
  );
}

function getChatWorkState(session: SidePanelSnapshot["activeSession"]): ChatWorkState {
  if (session.pendingPromptCount > 0) return "queued_startup_prompt";
  if (!session.turnInFlight) return "idle";
  if (!session.canCancelTurn) return "cancel_requested";
  return "turn_running";
}

function getTranscriptWaitingState(
  session: SidePanelSnapshot["activeSession"],
  chatWorkState: ChatWorkState
): ChatWaitingState {
  if (hasPendingPermissionRequest(session.transcript)) return { kind: "idle" };
  if (chatWorkState === "queued_startup_prompt" || chatWorkState === "turn_running") {
    return { kind: "waiting_for_response", label: "Waiting" };
  }
  if (chatWorkState === "cancel_requested") return { kind: "cancelling", label: "Cancelling" };
  return { kind: "idle" };
}

function hasPendingPermissionRequest(sessionTranscript: SidePanelSnapshot["activeSession"]["transcript"]): boolean {
  return sessionTranscript.some((entry) => entry.kind === "permission_request" && entry.status === "pending");
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
