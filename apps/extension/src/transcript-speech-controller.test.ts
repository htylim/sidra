import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TRANSCRIPT_SPEECH_SETTINGS } from "./settings-store";
import type { BridgeToExtension, ExtensionToBridge } from "@sidra/protocol";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TranscriptSpeechController", () => {
  it("speech_idle_click_posts_synthesize_request", async () => {
    const { TranscriptSpeechController } = await import("./transcript-speech-controller");
    const transport = new FakeSpeechTransport();
    const playback = new FakeSpeechPlaybackGateway();
    const controller = new TranscriptSpeechController({
      transport,
      playback,
      settings: DEFAULT_TRANSCRIPT_SPEECH_SETTINGS,
      createRequestId: () => "speech-1"
    });

    expect(controller.toggleSpeech({ entryId: "entry-1", text: " Read this bubble. " })).toBe(true);

    expect(transport.postedMessages).toEqual([
      {
        type: "speech.synthesize",
        version: 4,
        requestId: "speech-1",
        text: "Read this bubble.",
        options: {
          model: "gpt-4o-mini-tts",
          voice: "marin",
          format: "mp3",
          speed: 1,
          instructions: DEFAULT_TRANSCRIPT_SPEECH_SETTINGS.instructions
        }
      }
    ]);
    expect(controller.getSnapshot()).toMatchObject({ activeEntryId: "entry-1", status: "loading" });
  });

  it("speech_controller_ignores_stale_chunks", async () => {
    const { TranscriptSpeechController } = await import("./transcript-speech-controller");
    const transport = new FakeSpeechTransport();
    const playback = new FakeSpeechPlaybackGateway();
    const requestIds = ["speech-1", "speech-2"];
    const controller = new TranscriptSpeechController({
      transport,
      playback,
      settings: DEFAULT_TRANSCRIPT_SPEECH_SETTINGS,
      createRequestId: () => requestIds.shift() ?? "speech-x"
    });

    controller.toggleSpeech({ entryId: "entry-1", text: "First" });
    controller.toggleSpeech({ entryId: "entry-2", text: "Second" });
    transport.emit({ type: "speech.started", version: 4, requestId: "speech-2", mimeType: "audio/mpeg" });
    transport.emit({ type: "speech.chunk", version: 4, requestId: "speech-1", sequence: 0, audioBase64: "AQ==" });
    transport.emit({ type: "speech.chunk", version: 4, requestId: "speech-2", sequence: 0, audioBase64: "Ag==" });

    expect(playback.chunks).toEqual([[2]]);
  });

  it("speech_controller_plays_after_first_chunk", async () => {
    const { controller, transport, playback } = await createStartedController();

    transport.emit({ type: "speech.chunk", version: 4, requestId: "speech-1", sequence: 0, audioBase64: "AQI=" });

    expect(playback.playCalls).toBe(1);
    expect(playback.chunks).toEqual([[1, 2]]);
    expect(controller.getSnapshot()).toMatchObject({ status: "playing" });
  });

  it("speech_done_returns_to_idle_after_playback_ends", async () => {
    const { controller, transport, playback } = await createPlayingController();

    transport.emit({ type: "speech.done", version: 4, requestId: "speech-1" });
    expect(controller.getSnapshot()).toMatchObject({ activeEntryId: "entry-1", status: "playing" });

    playback.finishPlayback();

    expect(playback.finishCalls).toBe(1);
    expect(playback.stopCalls).toBe(1);
    expect(controller.getSnapshot()).toMatchObject({ activeEntryId: undefined, status: "idle" });
  });

  it("playback_end_from_stale_request_is_ignored", async () => {
    const { controller, transport, playback } = await createPlayingController(["speech-1", "speech-2"]);
    const firstEnded = playback.endCallbacks[0];
    controller.toggleSpeech({ entryId: "entry-2", text: "Second bubble." });
    transport.emit({ type: "speech.started", version: 4, requestId: "speech-2", mimeType: "audio/mpeg" });

    firstEnded?.();

    expect(controller.getSnapshot()).toMatchObject({ activeEntryId: "entry-2", status: "loading" });
  });

  it("speech_error_keeps_active_entry_for_inline_feedback", async () => {
    const { controller, transport, playback } = await createStartedController();

    transport.emit({
      type: "speech.error",
      version: 4,
      requestId: "speech-1",
      code: "openai_api_key_missing",
      message: "OpenAI API key is not configured."
    });

    expect(playback.stopCalls).toBe(1);
    expect(controller.getSnapshot()).toMatchObject({
      activeEntryId: "entry-1",
      status: "error",
      error: "OpenAI API key is not configured."
    });
  });

  it("speech_playing_click_pauses_audio", async () => {
    const { controller, transport, playback } = await createPlayingController();

    controller.toggleSpeech({ entryId: "entry-1", text: "Read this." });

    expect(playback.pauseCalls).toBe(1);
    expect(transport.postedMessages.filter((message) => message.type === "speech.cancel")).toEqual([]);
    expect(controller.getSnapshot()).toMatchObject({ status: "paused" });
  });

  it("speech_paused_click_resumes_audio", async () => {
    const { controller, playback } = await createPlayingController();
    controller.toggleSpeech({ entryId: "entry-1", text: "Read this." });

    controller.toggleSpeech({ entryId: "entry-1", text: "Read this." });

    expect(playback.resumeCalls).toBe(1);
    expect(controller.getSnapshot()).toMatchObject({ status: "playing" });
  });

  it("speech_loading_click_cancels_request", async () => {
    const { TranscriptSpeechController } = await import("./transcript-speech-controller");
    const transport = new FakeSpeechTransport();
    const playback = new FakeSpeechPlaybackGateway();
    const controller = new TranscriptSpeechController({
      transport,
      playback,
      settings: DEFAULT_TRANSCRIPT_SPEECH_SETTINGS,
      createRequestId: () => "speech-1"
    });
    controller.toggleSpeech({ entryId: "entry-1", text: "Read this." });

    controller.toggleSpeech({ entryId: "entry-1", text: "Read this." });

    expect(transport.postedMessages.at(-1)).toEqual({ type: "speech.cancel", version: 4, requestId: "speech-1" });
    expect(playback.stopCalls).toBe(1);
    expect(controller.getSnapshot()).toMatchObject({ status: "idle", activeEntryId: undefined });
  });

  it("starting_another_bubble_stops_previous_audio", async () => {
    const { controller, transport, playback } = await createPlayingController(["speech-1", "speech-2"]);

    controller.toggleSpeech({ entryId: "entry-2", text: "Second bubble." });

    expect(playback.stopCalls).toBe(1);
    expect(transport.postedMessages).toContainEqual({ type: "speech.cancel", version: 4, requestId: "speech-1" });
    expect(transport.postedMessages.at(-1)).toMatchObject({
      type: "speech.synthesize",
      requestId: "speech-2",
      text: "Second bubble."
    });
  });

  it("speech_stops_on_bridge_disconnect_and_new_chat", async () => {
    const first = await createPlayingController(["speech-1", "speech-2"]);
    first.controller.stopActiveSpeech();
    first.controller.toggleSpeech({ entryId: "entry-2", text: "Second bubble." });
    first.controller.stopActiveSpeech();

    expect(first.playback.stopCalls).toBe(2);
    expect(first.transport.postedMessages).toContainEqual({ type: "speech.cancel", version: 4, requestId: "speech-1" });
    expect(first.transport.postedMessages).toContainEqual({ type: "speech.cancel", version: 4, requestId: "speech-2" });
  });

  it("local_speech_stop_does_not_post_cancel_to_bridge", async () => {
    const { controller, transport, playback } = await createPlayingController();

    controller.stopLocalSpeech();

    expect(playback.stopCalls).toBe(1);
    expect(transport.postedMessages).not.toContainEqual({ type: "speech.cancel", version: 4, requestId: "speech-1" });
    expect(controller.getSnapshot()).toMatchObject({ activeEntryId: undefined, status: "idle" });
  });

  it("disabling_speech_setting_stops_active_playback", async () => {
    const { controller, transport, playback } = await createPlayingController();

    controller.updateSettings({ ...DEFAULT_TRANSCRIPT_SPEECH_SETTINGS, enabled: false });

    expect(playback.stopCalls).toBe(1);
    expect(transport.postedMessages).toContainEqual({ type: "speech.cancel", version: 4, requestId: "speech-1" });
    expect(controller.getSnapshot()).toMatchObject({ enabled: false, status: "idle" });
  });

  it("media_source_playback_ignores_stale_sourceopen_events", async () => {
    const { MediaSourceSpeechPlaybackGateway } = await import("./transcript-speech-controller");
    const mediaEnvironment = installFakeMediaSourceEnvironment();
    try {
      const playback = new MediaSourceSpeechPlaybackGateway();

      playback.start("audio/mpeg", () => {});
      playback.appendChunk(new Uint8Array([1]));
      const firstMediaSource = mediaEnvironment.mediaSources[0];

      playback.stop();
      playback.start("audio/mpeg", () => {});
      playback.appendChunk(new Uint8Array([2]));
      const secondMediaSource = mediaEnvironment.mediaSources[1];

      firstMediaSource?.open();

      expect(mediaEnvironment.sourceBuffers).toHaveLength(0);

      secondMediaSource?.open();

      expect(mediaEnvironment.sourceBuffers).toHaveLength(1);
      expect(mediaEnvironment.sourceBuffers[0]?.appendedBuffers).toEqual([[2]]);
    } finally {
      mediaEnvironment.restore();
    }
  });

  it("media_source_playback_ignores_stale_updateend_events", async () => {
    const { MediaSourceSpeechPlaybackGateway } = await import("./transcript-speech-controller");
    const mediaEnvironment = installFakeMediaSourceEnvironment();
    try {
      const playback = new MediaSourceSpeechPlaybackGateway();

      playback.start("audio/mpeg", () => {});
      mediaEnvironment.mediaSources[0]?.open();
      const firstSourceBuffer = mediaEnvironment.sourceBuffers[0];

      playback.start("audio/mpeg", () => {});
      mediaEnvironment.mediaSources[1]?.open();
      const secondSourceBuffer = mediaEnvironment.sourceBuffers[1];
      if (!secondSourceBuffer) throw new Error("Expected current source buffer");

      secondSourceBuffer.updating = true;
      playback.appendChunk(new Uint8Array([3]));
      secondSourceBuffer.updating = false;
      firstSourceBuffer?.emitUpdateEnd();

      expect(secondSourceBuffer.appendedBuffers).toEqual([]);

      secondSourceBuffer.emitUpdateEnd();

      expect(secondSourceBuffer.appendedBuffers).toEqual([[3]]);
    } finally {
      mediaEnvironment.restore();
    }
  });
});

