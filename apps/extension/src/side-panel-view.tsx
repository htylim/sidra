import { type CSSProperties, useEffect, useState } from "react";
import type { PermissionDecision } from "@sidra/protocol";
import type { CaptureMode } from "./capture-mode";
import { CurrentPageCard } from "./current-page-card";
import type { PageSelectionMode } from "./page-selection-service";
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
  onStartPageSelection?(mode: PageSelectionMode): boolean | Promise<boolean>;
  onCancelPageSelection?(): boolean;
  onRemoveContextAttachment?(attachmentId: string): boolean;
  onClearContextAttachments?(): boolean;
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
  const [selectionMenuOpen, setSelectionMenuOpen] = useState(false);
  const bridgeBlocked = props.snapshot.bridge.availability.status !== "ready";
  const pageUnsupported = props.snapshot.activePage.status === "unsupported";
  const chatUnavailable = !props.snapshot.bridge.canUseChat || pageUnsupported;
  const chatWorkState = getChatWorkState(props.snapshot.activeSession);
  const selectionActive = props.snapshot.pageSelection.status === "selecting";
  const showCancelButton =
    chatWorkState === "turn_running" || chatWorkState === "cancel_requested";
  const promptEntryDisabled = chatUnavailable || chatWorkState !== "idle" || selectionActive;
  const selectionToolbarDisabled = !selectionActive && (pageUnsupported || chatWorkState !== "idle");
  const cancelDisabled = chatWorkState !== "turn_running";
  const waitingState = chatUnavailable
    ? { kind: "idle" } satisfies ChatWaitingState
    : getTranscriptWaitingState(props.snapshot.activeSession, chatWorkState);
  const draftPrompt = props.snapshot.activeSession.draftPrompt;
  const sendFullDom = props.snapshot.activeSession.captureMode === "full_dom";
  const sendMode = props.snapshot.activeSession.sendMode;
  const sendActionLabel = sendMode === "capture" ? "Capture + Send" : "Send";
  const composerContextHint = getComposerContextHint(props.snapshot.activeSession);

  useEffect(() => {
    if (promptEntryDisabled) {
      setSendModeMenuOpen(false);
    }
  }, [promptEntryDisabled]);

  useEffect(() => {
    if (selectionToolbarDisabled || selectionActive) {
      setSelectionMenuOpen(false);
    }
  }, [selectionToolbarDisabled, selectionActive]);

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

  function startPageSelection(mode: PageSelectionMode) {
    setSelectionMenuOpen(false);
    void props.onStartPageSelection?.(mode);
  }

  function toggleSelectionMenu() {
    if (selectionToolbarDisabled) return;
    if (selectionActive) {
      props.onCancelPageSelection?.();
      return;
    }
    setSelectionMenuOpen((open) => !open);
  }

  const pageCard = getPageCardDisplay(props.snapshot);

  return (
    <main className="panel" style={{ "--sidra-accent": props.snapshot.display.accentColor } as CSSProperties}>
      <header className="header">
        <div className="brand-mark">S</div>
        <h1>Sidra</h1>
        <div className="selection-toolbar">
          <button
            type="button"
            className={`toolbar-button selection-toolbar-button${selectionActive ? " active" : ""}`}
            aria-label="Select page context"
            aria-pressed={selectionActive}
            aria-expanded={selectionMenuOpen}
            aria-controls="page-selection-mode-menu"
            title="Select page context"
            disabled={selectionToolbarDisabled}
            onClick={toggleSelectionMenu}
          >
            <SidraIcon name="scan-text" />
            {selectionActive ? <span>Selecting</span> : null}
          </button>
          {selectionMenuOpen ? (
            <div className="selection-mode-menu" id="page-selection-mode-menu" role="group" aria-label="Page selection mode">
              <button type="button" onClick={() => startPageSelection("text")}>
                <SidraIcon name="file-text" />
                <span>Text</span>
              </button>
              <button type="button" onClick={() => startPageSelection("snapshot")}>
                <SidraIcon name="image" />
                <span>Snapshot</span>
              </button>
            </div>
          ) : null}
        </div>
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
        <ComposerAttachmentTray
          attachments={props.snapshot.activeSession.contextAttachments}
          selectionState={props.snapshot.pageSelection}
          onRemoveContextAttachment={props.onRemoveContextAttachment}
          onClearContextAttachments={props.onClearContextAttachments}
        />
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
        <div className="composer-context-hint" role="note">
          <span>{composerContextHint.label}</span>
          <span>{composerContextHint.detail}</span>
        </div>
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
            <span>Include full page HTML</span>
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

function ComposerAttachmentTray(props: {
  attachments: SidePanelSnapshot["activeSession"]["contextAttachments"];
  selectionState: SidePanelSnapshot["pageSelection"];
  onRemoveContextAttachment?: (attachmentId: string) => boolean;
  onClearContextAttachments?: () => boolean;
}) {
  const hasAttachments = props.attachments.length > 0;
  const hasSelectionError = props.selectionState.status === "failed";
  const selectionErrorMessage = props.selectionState.status === "failed" ? props.selectionState.message : undefined;
  if (!hasAttachments && !hasSelectionError) return null;

  return (
    <section className="composer-attachment-tray" aria-label="Context attachments">
      <div className="attachment-tray-header">
        <span>Context attachments</span>
        {hasAttachments ? (
          <button type="button" className="attachment-clear-button" onClick={() => props.onClearContextAttachments?.()}>
            Clear all
          </button>
        ) : null}
      </div>
      {hasSelectionError ? (
        <div className="selection-error" role="alert">
          {selectionErrorMessage}
        </div>
      ) : null}
      {hasAttachments ? (
        <div className="attachment-list">
          {props.attachments.map((attachment) => (
            <div
              className={`attachment-row${attachment.tone === "warning" ? " warning" : ""}`}
              key={attachment.id}
            >
              <div className="attachment-icon">
                {attachment.source === "area_snapshot" && attachment.thumbnailDataUrl ? (
                  <img src={attachment.thumbnailDataUrl} alt="Area snapshot thumbnail" />
                ) : (
                  <SidraIcon name={attachment.source === "area_snapshot" ? "image" : "file-text"} />
                )}
              </div>
              <div className="attachment-copy">
                <div className="attachment-title-row">
                  <span className="attachment-title">{attachment.label}</span>
                  <span className="attachment-source">{attachmentSourceText(attachment)}</span>
                </div>
                <div className="attachment-preview">{attachmentPreviewText(attachment)}</div>
              </div>
              <button
                type="button"
                className="attachment-remove-button"
                aria-label={`Remove ${attachment.label} attachment`}
                onClick={() => props.onRemoveContextAttachment?.(attachment.id)}
              >
                <SidraIcon name="x" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </section>
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

function getComposerContextHint(activeSession: SidePanelSnapshot["activeSession"]): { label: string; detail: string } {
  if (activeSession.contextAttachments.length > 0) {
    const count = activeSession.contextAttachments.length;
    return {
      label: "Context attachments",
      detail:
        activeSession.sendMode === "capture"
          ? `${count} ${count === 1 ? "attachment" : "attachments"} will be sent with the page capture.`
          : `${count} ${count === 1 ? "attachment" : "attachments"} will be sent.`
    };
  }

  if (activeSession.sendMode === "send") {
    return {
      label: activeSession.contextState.label,
      detail: "Send uses the conversation only. Choose Capture + Send to attach current page text."
    };
  }

  if (activeSession.captureMode === "full_dom") {
    return {
      label: activeSession.contextState.label,
      detail: "Capture + Send will include full page HTML."
    };
  }

  return {
    label: activeSession.contextState.label,
    detail: "Capture + Send will include readable page text."
  };
}

function attachmentSourceText(
  attachment: SidePanelSnapshot["activeSession"]["contextAttachments"][number]
): string {
  const pageTitle = attachment.pageTitle?.trim();
  if (pageTitle) return pageTitle;
  try {
    return new URL(attachment.url).hostname;
  } catch {
    return attachment.url;
  }
}

function attachmentPreviewText(
  attachment: SidePanelSnapshot["activeSession"]["contextAttachments"][number]
): string {
  if (attachment.source === "area_snapshot" && attachment.imageDimensions) {
    return `${attachment.preview}, ${attachment.imageDimensions.width} x ${attachment.imageDimensions.height}`;
  }
  return attachment.preview;
}

function getPageCardDisplay(snapshot: SidePanelSnapshot): { title: string; statusLabel?: string; favIconUrl?: string } {
  if (snapshot.activePage.status === "unsupported") {
    return {
      title: snapshot.activePage.title?.trim() || snapshot.activePage.url || "No active page",
      statusLabel: unsupportedPageLabel(snapshot.activePage.reason),
      favIconUrl: snapshot.activePage.favIconUrl
    };
  }

  return {
    title: snapshot.activePage.displayTitle || snapshot.activePage.url,
    statusLabel:
      snapshot.activeSession.contextState.status === "capture_unavailable"
        ? snapshot.activeSession.contextState.label
        : undefined,
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
