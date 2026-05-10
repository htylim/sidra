import { useState } from "react";
import type { SidePanelSnapshot } from "./side-panel-controller";

export function SidePanelView(props: {
  snapshot: SidePanelSnapshot;
  onSendPrompt(prompt: string): boolean;
  onNewChat(): void;
  onRetryBridge(): void;
}) {
  const [draft, setDraft] = useState("");
  const chatBlocked = !props.snapshot.bridge.canUseChat;

  function sendPrompt() {
    if (chatBlocked) return;

    const prompt = draft.trim();
    if (!prompt) return;

    if (props.onSendPrompt(prompt)) {
      setDraft("");
    }
  }

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
          <div className="page-title">Current page</div>
          <div className="page-status">No context sent yet</div>
        </div>
        <div className="chevron">›</div>
      </section>

      <section className="chat" aria-live="polite">
        {chatBlocked ? (
          <BridgeSetupPanel
            availability={props.snapshot.bridge.availability}
            onRetryBridge={props.onRetryBridge}
          />
        ) : props.snapshot.activeSession.transcript.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✦</div>
            <h2>Ask anything about this page</h2>
            <p>Use the action below or ask your own question.</p>
            <button type="button" onClick={() => setDraft("Summarize this page")}>
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
          value={draft}
          placeholder="Ask about this page"
          disabled={chatBlocked}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendPrompt();
            }
          }}
        />
        <div className="composer-actions">
          <button type="button" className="options-button" aria-label="Prompt options" disabled={chatBlocked}>
            ⚙
          </button>
          <button type="button" className="send-button" onClick={sendPrompt} disabled={chatBlocked}>
            Capture + Send
          </button>
        </div>
      </footer>
    </main>
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
