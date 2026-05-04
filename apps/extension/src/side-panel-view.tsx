import { useState } from "react";
import type { SidePanelSnapshot } from "./side-panel-controller";

export function SidePanelView(props: {
  snapshot: SidePanelSnapshot;
  onSendPrompt(prompt: string): boolean;
  onNewChat(): void;
  onRetryBridge(): void;
}) {
  const [draft, setDraft] = useState("");

  function sendPrompt() {
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
        {props.snapshot.activeSession.transcript.length === 0 ? (
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
          placeholder={props.snapshot.bridge.connected ? "Ask about this page" : "Ask about this page"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              sendPrompt();
            }
          }}
        />
        <div className="composer-actions">
          <button type="button" className="options-button" aria-label="Prompt options">
            ⚙
          </button>
          <button type="button" className="send-button" onClick={sendPrompt}>
            Capture + Send
          </button>
        </div>
      </footer>
    </main>
  );
}
