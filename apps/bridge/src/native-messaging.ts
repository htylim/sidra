import { createBridge } from "./index.js";

type NativeMessagingBridge = {
  handleMessage(message: unknown): Promise<void>;
};

type RunNativeMessagingBridgeOptions = {
  bridge?: NativeMessagingBridge;
};

export function runNativeMessagingBridge(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  options: RunNativeMessagingBridgeOptions = {}
) {
  const bridge = options.bridge ?? createBridge({ emit: (message) => writeNativeMessage(output, message) });
  let buffer = Buffer.alloc(0);

  writeNativeMessage(output, { type: "bridge.ready", version: 1 });

  function enqueueRawMessage(raw: string) {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      writeNativeMessage(output, { type: "bridge.error", version: 1, message: "Invalid JSON", code: "invalid_message" });
      return;
    }

    void dispatchMessage(message);
  }

  async function dispatchMessage(message: unknown) {
    try {
      await bridge.handleMessage(message);
    } catch {
      writeNativeMessage(output, { type: "bridge.error", version: 1, message: "Bridge message failed", code: "internal_error" });
    }
  }

  input.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 4) {
      const messageLength = buffer.readUInt32LE(0);
      if (buffer.length < messageLength + 4) return;

      const raw = buffer.subarray(4, messageLength + 4).toString("utf8");
      buffer = buffer.subarray(messageLength + 4);
      enqueueRawMessage(raw);
    }
  });
}

export function writeNativeMessage(output: NodeJS.WritableStream, message: unknown) {
  const encoded = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(encoded.length, 0);
  output.write(Buffer.concat([header, encoded]));
}
