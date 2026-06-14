import type { SpeechVoice } from "@sidra/protocol";

export type SidraSettings = {
  readableContentLimitCharacters: number;
  domContentLimitCharacters: number;
  accentColor: string;
  promptFontSizePx: number;
  responseFontSizePx: number;
  quickActions: QuickActionsSettings;
  transcriptSpeech: TranscriptSpeechSettings;
};

export type TranscriptSpeechVoice = SpeechVoice;

export type TranscriptSpeechSettings = {
  enabled: boolean;
  voice: TranscriptSpeechVoice;
  speed: number;
  instructions: string;
  maxCharactersPerBubble: number;
};

export type QuickAction = {
  id: string;
  label: string;
  prompt: string;
};

export type QuickActionsSettings = {
  enabled: boolean;
  actions: QuickAction[];
};

export type SettingsStorageArea = "local" | "sync" | "managed" | "session";

export type SettingsStorageChange = {
  oldValue?: unknown;
  newValue?: unknown;
};

export type SettingsStorageGateway = {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  subscribeToChanges(listener: (changes: Record<string, SettingsStorageChange>, areaName: SettingsStorageArea) => void): () => void;
};

type Listener = () => void;

export const DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS = 120_000;
export const MIN_READABLE_CONTENT_LIMIT_CHARACTERS = 1_000;
export const MAX_READABLE_CONTENT_LIMIT_CHARACTERS = 500_000;
export const DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS = 300_000;
export const MIN_DOM_CONTENT_LIMIT_CHARACTERS = 1_000;
export const MAX_DOM_CONTENT_LIMIT_CHARACTERS = 750_000;
export const DEFAULT_ACCENT_COLOR = "#087c71";
export const DEFAULT_PROMPT_FONT_SIZE_PX = 15;
export const DEFAULT_RESPONSE_FONT_SIZE_PX = 17;
export const MIN_TRANSCRIPT_FONT_SIZE_PX = 12;
export const MAX_TRANSCRIPT_FONT_SIZE_PX = 22;
export const TRANSCRIPT_SPEECH_VOICES: TranscriptSpeechVoice[] = [
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse"
];
export const DEFAULT_TRANSCRIPT_SPEECH_INSTRUCTIONS =
  "Read naturally and clearly. Preserve the text language. Use a calm conversational tone.";
export const DEFAULT_TRANSCRIPT_SPEECH_SETTINGS: TranscriptSpeechSettings = {
  enabled: true,
  voice: "marin",
  speed: 1,
  instructions: DEFAULT_TRANSCRIPT_SPEECH_INSTRUCTIONS,
  maxCharactersPerBubble: 12_000
};
export const MIN_TRANSCRIPT_SPEECH_SPEED = 0.75;
export const MAX_TRANSCRIPT_SPEECH_SPEED = 1.5;
export const TRANSCRIPT_SPEECH_SPEED_STEP = 0.05;
export const MAX_TRANSCRIPT_SPEECH_INSTRUCTIONS_CHARACTERS = 600;
export const MIN_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS = 500;
export const MAX_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS = 50_000;
export const SIDRA_SETTINGS_STORAGE_KEY = "sidra.settings.v1";
export const DEFAULT_SUMMARIZE_PAGE_QUICK_ACTION_PROMPT = `Summarize this article following the instructions below.

- Make the response in the same language of the article. If the article is in Spanish, use Spanish, if it's in English, use English.
- For doing the summary create a bullet PER PARAGRAPH of the article. If the article has 10 paragraph, create 10 bullets. Each bullet should be the summary of that paragraph. Make each paragraph summary precise and concise to capture the main points of that paragraph.
- Focus on main ideas, key events, important people, and impactful statistics.
- Ensure sentences are short and clear for better speech quality.
- Avoid complex punctuation; prefer commas and periods.
- Note that the supplied page content may include more than just the article we want summarized. If that's the case ignore anything but the article.`;
export const DEFAULT_QUICK_ACTIONS_SETTINGS: QuickActionsSettings = {
  enabled: true,
  actions: [
    {
      id: "summarize-page",
      label: "Summarize this page",
      prompt: DEFAULT_SUMMARIZE_PAGE_QUICK_ACTION_PROMPT
    }
  ]
};

export class SettingsStore {
  private readonly storage: SettingsStorageGateway;
  private readonly listeners = new Set<Listener>();
  private snapshot: SidraSettings = defaultSidraSettings();
  private startPromise?: Promise<void>;
  private unsubscribeFromStorage?: () => void;
  private liveChangeGeneration = 0;
  private loadGeneration = 0;

