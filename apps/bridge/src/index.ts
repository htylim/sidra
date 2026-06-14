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
import type { BridgeSpeechManager } from "./speech-synthesis-manager.js";

export type BridgeRuntime = {
  emit(message: BridgeToExtension): void;
};

export function createBridge(
  runtime: BridgeRuntime,
  provider?: AgentProvider,
  options: {
    hardPayloadByteLimit?: number;
    heartbeatTimeoutMs?: number;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
    speech?: BridgeSpeechManager;
  } = {}
) {
  const sessions = new BridgeSessionManager({ provider, emit: (message) => runtime.emit(message) });
  const speech = options.speech;
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
      case "speech.synthesize":
        if (!speech) {
          runtime.emit({
            type: "speech.error",
            version: PROTOCOL_VERSION,
            requestId: message.requestId,
            message: "Speech is unavailable.",
            code: "unknown_error"
          });
          return;
        }
        await speech.synthesize(message);
        return;
      case "speech.cancel":
        if (!speech) {
          runtime.emit({
            type: "speech.error",
            version: PROTOCOL_VERSION,
            requestId: message.requestId,
            message: "Speech is unavailable.",
            code: "unknown_error"
          });
          return;
        }
        await speech.cancel(message);
        return;
      case "speech.credentials.status":
        if (!speech) {
          emitSpeechCredentialUnavailable();
          return;
        }
        await speech.getCredentialStatus();
        return;
      case "speech.credentials.save":
        if (!speech) {
          emitSpeechCredentialUnavailable();
          return;
        }
        await speech.saveCredentials(message);
        return;
      case "speech.credentials.test":
        if (!speech) {
          emitSpeechCredentialUnavailable();
          return;
        }
        await speech.testCredentials(message);
        return;
      case "speech.credentials.remove":
        if (!speech) {
          emitSpeechCredentialUnavailable();
          return;
        }
        await speech.removeCredentials();
        return;
      case "heartbeat":
        scheduleHeartbeatTimeout();
        return;
    }
  }

  function scheduleHeartbeatTimeout(): void {
    stopHeartbeatTimeout();
    heartbeatTimeout = scheduleTimeout(() => {
      runtime.emit({
        type: "bridge.error",
        version: PROTOCOL_VERSION,
        message: "Bridge heartbeat timed out. Retry to reconnect.",
        code: "heartbeat_timeout"
      });
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
    await speech?.cancelAll();
    await sessions.closeAllSessions(reason);
  }

  function emitSpeechCredentialUnavailable(): void {
    runtime.emit({
      type: "speech.credentials.error",
      version: PROTOCOL_VERSION,
      message: "Speech is unavailable.",
      code: "unknown_error"
    });
  }

  return { handleMessage, closeConnection };
}

export { runNativeMessagingBridge } from "./native-messaging.js";
export { SpeechSynthesisManager, OpenAISpeechGateway } from "./speech-synthesis-manager.js";
export { createDefaultSpeechCredentialStore } from "./speech-credential-store.js";
export type { AgentProvider, AgentSendInput, AgentSession };
