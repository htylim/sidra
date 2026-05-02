import {
  type AgentEvent,
  type BridgeToExtension,
  type ExtensionToBridge,
  parseExtensionToBridge
} from "@sidra/protocol";

export type BridgeRuntime = {
  emit(message: BridgeToExtension): void;
};

export type AgentSession = {
  send(prompt: string, signal: AbortSignal): AsyncIterable<AgentEvent>;
  close(): Promise<void>;
};

export type AgentProvider = {
  id: "codex";
  createSession(): Promise<AgentSession>;
};

export function createBridge(runtime: BridgeRuntime, provider: AgentProvider = createMockProvider()) {
  const sessions = new Map<string, AgentSession>();
  let nextBridgeSessionId = 1;

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
      case "session.start": {
        const existing = sessions.get(message.clientSessionId);
        if (existing) await existing.close();

        const session = await provider.createSession();
        sessions.set(message.clientSessionId, session);
        runtime.emit({
          type: "session.started",
          version: 1,
          clientSessionId: message.clientSessionId,
          bridgeSessionId: `mock-${nextBridgeSessionId++}`
        });
        return;
      }
      case "session.send": {
        const session = sessions.get(message.clientSessionId);
        if (!session) {
          runtime.emit({
            type: "session.error",
            version: 1,
            clientSessionId: message.clientSessionId,
            message: "Session has not been started",
            code: "session_not_started"
          });
          return;
        }

        const controller = new AbortController();
        for await (const event of session.send(message.prompt, controller.signal)) {
          runtime.emit({ type: "agent.event", version: 1, clientSessionId: message.clientSessionId, event });
        }
        return;
      }
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
        async *send(prompt: string) {
          yield { type: "assistant.text.delta", text: `Mock response to: ${prompt}` };
          yield { type: "assistant.done" };
        },
        async close() {}
      };
    }
  };
}

export { runNativeMessagingBridge } from "./native-messaging.js";
