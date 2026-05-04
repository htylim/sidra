import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { runNativeMessagingBridge } from "./native-messaging.js";

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
          version: 1,
          clientSessionId: "page-1",
          prompt: "Long prompt"
        }),
        encodeNativeMessage({
          type: "session.send",
          version: 1,
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
        version: 1,
        clientSessionId: "page-1",
        prompt: "Long prompt"
      },
      {
        type: "session.send",
        version: 1,
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
          version: 1,
          clientSessionId: "page-1",
          prompt: "Long prompt"
        }),
        encodeNativeMessage({
          type: "session.cancel",
          version: 1,
          clientSessionId: "page-1"
        })
      ])
    );

    await withTimeout(sawCancel);
  });

  it("continues to report invalid JSON without crashing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const messages = collectNativeMessages(output, 2);

    runNativeMessagingBridge(input, output);
    input.write(encodeRawNativeMessage("{"));

    await expect(messages).resolves.toEqual([
      { type: "bridge.ready", version: 1 },
      { type: "bridge.error", version: 1, message: "Invalid JSON", code: "invalid_message" }
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
