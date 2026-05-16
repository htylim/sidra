import type { SidePanelSnapshot } from "./side-panel-controller";

export function SidePanelView(props: {
  snapshot: SidePanelSnapshot;
  onSendPrompt(prompt: string): boolean;
  onCaptureAndSend(prompt: string): boolean | Promise<boolean>;
  onDraftPromptChange(text: string): void;
  onNewChat(): void;
  onRetryBridge(): void;
}) {
  const bridgeBlocked = props.snapshot.bridge.availability.status !== "ready";
  const pageUnsupported = props.snapshot.activePage.status === "unsupported";
  const promptControlsDisabled = !props.snapshot.bridge.canUseChat || pageUnsupported;
  const draftPrompt = props.snapshot.activeSession.draftPrompt;

  function sendPrompt() {
    if (promptControlsDisabled) return;

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
        <button type="button" className="toolbar-button" aria-label="New chat" onClick={props.onNewChat}>
          +
        </button>
      </header>

      <section className="page-card" aria-label="Current page">
        <div className="page-icon">□</div>
        <div className="page-copy">
          <div className="page-title" title={pageCard.title}>
            {pageCard.title}
          </div>
          <div className="page-status">{pageCard.statusLabel}</div>
        </div>
        <div className="chevron">›</div>
      </section>

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
            <div className="empty-icon">✦</div>
            <h2>Ask anything about this page</h2>
            <p>Use the action below or ask your own question.</p>
            <button type="button" onClick={() => props.onDraftPromptChange("Summarize this page")}>
              Summarize this page
            </button>
          </div>
        ) : (
          props.snapshot.activeSession.transcript.map((message, index) => (
            <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
              {message.text}
            </div>
          ))
        )}
      </section>

      <footer className="composer">
        <textarea
          value={draftPrompt}
          placeholder="Ask about this page"
          disabled={promptControlsDisabled}
          onChange={(event) => props.onDraftPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendPrompt();
            }
          }}
        />
        <div className="composer-actions">
          <button type="button" className="options-button" aria-label="Prompt options" disabled={promptControlsDisabled}>
            ⚙
          </button>
          <button type="button" className="send-button" onClick={sendPrompt} disabled={promptControlsDisabled}>
            Capture + Send
          </button>
        </div>
      </footer>
    </main>
  );
}

function getPageCardDisplay(snapshot: SidePanelSnapshot): { title: string; statusLabel: string } {
  if (snapshot.activePage.status === "unsupported") {
    return {
      title: snapshot.activePage.title?.trim() || snapshot.activePage.url || "No active page",
      statusLabel: unsupportedPageLabel(snapshot.activePage.reason)
    };
  }

  return {
    title: snapshot.activePage.displayTitle || snapshot.activePage.url,
    statusLabel: snapshot.activeSession.contextState.label
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
      <div className="setup-icon">!</div>
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
      <div className="setup-icon">!</div>
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
