import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import { PROMPT_EFFORT_VALUES, type PermissionDecision, type PromptEffort } from "@sidra/protocol";
import type { CaptureMode } from "./capture-mode";
import { ContextAttachmentList } from "./context-attachment-list";
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
  onPromptEffortChange(promptEffort: PromptEffort): void;
  onNewChat(): void;
  onRetryBridge(): void;
  onOpenSettings(): void;
  onToggleSpeechForTranscriptEntry(entryId: string, text: string): boolean;
  clipboard?: TranscriptClipboardGateway;
}) {
  const [sendModeMenuOpen, setSendModeMenuOpen] = useState(false);
  const [effortMenuOpen, setEffortMenuOpen] = useState(false);
  const [focusedPromptEffort, setFocusedPromptEffort] = useState<PromptEffort>(props.snapshot.display.promptEffort);
  const effortControlRef = useRef<HTMLDivElement>(null);
  const effortTriggerRef = useRef<HTMLButtonElement>(null);
  const effortOptionRefs = useRef<Partial<Record<PromptEffort, HTMLDivElement | null>>>({});
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
  const promptEffort = props.snapshot.display.promptEffort;
  const promptEffortLabelText = promptEffortLabel(promptEffort);
  const promptEffortControlLabel = `Effort: ${promptEffortLabelText}`;
  const activeSelectionMode = props.snapshot.pageSelection.status === "selecting" ? props.snapshot.pageSelection.mode : undefined;
  const selectionGuidance =
    props.snapshot.pageSelection.status === "selecting"
      ? selectionGuidanceText(props.snapshot.pageSelection.mode)
      : undefined;
  const promptEffortMenuId = "prompt-effort-menu";
  const sendActionLabel = sendMode === "capture" ? "Capture + Send" : "Send";
  const composerContextHint = getComposerContextHint(props.snapshot.activeSession);

  useEffect(() => {
    if (promptEntryDisabled) {
      setSendModeMenuOpen(false);
      setEffortMenuOpen(false);
    }
  }, [promptEntryDisabled]);

  useEffect(() => {
    if (!effortMenuOpen) {
      setFocusedPromptEffort(promptEffort);
    }
  }, [effortMenuOpen, promptEffort]);

  useEffect(() => {
    if (!effortMenuOpen) return;
    effortOptionRefs.current[focusedPromptEffort]?.focus();
  }, [effortMenuOpen, focusedPromptEffort]);

  useEffect(() => {
    if (!effortMenuOpen) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (effortControlRef.current?.contains(target)) return;
      setEffortMenuOpen(false);
    };
    const closeOnOutsideFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (effortControlRef.current?.contains(target)) return;
      setEffortMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("focusin", closeOnOutsideFocus);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("focusin", closeOnOutsideFocus);
    };
  }, [effortMenuOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (effortMenuOpen) {
        event.preventDefault();
        setEffortMenuOpen(false);
        effortTriggerRef.current?.focus();
        return;
      }
      if (sendModeMenuOpen) {
        event.preventDefault();
        setSendModeMenuOpen(false);
        return;
      }
      if (selectionActive) {
        event.preventDefault();
        props.onCancelPageSelection?.();
        return;
      }
      if (cancelDisabled) return;
      props.onCancelTurn();
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [cancelDisabled, effortMenuOpen, props.onCancelPageSelection, props.onCancelTurn, selectionActive, sendModeMenuOpen]);

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
    void props.onStartPageSelection?.(mode);
  }

  function handleSelectionToolClick(mode: PageSelectionMode) {
    if (activeSelectionMode === mode) {
      props.onCancelPageSelection?.();
      return;
    }
    if (selectionButtonDisabled(mode)) return;
    setEffortMenuOpen(false);
    startPageSelection(mode);
  }

  function selectionButtonDisabled(mode: PageSelectionMode): boolean {
    if (activeSelectionMode === mode) return false;
    if (selectionActive) return true;
    return selectionToolbarDisabled;
  }

  function openPromptEffortMenu(nextFocusedPromptEffort: PromptEffort = promptEffort) {
    if (promptEntryDisabled) return;
    setFocusedPromptEffort(nextFocusedPromptEffort);
    setSendModeMenuOpen(false);
    setEffortMenuOpen(true);
  }

  function selectPromptEffort(nextPromptEffort: PromptEffort) {
    if (promptEntryDisabled) return;
    props.onPromptEffortChange(nextPromptEffort);
    setFocusedPromptEffort(nextPromptEffort);
    setEffortMenuOpen(false);
    effortTriggerRef.current?.focus();
  }

  function handlePromptEffortTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (promptEntryDisabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      openPromptEffortMenu(promptEffort);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      openPromptEffortMenu(promptEffort);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      openPromptEffortMenu(PROMPT_EFFORT_VALUES[0]);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      openPromptEffortMenu(PROMPT_EFFORT_VALUES[PROMPT_EFFORT_VALUES.length - 1]);
    }
  }

  function handlePromptEffortOptionKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, effort: PromptEffort) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedPromptEffort(getAdjacentPromptEffort(effort, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedPromptEffort(getAdjacentPromptEffort(effort, -1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setFocusedPromptEffort(PROMPT_EFFORT_VALUES[0]);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setFocusedPromptEffort(PROMPT_EFFORT_VALUES[PROMPT_EFFORT_VALUES.length - 1]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setEffortMenuOpen(false);
      effortTriggerRef.current?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPromptEffort(effort);
    }
  }

  const pageCard = getPageCardDisplay(props.snapshot);

  return (
    <main className="panel" style={{ "--sidra-accent": props.snapshot.display.accentColor } as CSSProperties}>
      <header className="header">
        <div className="brand-mark">S</div>
        <h1>Sidra</h1>
        <div className="selection-toolbar" role="group" aria-label="Page attachment tools">
          <button
            type="button"
            className={`toolbar-button selection-tool-button${activeSelectionMode === "text" ? " active" : ""}`}
            aria-label={activeSelectionMode === "text" ? "Selecting text. Click to cancel." : "Select text"}
            aria-pressed={activeSelectionMode === "text"}
            title={activeSelectionMode === "text" ? "Cancel text selection" : "Select text"}
            disabled={selectionButtonDisabled("text")}
            onClick={() => handleSelectionToolClick("text")}
          >
            <SidraIcon name="file-text" />
            <span>{activeSelectionMode === "text" ? "Selecting text" : "Select text"}</span>
          </button>
          <button
            type="button"
            className={`toolbar-button selection-tool-button${activeSelectionMode === "snapshot" ? " active" : ""}`}
            aria-label={activeSelectionMode === "snapshot" ? "Selecting area. Click to cancel." : "Select area"}
            aria-pressed={activeSelectionMode === "snapshot"}
            title={activeSelectionMode === "snapshot" ? "Cancel area selection" : "Select area"}
            disabled={selectionButtonDisabled("snapshot")}
            onClick={() => handleSelectionToolClick("snapshot")}
          >
            <SidraIcon name="image" />
            <span>{activeSelectionMode === "snapshot" ? "Selecting area" : "Select area"}</span>
          </button>
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
            <p>Ask a question or summarize this page.</p>
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
        <div className="composer-input-shell">
          <ComposerAttachmentTray
            attachments={props.snapshot.activeSession.contextAttachments}
            selectionState={props.snapshot.pageSelection}
            clipboard={props.clipboard}
            onRemoveContextAttachment={props.onRemoveContextAttachment}
          />
          {selectionGuidance ? (
            <div className="selection-guidance" role="status">
              {selectionGuidance}
            </div>
          ) : null}
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
        </div>
        <div className="composer-context-hint" role="note">
          <span>{composerContextHint.label}</span>
          {composerContextHint.detail ? <span>{composerContextHint.detail}</span> : null}
        </div>
        <div className="composer-actions">
          <label className="composer-dom-toggle">
            <input
              type="checkbox"
              aria-label="Include full page HTML"
              checked={sendFullDom}
              disabled={promptEntryDisabled}
              onChange={(event) => {
                if (promptEntryDisabled) return;
                props.onCaptureModeChange(event.currentTarget.checked ? "full_dom" : "readable");
              }}
            />
            <span aria-hidden="true">Full DOM</span>
          </label>
          <div className="composer-effort-control" ref={effortControlRef}>
            <button
              ref={effortTriggerRef}
              type="button"
              className="composer-effort-trigger"
              aria-label={`Prompt effort: ${promptEffortLabelText}`}
              aria-haspopup="listbox"
              aria-expanded={effortMenuOpen}
              aria-controls={promptEffortMenuId}
              title="Prompt effort"
              disabled={promptEntryDisabled}
              onClick={() => {
                if (promptEntryDisabled) return;
                if (effortMenuOpen) {
                  setEffortMenuOpen(false);
                  return;
                }
                openPromptEffortMenu(promptEffort);
              }}
              onKeyDown={handlePromptEffortTriggerKeyDown}
            >
              <span>{promptEffortControlLabel}</span>
              <SidraIcon name={effortMenuOpen ? "chevron-up" : "chevron-down"} className="composer-effort-chevron" />
            </button>
            {effortMenuOpen && !promptEntryDisabled ? (
              <div className="composer-effort-menu" id={promptEffortMenuId} role="listbox" aria-label="Prompt effort options">
                {PROMPT_EFFORT_VALUES.map((effort) => {
                  const selected = effort === promptEffort;
                  return (
                    <div
                      key={effort}
                      ref={(element) => {
                        effortOptionRefs.current[effort] = element;
                      }}
                      className="composer-effort-option"
                      role="option"
                      aria-selected={selected}
                      tabIndex={effort === focusedPromptEffort ? 0 : -1}
                      onClick={() => selectPromptEffort(effort)}
                      onKeyDown={(event) => handlePromptEffortOptionKeyDown(event, effort)}
                    >
                      <SidraIcon name="check" className="composer-effort-check" />
                      <span>{promptEffortLabel(effort)}</span>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
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
                  setEffortMenuOpen(false);
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
  clipboard?: TranscriptClipboardGateway;
  onRemoveContextAttachment?: (attachmentId: string) => boolean;
}) {
  const hasAttachments = props.attachments.length > 0;
  const hasSelectionError = props.selectionState.status === "failed";
  const selectionErrorMessage = props.selectionState.status === "failed" ? props.selectionState.message : undefined;
  if (!hasAttachments && !hasSelectionError) return null;

  return (
    <section className="composer-attachment-tray" aria-label="Context attachments">
      {hasSelectionError ? (
        <div className="selection-error" role="alert">
          {selectionErrorMessage}
        </div>
      ) : null}
      {hasAttachments ? (
        <ContextAttachmentList
          attachments={props.attachments}
          clipboard={props.clipboard}
          onRemoveAttachment={props.onRemoveContextAttachment}
        />
      ) : null}
    </section>
  );
}

function promptEffortLabel(promptEffort: PromptEffort): string {
  switch (promptEffort) {
    case "low":
      return "Low";
    case "medium":
      return "Medium";
    case "high":
      return "High";
    case "xhigh":
      return "Extra high";
  }
}

function selectionGuidanceText(mode: PageSelectionMode): string {
  if (mode === "text") return "Select text on the page. Press Esc or click Selecting text to cancel.";
  return "Drag over the page area. Press Esc or click Selecting area to cancel.";
}

function getAdjacentPromptEffort(promptEffort: PromptEffort, offset: number): PromptEffort {
  const currentIndex = PROMPT_EFFORT_VALUES.indexOf(promptEffort);
  const nextIndex = (currentIndex + offset + PROMPT_EFFORT_VALUES.length) % PROMPT_EFFORT_VALUES.length;
  return PROMPT_EFFORT_VALUES[nextIndex];
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

function getComposerContextHint(activeSession: SidePanelSnapshot["activeSession"]): { label: string; detail?: string } {
  if (activeSession.contextAttachments.length > 0) {
    return {
      label: activeSession.sendMode === "capture" ? "Page capture" : "Attachments only"
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
