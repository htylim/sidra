import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS,
  DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS,
  MAX_DOM_CONTENT_LIMIT_CHARACTERS,
  MAX_READABLE_CONTENT_LIMIT_CHARACTERS,
  MIN_DOM_CONTENT_LIMIT_CHARACTERS,
  MIN_READABLE_CONTENT_LIMIT_CHARACTERS,
  SIDRA_SETTINGS_STORAGE_KEY,
  SettingsStore,
  type SettingsStorageArea,
  type SettingsStorageChange,
  type SettingsStorageGateway
} from "./settings-store";

describe("SettingsStore", () => {
  it("loads_default_readable_content_limit_when_storage_is_empty", async () => {
    const store = new SettingsStore({ storage: new FakeSettingsStorage() });

    await store.start();

    expect(store.getSnapshot()).toEqual({
      domContentLimitCharacters: DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS,
      readableContentLimitCharacters: DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS
    });
  });

  it("loads_stored_readable_content_limit_when_valid", async () => {
    const store = new SettingsStore({
      storage: new FakeSettingsStorage({
        [SIDRA_SETTINGS_STORAGE_KEY]: { readableContentLimitCharacters: 42_000 }
      })
    });

    await store.start();

    expect(store.getSnapshot()).toEqual({
      domContentLimitCharacters: DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS,
      readableContentLimitCharacters: 42_000
    });
  });

  it("loads_default_dom_content_limit_when_storage_is_empty", async () => {
    const store = new SettingsStore({ storage: new FakeSettingsStorage() });

    await store.start();

    expect(store.getSnapshot().domContentLimitCharacters).toBe(DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS);
  });

  it("loads_stored_dom_content_limit_when_valid", async () => {
    const store = new SettingsStore({
      storage: new FakeSettingsStorage({
        [SIDRA_SETTINGS_STORAGE_KEY]: { domContentLimitCharacters: 222_000 }
      })
    });

    await store.start();

    expect(store.getSnapshot()).toEqual({
      domContentLimitCharacters: 222_000,
      readableContentLimitCharacters: DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS
    });
  });

  it("returns_snapshots_that_cannot_mutate_store_state", async () => {
    const store = new SettingsStore({ storage: new FakeSettingsStorage() });
    await store.start();

    const snapshot = store.getSnapshot();
    snapshot.readableContentLimitCharacters = 1;
    snapshot.domContentLimitCharacters = 1;

    expect(store.getSnapshot().readableContentLimitCharacters).toBe(DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS);
    expect(store.getSnapshot().domContentLimitCharacters).toBe(DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS);
  });

  it("ignores_invalid_readable_content_limit_and_keeps_default", async () => {
    const invalidValues = [
      undefined,
      "120000",
      12.5,
      MIN_READABLE_CONTENT_LIMIT_CHARACTERS - 1,
      MAX_READABLE_CONTENT_LIMIT_CHARACTERS + 1
    ];

    for (const value of invalidValues) {
      const store = new SettingsStore({
        storage: new FakeSettingsStorage({
          [SIDRA_SETTINGS_STORAGE_KEY]: { readableContentLimitCharacters: value }
        })
      });

      await store.start();

      expect(store.getSnapshot().readableContentLimitCharacters).toBe(DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS);
    }
  });

  it("ignores_invalid_dom_content_limit_and_keeps_default", async () => {
    const invalidValues = [
      undefined,
      "300000",
      12.5,
      MIN_DOM_CONTENT_LIMIT_CHARACTERS - 1,
      MAX_DOM_CONTENT_LIMIT_CHARACTERS + 1
    ];

    for (const value of invalidValues) {
      const store = new SettingsStore({
        storage: new FakeSettingsStorage({
          [SIDRA_SETTINGS_STORAGE_KEY]: { domContentLimitCharacters: value }
        })
      });

      await store.start();

      expect(store.getSnapshot().domContentLimitCharacters).toBe(DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS);
    }
  });

  it("keeps_valid_readable_limit_when_dom_limit_is_invalid", async () => {
    const store = new SettingsStore({
      storage: new FakeSettingsStorage({
        [SIDRA_SETTINGS_STORAGE_KEY]: {
          readableContentLimitCharacters: 42_000,
          domContentLimitCharacters: MAX_DOM_CONTENT_LIMIT_CHARACTERS + 1
        }
      })
    });

    await store.start();

    expect(store.getSnapshot()).toEqual({
      domContentLimitCharacters: DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS,
      readableContentLimitCharacters: 42_000
    });
  });

  it("keeps_valid_dom_limit_when_readable_limit_is_invalid", async () => {
    const store = new SettingsStore({
      storage: new FakeSettingsStorage({
        [SIDRA_SETTINGS_STORAGE_KEY]: {
          readableContentLimitCharacters: MAX_READABLE_CONTENT_LIMIT_CHARACTERS + 1,
          domContentLimitCharacters: 222_000
        }
      })
    });

    await store.start();

    expect(store.getSnapshot()).toEqual({
      domContentLimitCharacters: 222_000,
      readableContentLimitCharacters: DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS
    });
  });

  it("resolves_initial_readiness_only_after_storage_load_completes", async () => {
    let resolveGet: ((value: Record<string, unknown>) => void) | undefined;
    const storage = new FakeSettingsStorage();
    storage.getOverride = () =>
      new Promise((resolve) => {
        resolveGet = resolve;
      });
    const store = new SettingsStore({ storage });
    let ready = false;

    const readiness = store.whenReady().then(() => {
      ready = true;
    });

    await Promise.resolve();
    expect(ready).toBe(false);

    resolveGet?.({ [SIDRA_SETTINGS_STORAGE_KEY]: { readableContentLimitCharacters: 2_000 } });
    await readiness;

    expect(ready).toBe(true);
    expect(store.getSnapshot().readableContentLimitCharacters).toBe(2_000);
  });

  it("applies_live_readable_content_limit_changes_from_local_storage", async () => {
    const storage = new FakeSettingsStorage();
    const store = new SettingsStore({ storage });
    let notificationCount = 0;
    store.subscribe(() => {
      notificationCount += 1;
    });
    await store.start();

    storage.emitChange(
      {
        [SIDRA_SETTINGS_STORAGE_KEY]: {
          newValue: { readableContentLimitCharacters: 5_000 }
        }
      },
      "local"
    );

    expect(store.getSnapshot().readableContentLimitCharacters).toBe(5_000);
    expect(notificationCount).toBe(1);
  });

  it("applies_live_dom_content_limit_changes_from_local_storage", async () => {
    const storage = new FakeSettingsStorage();
    const store = new SettingsStore({ storage });
    let notificationCount = 0;
    store.subscribe(() => {
      notificationCount += 1;
    });
    await store.start();

    storage.emitChange(
      {
        [SIDRA_SETTINGS_STORAGE_KEY]: {
          newValue: { domContentLimitCharacters: 444_000 }
        }
      },
      "local"
    );

    expect(store.getSnapshot().domContentLimitCharacters).toBe(444_000);
    expect(notificationCount).toBe(1);
  });

  it("does_not_overwrite_live_setting_change_when_initial_storage_load_finishes_late", async () => {
    let resolveGet: ((value: Record<string, unknown>) => void) | undefined;
    const storage = new FakeSettingsStorage();
    storage.getOverride = () =>
      new Promise((resolve) => {
        resolveGet = resolve;
      });
    const store = new SettingsStore({ storage });
    const readiness = store.start();

    storage.emitChange(
      {
        [SIDRA_SETTINGS_STORAGE_KEY]: {
          newValue: { readableContentLimitCharacters: 5_000 }
        }
      },
      "local"
    );
    resolveGet?.({ [SIDRA_SETTINGS_STORAGE_KEY]: { readableContentLimitCharacters: 2_000 } });
    await readiness;

    expect(store.getSnapshot().readableContentLimitCharacters).toBe(5_000);
  });

  it("uses_initial_storage_load_when_no_live_setting_change_races_it", async () => {
    let resolveGet: ((value: Record<string, unknown>) => void) | undefined;
    const storage = new FakeSettingsStorage();
    storage.getOverride = () =>
      new Promise((resolve) => {
        resolveGet = resolve;
      });
    const store = new SettingsStore({ storage });
    const readiness = store.start();

    resolveGet?.({ [SIDRA_SETTINGS_STORAGE_KEY]: { readableContentLimitCharacters: 2_000 } });
    await readiness;

    expect(store.getSnapshot().readableContentLimitCharacters).toBe(2_000);
  });

  it("ignores_stale_initial_storage_load_after_stop_and_restart", async () => {
    const pendingGets: Array<(value: Record<string, unknown>) => void> = [];
    const storage = new FakeSettingsStorage();
    storage.getOverride = () =>
      new Promise((resolve) => {
        pendingGets.push(resolve);
      });
    const store = new SettingsStore({ storage });
    const firstStart = store.start();

    store.stop();
    const secondStart = store.start();

    pendingGets[1]?.({
      [SIDRA_SETTINGS_STORAGE_KEY]: {
        readableContentLimitCharacters: 4_000,
        domContentLimitCharacters: 444_000
      }
    });
    await secondStart;

    pendingGets[0]?.({
      [SIDRA_SETTINGS_STORAGE_KEY]: {
        readableContentLimitCharacters: 2_000,
        domContentLimitCharacters: 222_000
      }
    });
    await firstStart;

    expect(store.getSnapshot()).toEqual({
      readableContentLimitCharacters: 4_000,
      domContentLimitCharacters: 444_000
    });
  });

  it("ignores_live_setting_changes_from_other_storage_areas", async () => {
    const storage = new FakeSettingsStorage();
    const store = new SettingsStore({ storage });
    await store.start();

    storage.emitChange(
      {
        [SIDRA_SETTINGS_STORAGE_KEY]: {
          newValue: { readableContentLimitCharacters: 5_000 }
        }
      },
      "sync"
    );

    expect(store.getSnapshot().readableContentLimitCharacters).toBe(DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS);
  });
});

class FakeSettingsStorage implements SettingsStorageGateway {
  getOverride?: (key: string) => Promise<Record<string, unknown>>;
  private readonly listeners: Array<(changes: Record<string, SettingsStorageChange>, areaName: SettingsStorageArea) => void> = [];

  constructor(private readonly stored: Record<string, unknown> = {}) {}

  async get(key: string): Promise<Record<string, unknown>> {
    if (this.getOverride) return this.getOverride(key);
    return key in this.stored ? { [key]: this.stored[key] } : {};
  }

  subscribeToChanges(listener: (changes: Record<string, SettingsStorageChange>, areaName: SettingsStorageArea) => void): () => void {
    this.listeners.push(listener);
    return () => undefined;
  }

  emitChange(changes: Record<string, SettingsStorageChange>, areaName: SettingsStorageArea): void {
    for (const listener of this.listeners) listener(changes, areaName);
  }
}
