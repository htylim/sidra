import { describe, expect, it } from "vitest";
import { createBridge } from "./index.js";

describe("SpeechSynthesisManager", () => {
  it("bridge_speech_missing_key_returns_speech_error", async () => {
    const { SpeechSynthesisManager } = await import("./speech-synthesis-manager.js");
    const emitted: unknown[] = [];
    const gateway = createRecordingGateway([[1]]);
    const manager = new SpeechSynthesisManager({
      credentialStore: createCredentialStore(),
      gateway,
      emit: (message: unknown) => emitted.push(message)
    });

    await manager.synthesize({
      type: "speech.synthesize",
      version: 3,
      requestId: "speech-1",
      text: "Read this.",
      options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 1 }
    });

    expect(gateway.requests).toHaveLength(0);
    expect(emitted).toContainEqual({
      type: "speech.error",
      version: 3,
      requestId: "speech-1",
      message: "OpenAI API key is missing.",
      code: "openai_api_key_missing"
    });
  });

  it("bridge_saves_tests_and_removes_speech_credentials", async () => {
    const { SpeechCredentialStore } = await import("./speech-credential-store.js");
    const { SpeechSynthesisManager } = await import("./speech-synthesis-manager.js");
    const emitted: unknown[] = [];
    const gateway = createRecordingGateway([[1]]);
    const credentialStore = new SpeechCredentialStore({
      secretStore: createMemorySecretStore(),
      environment: {}
    });
    const manager = new SpeechSynthesisManager({
      credentialStore,
      gateway,
      emit: (message: unknown) => emitted.push(message)
    });
    const bridge = createBridge(
      { emit: (message) => emitted.push(message) },
      undefined,
      { speech: manager } as unknown as Parameters<typeof createBridge>[2]
    );

    await bridge.handleMessage({ type: "speech.credentials.save", version: 3, apiKey: "sk-test-secret" });
    await bridge.handleMessage({ type: "speech.credentials.test", version: 3 });
    await bridge.handleMessage({ type: "speech.credentials.remove", version: 3 });

    expect(gateway.testedApiKeys).toEqual(["sk-test-secret"]);
    expect(emitted).toContainEqual({
      type: "speech.credentials.saved",
      version: 3,
      configured: true,
      source: "keychain",
      redactedKey: "sk-...cret"
    });
    expect(emitted).toContainEqual({ type: "speech.credentials.tested", version: 3, ok: true });
    expect(emitted).toContainEqual({ type: "speech.credentials.removed", version: 3, configured: false });
    expect(JSON.stringify(emitted)).not.toContain("sk-test-secret");
  });

  it("bridge_reports_environment_credential_after_stored_key_removal", async () => {
    const { SpeechCredentialStore } = await import("./speech-credential-store.js");
    const { SpeechSynthesisManager } = await import("./speech-synthesis-manager.js");
    const emitted: unknown[] = [];
    const credentialStore = new SpeechCredentialStore({
      secretStore: createMemorySecretStore("sk-stored-secret"),
      environment: { SIDRA_OPENAI_API_KEY: "sk-environment-secret" }
    });
    const manager = new SpeechSynthesisManager({
      credentialStore,
      gateway: createRecordingGateway([[1]]),
      emit: (message: unknown) => emitted.push(message)
    });

    await manager.removeCredentials();

    expect(emitted).toContainEqual({
      type: "speech.credentials.removed",
      version: 3,
      configured: true,
      source: "environment",
      redactedKey: "sk-...cret"
    });
    expect(JSON.stringify(emitted)).not.toContain("sk-environment-secret");
  });

  it("speech_manager_chunks_text_at_api_limit", async () => {
    const { SpeechSynthesisManager } = await import("./speech-synthesis-manager.js");
    const gateway = createRecordingGateway([[1], [2]]);
    const manager = new SpeechSynthesisManager({
      credentialStore: createCredentialStore("sk-test"),
      gateway,
      emit: () => {}
    });

    await manager.synthesize({
      type: "speech.synthesize",
      version: 3,
      requestId: "speech-1",
      text: `${"a".repeat(4_090)} ${"b".repeat(600)}`,
      options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 1 }
    });

    expect(gateway.requests.length).toBeGreaterThan(1);
    expect(Math.max(...gateway.requests.map((request) => request.text.length))).toBeLessThanOrEqual(4_096);
  });

  it("speech_manager_streams_ordered_audio_chunks", async () => {
    const { SpeechSynthesisManager } = await import("./speech-synthesis-manager.js");
    const emitted: unknown[] = [];
    const gateway = createRecordingGateway([
      [1],
      [2, 3]
    ]);
    const manager = new SpeechSynthesisManager({
      credentialStore: createCredentialStore("sk-test"),
      gateway,
      emit: (message: unknown) => emitted.push(message)
    });

    await manager.synthesize({
      type: "speech.synthesize",
      version: 3,
      requestId: "speech-1",
      text: "Read this.",
      options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 1 }
    });

    expect(emitted).toEqual([
      { type: "speech.started", version: 3, requestId: "speech-1", mimeType: "audio/mpeg" },
      { type: "speech.chunk", version: 3, requestId: "speech-1", sequence: 0, audioBase64: "AQ==" },
      { type: "speech.chunk", version: 3, requestId: "speech-1", sequence: 1, audioBase64: "AgM=" },
      { type: "speech.done", version: 3, requestId: "speech-1" }
    ]);
  });

  it("openai_gateway_sends_speech_request_options", async () => {
    const { OpenAISpeechGateway } = await import("./speech-synthesis-manager.js");
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    const gateway = new OpenAISpeechGateway((async (url: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push({ url: String(url), init: init ?? {} });
      return new Response(Uint8Array.from([1, 2, 3]));
    }) as typeof fetch);

    const chunks: Uint8Array[] = [];
    for await (const chunk of gateway.streamSpeech({
      apiKey: "sk-test",
      text: "Read this.",
      options: {
        model: "gpt-4o-mini-tts",
        voice: "marin",
        format: "mp3",
        speed: 1,
        instructions: "Read clearly."
      },
      signal: new AbortController().signal
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([Uint8Array.from([1, 2, 3])]);
    expect(fetchCalls).toHaveLength(1);
    expect(JSON.parse(String(fetchCalls[0].init.body))).toEqual({
      model: "gpt-4o-mini-tts",
      voice: "marin",
      input: "Read this.",
      response_format: "mp3",
      speed: 1,
      instructions: "Read clearly."
    });
  });

  it("speech_manager_reports_openai_error_details", async () => {
    const { OpenAISpeechGateway, SpeechSynthesisManager } = await import("./speech-synthesis-manager.js");
    const emitted: unknown[] = [];
    const gateway = new OpenAISpeechGateway((async () =>
      new Response(
        JSON.stringify({
          error: {
            message: "You exceeded your current quota, please check your plan and billing details.",
            code: "insufficient_quota"
          }
        }),
        { status: 429, statusText: "Too Many Requests", headers: { "Content-Type": "application/json" } }
      )) as typeof fetch);
    const manager = new SpeechSynthesisManager({
      credentialStore: createCredentialStore("sk-test"),
      gateway,
      emit: (message: unknown) => emitted.push(message)
    });

    await manager.synthesize({
      type: "speech.synthesize",
      version: 3,
      requestId: "speech-1",
      text: "Read this.",
      options: { model: "gpt-4o-mini-tts", voice: "marin", format: "mp3", speed: 1 }
    });

    expect(emitted).toContainEqual({
      type: "speech.error",
      version: 3,
      requestId: "speech-1",
      message:
        "OpenAI speech request failed (429 insufficient_quota): You exceeded your current quota, please check your plan and billing details.",
      code: "openai_request_failed"
    });
  });

  it("speech_cancel_aborts_active_request", async () => {
    const { SpeechSynthesisManager } = await import("./speech-synthesis-manager.js");
    const emitted: unknown[] = [];
    const gateway = createBlockingGateway();
    const manager = new SpeechSynthesisManager({
      credentialStore: createCredentialStore("sk-test"),
      gateway,
      emit: (message: unknown) => emitted.push(message)
    });

    const synthesizePromise = manager.synthesize({
      type: "speech.synthesize",
      version: 3,
      requestId: "speech-1",
      text: "Read this.",
      options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 1 }
    });

    await gateway.started;
    await manager.cancel({ type: "speech.cancel", version: 3, requestId: "speech-1" });
    await synthesizePromise;

    expect(gateway.abortCount).toBe(1);
    expect(emitted).toContainEqual({
      type: "speech.error",
      version: 3,
      requestId: "speech-1",
      message: "Speech request was cancelled.",
      code: "speech_cancelled"
    });
  });

  it("speech_cancel_during_credential_lookup_prevents_openai_request", async () => {
    const { SpeechSynthesisManager } = await import("./speech-synthesis-manager.js");
    const emitted: unknown[] = [];
    const gateway = createRecordingGateway([[1]]);
    const credentialStore = createDelayedCredentialStore("sk-test");
    const manager = new SpeechSynthesisManager({
      credentialStore,
      gateway,
      emit: (message: unknown) => emitted.push(message)
    });

    const synthesizePromise = manager.synthesize({
      type: "speech.synthesize",
      version: 3,
      requestId: "speech-1",
      text: "Read this.",
      options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 1 }
    });

    await manager.cancel({ type: "speech.cancel", version: 3, requestId: "speech-1" });
    credentialStore.resolve();
    await synthesizePromise;

    expect(gateway.requests).toEqual([]);
    expect(emitted).toEqual([
      {
        type: "speech.error",
        version: 3,
        requestId: "speech-1",
        message: "Speech request was cancelled.",
        code: "speech_cancelled"
      }
    ]);
  });

  it("speech_manager_cancels_all_requests_on_connection_close", async () => {
    const { SpeechSynthesisManager } = await import("./speech-synthesis-manager.js");
    const gateway = createBlockingGateway();
    const manager = new SpeechSynthesisManager({
      credentialStore: createCredentialStore("sk-test"),
      gateway,
      emit: () => {}
    });

    const synthesizePromise = manager.synthesize({
      type: "speech.synthesize",
      version: 3,
      requestId: "speech-1",
      text: "Read this.",
      options: { model: "gpt-4o-mini-tts", voice: "alloy", format: "mp3", speed: 1 }
    });

    await gateway.started;
    await manager.cancelAll();
    await synthesizePromise;

    expect(gateway.abortCount).toBe(1);
  });
});

