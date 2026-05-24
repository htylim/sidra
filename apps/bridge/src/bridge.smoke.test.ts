import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { BRIDGE_PAYLOAD_TOO_LARGE_CODE, type BridgeToExtension } from "@sidra/protocol";
import { createBridge, type AgentProvider, type AgentSendInput, type AgentSession } from "./index.js";
import { runNativeMessagingBridge } from "./native-messaging.js";
import { BRIDGE_HARD_PAYLOAD_BYTE_LIMIT } from "./payload-limit.js";

describe("mock bridge chat path", () => {
  it("starts a session and emits a mock assistant response for a prompt", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, createMockProvider());

    await bridge.handleMessage({
      type: "session.start",
      version: 2,
      clientSessionId: "page-1",
      providerId: "codex"
    });

    await bridge.handleMessage({
      type: "session.send",
      version: 2,
      clientSessionId: "page-1",
      prompt: "Summarize this page"
    });

    expect(emitted).toEqual([
      {
        type: "session.started",
        version: 2,
        clientSessionId: "page-1",
        bridgeSessionId: expect.any(String)
      },
      {
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.text.delta", text: "Mock response to: Summarize this page" }
      },
      {
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.done" }
      }
    ]);
  });

  it("processes back-to-back native messages in frame order", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 4);

    runNativeMessagingBridge(input, output, { provider: createMockProvider() });
    input.write(
      Buffer.concat([
        encodeNativeMessage({
          type: "session.start",
          version: 2,
          clientSessionId: "page-1",
          providerId: "codex"
        }),
        encodeNativeMessage({
          type: "session.send",
          version: 2,
          clientSessionId: "page-1",
          prompt: "Summarize this page"
        })
      ])
    );

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 2 },
      {
        type: "session.started",
        version: 2,
        clientSessionId: "page-1",
        bridgeSessionId: expect.any(String)
      },
      {
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.text.delta", text: "Mock response to: Summarize this page" }
      },
      {
        type: "agent.event",
        version: 2,
        clientSessionId: "page-1",
        event: { type: "assistant.done" }
      }
    ]);
  });

  it("reports invalid native-message JSON without crashing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);

    runNativeMessagingBridge(input, output);
    input.write(encodeRawNativeMessage("{"));

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 2 },
      { type: "bridge.error", version: 2, message: "Invalid JSON", code: "invalid_message" }
    ]);
  });

  it("emits invalid_message bridge.error for unknown extension commands", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, createMockProvider());

    await bridge.handleMessage({ type: "session.delete", version: 2, clientSessionId: "page-1" });

    expect(emitted).toEqual([
      { type: "bridge.error", version: 2, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("emits invalid_message bridge.error for malformed session.start", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) });

    await bridge.handleMessage({ type: "session.start", version: 2, clientSessionId: "page-1" });

    expect(emitted).toEqual([
      {
        type: "bridge.error",
        version: 2,
        message: "providerId must be codex",
        code: "invalid_message"
      }
    ]);
  });

  it("emits_invalid_message_bridge_error_for_non_json_serializable_direct_input", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) });
    const circularInput: Record<string, unknown> = { type: "session.send" };
    circularInput.self = circularInput;

    await bridge.handleMessage(circularInput);
    await bridge.handleMessage(undefined);
    await bridge.handleMessage(1n);

    expect(emitted).toEqual([
      { type: "bridge.error", version: 2, message: "Message must be valid JSON", code: "invalid_message" },
      { type: "bridge.error", version: 2, message: "Message must be valid JSON", code: "invalid_message" },
      { type: "bridge.error", version: 2, message: "Message must be valid JSON", code: "invalid_message" }
    ]);
  });

  it("rejects_oversized_direct_bridge_payload_with_payload_too_large_error", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, undefined, { hardPayloadByteLimit: 100 });

    await bridge.handleMessage({
      type: "session.send",
      version: 2,
      clientSessionId: "page-1",
      prompt: "x".repeat(200)
    });

    expect(emitted).toEqual([
      {
        type: "bridge.error",
        version: 2,
        message: "Payload is too large.",
        code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
      }
    ]);
  });

  it("oversized_direct_bridge_payload_error_does_not_echo_prompt_or_page_content", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, undefined, { hardPayloadByteLimit: 100 });

    await bridge.handleMessage({
      type: "session.send",
      version: 2,
      clientSessionId: "page-1",
      prompt: "Sensitive prompt text",
      pageContext: {
        kind: "readable",
        metadata: {
          url: "https://example.com/article",
          capturedAt: "2026-05-10T12:00:00.000Z"
        },
        text: "Sensitive captured page content",
        textLength: "Sensitive captured page content".length,
        extractionMethod: "readability"
      }
    });

    expect(JSON.stringify(emitted)).not.toContain("Sensitive prompt text");
    expect(JSON.stringify(emitted)).not.toContain("Sensitive captured page content");
    expect(emitted).toContainEqual(
      expect.objectContaining({ type: "bridge.error", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE })
    );
  });

  it("default_bridge_rejects_oversized_payload_with_the_hard_payload_limit", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) });

    await bridge.handleMessage({
      type: "session.send",
      version: 2,
      clientSessionId: "page-1",
      prompt: "x".repeat(BRIDGE_HARD_PAYLOAD_BYTE_LIMIT)
    });

    expect(emitted).toEqual([
      {
        type: "bridge.error",
        version: 2,
        message: "Payload is too large.",
        code: BRIDGE_PAYLOAD_TOO_LARGE_CODE
      }
    ]);
  });

  it("native_messaging_custom_limit_is_used_by_default_inner_bridge", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 2_000_000 });
    input.write(
      encodeNativeMessage({
        type: "session.send",
        version: 2,
        clientSessionId: "page-1",
        prompt: "x".repeat(BRIDGE_HARD_PAYLOAD_BYTE_LIMIT + 1)
      })
    );

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 2 },
      {
        type: "session.error",
        version: 2,
        clientSessionId: "page-1",
        message: "Session has not been started",
        code: "session_not_started"
      }
    ]);
  });

  it("mock_provider_response_does_not_echo_captured_page_context", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, createMockProvider());

    await bridge.handleMessage({
      type: "session.start",
      version: 2,
      clientSessionId: "page-1",
      providerId: "codex"
    });
    await bridge.handleMessage({
      type: "session.send",
      version: 2,
      clientSessionId: "page-1",
      prompt: "Summarize this page",
      pageContext: {
        kind: "readable",
        metadata: {
          url: "https://example.com/article",
          title: "Example article",
          capturedAt: "2026-05-10T12:00:00.000Z"
        },
        text: "Sensitive captured page text",
        textLength: "Sensitive captured page text".length,
        extractionMethod: "readability"
      }
    });

    expect(emitted).toContainEqual({
      type: "agent.event",
      version: 2,
      clientSessionId: "page-1",
      event: { type: "assistant.text.delta", text: "Mock response received." }
    });
    expect(JSON.stringify(emitted)).not.toContain("Sensitive captured page text");
  });

  it("dispatches reset and close lifecycle commands to provider sessions", async () => {
    const emitted: BridgeToExtension[] = [];
    const provider = createRecordingProvider();
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, provider);

    await bridge.handleMessage({
      type: "session.start",
      version: 2,
      clientSessionId: "page-1",
      providerId: "codex"
    });
    await bridge.handleMessage({
      type: "session.reset",
      version: 2,
      clientSessionId: "page-1"
    });
    await bridge.handleMessage({
      type: "session.close",
      version: 2,
      clientSessionId: "page-1"
    });
    await bridge.handleMessage({
      type: "session.send",
      version: 2,
      clientSessionId: "page-1",
      prompt: "After close"
    });

    expect(provider.createdSessions).toHaveLength(2);
    expect(provider.createdSessions[0]?.closeCount).toBe(1);
    expect(provider.createdSessions[1]?.closeCount).toBe(1);
    expect(emitted).toContainEqual({
      type: "session.error",
      version: 2,
      clientSessionId: "page-1",
      message: "Session has not been started",
      code: "session_not_started"
    });
  });

  it("bridge_smoke_cleans_up_session_on_session_close", async () => {
    const provider = createRecordingProvider();
    const bridge = createBridge({ emit: () => {} }, provider);

    await bridge.handleMessage({ type: "session.start", version: 2, clientSessionId: "page-1", providerId: "codex" });
    await bridge.handleMessage({ type: "session.close", version: 2, clientSessionId: "page-1" });

    expect(provider.createdSessions[0]?.closeCount).toBe(1);
  });

  it("bridge_smoke_accepts_heartbeat_without_user_visible_output", async () => {
    const emitted: BridgeToExtension[] = [];
    const bridge = createBridge({ emit: (message) => emitted.push(message) }, createRecordingProvider());

    await bridge.handleMessage({ type: "heartbeat", version: 2 });

    expect(emitted).toEqual([]);
  });

  it("dispatches a later client session while an earlier session is still pending", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const handled: unknown[] = [];
    let resolveFirstMessage: (() => void) | undefined;
    let secondMessageDispatched: (() => void) | undefined;
    const sawSecondMessage = new Promise<void>((resolve) => {
      secondMessageDispatched = resolve;
    });

    runNativeMessagingBridge(input, output, {
      bridge: {
        async handleMessage(message: unknown) {
          handled.push(message);
          if (isMessageForClientSession(message, "page-1")) {
            await new Promise<void>((resolve) => {
              resolveFirstMessage = resolve;
            });
            return;
          }
          if (isMessageForClientSession(message, "page-2")) {
            secondMessageDispatched?.();
          }
        }
      }
    });

    input.write(
      Buffer.concat([
        encodeNativeMessage({
          type: "session.send",
          version: 2,
          clientSessionId: "page-1",
          prompt: "Long prompt"
        }),
        encodeNativeMessage({
          type: "session.send",
          version: 2,
          clientSessionId: "page-2",
          prompt: "Independent prompt"
        })
      ])
    );

    await sawSecondMessage;
    resolveFirstMessage?.();

    expect(handled).toEqual([
      {
        type: "session.send",
        version: 2,
        clientSessionId: "page-1",
        prompt: "Long prompt"
      },
      {
        type: "session.send",
        version: 2,
        clientSessionId: "page-2",
        prompt: "Independent prompt"
      }
    ]);
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

function createMockProvider(): AgentProvider {
  return {
    id: "codex",
    async createSession() {
      return {
        async *send(input: AgentSendInput) {
          const text = input.prompt.includes("Untrusted page context JSON:")
            ? "Mock response received."
            : `Mock response to: ${input.prompt}`;
          yield { type: "assistant.text.delta", text };
          yield { type: "assistant.done" };
        },
        async close() {}
      };
    }
  };
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

function encodeNativeMessage(message: unknown) {
  return encodeRawNativeMessage(JSON.stringify(message));
}

function encodeRawNativeMessage(raw: string) {
  const encoded = Buffer.from(raw, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(encoded.length, 0);
  return Buffer.concat([header, encoded]);
}

function collectNativeMessages(output: PassThrough, expectedCount: number) {
  const messages: unknown[] = [];
  let buffer = Buffer.alloc(0);

  return new Promise<unknown[]>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${expectedCount} native messages`)), 1_000);

    output.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4) {
        const messageLength = buffer.readUInt32LE(0);
        if (buffer.length < messageLength + 4) return;

        const raw = buffer.subarray(4, messageLength + 4).toString("utf8");
        buffer = buffer.subarray(messageLength + 4);
        messages.push(JSON.parse(raw));

        if (messages.length === expectedCount) {
          clearTimeout(timeout);
          resolve(messages);
          return;
        }
      }
    });
  });
}

function isMessageForClientSession(message: unknown, clientSessionId: string) {
  return (
    typeof message === "object" &&
    message !== null &&
    "clientSessionId" in message &&
    message.clientSessionId === clientSessionId
  );
}
