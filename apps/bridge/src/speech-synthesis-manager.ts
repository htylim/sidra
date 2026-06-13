import {
  PROTOCOL_VERSION,
  type BridgeToExtension,
  type ExtensionToBridge,
  type SpeechAudioFormat,
  type SpeechCredentialStatus,
  type SpeechSynthesisOptions
} from "@sidra/protocol";
import type { SpeechCredentialStore } from "./speech-credential-store.js";

export const SPEECH_API_TEXT_CHUNK_CHARACTER_LIMIT = 4_096;
const AUDIO_CHUNK_BYTE_LIMIT = 48 * 1_024;
const OPENAI_SPEECH_URL = "https://api.openai.com/v1/audio/speech";
const OPENAI_MODELS_URL = "https://api.openai.com/v1/models/gpt-4o-mini-tts";

type SpeechSynthesizeMessage = Extract<ExtensionToBridge, { type: "speech.synthesize" }>;
type SpeechCancelMessage = Extract<ExtensionToBridge, { type: "speech.cancel" }>;
type SpeechCredentialSaveMessage = Extract<ExtensionToBridge, { type: "speech.credentials.save" }>;
type SpeechCredentialTestMessage = Extract<ExtensionToBridge, { type: "speech.credentials.test" }>;

export type SpeechGatewayRequest = {
  apiKey: string;
  text: string;
  options: SpeechSynthesisOptions;
  signal: AbortSignal;
};

export type SpeechSynthesisGateway = {
  streamSpeech(request: SpeechGatewayRequest): AsyncIterable<Uint8Array>;
  testCredential(apiKey: string, signal?: AbortSignal): Promise<void>;
};

export type BridgeSpeechManager = {
  synthesize(message: SpeechSynthesizeMessage): Promise<void>;
  cancel(message: SpeechCancelMessage): Promise<void>;
  getCredentialStatus(): Promise<void>;
  saveCredentials(message: SpeechCredentialSaveMessage): Promise<void>;
  testCredentials(message: SpeechCredentialTestMessage): Promise<void>;
  removeCredentials(): Promise<void>;
  cancelAll(): Promise<void>;
};

export class SpeechSynthesisManager implements BridgeSpeechManager {
  private readonly credentialStore: SpeechCredentialStoreLike;
  private readonly gateway: SpeechSynthesisGateway;
  private readonly emit: (message: BridgeToExtension) => void;
  private readonly activeRequests = new Map<string, AbortController>();

  constructor(options: {
    credentialStore: SpeechCredentialStore | SpeechCredentialStoreLike;
    gateway: SpeechSynthesisGateway;
    emit: (message: BridgeToExtension) => void;
  }) {
    this.credentialStore = options.credentialStore;
    this.gateway = options.gateway;
    this.emit = options.emit;
  }

  async synthesize(message: SpeechSynthesizeMessage): Promise<void> {
    this.activeRequests.get(message.requestId)?.abort();
    const abortController = new AbortController();
    this.activeRequests.set(message.requestId, abortController);
    let sequence = 0;

    try {
      const credential = await this.credentialStore.resolveApiKey();
      if (abortController.signal.aborted) throw new SpeechCancelledError();
      if (!credential) {
        this.emit({
          type: "speech.error",
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          message: "OpenAI API key is missing.",
          code: "openai_api_key_missing"
        });
        return;
      }

      this.emit({
        type: "speech.started",
        version: PROTOCOL_VERSION,
        requestId: message.requestId,
        mimeType: mimeTypeForFormat(message.options.format)
      });

      for (const textChunk of splitSpeechText(message.text)) {
        for await (const audioChunk of this.gateway.streamSpeech({
          apiKey: credential.apiKey,
          text: textChunk,
          options: message.options,
          signal: abortController.signal
        })) {
          if (abortController.signal.aborted) throw new SpeechCancelledError();
          for (const framedChunk of splitAudioChunk(audioChunk)) {
            this.emit({
              type: "speech.chunk",
              version: PROTOCOL_VERSION,
              requestId: message.requestId,
              sequence,
              audioBase64: Buffer.from(framedChunk).toString("base64")
            });
            sequence += 1;
          }
        }

        if (abortController.signal.aborted) throw new SpeechCancelledError();
      }

      this.emit({ type: "speech.done", version: PROTOCOL_VERSION, requestId: message.requestId });
    } catch (error) {
      if (abortController.signal.aborted || error instanceof SpeechCancelledError) {
        this.emit({
          type: "speech.error",
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          message: "Speech request was cancelled.",
          code: "speech_cancelled"
        });
      } else {
        this.emit({
          type: "speech.error",
          version: PROTOCOL_VERSION,
          requestId: message.requestId,
          message: speechErrorMessage(error),
          code: "openai_request_failed"
        });
      }
    } finally {
      if (this.activeRequests.get(message.requestId) === abortController) {
        this.activeRequests.delete(message.requestId);
      }
    }
  }

