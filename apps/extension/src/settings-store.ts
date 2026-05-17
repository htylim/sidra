export type SidraSettings = {
  readableContentLimitCharacters: number;
};

export type SettingsStorageArea = "local" | "sync" | "managed" | "session";

export type SettingsStorageChange = {
  oldValue?: unknown;
  newValue?: unknown;
};

export type SettingsStorageGateway = {
  get(key: string): Promise<Record<string, unknown>>;
  subscribeToChanges(listener: (changes: Record<string, SettingsStorageChange>, areaName: SettingsStorageArea) => void): () => void;
};

type Listener = () => void;

export const DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS = 120_000;
export const MIN_READABLE_CONTENT_LIMIT_CHARACTERS = 1_000;
export const MAX_READABLE_CONTENT_LIMIT_CHARACTERS = 500_000;
export const SIDRA_SETTINGS_STORAGE_KEY = "sidra.settings.v1";

export class SettingsStore {
  private readonly storage: SettingsStorageGateway;
  private readonly listeners = new Set<Listener>();
  private snapshot: SidraSettings = defaultSidraSettings();
  private startPromise?: Promise<void>;
  private unsubscribeFromStorage?: () => void;
  private liveChangeGeneration = 0;

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
    this.startPromise = this.loadInitialSettings();
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
  }

  private async loadInitialSettings(): Promise<void> {
    const generationAtLoadStart = this.liveChangeGeneration;
    let stored: unknown;
    try {
      stored = (await this.storage.get(SIDRA_SETTINGS_STORAGE_KEY))[SIDRA_SETTINGS_STORAGE_KEY];
    } catch {
      stored = undefined;
    }

    if (this.liveChangeGeneration !== generationAtLoadStart) return;
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
    if (nextSnapshot.readableContentLimitCharacters === this.snapshot.readableContentLimitCharacters) return;
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
  if (!isValidReadableContentLimit(readableContentLimitCharacters)) {
    return defaultSidraSettings();
  }

  return { readableContentLimitCharacters };
}

function defaultSidraSettings(): SidraSettings {
  return { readableContentLimitCharacters: DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS };
}

function cloneSettings(settings: SidraSettings): SidraSettings {
  return { readableContentLimitCharacters: settings.readableContentLimitCharacters };
}

function isValidReadableContentLimit(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_READABLE_CONTENT_LIMIT_CHARACTERS &&
    value <= MAX_READABLE_CONTENT_LIMIT_CHARACTERS
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
