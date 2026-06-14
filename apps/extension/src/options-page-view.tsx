import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { SpeechVoice } from "@sidra/protocol";
import type { SpeechCredentialClientSnapshot } from "./bridge/speech-credentials";
import { SidraIcon, type IconName } from "./sidra-icon";
import type { SpeechPreviewSettings, SpeechPreviewSnapshot } from "./speech-preview-client";
import {
  DEFAULT_TRANSCRIPT_SPEECH_SETTINGS,
  DEFAULT_ACCENT_COLOR,
  MAX_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS,
  MAX_TRANSCRIPT_SPEECH_INSTRUCTIONS_CHARACTERS,
  MAX_TRANSCRIPT_SPEECH_SPEED,
  MAX_TRANSCRIPT_FONT_SIZE_PX,
  MIN_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS,
  MIN_TRANSCRIPT_SPEECH_SPEED,
  MIN_TRANSCRIPT_FONT_SIZE_PX,
  TRANSCRIPT_SPEECH_SPEED_STEP,
  TRANSCRIPT_SPEECH_VOICES,
  type QuickAction,
  type QuickActionsSettings,
  type SettingsStore,
  type TranscriptSpeechSettings
} from "./settings-store";

type OptionsSettingsStore = Pick<
  SettingsStore,
  | "getSnapshot"
  | "whenReady"
  | "subscribe"
  | "saveQuickActions"
  | "saveAccentColor"
  | "saveTranscriptFontSizesPx"
  | "saveTranscriptSpeechSettings"
>;
type OptionsSpeechCredentialClient = {
  getSnapshot(): SpeechCredentialClientSnapshot;
  subscribe(listener: () => void): () => void;
  requestStatus(): void;
  saveApiKey(apiKey: string): { ok: true } | { ok: false; error: string };
  testApiKey(apiKey?: string): { ok: true } | { ok: false; error: string };
  removeApiKey(): { ok: true } | { ok: false; error: string };
};
type OptionsSpeechPreviewClient = {
  getSnapshot(): SpeechPreviewSnapshot;
  subscribe(listener: () => void): () => void;
  playSample(settings: SpeechPreviewSettings): { ok: true } | { ok: false; error: string };
};
type QuickActionFieldName = "label" | "prompt";
type TouchedQuickActionFields = Record<string, Partial<Record<QuickActionFieldName, boolean>>>;

const defaultSpeechCredentialSnapshot: SpeechCredentialClientSnapshot = {
  status: { configured: false },
  busy: false,
  disconnectGeneration: 0
};

const defaultSpeechCredentialClient: OptionsSpeechCredentialClient = {
  getSnapshot: () => defaultSpeechCredentialSnapshot,
  subscribe: () => () => undefined,
  requestStatus: () => undefined,
  saveApiKey: () => ({ ok: false, error: "Speech credential bridge is unavailable." }),
  testApiKey: () => ({ ok: false, error: "Speech credential bridge is unavailable." }),
  removeApiKey: () => ({ ok: false, error: "Speech credential bridge is unavailable." })
};
const defaultSpeechPreviewClient: OptionsSpeechPreviewClient = {
  getSnapshot: () => ({ status: "idle" }),
  subscribe: () => () => undefined,
  playSample: () => ({ ok: false, error: "Speech preview bridge is unavailable." })
};
const chromeStorageLabel = `chrome${"."}storage`;