async function createStartedController(requestIds = ["speech-1"]) {
  const { TranscriptSpeechController } = await import("./transcript-speech-controller");
  const transport = new FakeSpeechTransport();
  const playback = new FakeSpeechPlaybackGateway();
  const controller = new TranscriptSpeechController({
    transport,
    playback,
    settings: DEFAULT_TRANSCRIPT_SPEECH_SETTINGS,
    createRequestId: () => requestIds.shift() ?? "speech-x"
  });
  controller.toggleSpeech({ entryId: "entry-1", text: "Read this." });
  transport.emit({ type: "speech.started", version: 4, requestId: "speech-1", mimeType: "audio/mpeg" });
  return { controller, transport, playback };
}

async function createPlayingController(requestIds = ["speech-1"]) {
  const started = await createStartedController(requestIds);
  started.transport.emit({ type: "speech.chunk", version: 4, requestId: "speech-1", sequence: 0, audioBase64: "AQ==" });
  return started;
}

class FakeSpeechTransport {
  readonly postedMessages: ExtensionToBridge[] = [];
  private readonly listeners = new Set<(message: BridgeToExtension) => void>();

  post(message: ExtensionToBridge) {
    this.postedMessages.push(message);
    return { ok: true as const };
  }

  subscribeToMessages(listener: (message: BridgeToExtension) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(message: BridgeToExtension): void {
    for (const listener of this.listeners) listener(message);
  }
}

class FakeSpeechPlaybackGateway {
  readonly chunks: number[][] = [];
  readonly endCallbacks: Array<() => void> = [];
  startCalls: string[] = [];
  playCalls = 0;
  pauseCalls = 0;
  resumeCalls = 0;
  stopCalls = 0;
  finishCalls = 0;