  constructor(options: { storage: SettingsStorageGateway }) {
    this.storage = options.storage;
  }

  getSnapshot(): SidraSettings {
    return cloneSettings(this.snapshot);
  }

  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.unsubscribeFromStorage = this.storage.subscribeToChanges((changes, areaName) => {
      this.applyStorageChanges(changes, areaName);
    });
    this.loadGeneration += 1;
    this.startPromise = this.loadInitialSettings(this.loadGeneration);
    return this.startPromise;
  }

  whenReady(): Promise<void> {
    return this.start();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  stop(): void {
    this.unsubscribeFromStorage?.();
    this.unsubscribeFromStorage = undefined;
    this.startPromise = undefined;
    this.loadGeneration += 1;
  }

  async saveQuickActions(nextQuickActions: QuickActionsSettings): Promise<void> {
    const nextSnapshot = {
      ...this.getSnapshot(),
      quickActions: normalizeQuickActionsSettings(nextQuickActions, DEFAULT_QUICK_ACTIONS_SETTINGS)
    };
    await this.storage.set({ [SIDRA_SETTINGS_STORAGE_KEY]: cloneSettings(nextSnapshot) });
    this.setSnapshot(nextSnapshot);
  }

  async saveTranscriptFontSizesPx(nextFontSizesPx: {
    promptFontSizePx: number;
    responseFontSizePx: number;
  }): Promise<void> {
    const currentSnapshot = this.getSnapshot();
    const nextSnapshot = {
      ...currentSnapshot,
      promptFontSizePx: isValidTranscriptFontSize(nextFontSizesPx.promptFontSizePx)
        ? nextFontSizesPx.promptFontSizePx
        : currentSnapshot.promptFontSizePx,
      responseFontSizePx: isValidTranscriptFontSize(nextFontSizesPx.responseFontSizePx)
        ? nextFontSizesPx.responseFontSizePx
        : currentSnapshot.responseFontSizePx
    };
    await this.storage.set({ [SIDRA_SETTINGS_STORAGE_KEY]: cloneSettings(nextSnapshot) });
    this.setSnapshot(nextSnapshot);
  }

  async saveAccentColor(nextAccentColor: string): Promise<void> {
    const currentSnapshot = this.getSnapshot();
    const nextSnapshot = {
      ...currentSnapshot,
      accentColor: normalizeAccentColor(nextAccentColor) ?? currentSnapshot.accentColor
    };
    await this.storage.set({ [SIDRA_SETTINGS_STORAGE_KEY]: cloneSettings(nextSnapshot) });
    this.setSnapshot(nextSnapshot);
  }

  async saveTranscriptSpeechSettings(nextTranscriptSpeech: TranscriptSpeechSettings): Promise<void> {
    const nextSnapshot = {
      ...this.getSnapshot(),
      transcriptSpeech: normalizeTranscriptSpeechSettings(nextTranscriptSpeech, DEFAULT_TRANSCRIPT_SPEECH_SETTINGS)
    };
    await this.storage.set({ [SIDRA_SETTINGS_STORAGE_KEY]: cloneSettings(nextSnapshot) });
    this.setSnapshot(nextSnapshot);
  }

  private async loadInitialSettings(loadGeneration: number): Promise<void> {
    const generationAtLoadStart = this.liveChangeGeneration;
    let stored: unknown;
    try {
      stored = (await this.storage.get(SIDRA_SETTINGS_STORAGE_KEY))[SIDRA_SETTINGS_STORAGE_KEY];
    } catch {
      stored = undefined;
    }

    if (this.loadGeneration !== loadGeneration || this.liveChangeGeneration !== generationAtLoadStart) return;
    this.setSnapshot(parseStoredSettings(stored));
  }

  private applyStorageChanges(changes: Record<string, SettingsStorageChange>, areaName: SettingsStorageArea): void {
    if (areaName !== "local") return;
    const change = changes[SIDRA_SETTINGS_STORAGE_KEY];
    if (!change) return;
    this.liveChangeGeneration += 1;
    this.setSnapshot(parseStoredSettings(change.newValue));
  }

  private setSnapshot(nextSnapshot: SidraSettings): void {
    if (
      nextSnapshot.readableContentLimitCharacters === this.snapshot.readableContentLimitCharacters &&
      nextSnapshot.domContentLimitCharacters === this.snapshot.domContentLimitCharacters &&
      nextSnapshot.accentColor === this.snapshot.accentColor &&
      nextSnapshot.promptFontSizePx === this.snapshot.promptFontSizePx &&
      nextSnapshot.responseFontSizePx === this.snapshot.responseFontSizePx &&
      quickActionsMatch(nextSnapshot.quickActions, this.snapshot.quickActions) &&
      transcriptSpeechSettingsMatch(nextSnapshot.transcriptSpeech, this.snapshot.transcriptSpeech)
    ) {
      return;
    }
    this.snapshot = nextSnapshot;
    for (const listener of this.listeners) listener();
  }
}

