import { createBridge } from "./index.js";
import type { AgentProvider } from "./session-manager.js";
import { PROTOCOL_VERSION } from "@sidra/protocol";
import { BRIDGE_HARD_PAYLOAD_BYTE_LIMIT, exceedsPayloadByteLimit, payloadTooLargeError } from "./payload-limit.js";

type NativeMessagingBridge = {
  handleMessage(message: unknown): Promise<void>;
  closeConnection?(reason: "native_disconnect"): Promise<void>;
};

type RunNativeMessagingBridgeOptions = {
  bridge?: NativeMessagingBridge;
  provider?: AgentProvider;
  hardPayloadByteLimit?: number;
  heartbeatTimeoutMs?: number;
};

export function runNativeMessagingBridge(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  options: RunNativeMessagingBridgeOptions = {}
) {
  const hardPayloadByteLimit = options.hardPayloadByteLimit ?? BRIDGE_HARD_PAYLOAD_BYTE_LIMIT;
  const bridge =
    options.bridge ??
    createBridge(
      { emit: (message) => writeNativeMessage(output, message) },
      options.provider,
      {
        hardPayloadByteLimit,
        heartbeatTimeoutMs: options.heartbeatTimeoutMs
      }
    );
  let buffer = Buffer.alloc(0);
  let oversizedBytesToDiscard = 0;
  let cleanupStarted = false;

  writeNativeMessage(output, { type: "bridge.ready", version: PROTOCOL_VERSION });

  function enqueueRawMessage(raw: string) {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      writeNativeMessage(output, { type: "bridge.error", version: PROTOCOL_VERSION, message: "Invalid JSON", code: "invalid_message" });
      return;
    }

    void dispatchMessage(message);
  }

  async function dispatchMessage(message: unknown) {
    try {
      await bridge.handleMessage(message);
    } catch {
      writeNativeMessage(output, { type: "bridge.error", version: PROTOCOL_VERSION, message: "Bridge message failed", code: "internal_error" });
    }
  }

  input.on("data", (chunk: Buffer) => {
    let nextChunk = chunk;
    let chunkOffset = 0;

    if (oversizedBytesToDiscard > 0) {
      const bytesToDiscard = Math.min(oversizedBytesToDiscard, nextChunk.length);
      nextChunk = nextChunk.subarray(bytesToDiscard);
      oversizedBytesToDiscard -= bytesToDiscard;
      if (nextChunk.length === 0) return;
    }

    // Chrome Native Messaging frames each JSON message as a 4-byte
    // little-endian byte length followed by the UTF-8 JSON payload.
    while (chunkOffset < nextChunk.length || buffer.length > 0) {
      if (oversizedBytesToDiscard > 0) {
        const bytesToDiscard = Math.min(oversizedBytesToDiscard, nextChunk.length - chunkOffset);
        chunkOffset += bytesToDiscard;
        oversizedBytesToDiscard -= bytesToDiscard;
        if (oversizedBytesToDiscard > 0 || chunkOffset >= nextChunk.length) return;
        continue;
      }

      if (buffer.length < 4) {
        const headerBytesNeeded = 4 - buffer.length;
        const availableHeaderBytes = Math.min(headerBytesNeeded, nextChunk.length - chunkOffset);
        buffer = Buffer.concat([buffer, nextChunk.subarray(chunkOffset, chunkOffset + availableHeaderBytes)]);
        chunkOffset += availableHeaderBytes;
        if (buffer.length < 4) return;
      }

      const messageLength = buffer.readUInt32LE(0);
      if (exceedsPayloadByteLimit(messageLength, hardPayloadByteLimit)) {
        writeNativeMessage(output, payloadTooLargeError);
        buffer = Buffer.alloc(0);
        const payloadBytesInChunk = Math.min(messageLength, nextChunk.length - chunkOffset);
        chunkOffset += payloadBytesInChunk;
        oversizedBytesToDiscard = messageLength - payloadBytesInChunk;
        if (oversizedBytesToDiscard > 0 || chunkOffset >= nextChunk.length) return;
        continue;
      }

      const messageBytesNeeded = messageLength + 4 - buffer.length;
      const availableMessageBytes = Math.min(messageBytesNeeded, nextChunk.length - chunkOffset);
      if (availableMessageBytes > 0) {
        buffer = Buffer.concat([buffer, nextChunk.subarray(chunkOffset, chunkOffset + availableMessageBytes)]);
        chunkOffset += availableMessageBytes;
      }

      if (buffer.length < messageLength + 4) return;

      const raw = buffer.subarray(4, messageLength + 4).toString("utf8");
      buffer = Buffer.alloc(0);
      enqueueRawMessage(raw);
    }
  });

  input.on("end", cleanupNativeConnection);
  input.on("close", cleanupNativeConnection);
  input.on("error", cleanupNativeConnection);

  function cleanupNativeConnection() {
    if (cleanupStarted) return;
    cleanupStarted = true;
    void bridge.closeConnection?.("native_disconnect").catch(() => undefined);
  }
}

export function writeNativeMessage(output: NodeJS.WritableStream, message: unknown) {
  const encoded = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(encoded.length, 0);
  output.write(Buffer.concat([header, encoded]));
}
