import { describe, expect, it } from "vitest";

describe("SpeechCredentialStore", () => {
  it("speech_credentials_use_keychain_before_environment_fallback", async () => {
    const { SpeechCredentialStore } = await import("./speech-credential-store.js");
    const keychainStore = createMemorySecretStore("sk-keychain");
    const storeWithKeychainCredential = new SpeechCredentialStore({
      secretStore: keychainStore,
      environment: {
        SIDRA_OPENAI_API_KEY: "sk-sidra-env",
        OPENAI_API_KEY: "sk-openai-env"
      }
    });

    await expect(storeWithKeychainCredential.resolveApiKey()).resolves.toEqual({
      apiKey: "sk-keychain",
      source: "keychain"
    });

    const emptyKeychainStore = createMemorySecretStore();
    const storeWithEnvironmentCredential = new SpeechCredentialStore({
      secretStore: emptyKeychainStore,
      environment: {
        SIDRA_OPENAI_API_KEY: "sk-sidra-env",
        OPENAI_API_KEY: "sk-openai-env"
      }
    });

    await expect(storeWithEnvironmentCredential.resolveApiKey()).resolves.toEqual({
      apiKey: "sk-sidra-env",
      source: "environment"
    });
  });

  it("speech_credentials_skip_blank_sidra_environment_key_for_openai_fallback", async () => {
    const { SpeechCredentialStore } = await import("./speech-credential-store.js");
    const store = new SpeechCredentialStore({
      secretStore: createMemorySecretStore(),
      environment: {
        SIDRA_OPENAI_API_KEY: "   ",
        OPENAI_API_KEY: "sk-openai-env"
      }
    });

    await expect(store.resolveApiKey()).resolves.toEqual({
      apiKey: "sk-openai-env",
      source: "environment"
    });
  });

  it("macos_keychain_write_sends_secret_over_stdin_not_process_arguments", async () => {
    const { MacOSKeychainSpeechSecretStore } = await import("./speech-credential-store.js");
    const calls: Array<{ args: string[]; input?: string }> = [];
    const store = new MacOSKeychainSpeechSecretStore({
      service: "com.sidra.test",
      account: "speech",
      runSecurityCommand: async (args, options) => {
        calls.push({ args, input: options?.input });
        return { stdout: "", stderr: "" };
      }
    });

    await store.writeApiKey("sk-secret-value");

    expect(calls).toEqual([
      {
        args: ["add-generic-password", "-s", "com.sidra.test", "-a", "speech", "-U", "-w"],
        input: "sk-secret-value\n"
      }
    ]);
    expect(calls[0]?.args).not.toContain("sk-secret-value");
  });

  it("macos_keychain_delete_ignores_missing_item_errors", async () => {
    const { MacOSKeychainSpeechSecretStore, SecurityCommandError } = await import("./speech-credential-store.js");
    const store = new MacOSKeychainSpeechSecretStore({
      runSecurityCommand: async () => {
        throw new SecurityCommandError(
          "security exited with code 44",
          44,
          "",
          "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain."
        );
      }
    });

    await expect(store.deleteApiKey()).resolves.toBeUndefined();
  });

  it("macos_keychain_delete_surfaces_unexpected_errors", async () => {
    const { MacOSKeychainSpeechSecretStore, SecurityCommandError } = await import("./speech-credential-store.js");
    const store = new MacOSKeychainSpeechSecretStore({
      runSecurityCommand: async () => {
        throw new SecurityCommandError("security exited with code 51", 51, "", "User interaction is not allowed.");
      }
    });

    await expect(store.deleteApiKey()).rejects.toThrow("Keychain delete failed.");
  });

  it("macos_keychain_delete_requires_the_missing_item_exit_code", async () => {
    const { MacOSKeychainSpeechSecretStore, SecurityCommandError } = await import("./speech-credential-store.js");
    const store = new MacOSKeychainSpeechSecretStore({
      runSecurityCommand: async () => {
        throw new SecurityCommandError(
          "security exited with code 51",
          51,
          "",
          "security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain."
        );
      }
    });

    await expect(store.deleteApiKey()).rejects.toThrow("Keychain delete failed.");
  });
});

function createMemorySecretStore(initialValue?: string) {
  let value = initialValue;

  return {
    async readApiKey() {
      return value;
    },
    async writeApiKey(nextValue: string) {
      value = nextValue;
    },
    async deleteApiKey() {
      value = undefined;
    }
  };
}