  async cancel(message: SpeechCancelMessage): Promise<void> {
    const abortController = this.activeRequests.get(message.requestId);
    if (!abortController) {
      this.emit({
        type: "speech.error",
        version: PROTOCOL_VERSION,
        requestId: message.requestId,
        message: "Speech request was not found.",
        code: "speech_request_not_found"
      });
      return;
    }

    abortController.abort();
  }

  async getCredentialStatus(): Promise<void> {
    try {
      const status = await this.credentialStore.getStatus();
      this.emit({ type: "speech.credentials.status", version: PROTOCOL_VERSION, ...status });
    } catch {
      this.emitCredentialError("Credential status failed.", "credential_store_failed");
    }
  }

  async saveCredentials(message: SpeechCredentialSaveMessage): Promise<void> {
    try {
      const status = await this.credentialStore.saveApiKey(message.apiKey);
      this.emit({ type: "speech.credentials.saved", version: PROTOCOL_VERSION, ...status });
    } catch {
      this.emitCredentialError("Credential save failed.", "credential_store_failed");
    }
  }

  async testCredentials(message: SpeechCredentialTestMessage): Promise<void> {
    try {
      const apiKey = message.apiKey ?? (await this.credentialStore.resolveApiKey())?.apiKey;
      if (!apiKey) {
        this.emitCredentialError("OpenAI API key is missing.", "credential_missing");
        return;
      }

      await this.gateway.testCredential(apiKey);
      this.emit({ type: "speech.credentials.tested", version: PROTOCOL_VERSION, ok: true });
    } catch {
      this.emitCredentialError("Credential check failed.", "credential_test_failed");
    }
  }

  async removeCredentials(): Promise<void> {
    try {
      const status = await this.credentialStore.removeApiKey();
      this.emit({ type: "speech.credentials.removed", version: PROTOCOL_VERSION, ...status });
    } catch {
      this.emitCredentialError("Credential removal failed.", "credential_store_failed");
    }
  }

  async cancelAll(): Promise<void> {
    for (const abortController of this.activeRequests.values()) {
      abortController.abort();
    }
  }

  private emitCredentialError(message: string, code: "credential_store_failed" | "credential_test_failed" | "credential_missing"): void {
    this.emit({
      type: "speech.credentials.error",
      version: PROTOCOL_VERSION,
      message,
      code
    });
  }
}

export class OpenAISpeechGateway implements SpeechSynthesisGateway {
  private readonly fetchImplementation: typeof fetch;

  constructor(fetchImplementation: typeof fetch = fetch) {
    this.fetchImplementation = fetchImplementation;
  }

  async *streamSpeech(request: SpeechGatewayRequest): AsyncIterable<Uint8Array> {
    const response = await this.fetchImplementation(OPENAI_SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${request.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.options.model,
        voice: request.options.voice,
        input: request.text,
        response_format: request.options.format,
        speed: request.options.speed,
        ...(request.options.instructions ? { instructions: request.options.instructions } : {})
      }),
      signal: request.signal
    });

    if (!response.ok) throw await OpenAIRequestError.fromResponse(response, "OpenAI speech request failed");

    if (!response.body) {
      yield new Uint8Array(await response.arrayBuffer());
      return;
    }

    const reader = response.body.getReader();
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) return;
        yield result.value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  async testCredential(apiKey: string, signal?: AbortSignal): Promise<void> {
    const response = await this.fetchImplementation(OPENAI_MODELS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal
    });

    if (!response.ok) throw new Error("OpenAI credential check failed.");
  }
}

