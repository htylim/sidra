import { useEffect, useRef, useState } from "react";
import type { QuickAction, QuickActionsSettings, SettingsStore } from "./settings-store";

type OptionsSettingsStore = Pick<SettingsStore, "getSnapshot" | "whenReady" | "subscribe" | "saveQuickActions">;
type QuickActionFieldName = "label" | "prompt";
type TouchedQuickActionFields = Record<string, Partial<Record<QuickActionFieldName, boolean>>>;

export function OptionsPageView(props: { settingsStore: OptionsSettingsStore }) {
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [touchedFields, setTouchedFields] = useState<TouchedQuickActionFields>({});
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
      const initialQuickActions = props.settingsStore.getSnapshot().quickActions;
      setQuickActions(initialQuickActions);
      setTouchedFields(touchedFieldsForInvalidActions(initialQuickActions.actions));
      setReady(true);
    });

    const unsubscribe = props.settingsStore.subscribe(() => {
      if (!cancelled && !dirtyRef.current) {
        const nextQuickActions = props.settingsStore.getSnapshot().quickActions;
        setQuickActions(nextQuickActions);
        setTouchedFields(touchedFieldsForInvalidActions(nextQuickActions.actions));
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [props.settingsStore]);

  function updateAction(actionId: string, fieldName: QuickActionFieldName, value: string) {
    markDirty();
    setSaveError(undefined);
    setTouchedFields((current) => ({
      ...current,
      [actionId]: { ...current[actionId], [fieldName]: true }
    }));
    setQuickActions((current) => ({
      ...current,
      actions: current.actions.map((action) => (action.id === actionId ? { ...action, [fieldName]: value } : action))
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
    setTouchedFields((current) => {
      const { [actionId]: _removed, ...remaining } = current;
      return remaining;
    });
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
          {quickActions.actions.map((action, index) => {
            const labelError = getVisibleFieldError(action, "label", touchedFields[action.id]?.label);
            const promptError = getVisibleFieldError(action, "prompt", touchedFields[action.id]?.prompt);
            const labelErrorId = quickActionFieldErrorId(action.id, "label");
            const promptErrorId = quickActionFieldErrorId(action.id, "prompt");

            return (
              <div className="action-row" key={action.id}>
                <label>
                  <span>Action label</span>
                  <input
                    aria-label={`Action ${index + 1} label`}
                    aria-invalid={labelError ? "true" : undefined}
                    aria-describedby={labelError ? labelErrorId : undefined}
                    value={action.label}
                    disabled={controlsDisabled}
                    onChange={(event) => updateAction(action.id, "label", event.currentTarget.value)}
                  />
                  {labelError ? (
                    <span className="validation-error" id={labelErrorId}>
                      {labelError}
                    </span>
                  ) : null}
                </label>
                <label>
                  <span>Action prompt</span>
                  <textarea
                    aria-label={`Action ${index + 1} prompt`}
                    aria-invalid={promptError ? "true" : undefined}
                    aria-describedby={promptError ? promptErrorId : undefined}
                    value={action.prompt}
                    disabled={controlsDisabled}
                    onChange={(event) => updateAction(action.id, "prompt", event.currentTarget.value)}
                  />
                  {promptError ? (
                    <span className="validation-error" id={promptErrorId}>
                      {promptError}
                    </span>
                  ) : null}
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
            );
          })}
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
          <button
            type="button"
            className="send-button"
            disabled={!canSave}
            aria-busy={saving ? "true" : undefined}
            onClick={() => void save()}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </section>
    </main>
  );
}

function isValidActionDraft(action: QuickAction): boolean {
  return action.label.trim().length > 0 && action.prompt.trim().length > 0;
}

function getVisibleFieldError(action: QuickAction, fieldName: QuickActionFieldName, touched: boolean | undefined): string | undefined {
  if (!touched) return undefined;
  if (action[fieldName].trim().length > 0) return undefined;
  return fieldName === "label" ? "Action label is required." : "Action prompt is required.";
}

function quickActionFieldErrorId(actionId: string, fieldName: QuickActionFieldName): string {
  return `quick-action-${domSafeIdSegment(actionId)}-${fieldName}-error`;
}

function domSafeIdSegment(value: string): string {
  return Array.from(value, (character) => character.codePointAt(0)?.toString(36) ?? "0").join("-");
}

function touchedFieldsForInvalidActions(actions: QuickAction[]): TouchedQuickActionFields {
  const touchedFields: TouchedQuickActionFields = {};

  for (const action of actions) {
    const fieldState: Partial<Record<QuickActionFieldName, boolean>> = {};
    if (action.label.trim().length === 0) fieldState.label = true;
    if (action.prompt.trim().length === 0) fieldState.prompt = true;
    if (fieldState.label || fieldState.prompt) touchedFields[action.id] = fieldState;
  }

  return touchedFields;
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
