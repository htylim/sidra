import { spawn as nodeSpawn } from "node:child_process";
import { CodexAppServerClient, type AppServerClientInfo } from "./codex-app-server-client.js";

type SpawnedAppServerProcess = {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  kill(signal?: NodeJS.Signals): boolean;
  on?(event: "exit" | "error", listener: () => void): unknown;
};

type SpawnAppServer = (
  command: string,
  args: string[],
  options: { stdio: ["pipe", "pipe", "pipe"]; env: NodeJS.ProcessEnv }
) => SpawnedAppServerProcess;

export type StartCodexAppServerOptions = {
  clientInfo: AppServerClientInfo;
  spawn?: SpawnAppServer;
};

export type RunningCodexAppServer = {
  client: CodexAppServerClient;
  process: SpawnedAppServerProcess;
  close(): void;
};

export async function startCodexAppServer(options: StartCodexAppServerOptions): Promise<RunningCodexAppServer> {
  const spawnAppServer = options.spawn ?? nodeSpawn;
  const childProcess = spawnAppServer("codex", ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: createCodexAppServerEnvironment(process.env)
  });
  const client = new CodexAppServerClient({
    input: childProcess.stdout,
    output: childProcess.stdin
  });
  childProcess.on?.("exit", () => client.close());
  childProcess.on?.("error", () => client.close());

  try {
    await client.initialize(options.clientInfo);
  } catch (error) {
    childProcess.kill("SIGTERM");
    throw error;
  }

  return {
    client,
    process: childProcess,
    close() {
      childProcess.kill("SIGTERM");
    }
  };
}

function createCodexAppServerEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { SIDRA_CODEX_WORKSPACE_ROOT: _workspaceRoot, ...codexEnvironment } = environment;
  return codexEnvironment;
}
