import {
  type BridgeToExtension,
  type ExtensionToBridge,
  parseExtensionToBridge
} from "@sidra/protocol";
import { BridgeSessionManager, type AgentProvider, type AgentSendInput, type AgentSession } from "./session-manager.js";

export type BridgeRuntime = {
  emit(message: BridgeToExtension): void;
};

export function createBridge(runtime: BridgeRuntime, provider: AgentProvider = createMockProvider()) {
  const sessions = new BridgeSessionManager({ provider, emit: (message) => runtime.emit(message) });

  async function handleMessage(input: unknown): Promise<void> {
    const parsed = parseExtensionToBridge(input);
    if (!parsed.ok) {
      runtime.emit({ type: "bridge.error", version: 1, message: parsed.error, code: "invalid_message" });
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
      case "heartbeat":
        return;
    }
  }

  return { handleMessage };
}

function createMockProvider(): AgentProvider {
  return {
    id: "codex",
    async createSession() {
      return {
        async *send(input: AgentSendInput) {
          const prompt = input.prompt;
          yield { type: "assistant.text.delta", text: `Mock response to: ${prompt}` };
          yield { type: "assistant.done" };
        },
        async close() {}
      };
    }
  };
}

export { runNativeMessagingBridge } from "./native-messaging.js";
export type { AgentProvider, AgentSendInput, AgentSession };