type SpeechCredentialStoreLike = {
  resolveApiKey(): Promise<{ apiKey: string; source: "keychain" | "environment" } | undefined>;
  getStatus(): Promise<SpeechCredentialStatus>;
  saveApiKey(apiKey: string): Promise<Extract<SpeechCredentialStatus, { configured: true }>>;
  removeApiKey(): Promise<SpeechCredentialStatus>;
};

class SpeechCancelledError extends Error {}

class OpenAIRequestError extends Error {
  readonly status: number;
  readonly providerCode: string | undefined;

  private constructor(options: { status: number; messagePrefix: string; providerMessage?: string; providerCode?: string }) {
    const providerCodeText = options.providerCode ? ` ${options.providerCode}` : "";
    const detail = options.providerMessage ? `: ${options.providerMessage}` : ".";
    super(`${options.messagePrefix} (${options.status}${providerCodeText})${detail}`);
    this.name = "OpenAIRequestError";
    this.status = options.status;
    this.providerCode = options.providerCode;
  }

  static async fromResponse(response: Response, messagePrefix: string): Promise<OpenAIRequestError> {
    const providerError = await readOpenAIError(response);
    return new OpenAIRequestError({
      status: response.status,
      messagePrefix,
      providerMessage: providerError.message,
      providerCode: providerError.code
    });
  }
}

function speechErrorMessage(error: unknown): string {
  if (error instanceof OpenAIRequestError) return error.message;
  return "OpenAI speech request failed.";
}

async function readOpenAIError(response: Response): Promise<{ message?: string; code?: string }> {
  try {
    const text = await response.text();
    if (!text.trim()) return {};
    const parsed: unknown = JSON.parse(text);
    if (!isOpenAIErrorBody(parsed)) return { message: truncateErrorMessage(text) };
    return {
      message: truncateErrorMessage(parsed.error.message),
      code: typeof parsed.error.code === "string" ? parsed.error.code : undefined
    };
  } catch {
    return {};
  }
}

function isOpenAIErrorBody(value: unknown): value is { error: { message: string; code?: unknown } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: unknown }).error === "object" &&
    (value as { error?: unknown }).error !== null &&
    typeof ((value as { error: { message?: unknown } }).error.message) === "string"
  );
}

function truncateErrorMessage(message: string): string {
  return message.length > 360 ? `${message.slice(0, 357)}...` : message;
}

export function splitSpeechText(text: string): string[] {
  const chunks: string[] = [];
  let remainingText = text.trim();

  while (remainingText.length > SPEECH_API_TEXT_CHUNK_CHARACTER_LIMIT) {
    const splitIndex = findSpeechTextSplitIndex(remainingText);
    chunks.push(remainingText.slice(0, splitIndex).trim());
    remainingText = remainingText.slice(splitIndex).trimStart();
  }

  if (remainingText.length > 0) chunks.push(remainingText);
  return chunks;
}

function findSpeechTextSplitIndex(text: string): number {
  const candidate = text.slice(0, SPEECH_API_TEXT_CHUNK_CHARACTER_LIMIT + 1);
  for (const separator of ["\n\n", "\n", ". ", " "]) {
    const separatorIndex = candidate.lastIndexOf(separator);
    if (separatorIndex > 0) return separatorIndex + separator.length;
  }
  return SPEECH_API_TEXT_CHUNK_CHARACTER_LIMIT;
}

function splitAudioChunk(audioChunk: Uint8Array): Uint8Array[] {
  if (audioChunk.byteLength <= AUDIO_CHUNK_BYTE_LIMIT) return [audioChunk];

  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < audioChunk.byteLength; offset += AUDIO_CHUNK_BYTE_LIMIT) {
    chunks.push(audioChunk.subarray(offset, offset + AUDIO_CHUNK_BYTE_LIMIT));
  }
  return chunks;
}

function mimeTypeForFormat(format: SpeechAudioFormat): string {
  switch (format) {
    case "mp3":
      return "audio/mpeg";
    case "opus":
      return "audio/ogg";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "wav":
      return "audio/wav";
    case "pcm":
      return "audio/L16";
  }
}
