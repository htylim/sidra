import { PROTOCOL_VERSION, type BridgeToExtension, type ExtensionToBridge } from "@sidra/protocol";
import type { TranscriptSpeechSettings } from "./settings-store";

export type TranscriptSpeechStatus = "idle" | "loading" | "playing" | "paused" | "error";

export type TranscriptSpeechSnapshot = {
  enabled: boolean;
  status: TranscriptSpeechStatus;
  activeEntryId?: string;
  error?: string;
};

export type TranscriptSpeechToggleInput = {
  entryId: string;
  text: string;
};

export type TranscriptSpeechTransport = {
  post(message: ExtensionToBridge): { ok: true } | { ok: false; error: string };
  subscribeToMessages(listener: (message: BridgeToExtension) => void): () => void;
};

export type TranscriptSpeechPlaybackGateway = {
  start(mimeType: string, onEnded: () => void): void;
  appendChunk(chunk: Uint8Array): void;
  play(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  finish(): void;
};

type ActiveSpeechRequest = {
  entryId: string;
  requestId: string;
  receivedFirstChunk: boolean;
};

export class TranscriptSpeechController {
  private readonly transport: TranscriptSpeechTransport;
  private readonly playback: TranscriptSpeechPlaybackGateway;
  private readonly createRequestId: () => string;
  private readonly unsubscribeTransport: () => void;
  private readonly listeners = new Set<() => void>();
  private settings: TranscriptSpeechSettings;
  private activeRequest: ActiveSpeechRequest | undefined;
  private snapshot: TranscriptSpeechSnapshot;

  constructor(options: {
    transport: TranscriptSpeechTransport;
    playback: TranscriptSpeechPlaybackGateway;
    settings: TranscriptSpeechSettings;
    createRequestId?: () => string;
  }) {
    this.transport = options.transport;
    this.playback = options.playback;
    this.settings = options.settings;
    this.createRequestId = options.createRequestId ?? (() => crypto.randomUUID());
    this.snapshot = { enabled: options.settings.enabled, status: "idle", activeEntryId: undefined };
    this.unsubscribeTransport = this.transport.subscribeToMessages((message) => this.handleBridgeMessage(message));
  }

  getSnapshot = (): TranscriptSpeechSnapshot => this.snapshot;

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  toggleSpeech(input: TranscriptSpeechToggleInput): boolean {
    if (!this.settings.enabled) return false;

    if (this.activeRequest?.entryId === input.entryId) {
      return this.toggleActiveSpeech();
    }

    if (this.activeRequest) this.cancelActiveSpeech();
    return this.startSpeech(input);
  }

  updateSettings(settings: TranscriptSpeechSettings): void {
    const wasEnabled = this.settings.enabled;
    this.settings = settings;
    if (wasEnabled && !settings.enabled) {
      this.stopActiveSpeech();
      this.setSnapshot({ enabled: false, status: "idle", activeEntryId: undefined });
      return;
    }

    this.setSnapshot({ ...this.snapshot, enabled: settings.enabled });
  }

  stopActiveSpeech(): void {
    if (!this.activeRequest) {
      this.stopLocalPlayback();
      return;
    }

    this.cancelActiveSpeech();
  }

  stopLocalSpeech(): void {
    this.stopLocalPlayback();
  }

  dispose(): void {
    this.stopActiveSpeech();
    this.unsubscribeTransport();
    this.listeners.clear();
  }

  private toggleActiveSpeech(): boolean {
    if (!this.activeRequest) return false;

    switch (this.snapshot.status) {
      case "loading":
        this.cancelActiveSpeech();
        return true;
      case "playing":
        this.playback.pause();
        this.setSnapshot({ ...this.snapshot, status: "paused" });
        return true;
      case "paused":
        this.playback.resume();
        this.setSnapshot({ ...this.snapshot, status: "playing" });
        return true;
      case "idle":
      case "error":
        return false;
    }
  }

  private startSpeech(input: TranscriptSpeechToggleInput): boolean {
    const text = normalizeSpeechText(input.text, this.settings.maxCharactersPerBubble);
    if (!text) return false;

    const requestId = this.createRequestId();
    const message: ExtensionToBridge = {
      type: "speech.synthesize",
      version: PROTOCOL_VERSION,
      requestId,
      text,
      options: {
        model: "gpt-4o-mini-tts",
        voice: this.settings.voice,
        format: "mp3",
        speed: this.settings.speed,
        instructions: this.settings.instructions
      }
    };
    const postResult = this.transport.post(message);
    if (!postResult.ok) {
      this.setSnapshot({ enabled: this.settings.enabled, status: "error", activeEntryId: undefined, error: postResult.error });
      return false;
    }

    this.activeRequest = { entryId: input.entryId, requestId, receivedFirstChunk: false };
    this.setSnapshot({ enabled: this.settings.enabled, status: "loading", activeEntryId: input.entryId });
    return true;
  }

  private cancelActiveSpeech(): void {
    const activeRequest = this.activeRequest;
    if (!activeRequest) return;

    this.transport.post({ type: "speech.cancel", version: PROTOCOL_VERSION, requestId: activeRequest.requestId });
    this.playback.stop();
    this.activeRequest = undefined;
    this.setSnapshot({ enabled: this.settings.enabled, status: "idle", activeEntryId: undefined });
  }

  private handleBridgeMessage(message: BridgeToExtension): void {
    const activeRequest = this.activeRequest;
    if (!activeRequest || !isSpeechMessageForRequest(message, activeRequest.requestId)) return;

    switch (message.type) {
      case "speech.started":
        this.playback.start(message.mimeType, () => this.finishPlaybackForRequest(activeRequest.requestId));
        return;
      case "speech.chunk":
        this.playback.appendChunk(decodeBase64Audio(message.audioBase64));
        if (!activeRequest.receivedFirstChunk) {
          activeRequest.receivedFirstChunk = true;
          this.playback.play();
          this.setSnapshot({ enabled: this.settings.enabled, status: "playing", activeEntryId: activeRequest.entryId });
        }
        return;
      case "speech.done":
        this.playback.finish();
        return;
      case "speech.error":
        this.playback.stop();
        const failedEntryId = activeRequest.entryId;
        this.activeRequest = undefined;
        this.setSnapshot({
          enabled: this.settings.enabled,
          status: "error",
          activeEntryId: failedEntryId,
          error: message.message
        });
        return;
    }
  }

  private setSnapshot(snapshot: TranscriptSpeechSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }

  private finishPlaybackForRequest(requestId: string): void {
    const activeRequest = this.activeRequest;
    if (!activeRequest || activeRequest.requestId !== requestId) return;
    this.playback.stop();
    this.activeRequest = undefined;
    this.setSnapshot({ enabled: this.settings.enabled, status: "idle", activeEntryId: undefined });
  }

  private stopLocalPlayback(): void {
    this.playback.stop();
    this.activeRequest = undefined;
    this.setSnapshot({ enabled: this.settings.enabled, status: "idle", activeEntryId: undefined });
  }
}

export class MediaSourceSpeechPlaybackGateway implements TranscriptSpeechPlaybackGateway {
  private audio: HTMLAudioElement | undefined;
  private mediaSource: MediaSource | undefined;
  private sourceBuffer: SourceBuffer | undefined;
  private objectUrl: string | undefined;
  private pendingChunks: Uint8Array[] = [];
  private streamFinished = false;
  private playbackGeneration = 0;

  start(mimeType: string, onEnded: () => void): void {
    this.stop();
    const generation = this.nextPlaybackGeneration();
    const mediaSource = new MediaSource();
    const audio = new Audio();
    this.audio = audio;
    this.mediaSource = mediaSource;
    this.objectUrl = URL.createObjectURL(mediaSource);
    audio.src = this.objectUrl;
    audio.addEventListener("ended", onEnded, { once: true });
    mediaSource.addEventListener(
      "sourceopen",
      () => {
        if (!this.isCurrentPlayback(generation, mediaSource) || mediaSource.readyState !== "open") return;
        const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        this.sourceBuffer = sourceBuffer;
        sourceBuffer.addEventListener("updateend", () => {
          if (!this.isCurrentPlayback(generation, mediaSource, sourceBuffer)) return;
          this.flushPendingChunks(generation);
        });
        this.flushPendingChunks(generation);
      },
      { once: true }
    );
  }

  appendChunk(chunk: Uint8Array): void {
    this.pendingChunks.push(chunk);
    this.flushPendingChunks(this.playbackGeneration);
  }

  play(): void {
    void this.audio?.play().catch(() => undefined);
  }

  pause(): void {
    this.audio?.pause();
  }

  resume(): void {
    this.play();
  }

  stop(): void {
    this.nextPlaybackGeneration();
    this.audio?.pause();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.audio = undefined;
    this.mediaSource = undefined;
    this.sourceBuffer = undefined;
    this.objectUrl = undefined;
    this.pendingChunks = [];
    this.streamFinished = false;
  }

  finish(): void {
    this.streamFinished = true;
    this.flushPendingChunks(this.playbackGeneration);
  }

  private flushPendingChunks(generation: number): void {
    const mediaSource = this.mediaSource;
    const sourceBuffer = this.sourceBuffer;
    if (!mediaSource || !sourceBuffer || !this.isCurrentPlayback(generation, mediaSource, sourceBuffer) || sourceBuffer.updating) return;

    const nextChunk = this.pendingChunks.shift();
    if (nextChunk) {
      sourceBuffer.appendBuffer(copyToArrayBuffer(nextChunk));
      return;
    }

    if (this.streamFinished && mediaSource.readyState === "open") {
      mediaSource.endOfStream();
    }
  }

  private nextPlaybackGeneration(): number {
    this.playbackGeneration += 1;
    return this.playbackGeneration;
  }

  private isCurrentPlayback(generation: number, mediaSource: MediaSource, sourceBuffer?: SourceBuffer): boolean {
    return (
      this.playbackGeneration === generation &&
      this.mediaSource === mediaSource &&
      (sourceBuffer === undefined || this.sourceBuffer === sourceBuffer)
    );
  }
}

function normalizeSpeechText(text: string, maxCharacters: number): string {
  return text.trim().slice(0, maxCharacters).trim();
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isSpeechMessageForRequest(
  message: BridgeToExtension,
  requestId: string
): message is Extract<BridgeToExtension, { type: "speech.started" | "speech.chunk" | "speech.done" | "speech.error" }> {
  return (
    (message.type === "speech.started" ||
      message.type === "speech.chunk" ||
      message.type === "speech.done" ||
      message.type === "speech.error") &&
    message.requestId === requestId
  );
}

function decodeBase64Audio(audioBase64: string): Uint8Array {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