export function createDefaultSettingsSource(): Pick<SettingsStore, "getSnapshot" | "whenReady"> {
  return {
    getSnapshot: () => defaultSidraSettings(),
    whenReady: async () => undefined
  };
}

export function createChromeSettingsStore(): SettingsStore {
  return new SettingsStore({
    storage: {
      get: (key) => chrome.storage.local.get(key),
      set: (values) => chrome.storage.local.set(values),
      subscribeToChanges(listener) {
        chrome.storage.onChanged.addListener(listener);
        return () => chrome.storage.onChanged.removeListener(listener);
      }
    }
  });
}

function parseStoredSettings(value: unknown): SidraSettings {
  if (!isRecord(value)) return defaultSidraSettings();

  const readableContentLimitCharacters = value.readableContentLimitCharacters;
  const domContentLimitCharacters = value.domContentLimitCharacters;
  const accentColor = value.accentColor;
  const promptFontSizePx = value.promptFontSizePx;
  const responseFontSizePx = value.responseFontSizePx;
  const legacyTranscriptFontSizePx = value.transcriptFontSizePx;
  const defaults = defaultSidraSettings();
  const legacyTranscriptFontSize = isValidTranscriptFontSize(legacyTranscriptFontSizePx)
    ? legacyTranscriptFontSizePx
    : undefined;

  return {
    readableContentLimitCharacters: isValidReadableContentLimit(readableContentLimitCharacters)
      ? readableContentLimitCharacters
      : defaults.readableContentLimitCharacters,
    domContentLimitCharacters: isValidDomContentLimit(domContentLimitCharacters)
      ? domContentLimitCharacters
      : defaults.domContentLimitCharacters,
    accentColor: normalizeAccentColor(accentColor) ?? defaults.accentColor,
    promptFontSizePx: isValidTranscriptFontSize(promptFontSizePx)
      ? promptFontSizePx
      : legacyTranscriptFontSize ?? defaults.promptFontSizePx,
    responseFontSizePx: isValidTranscriptFontSize(responseFontSizePx)
      ? responseFontSizePx
      : legacyTranscriptFontSize ?? defaults.responseFontSizePx,
    quickActions: parseQuickActionsSettings(value.quickActions),
    transcriptSpeech: parseTranscriptSpeechSettings(value.transcriptSpeech)
  };
}

function defaultSidraSettings(): SidraSettings {
  return {
    readableContentLimitCharacters: DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS,
    domContentLimitCharacters: DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS,
    accentColor: DEFAULT_ACCENT_COLOR,
    promptFontSizePx: DEFAULT_PROMPT_FONT_SIZE_PX,
    responseFontSizePx: DEFAULT_RESPONSE_FONT_SIZE_PX,
    quickActions: DEFAULT_QUICK_ACTIONS_SETTINGS,
    transcriptSpeech: DEFAULT_TRANSCRIPT_SPEECH_SETTINGS
  };
}

function cloneSettings(settings: SidraSettings): SidraSettings {
  return {
    readableContentLimitCharacters: settings.readableContentLimitCharacters,
    domContentLimitCharacters: settings.domContentLimitCharacters,
    accentColor: settings.accentColor,
    promptFontSizePx: settings.promptFontSizePx,
    responseFontSizePx: settings.responseFontSizePx,
    quickActions: cloneQuickActionsSettings(settings.quickActions),
    transcriptSpeech: { ...settings.transcriptSpeech }
  };
}

function parseTranscriptSpeechSettings(value: unknown): TranscriptSpeechSettings {
  if (!isRecord(value)) return { ...DEFAULT_TRANSCRIPT_SPEECH_SETTINGS };
  return normalizeTranscriptSpeechSettings(value, DEFAULT_TRANSCRIPT_SPEECH_SETTINGS);
}

function normalizeTranscriptSpeechSettings(value: unknown, fallback: TranscriptSpeechSettings): TranscriptSpeechSettings {
  if (!isRecord(value)) return { ...fallback };

  const enabled = typeof value.enabled === "boolean" ? value.enabled : fallback.enabled;
  const voice = isTranscriptSpeechVoice(value.voice) ? value.voice : fallback.voice;
  const speed = isValidTranscriptSpeechSpeed(value.speed) ? value.speed : fallback.speed;
  const instructions = normalizeSpeechInstructions(value.instructions, fallback.instructions);
  const maxCharactersPerBubble = isValidTranscriptSpeechBubbleLimit(value.maxCharactersPerBubble)
    ? value.maxCharactersPerBubble
    : fallback.maxCharactersPerBubble;

  return {
    enabled,
    voice,
    speed,
    instructions,
    maxCharactersPerBubble
  };
}

