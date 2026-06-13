import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";
import { BRIDGE_PAYLOAD_TOO_LARGE_CODE } from "@sidra/protocol";
import { runNativeMessagingBridge } from "./native-messaging.js";
import type { AgentProvider, AgentSession } from "./session-manager.js";
import { BRIDGE_HARD_PAYLOAD_BYTE_LIMIT } from "./payload-limit.js";

describe("native messaging dispatch", () => {
  it("dispatches later session messages while an earlier provider stream is still open", async () => {
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
          version: 3,
          clientSessionId: "page-1",
          prompt: "Long prompt"
        }),
        encodeNativeMessage({
          type: "session.send",
          version: 3,
          clientSessionId: "page-2",
          prompt: "Independent prompt"
        })
      ])
    );

    await withTimeout(sawSecondMessage);
    resolveFirstMessage?.();

    expect(handled).toEqual([
      {
        type: "session.send",
        version: 3,
        clientSessionId: "page-1",
        prompt: "Long prompt"
      },
      {
        type: "session.send",
        version: 3,
        clientSessionId: "page-2",
        prompt: "Independent prompt"
      }
    ]);
  });

  it("can process session.cancel while a provider stream is still open", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let cancelDispatched: (() => void) | undefined;
    const sawCancel = new Promise<void>((resolve) => {
      cancelDispatched = resolve;
    });

    runNativeMessagingBridge(input, output, {
      bridge: {
        async handleMessage(message: unknown) {
          if (isMessageOfType(message, "session.send")) {
            await sawCancel;
          }
          if (isMessageOfType(message, "session.cancel")) {
            cancelDispatched?.();
          }
        }
      }
    });

    input.write(
      Buffer.concat([
        encodeNativeMessage({
          type: "session.send",
          version: 3,
          clientSessionId: "page-1",
          prompt: "Long prompt"
        }),
        encodeNativeMessage({
          type: "session.cancel",
          version: 3,
          clientSessionId: "page-1"
        })
      ])
    );

    await withTimeout(sawCancel);
  });

  it("dispatches_permission_respond_while_provider_turn_is_blocked", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let responseDispatched: (() => void) | undefined;
    const sawResponse = new Promise<void>((resolve) => {
      responseDispatched = resolve;
    });

    runNativeMessagingBridge(input, output, {
      bridge: {
        async handleMessage(message: unknown) {
          if (isMessageOfType(message, "session.send")) {
            await sawResponse;
          }
          if (isMessageOfType(message, "permission.respond")) {
            responseDispatched?.();
          }
        }
      }
    });

    input.write(
      Buffer.concat([
        encodeNativeMessage({
          type: "session.send",
          version: 3,
          clientSessionId: "page-1",
          prompt: "Long prompt"
        }),
        encodeNativeMessage({
          type: "permission.respond",
          version: 3,
          clientSessionId: "page-1",
          requestId: "permission-1",
          decision: "allow_once"
        })
      ])
    );

    await withTimeout(sawResponse);
  });

  it("dispatches_other_session_messages_while_permission_is_pending", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let secondSessionDispatched: (() => void) | undefined;
    const sawSecondSession = new Promise<void>((resolve) => {
      secondSessionDispatched = resolve;
    });

    runNativeMessagingBridge(input, output, {
      bridge: {
        async handleMessage(message: unknown) {
          if (isMessageForClientSession(message, "page-1")) {
            await sawSecondSession;
          }
          if (isMessageForClientSession(message, "page-2")) {
            secondSessionDispatched?.();
          }
        }
      }
    });

    input.write(
      Buffer.concat([
        encodeNativeMessage({
          type: "session.send",
          version: 3,
          clientSessionId: "page-1",
          prompt: "Long prompt"
        }),
        encodeNativeMessage({
          type: "session.send",
          version: 3,
          clientSessionId: "page-2",
          prompt: "Independent prompt"
        })
      ])
    );

    await withTimeout(sawSecondSession);
  });

  it("continues to report invalid JSON without crashing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 1);

    runNativeMessagingBridge(input, output);
    input.write(encodeRawNativeMessage("{"));

    await expect(messages).resolves.toEqual([{ type: "bridge.error", version: 3, message: "Invalid JSON", code: "invalid_message" }]);
  });

  it("reports bridge handler rejections without blocking later dispatch", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 1);
    let secondMessageDispatched: (() => void) | undefined;
    const sawSecondMessage = new Promise<void>((resolve) => {
      secondMessageDispatched = resolve;
    });

    runNativeMessagingBridge(input, output, {
      bridge: {
        async handleMessage(message: unknown) {
          if (isMessageForClientSession(message, "page-2")) {
            secondMessageDispatched?.();
            return;
          }
          throw new Error("secret failure detail");
        }
      }
    });
    input.write(
      Buffer.concat([
        encodeNativeMessage({ type: "session.send", version: 3, clientSessionId: "page-1", prompt: "Hello" }),
        encodeNativeMessage({ type: "session.send", version: 3, clientSessionId: "page-2", prompt: "After failure" })
      ])
    );

    await withTimeout(sawSecondMessage);
    expect(await messages).toEqual([{ type: "bridge.error", version: 3, message: "Bridge message failed", code: "internal_error" }]);
  });

  it("reports parser validation errors from framed native messages", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 1);

    runNativeMessagingBridge(input, output);
    input.write(encodeNativeMessage({ type: "session.delete", version: 3, clientSessionId: "page-1" }));

    await expect(messages).resolves.toEqual([{ type: "bridge.error", version: 3, message: "Unknown command", code: "invalid_message" }]);
  });

  it("rejects_oversized_native_message_before_json_parsing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 1);
    const invalidOversizedJson = "{".padEnd(101, "x");

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 100 });
    input.write(encodeRawNativeMessage(invalidOversizedJson));

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 3, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE }
    ]);
  });

  it("continues_after_rejecting_oversized_native_message_frame", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 100 });
    input.write(
      Buffer.concat([
        encodeRawNativeMessage("x".repeat(101)),
        encodeNativeMessage({
          type: "session.delete",
          version: 3,
          clientSessionId: "page-1"
        })
      ])
    );

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 3, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE },
      { type: "bridge.error", version: 3, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("discards_chunked_oversized_native_message_without_buffering_payload", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);
    const oversizedFrame = encodeRawNativeMessage("x".repeat(101));
    const nextFrame = encodeNativeMessage({
      type: "session.delete",
      version: 3,
      clientSessionId: "page-1"
    });

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 100 });
    input.write(oversizedFrame.subarray(0, 10));
    input.write(Buffer.concat([oversizedFrame.subarray(10), nextFrame]));

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 3, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE },
      { type: "bridge.error", version: 3, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("discards_later_oversized_chunks_before_buffering_them_for_parsing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);
    const oversizedFrame = encodeRawNativeMessage("x".repeat(101));
    const nextFrame = encodeNativeMessage({
      type: "session.delete",
      version: 3,
      clientSessionId: "page-1"
    });

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 100 });
    input.write(oversizedFrame.subarray(0, 4));
    input.write(Buffer.concat([oversizedFrame.subarray(4), nextFrame]));

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 3, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE },
      { type: "bridge.error", version: 3, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("rejects_header_plus_oversized_payload_in_one_chunk_without_parsing_payload_bytes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);
    const oversizedFrame = encodeRawNativeMessage("{".repeat(101));
    const nextFrame = encodeNativeMessage({
      type: "session.delete",
      version: 3,
      clientSessionId: "page-1"
    });

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 100 });
    input.write(Buffer.concat([oversizedFrame, nextFrame]));

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 3, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE },
      { type: "bridge.error", version: 3, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("default_native_messaging_bridge_rejects_oversized_frames_with_the_hard_payload_limit", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 1);

    runNativeMessagingBridge(input, output);
    input.write(encodeRawNativeMessage("x".repeat(BRIDGE_HARD_PAYLOAD_BYTE_LIMIT + 1)));

    await expect(messages).resolves.toEqual([
      { type: "bridge.error", version: 3, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE }
    ]);
  });

  it("native_messaging_transport_does_not_emit_startup_readiness", async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    runNativeMessagingBridge(input, output);

    await expect(collectNativeMessagesUntilIdle(output, 20)).resolves.toEqual([]);
  });
});