  start(mimeType: string, onEnded: () => void): void {
    this.startCalls.push(mimeType);
    this.endCallbacks.push(onEnded);
  }

  appendChunk(chunk: Uint8Array): void {
    this.chunks.push(Array.from(chunk));
  }

  play(): void {
    this.playCalls += 1;
  }

  pause(): void {
    this.pauseCalls += 1;
  }

  resume(): void {
    this.resumeCalls += 1;
  }

  stop(): void {
    this.stopCalls += 1;
  }

  finish(): void {
    this.finishCalls += 1;
  }

  finishPlayback(): void {
    this.endCallbacks.at(-1)?.();
  }
}

function installFakeMediaSourceEnvironment() {
  const mediaSources: FakeMediaSource[] = [];
  const sourceBuffers: FakeSourceBuffer[] = [];
  const originalCreateObjectUrl = readUrlStatic("createObjectURL");
  const originalRevokeObjectUrl = readUrlStatic("revokeObjectURL");

  vi.stubGlobal(
    "Audio",
    class {
      src = "";
      addEventListener() {}
      pause() {}
      async play() {}
    }
  );
  vi.stubGlobal(
    "MediaSource",
    class extends FakeMediaSource {
      constructor() {
        super(sourceBuffers);
        mediaSources.push(this);
      }
    }
  );
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:sidra-speech")
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn()
  });

  return {
    mediaSources,
    sourceBuffers,
    restore() {
      restoreUrlStatic("createObjectURL", originalCreateObjectUrl);
      restoreUrlStatic("revokeObjectURL", originalRevokeObjectUrl);
    }
  };
}

