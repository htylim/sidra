import { useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createChromeBridgeSessionClient } from "./bridge/session-client";
import "./styles.css";

const bridgeSessionClient = createChromeBridgeSessionClient();

function SidePanel() {
  const [draft, setDraft] = useState("");
  const bridgeState = useSyncExternalStore(
    bridgeSessionClient.subscribe,
    bridgeSessionClient.getSnapshot
  );

  function sendPrompt() {
    const prompt = draft.trim();
    if (!prompt) return;

    if (bridgeSessionClient.sendPrompt(prompt)) {
      setDraft("");
    }
  }

  return (
    <main className="panel">
      <header className="header">
        <div className="brand-mark">S</div>
        <h1>Sidra</h1>
        <button type="button" className="toolbar-button" aria-label="New chat">
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
        {bridgeState.messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✦</div>
            <h2>Ask anything about this page</h2>
            <p>Use the action below or ask your own question.</p>
            <button type="button" onClick={() => setDraft("Summarize this page")}>
              Summarize this page
            </button>
          </div>
        ) : (
          bridgeState.messages.map((message, index) => (
            <div className={`message ${message.role}`} key={`${message.role}-${index}`}>
              {message.text}
            </div>
          ))
        )}
      </section>

      <footer className="composer">
        <textarea
          value={draft}
          placeholder={bridgeState.connected ? "Ask about this page" : "Ask about this page"}
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

createRoot(document.getElementById("root")!).render(<SidePanel />);