function createCredentialStore(apiKey?: string) {
  return {
    async resolveApiKey() {
      if (!apiKey) return undefined;
      return { apiKey, source: "keychain" as const };
    },
    async getStatus() {
      return apiKey
        ? { configured: true as const, source: "keychain" as const, redactedKey: "sk-...test" }
        : { configured: false as const };
    },
    async saveApiKey(nextApiKey: string) {
      apiKey = nextApiKey;
      return { configured: true as const, source: "keychain" as const, redactedKey: "sk-...cret" };
    },
    async removeApiKey() {
      apiKey = undefined;
      return { configured: false as const };
    }
  };
}

function createDelayedCredentialStore(apiKey: string) {
  let resolveCredential: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveCredential = resolve;
  });

  return {
    resolve: resolveCredential,
    async resolveApiKey() {
      await ready;
      return { apiKey, source: "keychain" as const };
    },
    async getStatus() {
      return { configured: true as const, source: "keychain" as const, redactedKey: "sk-...test" };
    },
    async saveApiKey() {
      return { configured: true as const, source: "keychain" as const, redactedKey: "sk-...test" };
    },
    async removeApiKey() {
      return { configured: false as const };
    }
  };
}

function createRecordingGateway(chunks: number[][]) {
  const gateway = {
    requests: [] as Array<{ text: string }>,
    testedApiKeys: [] as string[],
    async *streamSpeech(request: { text: string }) {
      gateway.requests.push(request);
      for (const chunk of chunks) {
        yield Uint8Array.from(chunk);
      }
    },
    async testCredential(apiKey: string) {
      gateway.testedApiKeys.push(apiKey);
    }
  };
  return gateway;
}

function createBlockingGateway() {
  let markStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const gateway = {
    abortCount: 0,
    started,
    requests: [] as Array<{ text: string }>,
    testedApiKeys: [] as string[],
    async *streamSpeech(request: { text: string; signal: AbortSignal }) {
      gateway.requests.push(request);
      markStarted();
      await new Promise<void>((resolve) => {
        request.signal.addEventListener(
          "abort",
          () => {
            gateway.abortCount += 1;
            resolve();
          },
          { once: true }
        );
      });
    },
    async testCredential(apiKey: string) {
      gateway.testedApiKeys.push(apiKey);
    }
  };
  return gateway;
}

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
