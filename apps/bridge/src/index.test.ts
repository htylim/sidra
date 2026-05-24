import { describe, expect, it, vi } from "vitest";
import type { BridgeToExtension } from "@sidra/protocol";
import { createBridge, type AgentProvider, type AgentSession } from "./index.js";

describe("createBridge connection heartbeat cleanup", () => {
  it("default_provider_fails_closed_when_codex_provider_is_not_configured", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) });

    await bridge.handleMessage({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex" });

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Provider is not available",
      code: "provider_unavailable"
    });
  });

  it("heartbeat_extends_connection_deadline_without_closing_sessions", async () => {
    vi.useFakeTimers();
    const provider = createRecordingProvider();
    const bridge = createBridge({ emit: () => {} }, provider, { heartbeatTimeoutMs: 30_000 });

    await bridge.handleMessage({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex" });
    vi.advanceTimersByTime(20_000);
    await bridge.handleMessage({ type: "heartbeat", version: 2 });
    vi.advanceTimersByTime(20_000);

    expect(provider.createdSessions[0]?.closeCount).toBe(0);
    vi.useRealTimers();
  });

  it("heartbeat_timeout_closes_all_connection_sessions", async () => {
    vi.useFakeTimers();
    const provider = createRecordingProvider();
    const bridge = createBridge({ emit: () => {} }, provider, { heartbeatTimeoutMs: 30_000 });

    await bridge.handleMessage({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex" });
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();

    expect(provider.createdSessions[0]?.closeCount).toBe(1);
    vi.useRealTimers();
  });

  it("message_after_heartbeat_timeout_reports_session_not_started", async () => {
    vi.useFakeTimers();
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, createRecordingProvider(), {
      heartbeatTimeoutMs: 30_000
    });

    await bridge.handleMessage({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex" });
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();
    await bridge.handleMessage({ type: "session.send", version: 2, clientSessionId: "page-1", prompt: "After timeout" });

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Session has not been started",
      code: "session_not_started"
    });
    vi.useRealTimers();
  });

  it("session_start_after_heartbeat_timeout_reports_session_not_started", async () => {
    vi.useFakeTimers();
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, createRecordingProvider(), {
      heartbeatTimeoutMs: 30_000
    });

    await bridge.handleMessage({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex" });
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();
    await bridge.handleMessage({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex" });

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Session has not been started",
      code: "session_not_started"
    });
    vi.useRealTimers();
  });

  it("bridge_cleanup_does_not_log_prompt_or_page_content_by_default", async () => {
    vi.useFakeTimers();
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, createRecordingProvider(), {
      heartbeatTimeoutMs: 30_000
    });

    await bridge.handleMessage({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex" });
    await bridge.handleMessage({
      type: "session.send",
      version: 2,
      clientSessionId: "page-1",
      prompt: "Sensitive prompt",
      pageContext: {
        kind: "readable",
        metadata: { url: "https://example.com/article", capturedAt: "2026-05-10T12:00:00.000Z" },
        text: "Sensitive captured page content",
        textLength: "Sensitive captured page content".length,
        extractionMethod: "readability"
      }
    });
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();

    expect(JSON.stringify(emitted)).not.toContain("Sensitive prompt");
    expect(JSON.stringify(emitted)).not.toContain("Sensitive captured page content");
    vi.useRealTimers();
  });

  it("heartbeat_timeout_cleanup_rejection_is_handled", async () => {
    vi.useFakeTimers();
    const bridge = createBridge(
      { emit: () => {} },
      {
        id: "codex",
        async createSession() {
          return {
            async *send() {},
            async close() {
              throw new Error("close failed");
            }
          };
        }
      },
      { heartbeatTimeoutMs: 30_000 }
    );

    await bridge.handleMessage({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex" });
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();

    vi.useRealTimers();
  });
});

function createRecordingProvider() {
  const createdSessions: RecordingSession[] = [];
  const provider: AgentProvider & { createdSessions: RecordingSession[] } = {
    id: "codex",
    createdSessions,
    async createSession() {
      const session = new RecordingSession();
      createdSessions.push(session);
      return session;
    }
  };
  return provider;
}

class RecordingSession implements AgentSession {
  closeCount = 0;

  async *send() {
    yield { type: "assistant.done" } as const;
  }

  async close() {
    this.closeCount += 1;
  }
}
