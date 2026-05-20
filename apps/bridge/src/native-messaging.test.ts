import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { BRIDGE_PAYLOAD_TOO_LARGE_CODE } from "@sidra/protocol";
import { runNativeMessagingBridge } from "./native-messaging.js";
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

    await withTimeout(sawSecondMessage);
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
          version: 2,
          clientSessionId: "page-1",
          prompt: "Long prompt"
        }),
        encodeNativeMessage({
          type: "session.cancel",
          version: 2,
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
          version: 2,
          clientSessionId: "page-1",
          prompt: "Long prompt"
        }),
        encodeNativeMessage({
          type: "permission.respond",
          version: 2,
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

    await withTimeout(sawSecondSession);
  });

  it("continues to report invalid JSON without crashing", async () => {
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

  it("reports parser validation errors from framed native messages", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);

    runNativeMessagingBridge(input, output);
    input.write(encodeNativeMessage({ type: "session.delete", version: 2, clientSessionId: "page-1" }));

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 2 },
      { type: "bridge.error", version: 2, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("rejects_oversized_native_message_before_json_parsing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);
    const invalidOversizedJson = "{".padEnd(101, "x");

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 100 });
    input.write(encodeRawNativeMessage(invalidOversizedJson));

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 2 },
      { type: "bridge.error", version: 2, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE }
    ]);
  });

  it("continues_after_rejecting_oversized_native_message_frame", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 3);

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 100 });
    input.write(
      Buffer.concat([
        encodeRawNativeMessage("x".repeat(101)),
        encodeNativeMessage({
          type: "session.delete",
          version: 2,
          clientSessionId: "page-1"
        })
      ])
    );

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 2 },
      { type: "bridge.error", version: 2, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE },
      { type: "bridge.error", version: 2, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("discards_chunked_oversized_native_message_without_buffering_payload", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 3);
    const oversizedFrame = encodeRawNativeMessage("x".repeat(101));
    const nextFrame = encodeNativeMessage({
      type: "session.delete",
      version: 2,
      clientSessionId: "page-1"
    });

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 100 });
    input.write(oversizedFrame.subarray(0, 10));
    input.write(Buffer.concat([oversizedFrame.subarray(10), nextFrame]));

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 2 },
      { type: "bridge.error", version: 2, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE },
      { type: "bridge.error", version: 2, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("discards_later_oversized_chunks_before_buffering_them_for_parsing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 3);
    const oversizedFrame = encodeRawNativeMessage("x".repeat(101));
    const nextFrame = encodeNativeMessage({
      type: "session.delete",
      version: 2,
      clientSessionId: "page-1"
    });

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 100 });
    input.write(oversizedFrame.subarray(0, 4));
    input.write(Buffer.concat([oversizedFrame.subarray(4), nextFrame]));

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 2 },
      { type: "bridge.error", version: 2, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE },
      { type: "bridge.error", version: 2, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("rejects_header_plus_oversized_payload_in_one_chunk_without_parsing_payload_bytes", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 3);
    const oversizedFrame = encodeRawNativeMessage("{".repeat(101));
    const nextFrame = encodeNativeMessage({
      type: "session.delete",
      version: 2,
      clientSessionId: "page-1"
    });

    runNativeMessagingBridge(input, output, { hardPayloadByteLimit: 100 });
    input.write(Buffer.concat([oversizedFrame, nextFrame]));

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 2 },
      { type: "bridge.error", version: 2, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE },
      { type: "bridge.error", version: 2, message: "Unknown command", code: "invalid_message" }
    ]);
  });

  it("default_native_messaging_bridge_rejects_oversized_frames_with_the_hard_payload_limit", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);

    runNativeMessagingBridge(input, output);
    input.write(encodeRawNativeMessage("x".repeat(BRIDGE_HARD_PAYLOAD_BYTE_LIMIT + 1)));

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 2 },
      { type: "bridge.error", version: 2, message: "Payload is too large.", code: BRIDGE_PAYLOAD_TOO_LARGE_CODE }
    ]);
  });
});

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
