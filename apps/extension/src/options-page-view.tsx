import { useEffect, useRef, useState } from "react";
import type { QuickAction, QuickActionsSettings, SettingsStore } from "./settings-store";

type OptionsSettingsStore = Pick<SettingsStore, "getSnapshot" | "whenReady" | "subscribe" | "saveQuickActions">;

export function OptionsPageView(props: { settingsStore: OptionsSettingsStore }) {
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [quickActions, setQuickActions] = useState<QuickActionsSettings>(() => ({
    enabled: true,
    actions: []
  }));
  const canSave = ready && !saving && quickActions.actions.every(isValidActionDraft);
  const controlsDisabled = !ready || saving;

  function markDirty() {
    dirtyRef.current = true;
    setDirty(true);
  }

  useEffect(() => {
    let cancelled = false;
    props.settingsStore.whenReady().then(() => {
      if (cancelled) return;
      setQuickActions(props.settingsStore.getSnapshot().quickActions);
      setReady(true);
    });

    const unsubscribe = props.settingsStore.subscribe(() => {
      if (!cancelled && !dirtyRef.current) setQuickActions(props.settingsStore.getSnapshot().quickActions);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [props.settingsStore]);

  function updateAction(actionId: string, changes: Partial<Pick<QuickAction, "label" | "prompt">>) {
    markDirty();
    setSaveError(undefined);
    setQuickActions((current) => ({
      ...current,
      actions: current.actions.map((action) => (action.id === actionId ? { ...action, ...changes } : action))
    }));
  }

  function addAction() {
    markDirty();
    setSaveError(undefined);
    setQuickActions((current) => ({
      ...current,
      actions: [
        ...current.actions,
        {
          id: nextDraftActionId(current.actions),
          label: "New action",
          prompt: "Ask about this page"
        }
      ]
    }));
  }

  function removeAction(actionId: string) {
    markDirty();
    setSaveError(undefined);
    setQuickActions((current) => ({
      ...current,
      actions: current.actions.filter((action) => action.id !== actionId)
    }));
  }

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(undefined);
    try {
      await props.settingsStore.saveQuickActions(quickActions);
      dirtyRef.current = false;
      setDirty(false);
      setQuickActions(props.settingsStore.getSnapshot().quickActions);
    } catch {
      setSaveError("Could not save quick actions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="options-page">
      <header className="options-header">
        <h1>Sidra Settings</h1>
      </header>

      <section className="options-section" aria-label="Quick actions">
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={quickActions.enabled}
            disabled={controlsDisabled}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              markDirty();
              setSaveError(undefined);
              setQuickActions((current) => ({ ...current, enabled }));
            }}
          />
          <span>Enable quick actions</span>
        </label>

        <div className="action-list">
          {quickActions.actions.map((action, index) => (
            <div className="action-row" key={action.id}>
              <label>
                <span>Action label</span>
                <input
                  aria-label={`Action ${index + 1} label`}
                  value={action.label}
                  disabled={controlsDisabled}
                  onChange={(event) => updateAction(action.id, { label: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>Action prompt</span>
                <textarea
                  aria-label={`Action ${index + 1} prompt`}
                  value={action.prompt}
                  disabled={controlsDisabled}
                  onChange={(event) => updateAction(action.id, { prompt: event.currentTarget.value })}
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                aria-label={`Remove action ${index + 1}`}
                disabled={controlsDisabled}
                onClick={() => removeAction(action.id)}
              >
                Remove action
              </button>
            </div>
          ))}
        </div>

        {saveError ? (
          <div className="settings-error" role="alert">
            {saveError}
          </div>
        ) : null}

        <div className="options-actions">
          <button type="button" className="secondary-button" disabled={controlsDisabled} onClick={addAction}>
            Add action
          </button>
          <button type="button" className="send-button" disabled={!canSave} onClick={() => void save()}>
            Save
          </button>
        </div>
      </section>
    </main>
  );
}

function isValidActionDraft(action: QuickAction): boolean {
  return action.label.trim().length > 0 && action.prompt.trim().length > 0;
}

function nextDraftActionId(actions: QuickAction[]): string {
  let index = actions.length;
  let id = `quick-action-${index}`;
  const usedIds = new Set(actions.map((action) => action.id));
  while (usedIds.has(id)) {
    index += 1;
    id = `quick-action-${index}`;
  }
  return id;
}