function parseQuickActionsSettings(value: unknown): QuickActionsSettings {
  if (!isRecord(value)) return cloneQuickActionsSettings(DEFAULT_QUICK_ACTIONS_SETTINGS);
  return normalizeQuickActionsSettings(value, DEFAULT_QUICK_ACTIONS_SETTINGS);
}

function normalizeQuickActionsSettings(value: unknown, fallback: QuickActionsSettings): QuickActionsSettings {
  if (!isRecord(value)) return cloneQuickActionsSettings(fallback);

  const enabled = typeof value.enabled === "boolean" ? value.enabled : fallback.enabled;
  if (!Array.isArray(value.actions)) return { enabled, actions: cloneQuickActions(fallback.actions) };

  return {
    enabled,
    actions: normalizeQuickActions(value.actions)
  };
}

function normalizeQuickActions(values: unknown[]): QuickAction[] {
  const usedIds = new Set<string>();
  const actions: QuickAction[] = [];

  values.forEach((value, sourceIndex) => {
    if (!isRecord(value)) return;

    const label = normalizeRequiredText(value.label);
    const prompt = normalizeRequiredText(value.prompt);
    if (!label || !prompt) return;

    const storedId = normalizeRequiredText(value.id);
    const id = storedId && !usedIds.has(storedId) ? storedId : createDeterministicQuickActionId(sourceIndex, usedIds);
    usedIds.add(id);
    actions.push({ id, label, prompt });
  });

  return actions;
}

function createDeterministicQuickActionId(sourceIndex: number, usedIds: Set<string>): string {
  let candidate = `quick-action-${sourceIndex}`;
  let suffix = sourceIndex + 1;
  while (usedIds.has(candidate)) {
    candidate = `quick-action-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function normalizeRequiredText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function cloneQuickActionsSettings(settings: QuickActionsSettings): QuickActionsSettings {
  return {
    enabled: settings.enabled,
    actions: cloneQuickActions(settings.actions)
  };
}

function cloneQuickActions(actions: QuickAction[]): QuickAction[] {
  return actions.map((action) => ({ ...action }));
}

function quickActionsMatch(first: QuickActionsSettings, second: QuickActionsSettings): boolean {
  if (first.enabled !== second.enabled) return false;
  if (first.actions.length !== second.actions.length) return false;
  return first.actions.every((action, index) => {
    const otherAction = second.actions[index];
    return action.id === otherAction.id && action.label === otherAction.label && action.prompt === otherAction.prompt;
  });
}

function transcriptSpeechSettingsMatch(first: TranscriptSpeechSettings, second: TranscriptSpeechSettings): boolean {
  return (
    first.enabled === second.enabled &&
    first.voice === second.voice &&
    first.speed === second.speed &&
    first.instructions === second.instructions &&
    first.maxCharactersPerBubble === second.maxCharactersPerBubble
  );
}

function isValidReadableContentLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_READABLE_CONTENT_LIMIT_CHARACTERS &&
    value <= MAX_READABLE_CONTENT_LIMIT_CHARACTERS
  );
}

function isValidDomContentLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_DOM_CONTENT_LIMIT_CHARACTERS &&
    value <= MAX_DOM_CONTENT_LIMIT_CHARACTERS
  );
}

function isValidTranscriptFontSize(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_TRANSCRIPT_FONT_SIZE_PX &&
    value <= MAX_TRANSCRIPT_FONT_SIZE_PX
  );
}

function normalizeAccentColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) return undefined;
  return trimmed.toLowerCase();
}

function isTranscriptSpeechVoice(value: unknown): value is TranscriptSpeechVoice {
  return typeof value === "string" && TRANSCRIPT_SPEECH_VOICES.includes(value as TranscriptSpeechVoice);
}

function isValidTranscriptSpeechSpeed(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_TRANSCRIPT_SPEECH_SPEED &&
    value <= MAX_TRANSCRIPT_SPEECH_SPEED
  );
}

function isValidTranscriptSpeechBubbleLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS &&
    value <= MAX_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS
  );
}

function normalizeSpeechInstructions(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length <= MAX_TRANSCRIPT_SPEECH_INSTRUCTIONS_CHARACTERS ? trimmed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
