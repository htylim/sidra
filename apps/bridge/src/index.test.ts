import { describe, expect, it, vi } from "vitest";
import type { BridgeToExtension } from "@sidra/protocol";
import { createBridge, type AgentProvider, type AgentSendInput, type AgentSession } from "./index.js";

describe("createBridge speech dispatch", () => {
  it("bridge_routes_speech_synthesize_to_speech_manager", async () => {
    const speech = {
      synthesize: vi.fn(async () => {}),
      cancel: vi.fn(async () => {}),
      getCredentialStatus: vi.fn(async () => {}),
      saveCredentials: vi.fn(async () => {}),
      testCredentials: vi.fn(async () => {}),
      removeCredentials: vi.fn(async () => {}),
      cancelAll: vi.fn(async () => {})
    };
    const bridge = createBridge(
      { emit: () => {} },
      undefined,
      { speech } as unknown as Parameters<typeof createBridge>[2]
    );

    await bridge.handleMessage({
      type: "speech.synthesize",
      version: 4,
      requestId: "speech-1",
      text: "Read this.",
      options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 1 }
    });

    expect(speech.synthesize).toHaveBeenCalledWith({
      type: "speech.synthesize",
      version: 4,
      requestId: "speech-1",
      text: "Read this.",
      options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 1 }
    });
  });
});

describe("createBridge connection heartbeat cleanup", () => {
  it("routes_session_send_prompt_effort_to_session_manager", async () => {
    const provider = createRecordingProvider();
    const bridge = createBridge({ emit: () => {} }, provider);

    await bridge.handleMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" });
    await bridge.handleMessage({
      type: "session.send",
      version: 4,
      clientSessionId: "page-1",
      prompt: "Use effort",
      promptEffort: "high"
    });

    expect(provider.createdSessions[0]?.sentInputs).toContainEqual(
      expect.objectContaining({ promptEffort: "high" })
    );
  });

  it("default_provider_fails_closed_when_codex_provider_is_not_configured", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) });

    await bridge.handleMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" });

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 4,
      clientSessionId: "page-1",
      message: "Provider is not available",
      code: "provider_unavailable"
    });
  });

  it("heartbeat_extends_connection_deadline_without_closing_sessions", async () => {
    vi.useFakeTimers();
    const provider = createRecordingProvider();
    const bridge = createBridge({ emit: () => {} }, provider, { heartbeatTimeoutMs: 30_000 });

    await bridge.handleMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" });
    vi.advanceTimersByTime(20_000);
    await bridge.handleMessage({ type: "heartbeat", version: 4 });
    vi.advanceTimersByTime(20_000);

    expect(provider.createdSessions[0]?.closeCount).toBe(0);
    vi.useRealTimers();
  });

  it("heartbeat_timeout_closes_all_connection_sessions", async () => {
    vi.useFakeTimers();
    const provider = createRecordingProvider();
    const bridge = createBridge({ emit: () => {} }, provider, { heartbeatTimeoutMs: 30_000 });

    await bridge.handleMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" });
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();

    expect(provider.createdSessions[0]?.closeCount).toBe(1);
    vi.useRealTimers();
  });

  it("heartbeat_timeout_emits_blocking_bridge_error_before_cleanup", async () => {
    vi.useFakeTimers();
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, createRecordingProvider(), {
      heartbeatTimeoutMs: 30_000
    });

    await bridge.handleMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" });
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();

    expect(emitted).toContainEqual({
      type: "bridge.error",
      version: 4,
      message: "Bridge heartbeat timed out. Retry to reconnect.",
      code: "heartbeat_timeout"
    });
    vi.useRealTimers();
  });

  it("message_after_heartbeat_timeout_reports_session_not_started", async () => {
    vi.useFakeTimers();
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, createRecordingProvider(), {
      heartbeatTimeoutMs: 30_000
    });

    await bridge.handleMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" });
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();
    await bridge.handleMessage({ type: "session.send", version: 4, clientSessionId: "page-1", prompt: "After timeout" });

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 4,
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

    await bridge.handleMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" });
    vi.advanceTimersByTime(30_000);
    await Promise.resolve();
    await bridge.handleMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" });

    expect(emitted).toContainEqual({
      type: "session.error",
      version: 4,
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

    await bridge.handleMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" });
    await bridge.handleMessage({
      type: "session.send",
      version: 4,
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

    await bridge.handleMessage({ type: "session.start", version: 4, clientSessionId: "page-1", providerId: "codex" });
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
  readonly sentInputs: AgentSendInput[] = [];
  closeCount = 0;

  async *send(input: AgentSendInput) {
    this.sentInputs.push(input);
    yield { type: "assistant.done" } as const;
  }

  async close() {
    this.closeCount += 1;
  }
}
