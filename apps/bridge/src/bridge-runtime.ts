import { createCodexAppServerProvider } from "./codex-app-server-provider.js";
import { runNativeMessagingBridge } from "./native-messaging.js";
import { startCodexAppServer, type RunningCodexAppServer } from "./codex-app-server-process.js";
import type { AgentProvider } from "./session-manager.js";

const CODEX_WORKSPACE_ROOT_ENV = "SIDRA_CODEX_WORKSPACE_ROOT";

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
  const providerRuntime = await createProviderRuntimeFromEnvironment(environment, dependencies);
  runNativeMessagingBridge(input, output, { provider: providerRuntime.provider });
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

async function assertCodexAuthenticated(appServer: RunningCodexAppServer): Promise<void> {
  const response = await appServer.client.request("account/read", { refreshToken: true });
  if (!isRecord(response) || !isRecord(response.account)) {
    throw new Error("Codex authentication is required");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