function readUrlStatic(name: "createObjectURL" | "revokeObjectURL"): unknown {
  return (URL as unknown as Record<string, unknown>)[name];
}

function restoreUrlStatic(name: "createObjectURL" | "revokeObjectURL", original: unknown): void {
  if (original === undefined) {
    delete (URL as unknown as Record<string, unknown>)[name];
    return;
  }
  Object.defineProperty(URL, name, { configurable: true, value: original });
}

class FakeMediaSource {
  readyState = "closed";
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(private readonly sourceBuffers: FakeSourceBuffer[]) {}

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  addSourceBuffer(): SourceBuffer {
    const sourceBuffer = new FakeSourceBuffer();
    this.sourceBuffers.push(sourceBuffer);
    return sourceBuffer as unknown as SourceBuffer;
  }

  endOfStream(): void {
    this.readyState = "ended";
  }

  open(): void {
    this.readyState = "open";
    for (const listener of this.listeners.get("sourceopen") ?? []) listener();
  }
}

class FakeSourceBuffer {
  readonly appendedBuffers: number[][] = [];
  updating = false;
  private readonly listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  appendBuffer(buffer: ArrayBuffer): void {
    this.appendedBuffers.push(Array.from(new Uint8Array(buffer)));
  }

  emitUpdateEnd(): void {
    for (const listener of this.listeners.get("updateend") ?? []) listener();
  }
}
