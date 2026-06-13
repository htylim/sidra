import type { SpeechVoice } from "@sidra/protocol";
import { DEFAULT_TRANSCRIPT_SPEECH_SETTINGS, type TranscriptSpeechSettings } from "./settings-store";
import { TranscriptSpeechController, type TranscriptSpeechPlaybackGateway, type TranscriptSpeechTransport } from "./transcript-speech-controller";

export const SETTINGS_SPEECH_SAMPLE_TEXT =
  "This is Sidra reading a short sample. The voice, speed, and instructions come from these settings.";

export type SpeechPreviewSettings = {
  voice: SpeechVoice;
  speed: number;
  instructions: string;
};

export type SpeechPreviewSnapshot = {
  status: "idle" | "loading" | "playing" | "paused" | "error";
  error?: string;
};

export class SpeechPreviewClient {
  private readonly controller: TranscriptSpeechController;

  constructor(options: {
    transport: TranscriptSpeechTransport;
    playback: TranscriptSpeechPlaybackGateway;
    createRequestId?: () => string;
  }) {
    this.controller = new TranscriptSpeechController({
      transport: options.transport,
      playback: options.playback,
      settings: createPreviewTranscriptSpeechSettings(DEFAULT_TRANSCRIPT_SPEECH_SETTINGS),
      createRequestId: options.createRequestId
    });
  }

  getSnapshot = (): SpeechPreviewSnapshot => {
    const snapshot = this.controller.getSnapshot();
    return { status: snapshot.status, error: snapshot.error };
  };

  subscribe(listener: () => void): () => void {
    return this.controller.subscribe(listener);
  }

  playSample(settings: SpeechPreviewSettings): { ok: true } | { ok: false; error: string } {
    this.controller.updateSettings(createPreviewTranscriptSpeechSettings(settings));
    const started = this.controller.toggleSpeech({
      entryId: "settings-speech-preview",
      text: SETTINGS_SPEECH_SAMPLE_TEXT
    });
    return started ? { ok: true } : { ok: false, error: "Could not start speech sample." };
  }

  dispose(): void {
    this.controller.dispose();
  }
}

function createPreviewTranscriptSpeechSettings(settings: SpeechPreviewSettings): TranscriptSpeechSettings {
  return {
    enabled: true,
    voice: settings.voice,
    speed: settings.speed,
    instructions: settings.instructions,
    maxCharactersPerBubble: SETTINGS_SPEECH_SAMPLE_TEXT.length
  };
}