export function OptionsPageView(props: {
  settingsStore: OptionsSettingsStore;
  speechCredentials?: OptionsSpeechCredentialClient;
  speechPreview?: OptionsSpeechPreviewClient;
}) {
  const speechCredentials = props.speechCredentials ?? defaultSpeechCredentialClient;
  const speechPreview = props.speechPreview ?? defaultSpeechPreviewClient;
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const quickActionsDirtyRef = useRef(false);
  const accentColorDirtyRef = useRef(false);
  const transcriptFontSizesDirtyRef = useRef(false);
  const transcriptSpeechDirtyRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | undefined>(undefined);
  const [touchedFields, setTouchedFields] = useState<TouchedQuickActionFields>({});
  const [promptFontSizeDraft, setPromptFontSizeDraft] = useState("");
  const [responseFontSizeDraft, setResponseFontSizeDraft] = useState("");
  const [accentColorDraft, setAccentColorDraft] = useState(DEFAULT_ACCENT_COLOR);
  const [promptFontSizeTouched, setPromptFontSizeTouched] = useState(false);
  const [responseFontSizeTouched, setResponseFontSizeTouched] = useState(false);
  const [speechEnabled, setSpeechEnabled] = useState(DEFAULT_TRANSCRIPT_SPEECH_SETTINGS.enabled);
  const [speechVoice, setSpeechVoice] = useState<SpeechVoice>(DEFAULT_TRANSCRIPT_SPEECH_SETTINGS.voice);
  const [speechSpeedDraft, setSpeechSpeedDraft] = useState(String(DEFAULT_TRANSCRIPT_SPEECH_SETTINGS.speed));
  const [speechInstructionsDraft, setSpeechInstructionsDraft] = useState(DEFAULT_TRANSCRIPT_SPEECH_SETTINGS.instructions);
  const [speechMaxCharactersDraft, setSpeechMaxCharactersDraft] = useState(
    String(DEFAULT_TRANSCRIPT_SPEECH_SETTINGS.maxCharactersPerBubble)
  );
  const [speechSpeedTouched, setSpeechSpeedTouched] = useState(false);
  const [speechInstructionsTouched, setSpeechInstructionsTouched] = useState(false);
  const [speechMaxCharactersTouched, setSpeechMaxCharactersTouched] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeyError, setApiKeyError] = useState<string | undefined>(undefined);
  const [credentialSnapshot, setCredentialSnapshot] = useState(() => speechCredentials.getSnapshot());
  const [speechPreviewSnapshot, setSpeechPreviewSnapshot] = useState(() => speechPreview.getSnapshot());
  const [quickActions, setQuickActions] = useState<QuickActionsSettings>(() => ({
    enabled: true,
    actions: []
  }));
  const promptFontSizeValue = Number(promptFontSizeDraft);
  const responseFontSizeValue = Number(responseFontSizeDraft);
  const speechSpeedValue = Number(speechSpeedDraft);
  const speechMaxCharactersValue = Number(speechMaxCharactersDraft);
  const promptFontSizeIsValid = isValidTranscriptFontSizeDraft(promptFontSizeDraft);
  const responseFontSizeIsValid = isValidTranscriptFontSizeDraft(responseFontSizeDraft);
  const speechSpeedIsValid = isValidSpeechSpeedDraft(speechSpeedDraft);
  const speechInstructionsAreValid = speechInstructionsDraft.trim().length <= MAX_TRANSCRIPT_SPEECH_INSTRUCTIONS_CHARACTERS;
  const speechMaxCharactersIsValid = isValidSpeechMaxCharactersDraft(speechMaxCharactersDraft);
  const promptFontSizeErrorId = "prompt-font-size-error";
  const responseFontSizeErrorId = "response-font-size-error";
  const speechSpeedErrorId = "speech-speed-error";
  const speechInstructionsErrorId = "speech-instructions-error";
  const speechMaxCharactersErrorId = "speech-max-characters-error";
  const promptFontSizeError =
    promptFontSizeTouched && !promptFontSizeIsValid
      ? `Enter a whole number from ${MIN_TRANSCRIPT_FONT_SIZE_PX} to ${MAX_TRANSCRIPT_FONT_SIZE_PX}.`
      : undefined;
  const responseFontSizeError =
    responseFontSizeTouched && !responseFontSizeIsValid
      ? `Enter a whole number from ${MIN_TRANSCRIPT_FONT_SIZE_PX} to ${MAX_TRANSCRIPT_FONT_SIZE_PX}.`
      : undefined;
  const speechSpeedError =
    speechSpeedTouched && !speechSpeedIsValid
      ? `Choose a speed from ${MIN_TRANSCRIPT_SPEECH_SPEED} to ${MAX_TRANSCRIPT_SPEECH_SPEED}.`
      : undefined;
  const speechInstructionsError =
    speechInstructionsTouched && !speechInstructionsAreValid
      ? `Use ${MAX_TRANSCRIPT_SPEECH_INSTRUCTIONS_CHARACTERS} characters or fewer.`
      : undefined;
  const speechMaxCharactersError =
    speechMaxCharactersTouched && !speechMaxCharactersIsValid
      ? `Enter a whole number from ${MIN_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS} to ${MAX_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS}.`
      : undefined;
  const canSave =
    ready &&
    dirty &&
    !saving &&
    quickActions.actions.every(isValidActionDraft) &&
    promptFontSizeIsValid &&
    responseFontSizeIsValid &&
    speechSpeedIsValid &&
    speechInstructionsAreValid &&
    speechMaxCharactersIsValid;
  const controlsDisabled = !ready || saving;
  const credentialControlsDisabled = controlsDisabled || credentialSnapshot.busy;
  const speechPreviewCanStart =
    ready &&
    !saving &&
    !credentialSnapshot.busy &&
    credentialSnapshot.status.configured &&
    speechSpeedIsValid &&
    speechInstructionsAreValid;

  function markQuickActionsDirty() {
    dirtyRef.current = true;
    quickActionsDirtyRef.current = true;
    setDirty(true);
    setSaveSuccessMessage(undefined);
  }

  function markAccentColorDirty() {
    dirtyRef.current = true;
    accentColorDirtyRef.current = true;
    setDirty(true);
    setSaveSuccessMessage(undefined);
  }

  function markTranscriptFontSizesDirty() {
    dirtyRef.current = true;
    transcriptFontSizesDirtyRef.current = true;
    setDirty(true);
    setSaveSuccessMessage(undefined);
  }

  function markTranscriptSpeechDirty() {
    dirtyRef.current = true;
    transcriptSpeechDirtyRef.current = true;
    setDirty(true);
    setSaveSuccessMessage(undefined);
  }

  function setTranscriptSpeechDraft(settings: TranscriptSpeechSettings) {
    setSpeechEnabled(settings.enabled);
    setSpeechVoice(settings.voice);
    setSpeechSpeedDraft(String(settings.speed));
    setSpeechInstructionsDraft(settings.instructions);
    setSpeechMaxCharactersDraft(String(settings.maxCharactersPerBubble));
  }

  useEffect(() => {
    let cancelled = false;
    props.settingsStore.whenReady().then(() => {
      if (cancelled) return;
      const initialSettings = props.settingsStore.getSnapshot();
      setQuickActions(initialSettings.quickActions);
      setAccentColorDraft(initialSettings.accentColor);
      setPromptFontSizeDraft(String(initialSettings.promptFontSizePx));
      setResponseFontSizeDraft(String(initialSettings.responseFontSizePx));
      setTranscriptSpeechDraft(initialSettings.transcriptSpeech);
      setTouchedFields(touchedFieldsForInvalidActions(initialSettings.quickActions.actions));
      setReady(true);
    });

    const unsubscribe = props.settingsStore.subscribe(() => {
      if (!cancelled) {
        const nextSettings = props.settingsStore.getSnapshot();
        if (!quickActionsDirtyRef.current) {
          setQuickActions(nextSettings.quickActions);
          setTouchedFields(touchedFieldsForInvalidActions(nextSettings.quickActions.actions));
        }
        if (!accentColorDirtyRef.current) {
          setAccentColorDraft(nextSettings.accentColor);
        }
        if (!transcriptFontSizesDirtyRef.current) {
          setPromptFontSizeDraft(String(nextSettings.promptFontSizePx));
          setResponseFontSizeDraft(String(nextSettings.responseFontSizePx));
          setPromptFontSizeTouched(false);
          setResponseFontSizeTouched(false);
        }
        if (!transcriptSpeechDirtyRef.current) {
          setTranscriptSpeechDraft(nextSettings.transcriptSpeech);
          setSpeechSpeedTouched(false);
          setSpeechInstructionsTouched(false);
          setSpeechMaxCharactersTouched(false);
        }
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [props.settingsStore]);

  useEffect(() => {
    setCredentialSnapshot(speechCredentials.getSnapshot());
    const unsubscribe = speechCredentials.subscribe(() => {
      setCredentialSnapshot(speechCredentials.getSnapshot());
    });
    speechCredentials.requestStatus();
    return unsubscribe;
  }, [speechCredentials]);

  useEffect(() => {
    setSpeechPreviewSnapshot(speechPreview.getSnapshot());
    return speechPreview.subscribe(() => {
      setSpeechPreviewSnapshot(speechPreview.getSnapshot());
    });
  }, [speechPreview]);

  useEffect(() => {
    setApiKeyDraft("");
  }, [credentialSnapshot.disconnectGeneration]);

  function syncDraftsFromStore() {
    const nextSettings = props.settingsStore.getSnapshot();
    if (!quickActionsDirtyRef.current) {
      setQuickActions(nextSettings.quickActions);
      setTouchedFields(touchedFieldsForInvalidActions(nextSettings.quickActions.actions));
    }
    if (!accentColorDirtyRef.current) {
      setAccentColorDraft(nextSettings.accentColor);
    }
    if (!transcriptFontSizesDirtyRef.current) {
      setPromptFontSizeDraft(String(nextSettings.promptFontSizePx));
      setResponseFontSizeDraft(String(nextSettings.responseFontSizePx));
      setPromptFontSizeTouched(false);
      setResponseFontSizeTouched(false);
    }
    if (!transcriptSpeechDirtyRef.current) {
      setTranscriptSpeechDraft(nextSettings.transcriptSpeech);
      setSpeechSpeedTouched(false);
      setSpeechInstructionsTouched(false);
      setSpeechMaxCharactersTouched(false);
    }
  }

  function updateAction(actionId: string, fieldName: QuickActionFieldName, value: string) {
    markQuickActionsDirty();
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
    markQuickActionsDirty();
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
    markQuickActionsDirty();
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
    setSaveSuccessMessage(undefined);
    try {
      if (quickActionsDirtyRef.current) {
        await props.settingsStore.saveQuickActions(quickActions);
      }
      if (accentColorDirtyRef.current) {
        await props.settingsStore.saveAccentColor(accentColorDraft);
      }
      if (transcriptFontSizesDirtyRef.current) {
        await props.settingsStore.saveTranscriptFontSizesPx({
          promptFontSizePx: promptFontSizeValue,
          responseFontSizePx: responseFontSizeValue
        });
      }
      if (transcriptSpeechDirtyRef.current) {
        await props.settingsStore.saveTranscriptSpeechSettings({
          enabled: speechEnabled,
          voice: speechVoice,
          speed: speechSpeedValue,
          instructions: speechInstructionsDraft.trim(),
          maxCharactersPerBubble: speechMaxCharactersValue
        });
      }
      dirtyRef.current = false;
      quickActionsDirtyRef.current = false;
      accentColorDirtyRef.current = false;
      transcriptFontSizesDirtyRef.current = false;
      transcriptSpeechDirtyRef.current = false;
      setDirty(false);
      setPromptFontSizeTouched(false);
      setResponseFontSizeTouched(false);
      setSpeechSpeedTouched(false);
      setSpeechInstructionsTouched(false);
      setSpeechMaxCharactersTouched(false);
      syncDraftsFromStore();
      setSaveSuccessMessage("Settings saved.");
    } catch {
      setSaveError("Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  function saveApiKey() {
    const apiKey = apiKeyDraft.trim();
    if (!apiKey) {
      setApiKeyError("Enter an OpenAI API key.");
      return;
    }

    const result = speechCredentials.saveApiKey(apiKey);
    if (!result.ok) {
      setApiKeyError(result.error);
      return;
    }

    setApiKeyError(undefined);
    setApiKeyDraft("");
  }

  function testApiKey() {
    const apiKey = apiKeyDraft.trim();
    const result = speechCredentials.testApiKey(apiKey || undefined);
    if (!result.ok) {
      setApiKeyError(result.error);
      return;
    }

    setApiKeyError(undefined);
    setApiKeyDraft("");
  }

  function removeApiKey() {
    const result = speechCredentials.removeApiKey();
    if (!result.ok) {
      setApiKeyError(result.error);
      return;
    }

    setApiKeyError(undefined);
    setApiKeyDraft("");
  }

  function playSpeechSample() {
    if (!speechPreviewCanStart) return;

    const result = speechPreview.playSample({
      voice: speechVoice,
      speed: speechSpeedValue,
      instructions: speechInstructionsDraft.trim()
    });
    if (!result.ok) {
      setApiKeyError(result.error);
      return;
    }

    setApiKeyError(undefined);
  }

  return (
    <main className="options-page" style={{ "--sidra-accent": accentColorDraft } as CSSProperties}>
      <header className="options-header">
        <h1>Sidra Settings</h1>
      </header>

      <section className="options-section" aria-labelledby="display-settings-heading">
        <h2 id="display-settings-heading">Display</h2>
        <label className="color-setting">
          <span>Accent color</span>
          <span className="color-setting-control">
            <input
              type="color"
              aria-label="Accent color"
              value={accentColorDraft}
              disabled={controlsDisabled}
              onChange={(event) => {
                markAccentColorDirty();
                setSaveError(undefined);
                setAccentColorDraft(event.currentTarget.value);
              }}
            />
            <span>{accentColorDraft}</span>
          </span>
        </label>
        <label className="font-size-setting">
          <span>Prompt text size</span>
          <input
            type="number"
            min={MIN_TRANSCRIPT_FONT_SIZE_PX}
            max={MAX_TRANSCRIPT_FONT_SIZE_PX}
            step={1}
            value={promptFontSizeDraft}
            disabled={controlsDisabled}
            aria-invalid={promptFontSizeError ? "true" : undefined}
            aria-describedby={promptFontSizeError ? promptFontSizeErrorId : undefined}
            onChange={(event) => {
              markTranscriptFontSizesDirty();
              setSaveError(undefined);
              setPromptFontSizeTouched(true);
              setPromptFontSizeDraft(event.currentTarget.value);
            }}
          />
          {promptFontSizeError ? (
            <span className="validation-error" id={promptFontSizeErrorId}>
              {promptFontSizeError}
            </span>
          ) : null}
        </label>
        <label className="font-size-setting">
          <span>Response text size</span>
          <input
            type="number"
            min={MIN_TRANSCRIPT_FONT_SIZE_PX}
            max={MAX_TRANSCRIPT_FONT_SIZE_PX}
            step={1}
            value={responseFontSizeDraft}
            disabled={controlsDisabled}
            aria-invalid={responseFontSizeError ? "true" : undefined}
            aria-describedby={responseFontSizeError ? responseFontSizeErrorId : undefined}
            onChange={(event) => {
              markTranscriptFontSizesDirty();
              setSaveError(undefined);
              setResponseFontSizeTouched(true);
              setResponseFontSizeDraft(event.currentTarget.value);
            }}
          />
          {responseFontSizeError ? (
            <span className="validation-error" id={responseFontSizeErrorId}>
              {responseFontSizeError}
            </span>
          ) : null}
        </label>
      </section>

      <section className="options-section" aria-labelledby="speech-settings-heading">
        <h2 id="speech-settings-heading">Read aloud</h2>
        <div className="speech-credential-settings">
          <p className="credential-status">{credentialStatusText(credentialSnapshot)}</p>
          <label className="font-size-setting">
            <span>OpenAI API key</span>
            <input
              type="password"
              value={apiKeyDraft}
              placeholder={apiKeyPlaceholder(credentialSnapshot)}
              disabled={credentialControlsDisabled}
              aria-invalid={apiKeyError ? "true" : undefined}
              aria-describedby={apiKeyError ? "openai-api-key-error" : undefined}
              onChange={(event) => {
                setApiKeyDraft(event.currentTarget.value);
                setApiKeyError(undefined);
              }}
            />
            {apiKeyError ? (
              <span className="validation-error" id="openai-api-key-error">
                {apiKeyError}
              </span>
            ) : null}
          </label>
          <p className="settings-help">Stored by the local Sidra bridge in the OS secret store. Not saved in {chromeStorageLabel}.</p>
          {credentialSnapshot.error ? (
            <div className="settings-error" role="alert">
              {credentialSnapshot.error}
            </div>
          ) : null}
          {credentialSnapshot.successMessage ? (
            <p className="settings-success" role="status">
              <SidraIcon name="check" />
              <span>{credentialSnapshot.successMessage}</span>
            </p>
          ) : null}
          <div className="credential-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={credentialControlsDisabled || !apiKeyDraft.trim()}
              onClick={saveApiKey}
            >
              Save OpenAI API key
            </button>
            <button type="button" className="secondary-button" disabled={credentialControlsDisabled} onClick={testApiKey}>
              Test OpenAI API key
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={credentialControlsDisabled || !credentialSnapshot.status.configured}
              onClick={removeApiKey}
            >
              Remove OpenAI API key
            </button>
          </div>
        </div>

        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={speechEnabled}
            disabled={controlsDisabled}
            onChange={(event) => {
              markTranscriptSpeechDirty();
              setSaveError(undefined);
              setSpeechEnabled(event.currentTarget.checked);
            }}
          />
          <span>Enable read aloud</span>
        </label>

        <label className="font-size-setting">
          <span>Voice</span>
          <select
            value={speechVoice}
            disabled={controlsDisabled}
            onChange={(event) => {
              markTranscriptSpeechDirty();
              setSaveError(undefined);
              setSpeechVoice(event.currentTarget.value as SpeechVoice);
            }}
          >
            {TRANSCRIPT_SPEECH_VOICES.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </select>
        </label>

        <label className="font-size-setting">
          <span>Speech speed</span>
          <input
            type="range"
            aria-label="Speech speed"
            min={MIN_TRANSCRIPT_SPEECH_SPEED}
            max={MAX_TRANSCRIPT_SPEECH_SPEED}
            step={TRANSCRIPT_SPEECH_SPEED_STEP}
            value={speechSpeedDraft}
            disabled={controlsDisabled}
            aria-invalid={speechSpeedError ? "true" : undefined}
            aria-describedby={speechSpeedError ? speechSpeedErrorId : undefined}
            onChange={(event) => {
              markTranscriptSpeechDirty();
              setSaveError(undefined);
              setSpeechSpeedTouched(true);
              setSpeechSpeedDraft(event.currentTarget.value);
            }}
          />
          <output>{speechSpeedDraft}x</output>
          {speechSpeedError ? (
            <span className="validation-error" id={speechSpeedErrorId}>
              {speechSpeedError}
            </span>
          ) : null}
        </label>

        <label className="font-size-setting speech-instructions-setting">
          <span>Speech instructions</span>
          <textarea
            value={speechInstructionsDraft}
            disabled={controlsDisabled}
            aria-invalid={speechInstructionsError ? "true" : undefined}
            aria-describedby={speechInstructionsError ? speechInstructionsErrorId : undefined}
            onChange={(event) => {
              markTranscriptSpeechDirty();
              setSaveError(undefined);
              setSpeechInstructionsTouched(true);
              setSpeechInstructionsDraft(event.currentTarget.value);
            }}
          />
          {speechInstructionsError ? (
            <span className="validation-error" id={speechInstructionsErrorId}>
              {speechInstructionsError}
            </span>
          ) : null}
        </label>

        <label className="font-size-setting">
          <span>Maximum characters per bubble</span>
          <input
            type="number"
            min={MIN_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS}
            max={MAX_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS}
            step={1}
            value={speechMaxCharactersDraft}
            disabled={controlsDisabled}
            aria-invalid={speechMaxCharactersError ? "true" : undefined}
            aria-describedby={speechMaxCharactersError ? speechMaxCharactersErrorId : undefined}
            onChange={(event) => {
              markTranscriptSpeechDirty();
              setSaveError(undefined);
              setSpeechMaxCharactersTouched(true);
              setSpeechMaxCharactersDraft(event.currentTarget.value);
            }}
          />
          {speechMaxCharactersError ? (
            <span className="validation-error" id={speechMaxCharactersErrorId}>
              {speechMaxCharactersError}
            </span>
          ) : null}
        </label>

        {speechPreviewSnapshot.error ? (
          <div className="settings-error" role="alert">
            {speechPreviewSnapshot.error}
          </div>
        ) : null}

        <div className="speech-preview-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={!speechPreviewCanStart}
            aria-busy={speechPreviewSnapshot.status === "loading" ? "true" : undefined}
            onClick={playSpeechSample}
          >
            <SidraIcon name={speechPreviewIconName(speechPreviewSnapshot.status)} />
            <span>{speechPreviewButtonLabel(speechPreviewSnapshot.status)}</span>
          </button>
        </div>
      </section>

      <section className="options-section" aria-labelledby="quick-actions-settings-heading">
        <h2 id="quick-actions-settings-heading">Quick actions</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={quickActions.enabled}
            disabled={controlsDisabled}
            onChange={(event) => {
              const enabled = event.currentTarget.checked;
              markQuickActionsDirty();
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
        {saveSuccessMessage ? (
          <p className="settings-success" role="status">
            <SidraIcon name="check" />
            <span>{saveSuccessMessage}</span>
          </p>
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

function credentialStatusText(snapshot: SpeechCredentialClientSnapshot): string {
  if (!snapshot.status.configured) return "OpenAI key not configured.";
  if (snapshot.status.source === "environment") return `OpenAI key configured from environment, ending in ${keySuffix(snapshot.status.redactedKey)}.`;
  return `OpenAI key saved in Keychain, ending in ${keySuffix(snapshot.status.redactedKey)}.`;
}

function apiKeyPlaceholder(snapshot: SpeechCredentialClientSnapshot): string | undefined {
  if (!snapshot.status.configured) return undefined;
  if (snapshot.status.source === "environment") return `Environment key ${snapshot.status.redactedKey}`;
  return `Saved key ${snapshot.status.redactedKey}`;
}

function keySuffix(redactedKey: string): string {
  const suffix = redactedKey.split("...").at(-1)?.trim();
  return suffix || redactedKey;
}

function speechPreviewButtonLabel(status: SpeechPreviewSnapshot["status"]): string {
  switch (status) {
    case "loading":
      return "Stop TTS sample";
    case "playing":
      return "Pause TTS sample";
    case "paused":
      return "Resume TTS sample";
    case "idle":
    case "error":
      return "Play TTS sample";
  }
}

function speechPreviewIconName(status: SpeechPreviewSnapshot["status"]): IconName {
  return status === "playing" || status === "loading" ? "pause" : "play";
}

function isValidActionDraft(action: QuickAction): boolean {
  return action.label.trim().length > 0 && action.prompt.trim().length > 0;
}

function isValidTranscriptFontSizeDraft(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return parsed >= MIN_TRANSCRIPT_FONT_SIZE_PX && parsed <= MAX_TRANSCRIPT_FONT_SIZE_PX;
}

function isValidSpeechSpeedDraft(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  const parsed = Number(value);
  return parsed >= MIN_TRANSCRIPT_SPEECH_SPEED && parsed <= MAX_TRANSCRIPT_SPEECH_SPEED;
}

function isValidSpeechMaxCharactersDraft(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return parsed >= MIN_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS && parsed <= MAX_TRANSCRIPT_SPEECH_BUBBLE_CHARACTERS;
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
