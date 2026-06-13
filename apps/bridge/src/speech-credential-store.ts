import { spawn } from "node:child_process";
import type { SpeechCredentialSource, SpeechCredentialStatus } from "@sidra/protocol";

const DEFAULT_KEYCHAIN_SERVICE = "com.sidra.openai";
const DEFAULT_KEYCHAIN_ACCOUNT = "default";

type SecurityCommandRunner = (
  args: string[],
  options?: { input?: string }
) => Promise<{
  stdout: string;
  stderr: string;
}>;

export class SecurityCommandError extends Error {
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string
  ) {
    super(message);
    this.name = "SecurityCommandError";
  }
}

export type ResolvedSpeechCredential = {
  apiKey: string;
  source: SpeechCredentialSource;
};

export type SpeechSecretStore = {
  readApiKey(): Promise<string | undefined>;
  writeApiKey(apiKey: string): Promise<void>;
  deleteApiKey(): Promise<void>;
};

export type SpeechCredentialEnvironment = {
  SIDRA_OPENAI_API_KEY?: string;
  OPENAI_API_KEY?: string;
};

export class SpeechCredentialStore {
  private readonly secretStore: SpeechSecretStore;
  private readonly environment: SpeechCredentialEnvironment;

  constructor(options: { secretStore: SpeechSecretStore; environment?: SpeechCredentialEnvironment }) {
    this.secretStore = options.secretStore;
    this.environment = options.environment ?? {};
  }

  async resolveApiKey(): Promise<ResolvedSpeechCredential | undefined> {
    const storedApiKey = normalizeApiKey(await this.secretStore.readApiKey());
    if (storedApiKey) return { apiKey: storedApiKey, source: "keychain" };

    const sidraEnvironmentApiKey = normalizeApiKey(this.environment.SIDRA_OPENAI_API_KEY);
    if (sidraEnvironmentApiKey) return { apiKey: sidraEnvironmentApiKey, source: "environment" };

    const openAIEnvironmentApiKey = normalizeApiKey(this.environment.OPENAI_API_KEY);
    if (openAIEnvironmentApiKey) return { apiKey: openAIEnvironmentApiKey, source: "environment" };

    return undefined;
  }

  async getStatus(): Promise<SpeechCredentialStatus> {
    const credential = await this.resolveApiKey();
    if (!credential) return { configured: false };

    return {
      configured: true,
      source: credential.source,
      redactedKey: redactApiKey(credential.apiKey)
    };
  }

  async saveApiKey(apiKey: string): Promise<Extract<SpeechCredentialStatus, { configured: true }>> {
    const normalizedApiKey = normalizeApiKey(apiKey);
    if (!normalizedApiKey) throw new Error("API key is required.");

    await this.secretStore.writeApiKey(normalizedApiKey);
    return {
      configured: true,
      source: "keychain",
      redactedKey: redactApiKey(normalizedApiKey)
    };
  }

  async removeApiKey(): Promise<SpeechCredentialStatus> {
    await this.secretStore.deleteApiKey();
    return this.getStatus();
  }
}

export class MacOSKeychainSpeechSecretStore implements SpeechSecretStore {
  private readonly service: string;
  private readonly account: string;
  private readonly runSecurityCommand: SecurityCommandRunner;

  constructor(options: { service?: string; account?: string; runSecurityCommand?: SecurityCommandRunner } = {}) {
    this.service = options.service ?? DEFAULT_KEYCHAIN_SERVICE;
    this.account = options.account ?? DEFAULT_KEYCHAIN_ACCOUNT;
    this.runSecurityCommand = options.runSecurityCommand ?? runSecurityCommand;
  }

  async readApiKey(): Promise<string | undefined> {
    try {
      const result = await this.runSecurityCommand([
        "find-generic-password",
        "-s",
        this.service,
        "-a",
        this.account,
        "-w"
      ]);
      return normalizeApiKey(result.stdout);
    } catch {
      return undefined;
    }
  }

  async writeApiKey(apiKey: string): Promise<void> {
    try {
      await this.runSecurityCommand(
        [
          "add-generic-password",
          "-s",
          this.service,
          "-a",
          this.account,
          "-U",
          "-w"
        ],
        { input: `${apiKey}\n` }
      );
    } catch {
      throw new Error("Keychain write failed.");
    }
  }

  async deleteApiKey(): Promise<void> {
    try {
      await this.runSecurityCommand([
        "delete-generic-password",
        "-s",
        this.service,
        "-a",
        this.account
      ]);
    } catch (error) {
      if (isSecurityItemNotFoundError(error)) return;
      throw new Error("Keychain delete failed.");
    }
  }
}

function runSecurityCommand(args: string[], options: { input?: string } = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new SecurityCommandError(`security exited with code ${exitCode ?? "unknown"}`, exitCode, stdout, stderr));
    });

    if (options.input === undefined) {
      child.stdin.end();
    } else {
      child.stdin.end(options.input);
    }
  });
}

function isSecurityItemNotFoundError(error: unknown): boolean {
  if (!(error instanceof SecurityCommandError)) return false;
  if (error.exitCode !== 44) return false;
  const output = `${error.stdout}\n${error.stderr}`.toLowerCase();
  return output.includes("security: seckeychainsearchcopynext: the specified item could not be found in the keychain.");
}

export function createDefaultSpeechCredentialStore(environment: SpeechCredentialEnvironment = process.env): SpeechCredentialStore {
  return new SpeechCredentialStore({
    secretStore: new MacOSKeychainSpeechSecretStore(),
    environment
  });
}

export function redactApiKey(apiKey: string): string {
  const normalizedApiKey = normalizeApiKey(apiKey) ?? "";
  if (normalizedApiKey.length <= 7) return "sk-...";
  return `${normalizedApiKey.slice(0, 3)}...${normalizedApiKey.slice(-4)}`;
}

function normalizeApiKey(apiKey: string | undefined): string | undefined {
  const normalizedApiKey = apiKey?.trim();
  return normalizedApiKey && normalizedApiKey.length > 0 ? normalizedApiKey : undefined;
}
