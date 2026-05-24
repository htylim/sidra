import { createCodexAppServerProvider } from "./codex-app-server-provider.js";
import { runNativeMessagingBridge, writeNativeMessage } from "./native-messaging.js";
import { startCodexAppServer, type RunningCodexAppServer } from "./codex-app-server-process.js";
import type { AgentProvider } from "./session-manager.js";
import { PROTOCOL_VERSION, parseExtensionToBridge } from "@sidra/protocol";

const CODEX_WORKSPACE_ROOT_ENV = "SIDRA_CODEX_WORKSPACE_ROOT";
const CODEX_SETUP_FAILED_MESSAGE = "Codex setup failed.";
const CODEX_SETUP_FAILED_ERROR = {
  type: "bridge.error",
  version: PROTOCOL_VERSION,
  message: CODEX_SETUP_FAILED_MESSAGE,
  code: "codex_setup_failed"
} as const;

type RuntimeEnvironment = Record<string, string | undefined>;

type BridgeRuntimeDependencies = {
  startCodexAppServer(options: { clientInfo: { name: string; version: string } }): Promise<RunningCodexAppServer>;
};

export type RuntimeAgentProvider = AgentProvider & {
  close(): void;
};

type ConfiguredProviderRuntime = {
  provider?: RuntimeAgentProvider;
  close(): void;
};

const defaultDependencies: BridgeRuntimeDependencies = {
  startCodexAppServer
};

export async function createProviderFromEnvironment(
  environment: RuntimeEnvironment = process.env,
  dependencies: BridgeRuntimeDependencies = defaultDependencies
): Promise<RuntimeAgentProvider | undefined> {
  return (await createProviderRuntimeFromEnvironment(environment, dependencies)).provider;
}

async function createProviderRuntimeFromEnvironment(
  environment: RuntimeEnvironment,
  dependencies: BridgeRuntimeDependencies
): Promise<ConfiguredProviderRuntime> {
  const workingDirectory = environment[CODEX_WORKSPACE_ROOT_ENV];
  if (!workingDirectory) return { close() {} };

  const appServer = await dependencies.startCodexAppServer({
    clientInfo: { name: "sidra-bridge", version: "0.0.0" }
  });
  try {
    await assertCodexAuthenticated(appServer);
  } catch (error) {
    appServer.close();
    throw error;
  }
  const provider = retainAppServerForProviderLifetime(
    createCodexAppServerProvider({ appServer: appServer.client, workingDirectory }),
    appServer
  );
  return {
    provider,
    close() {
      appServer.close();
    }
  };
}

function retainAppServerForProviderLifetime(provider: AgentProvider, appServer: RunningCodexAppServer): RuntimeAgentProvider {
  return {
    id: provider.id,
    createSession() {
      void appServer;
      return provider.createSession();
    },
    close() {
      appServer.close();
    }
  };
}

export async function runBridgeFromEnvironment(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  environment: RuntimeEnvironment = process.env,
  dependencies: BridgeRuntimeDependencies = defaultDependencies
): Promise<void> {
  const providerRuntime = await createRuntimeForNativeMessaging(environment, dependencies);
  if (!providerRuntime.provider) {
    runNativeMessagingBridge(input, output, { bridge: createSetupBlockedBridge(output) });
    writeNativeMessage(output, CODEX_SETUP_FAILED_ERROR);
    return;
  }

  runNativeMessagingBridge(input, output, { provider: providerRuntime.provider });
  writeNativeMessage(output, { type: "bridge.ready", version: PROTOCOL_VERSION });
  let providerRuntimeClosed = false;
  const closeProviderRuntime = () => {
    if (providerRuntimeClosed) return;
    providerRuntimeClosed = true;
    providerRuntime.close();
  };
  input.on("end", closeProviderRuntime);
  input.on("close", closeProviderRuntime);
  input.on("error", closeProviderRuntime);
}

async function createRuntimeForNativeMessaging(
  environment: RuntimeEnvironment,
  dependencies: BridgeRuntimeDependencies
): Promise<ConfiguredProviderRuntime> {
  const workingDirectory = environment[CODEX_WORKSPACE_ROOT_ENV];
  if (!workingDirectory) return { close() {} };

  try {
    return await createProviderRuntimeFromEnvironment(environment, dependencies);
  } catch {
    return { close() {} };
  }
}

function createSetupBlockedBridge(output: NodeJS.WritableStream) {
  return {
    async handleMessage(message: unknown): Promise<void> {
      const parsed = parseExtensionToBridge(message);
      if (!parsed.ok) {
        writeNativeMessage(output, {
          type: "bridge.error",
          version: PROTOCOL_VERSION,
          message: parsed.error,
          code: "invalid_message"
        });
        return;
      }
      writeNativeMessage(output, CODEX_SETUP_FAILED_ERROR);
    }
  };
}

async function assertCodexAuthenticated(appServer: RunningCodexAppServer): Promise<void> {
  const response = await appServer.client.request("account/read", { refreshToken: true });
  if (!isRecord(response) || !isRecord(response.account)) {
    throw new Error("Codex authentication is required");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