describe("native messaging connection cleanup", () => {
  it("native_disconnect_closes_all_connection_sessions_once", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const closeConnection = vi.fn(async () => undefined);

    runNativeMessagingBridge(input, output, {
      bridge: {
        async handleMessage() {},
        closeConnection
      }
    });

    input.emit("close");
    input.emit("end");

    expect(closeConnection).toHaveBeenCalledTimes(1);
    expect(closeConnection).toHaveBeenCalledWith("native_disconnect");
  });

  it("native_input_end_closes_all_connection_sessions", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const closeConnection = vi.fn(async () => undefined);

    runNativeMessagingBridge(input, output, {
      bridge: {
        async handleMessage() {},
        closeConnection
      }
    });

    input.emit("end");

    expect(closeConnection).toHaveBeenCalledTimes(1);
  });

  it("native_input_error_closes_all_connection_sessions", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const closeConnection = vi.fn(async () => undefined);

    runNativeMessagingBridge(input, output, {
      bridge: {
        async handleMessage() {},
        closeConnection
      }
    });

    input.emit("error", new Error("stdin failed"));

    expect(closeConnection).toHaveBeenCalledTimes(1);
  });

  it("native_disconnect_during_in_flight_turn_aborts_and_closes_provider_session", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const provider = createNativeRecordingProvider();

    runNativeMessagingBridge(input, output, { provider });
    input.write(
      Buffer.concat([
        encodeNativeMessage({ type: "session.start", version: 3, clientSessionId: "page-1", providerId: "codex" }),
        encodeNativeMessage({ type: "session.send", version: 3, clientSessionId: "page-1", prompt: "Long prompt" })
      ])
    );
    await waitForCondition(() => provider.createdSessions[0]?.sentInputs.length === 1);
    input.emit("close");
    await waitForCondition(() => provider.createdSessions[0]?.closeCount === 1);

    expect(provider.createdSessions[0]?.sendSignals[0]?.aborted).toBe(true);
    expect(provider.createdSessions[0]?.closeCount).toBe(1);
  });

  it("native_heartbeat_timeout_closes_connection_sessions", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const provider = createNativeRecordingProvider();

    runNativeMessagingBridge(input, output, { provider, heartbeatTimeoutMs: 10 });
    input.write(encodeNativeMessage({ type: "session.start", version: 3, clientSessionId: "page-1", providerId: "codex" }));
    await collectNativeMessages(output, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(provider.createdSessions[0]?.closeCount).toBe(1);
  });

  it("native_cleanup_does_not_write_prompt_or_page_content", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const provider = createNativeRecordingProvider();
    const collectedMessages = collectNativeMessagesUntilIdle(output, 20);

    runNativeMessagingBridge(input, output, { provider });
    input.write(
      Buffer.concat([
        encodeNativeMessage({ type: "session.start", version: 3, clientSessionId: "page-1", providerId: "codex" }),
        encodeNativeMessage({
          type: "session.send",
          version: 3,
          clientSessionId: "page-1",
          prompt: "Sensitive prompt",
          pageContext: {
            kind: "readable",
            metadata: { url: "https://example.com/article", capturedAt: "2026-05-10T12:00:00.000Z" },
            text: "Sensitive page content",
            textLength: "Sensitive page content".length,
            extractionMethod: "readability"
          }
        })
      ])
    );
    await provider.createdSessions[0]?.waitForSendCount(1);
    input.emit("close");

    const serialized = JSON.stringify(await collectedMessages);
    expect(serialized).not.toContain("Sensitive prompt");
    expect(serialized).not.toContain("Sensitive page content");
  });

  it("native_disconnect_cleanup_rejection_is_handled", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const closeConnection = vi.fn(async () => {
      throw new Error("cleanup failed");
    });

    runNativeMessagingBridge(input, output, {
      bridge: {
        async handleMessage() {},
        closeConnection
      }
    });

    input.emit("close");
    await Promise.resolve();

    expect(closeConnection).toHaveBeenCalledTimes(1);
  });
});

