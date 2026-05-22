import {
  PROTOCOL_VERSION,
  type BridgeToExtension,
  type ExtensionToBridge,
  parseExtensionToBridge
} from "@sidra/protocol";
import {
  BRIDGE_HARD_PAYLOAD_BYTE_LIMIT,
  exceedsPayloadByteLimit,
  payloadTooLargeError,
  serializedJsonByteLength
} from "./payload-limit.js";
import {
  BridgeSessionManager,
  type AgentProvider,
  type AgentSendInput,
  type AgentSession,
  type ConnectionCleanupReason
} from "./session-manager.js";

export type BridgeRuntime = {
  emit(message: BridgeToExtension): void;
};

export function createBridge(
  runtime: BridgeRuntime,
  provider: AgentProvider = createMockProvider(),
  options: {
    hardPayloadByteLimit?: number;
    heartbeatTimeoutMs?: number;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
  } = {}
) {
  const sessions = new BridgeSessionManager({ provider, emit: (message) => runtime.emit(message) });
  const hardPayloadByteLimit = options.hardPayloadByteLimit ?? BRIDGE_HARD_PAYLOAD_BYTE_LIMIT;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 30_000;
  const scheduleTimeout = options.setTimeout ?? setTimeout;
  const cancelTimeout = options.clearTimeout ?? clearTimeout;
  let heartbeatTimeout: ReturnType<typeof setTimeout> | undefined;

  scheduleHeartbeatTimeout();

  async function handleMessage(input: unknown): Promise<void> {
    const payloadSize = serializedJsonByteLength(input);
    if (!payloadSize.ok) {
      runtime.emit({ type: "bridge.error", version: PROTOCOL_VERSION, message: "Message must be valid JSON", code: "invalid_message" });
      return;
    }

    if (exceedsPayloadByteLimit(payloadSize.byteLength, hardPayloadByteLimit)) {
      runtime.emit(payloadTooLargeError);
      return;
    }

    const parsed = parseExtensionToBridge(input);
    if (!parsed.ok) {
      runtime.emit({ type: "bridge.error", version: PROTOCOL_VERSION, message: parsed.error, code: "invalid_message" });
      return;
    }

    await handleValidatedMessage(parsed.value);
  }

  async function handleValidatedMessage(message: ExtensionToBridge): Promise<void> {
    switch (message.type) {
      case "session.start":
        await sessions.startSession(message.clientSessionId, message.providerId);
        return;
      case "session.send":
        await sessions.sendPrompt(message.clientSessionId, {
          prompt: message.prompt,
          pageContext: message.pageContext
        });
        return;
      case "session.cancel":
        await sessions.cancelTurn(message.clientSessionId);
        return;
      case "session.reset":
        await sessions.resetSession(message.clientSessionId);
        return;
      case "session.close":
        await sessions.closeSession(message.clientSessionId);
        return;
      case "permission.respond":
        await sessions.respondToPermission(message.clientSessionId, message.requestId, message.decision);
        return;
      case "heartbeat":
        scheduleHeartbeatTimeout();
        return;
    }
  }

  function scheduleHeartbeatTimeout(): void {
    stopHeartbeatTimeout();
    heartbeatTimeout = scheduleTimeout(() => {
      void closeConnection("heartbeat_timeout").catch(() => undefined);
    }, heartbeatTimeoutMs);
  }

  function stopHeartbeatTimeout(): void {
    if (heartbeatTimeout === undefined) return;
    cancelTimeout(heartbeatTimeout);
    heartbeatTimeout = undefined;
  }

  async function closeConnection(reason: ConnectionCleanupReason): Promise<void> {
    stopHeartbeatTimeout();
    await sessions.closeAllSessions(reason);
  }

  return { handleMessage, closeConnection };
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

export { runNativeMessagingBridge } from "./native-messaging.js";
export type { AgentProvider, AgentSendInput, AgentSession };