class NativeRecordingSession implements AgentSession {
  readonly sentInputs: unknown[] = [];
  readonly sendSignals: AbortSignal[] = [];
  closeCount = 0;
  private readonly sendWaiters: Array<() => void> = [];
  private closed = false;

  async *send(input: unknown, signal: AbortSignal) {
    this.sentInputs.push(input);
    this.sendSignals.push(signal);
    this.resolveSendWaiters();
    while (!this.closed) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
  }

  async close() {
    this.closeCount += 1;
    this.closed = true;
  }

  async waitForSendCount(count: number) {
    if (this.sentInputs.length >= count) return;
    await new Promise<void>((resolve) => this.sendWaiters.push(resolve));
  }

  private resolveSendWaiters() {
    while (this.sendWaiters.length > 0) {
      this.sendWaiters.shift()?.();
    }
  }
}

function createNativeRecordingProvider() {
  const createdSessions: NativeRecordingSession[] = [];
  const provider: AgentProvider & { createdSessions: NativeRecordingSession[] } = {
    id: "codex",
    createdSessions,
    async createSession() {
      const session = new NativeRecordingSession();
      createdSessions.push(session);
      return session;
    }
  };
  return provider;
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

function collectNativeMessagesUntilIdle(output: PassThrough, idleMs: number) {
  const messages: unknown[] = [];
  let buffer = Buffer.alloc(0);

  return new Promise<unknown[]>((resolve) => {
    let idleTimer = setTimeout(() => resolve(messages), idleMs);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        output.off("data", onData);
        resolve(messages);
      }, idleMs);
    };

    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 4) {
        const messageLength = buffer.readUInt32LE(0);
        if (buffer.length < messageLength + 4) break;

        const raw = buffer.subarray(4, messageLength + 4).toString("utf8");
        buffer = buffer.subarray(messageLength + 4);
        messages.push(JSON.parse(raw));
      }

      resetIdleTimer();
    };

    output.on("data", onData);
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

function isMessageOfType(message: unknown, type: string) {
  return typeof message === "object" && message !== null && "type" in message && message.type === type;
}

function withTimeout(promise: Promise<void>) {
  return Promise.race([
    promise,
    new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for dispatch")), 1_000);
    })
  ]);
}

async function waitForCondition(condition: () => boolean) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > 1_000) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
