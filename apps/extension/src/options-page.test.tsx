// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS,
  DEFAULT_ACCENT_COLOR,
  DEFAULT_PROMPT_FONT_SIZE_PX,
  DEFAULT_QUICK_ACTIONS_SETTINGS,
  DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS,
  DEFAULT_RESPONSE_FONT_SIZE_PX,
  DEFAULT_TRANSCRIPT_SPEECH_SETTINGS,
  MAX_TRANSCRIPT_FONT_SIZE_PX,
  MIN_TRANSCRIPT_FONT_SIZE_PX,
  type QuickActionsSettings,
  type SidraSettings,
  type TranscriptSpeechSettings,
  type SettingsStore
} from "./settings-store";
import { OptionsPageView } from "./options-page-view";

afterEach(() => {
  cleanup();
});

describe("OptionsPage quick actions", () => {
  it("renders_quick_action_enable_toggle_and_action_rows", async () => {
    render(<OptionsPageView settingsStore={new FakeSettingsStore()} />);

    expect(await screen.findByRole("checkbox", { name: "Enable quick actions" })).toHaveProperty("checked", true);
    expect(screen.getByDisplayValue("Summarize this page")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Add action" })).not.toBeNull();
  });

  it("toggles_quick_actions_from_options_page", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    render(<OptionsPageView settingsStore={store} />);

    await user.click(await screen.findByRole("checkbox", { name: "Enable quick actions" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(store.saveCalls.at(-1)).toMatchObject({ enabled: false });
  });

  it("adds_and_removes_quick_actions_from_options_page", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    render(<OptionsPageView settingsStore={store} />);

    await user.click(await screen.findByRole("button", { name: "Add action" }));
    expect(screen.getAllByLabelText(/Action \d+ label/)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Remove action 1" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(store.saveCalls.at(-1)?.actions).toHaveLength(1);
  });

  it("edits_quick_action_label_and_prompt", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    render(<OptionsPageView settingsStore={store} />);

    const label = await screen.findByLabelText("Action 1 label");
    await user.clear(label);
    await user.type(label, "Explain");
    const prompt = screen.getByLabelText("Action 1 prompt");
    await user.clear(prompt);
    await user.type(prompt, "Explain this page");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(store.saveCalls.at(-1)).toEqual({
      enabled: true,
      actions: [{ id: "summarize-page", label: "Explain", prompt: "Explain this page" }]
    });
  });

  it("does_not_save_blank_quick_action_label_or_prompt", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    render(<OptionsPageView settingsStore={store} />);

    await user.clear(await screen.findByLabelText("Action 1 label"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(store.saveCalls).toEqual([]);
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  });

  it("renders_stored_disabled_quick_actions_after_settings_are_ready", async () => {
    render(
      <OptionsPageView
        settingsStore={
          new FakeSettingsStore({
            quickActions: { enabled: false, actions: DEFAULT_QUICK_ACTIONS_SETTINGS.actions }
          })
        }
      />
    );

    expect(await screen.findByRole("checkbox", { name: "Enable quick actions" })).toHaveProperty("checked", false);
  });

  it("renders_stored_custom_quick_actions_after_settings_are_ready", async () => {
    render(
      <OptionsPageView
        settingsStore={
          new FakeSettingsStore({
            quickActions: {
              enabled: true,
              actions: [{ id: "translate", label: "Translate", prompt: "Translate this page" }]
            }
          })
        }
      />
    );

    expect(await screen.findByDisplayValue("Translate")).not.toBeNull();
    expect(screen.getByDisplayValue("Translate this page")).not.toBeNull();
  });

  it("blocks_quick_action_saves_until_initial_settings_load_completes", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    store.holdReadiness();
    render(<OptionsPageView settingsStore={store} />);

    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(store.saveCalls).toEqual([]);

    store.resolveReadiness();
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true));
  });

  it("does_not_overwrite_unsaved_edits_when_live_settings_change", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    render(<OptionsPageView settingsStore={store} />);

    const label = await screen.findByLabelText("Action 1 label");
    await user.clear(label);
    await user.type(label, "Unsaved");
    store.replaceQuickActions({
      enabled: true,
      actions: [{ id: "external", label: "External", prompt: "External prompt" }]
    });

    expect(screen.getByDisplayValue("Unsaved")).not.toBeNull();
    expect(screen.queryByDisplayValue("External")).toBeNull();
  });

  it("reports_save_errors_and_keeps_the_edited_draft", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    store.nextSaveError = new Error("quota exceeded");
    render(<OptionsPageView settingsStore={store} />);

    const label = await screen.findByLabelText("Action 1 label");
    await user.clear(label);
    await user.type(label, "Edited");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect((await screen.findByRole("alert")).textContent).toBe("Could not save settings.");
    expect(screen.getByDisplayValue("Edited")).not.toBeNull();
  });

  it("uses_row_specific_accessible_names_for_quick_action_fields", async () => {
    const user = userEvent.setup();
    render(<OptionsPageView settingsStore={new FakeSettingsStore()} />);

    await user.click(await screen.findByRole("button", { name: "Add action" }));

    expect(screen.getByLabelText("Action 1 label")).not.toBeNull();
    expect(screen.getByLabelText("Action 1 prompt")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove action 1" })).not.toBeNull();
    expect(screen.getByLabelText("Action 2 label")).not.toBeNull();
    expect(screen.getByLabelText("Action 2 prompt")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Remove action 2" })).not.toBeNull();
  });

  it("disables_editing_while_quick_action_save_is_in_flight", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    store.holdSave();
    render(<OptionsPageView settingsStore={store} />);

    const label = await screen.findByLabelText("Action 1 label");
    await user.type(label, " edited");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByLabelText("Action 1 label")).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Action 1 prompt")).toHaveProperty("disabled", true);
    expect(screen.getByRole("checkbox", { name: "Enable quick actions" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Add action" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Remove action 1" })).toHaveProperty("disabled", true);
  });

  it("resyncs_from_store_after_successful_quick_action_save", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    render(<OptionsPageView settingsStore={store} />);

    const label = await screen.findByLabelText("Action 1 label");
    await user.clear(label);
    await user.type(label, " Trimmed ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByDisplayValue("Trimmed")).not.toBeNull();
  });

  it("renders_prompt_and_response_font_size_controls_after_settings_are_ready", async () => {
    render(<OptionsPageView settingsStore={new FakeSettingsStore({ promptFontSizePx: 14, responseFontSizePx: 18 })} />);

    const promptInput = await screen.findByRole("spinbutton", { name: "Prompt text size" });
    const responseInput = await screen.findByRole("spinbutton", { name: "Response text size" });

    expect(promptInput).toHaveProperty("value", "14");
    expect(responseInput).toHaveProperty("value", "18");
    expect(promptInput).toHaveProperty("min", `${MIN_TRANSCRIPT_FONT_SIZE_PX}`);
    expect(responseInput).toHaveProperty("max", `${MAX_TRANSCRIPT_FONT_SIZE_PX}`);
  });

  it("renders_accent_color_picker_after_settings_are_ready", async () => {
    render(<OptionsPageView settingsStore={new FakeSettingsStore({ accentColor: "#c026d3" })} />);

    const colorInput = await screen.findByLabelText("Accent color");

    expect(colorInput).toHaveProperty("value", "#c026d3");
    expect(screen.getByText("#c026d3")).not.toBeNull();
  });

  it("saves_accent_color_from_options_page", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    render(<OptionsPageView settingsStore={store} />);

    fireEvent.change(await screen.findByLabelText("Accent color"), { target: { value: "#2563eb" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(store.accentColorSaveCalls).toEqual(["#2563eb"]);
  });

  it("edits_prompt_and_response_font_sizes_from_options_page", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    render(<OptionsPageView settingsStore={store} />);

    fireEvent.change(await screen.findByRole("spinbutton", { name: "Prompt text size" }), { target: { value: "14" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Response text size" }), { target: { value: "18" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(store.transcriptFontSizeSaveCalls).toEqual([{ promptFontSizePx: 14, responseFontSizePx: 18 }]);
    expect(store.saveCalls).toEqual([]);
  });

  it("does_not_save_invalid_prompt_font_size", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    render(<OptionsPageView settingsStore={store} />);

    const input = await screen.findByRole("spinbutton", { name: "Prompt text size" });
    fireEvent.change(input, { target: { value: `${MAX_TRANSCRIPT_FONT_SIZE_PX + 1}` } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(store.transcriptFontSizeSaveCalls).toEqual([]);
    expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText(`Enter a whole number from ${MIN_TRANSCRIPT_FONT_SIZE_PX} to ${MAX_TRANSCRIPT_FONT_SIZE_PX}.`)).not.toBeNull();
  });

  it("does_not_overwrite_unsaved_font_size_when_live_settings_change", async () => {
    const store = new FakeSettingsStore({ promptFontSizePx: 15, responseFontSizePx: 17 });
    render(<OptionsPageView settingsStore={store} />);

    const input = await screen.findByRole("spinbutton", { name: "Prompt text size" });
    fireEvent.change(input, { target: { value: "18" } });
    store.replaceTranscriptFontSizes({ promptFontSizePx: 20, responseFontSizePx: 21 });

    expect(input).toHaveProperty("value", "18");
  });

  it("syncs_live_quick_action_changes_when_font_size_has_unsaved_edits", async () => {
    const store = new FakeSettingsStore({ promptFontSizePx: 15, responseFontSizePx: 17 });
    render(<OptionsPageView settingsStore={store} />);

    const input = await screen.findByRole("spinbutton", { name: "Prompt text size" });
    fireEvent.change(input, { target: { value: "18" } });
    store.replaceQuickActions({
      enabled: true,
      actions: [{ id: "external", label: "External", prompt: "External prompt" }]
    });

    expect(await screen.findByDisplayValue("External")).not.toBeNull();
    expect(input).toHaveProperty("value", "18");
  });

  it("disables_font_size_control_while_save_is_in_flight", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    store.holdSave();
    render(<OptionsPageView settingsStore={store} />);

    const input = await screen.findByRole("spinbutton", { name: "Prompt text size" });
    fireEvent.change(input, { target: { value: "18" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByRole("spinbutton", { name: "Prompt text size" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("spinbutton", { name: "Response text size" })).toHaveProperty("disabled", true);
    store.resolveSave();
    await waitFor(() =>
      expect(store.transcriptFontSizeSaveCalls).toEqual([{ promptFontSizePx: 18, responseFontSizePx: 17 }])
    );
  });

  it("resyncs_font_size_from_store_after_successful_save", async () => {
    const user = userEvent.setup();
    const store = new FakeSettingsStore();
    render(<OptionsPageView settingsStore={store} />);

    const input = await screen.findByRole("spinbutton", { name: "Prompt text size" });
    fireEvent.change(input, { target: { value: "18" } });
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByDisplayValue("18")).not.toBeNull();
  });

  describe("speech settings", () => {
    it("options_page_renders_speech_settings", async () => {
      render(
        <OptionsPageView
          settingsStore={
            new FakeSettingsStore({
              transcriptSpeech: {
                enabled: true,
                voice: "cedar",
                speed: 1.2,
                instructions: "Read clearly.",
                maxCharactersPerBubble: 15_000
              }
            })
          }
          speechCredentials={new FakeSpeechCredentialClient()}
        />
      );

      expect(await screen.findByRole("checkbox", { name: "Enable read aloud" })).toHaveProperty("checked", true);
      expect(screen.getByRole("combobox", { name: "Voice" })).toHaveProperty("value", "cedar");
      expect(screen.getByRole("slider", { name: "Speech speed" })).toHaveProperty("value", "1.2");
      expect(screen.getByRole("textbox", { name: "Speech instructions" })).toHaveProperty("value", "Read clearly.");
      expect(screen.getByRole("spinbutton", { name: "Maximum characters per bubble" })).toHaveProperty("value", "15000");
    });

    it("options_page_renders_speech_credential_status_and_key_controls", async () => {
      render(
        <OptionsPageView
          settingsStore={new FakeSettingsStore()}
          speechCredentials={
            new FakeSpeechCredentialClient({
              status: { configured: true, source: "keychain", redactedKey: "sk-...7d42" }
            })
          }
        />
      );

      expect(await screen.findByText("OpenAI key saved in Keychain, ending in 7d42.")).not.toBeNull();
      expect(screen.getByLabelText("OpenAI API key")).toHaveProperty("type", "password");
      expect(screen.getByLabelText("OpenAI API key")).toHaveProperty("placeholder", "Saved key sk-...7d42");
      expect(screen.getByRole("button", { name: "Save OpenAI API key" })).not.toBeNull();
      expect(screen.getByRole("button", { name: "Test OpenAI API key" })).not.toBeNull();
      expect(screen.getByRole("button", { name: "Remove OpenAI API key" })).not.toBeNull();
      expect(screen.getByText("Stored by the local Sidra bridge in the OS secret store. Not saved in chrome.storage.")).not.toBeNull();
    });

    it("options_page_saves_tests_and_removes_api_key_through_bridge", async () => {
      const user = userEvent.setup();
      const credentials = new FakeSpeechCredentialClient();
      render(<OptionsPageView settingsStore={new FakeSettingsStore()} speechCredentials={credentials} />);

      const input = await screen.findByLabelText("OpenAI API key");
      await user.type(input, "sk-test-secret");
      await user.click(screen.getByRole("button", { name: "Save OpenAI API key" }));
      await user.type(input, "sk-test-secret");
      await user.click(screen.getByRole("button", { name: "Test OpenAI API key" }));
      await user.click(screen.getByRole("button", { name: "Remove OpenAI API key" }));

      expect(credentials.calls).toEqual([
        { type: "status" },
        { type: "save", apiKey: "sk-test-secret" },
        { type: "test", apiKey: "sk-test-secret" },
        { type: "remove" }
      ]);
    });

    it("options_page_observes_synchronous_credential_status_failure", async () => {
      render(
        <OptionsPageView
          settingsStore={new FakeSettingsStore()}
          speechCredentials={new FakeSpeechCredentialClient({ requestStatusError: "Sidra bridge disconnected." })}
        />
      );

      expect(await screen.findByText("Sidra bridge disconnected.")).not.toBeNull();
    });

    it("options_page_clears_api_key_input_after_secret_actions", async () => {
      const user = userEvent.setup();
      const credentials = new FakeSpeechCredentialClient();
      render(<OptionsPageView settingsStore={new FakeSettingsStore()} speechCredentials={credentials} />);

      const input = await screen.findByLabelText("OpenAI API key");
      await user.type(input, "sk-test-secret");
      await user.click(screen.getByRole("button", { name: "Save OpenAI API key" }));
      expect(input).toHaveProperty("value", "");

      await user.type(input, "sk-test-secret");
      await user.click(screen.getByRole("button", { name: "Test OpenAI API key" }));
      expect(input).toHaveProperty("value", "");

      await user.type(input, "sk-test-secret");
      await user.click(screen.getByRole("button", { name: "Remove OpenAI API key" }));
      expect(input).toHaveProperty("value", "");
    });

    it("options_page_validates_speech_settings_before_save", async () => {
      const user = userEvent.setup();
      const store = new FakeSettingsStore();
      render(<OptionsPageView settingsStore={store} speechCredentials={new FakeSpeechCredentialClient()} />);

      fireEvent.change(await screen.findByRole("textbox", { name: "Speech instructions" }), { target: { value: "x".repeat(601) } });
      fireEvent.change(screen.getByRole("spinbutton", { name: "Maximum characters per bubble" }), { target: { value: "100" } });
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(store.transcriptSpeechSaveCalls).toEqual([]);
      expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
      expect(screen.getByText("Use 600 characters or fewer.")).not.toBeNull();
      expect(screen.getByText("Enter a whole number from 500 to 50000.")).not.toBeNull();
    });

    it("options_page_saves_speech_settings_with_existing_save_flow", async () => {
      const user = userEvent.setup();
      const store = new FakeSettingsStore();
      render(<OptionsPageView settingsStore={store} speechCredentials={new FakeSpeechCredentialClient()} />);

      await user.click(await screen.findByRole("checkbox", { name: "Enable read aloud" }));
      fireEvent.change(screen.getByRole("combobox", { name: "Voice" }), { target: { value: "cedar" } });
      fireEvent.change(screen.getByRole("slider", { name: "Speech speed" }), { target: { value: "1.25" } });
      await user.clear(screen.getByRole("textbox", { name: "Speech instructions" }));
      await user.type(screen.getByRole("textbox", { name: "Speech instructions" }), "Read like a radio host.");
      fireEvent.change(screen.getByRole("spinbutton", { name: "Maximum characters per bubble" }), { target: { value: "20000" } });
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(store.transcriptSpeechSaveCalls).toEqual([
        {
          enabled: false,
          voice: "cedar",
          speed: 1.25,
          instructions: "Read like a radio host.",
          maxCharactersPerBubble: 20_000
        }
      ]);
    });

    it("options_page_tests_tts_sample_with_current_speech_settings", async () => {
      const user = userEvent.setup();
      const speechPreview = new FakeSpeechPreviewClient();
      render(
        <OptionsPageView
          settingsStore={new FakeSettingsStore()}
          speechCredentials={
            new FakeSpeechCredentialClient({
              status: { configured: true, source: "keychain", redactedKey: "sk-...7d42" }
            })
          }
          speechPreview={speechPreview}
        />
      );

      fireEvent.change(await screen.findByRole("combobox", { name: "Voice" }), { target: { value: "cedar" } });
      fireEvent.change(screen.getByRole("slider", { name: "Speech speed" }), { target: { value: "1.25" } });
      await user.clear(screen.getByRole("textbox", { name: "Speech instructions" }));
      await user.type(screen.getByRole("textbox", { name: "Speech instructions" }), "Read like a radio host.");
      await user.click(screen.getByRole("button", { name: "Play TTS sample" }));

      expect(speechPreview.calls).toEqual([
        {
          voice: "cedar",
          speed: 1.25,
          instructions: "Read like a radio host."
        }
      ]);
    });
  });

  describe("settings save feedback", () => {
    it("disables_save_until_settings_are_changed", async () => {
      const user = userEvent.setup();
      render(<OptionsPageView settingsStore={new FakeSettingsStore()} />);

      const saveButton = await screen.findByRole("button", { name: "Save" });
      expect(saveButton).toHaveProperty("disabled", true);

      await user.type(screen.getByLabelText("Action 1 label"), " edited");

      expect(saveButton).toHaveProperty("disabled", false);
    });

    it("shows_saving_feedback_and_busy_state_while_quick_action_save_is_in_flight", async () => {
      const user = userEvent.setup();
      const store = new FakeSettingsStore();
      store.holdSave();
      render(<OptionsPageView settingsStore={store} />);

      await user.type(await screen.findByLabelText("Action 1 label"), " edited");
      await user.click(screen.getByRole("button", { name: "Save" }));

      const saveButton = screen.getByRole("button", { name: "Saving..." });
      expect(saveButton).toHaveProperty("disabled", true);
      expect(saveButton.getAttribute("aria-busy")).toBe("true");
    });

    it("restores_save_button_label_after_successful_quick_action_save", async () => {
      const user = userEvent.setup();
      const store = new FakeSettingsStore();
      store.holdSave();
      render(<OptionsPageView settingsStore={store} />);

      await user.type(await screen.findByLabelText("Action 1 label"), " edited");
      await user.click(screen.getByRole("button", { name: "Save" }));
      store.resolveSave();

      expect((await screen.findByRole("button", { name: "Save" })).getAttribute("aria-busy")).toBeNull();
    });

    it("shows_success_feedback_and_disables_save_after_successful_save", async () => {
      const user = userEvent.setup();
      const store = new FakeSettingsStore();
      render(<OptionsPageView settingsStore={store} />);

      await user.type(await screen.findByLabelText("Action 1 label"), " edited");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Settings saved.")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    });

    it("restores_save_button_label_after_failed_quick_action_save", async () => {
      const user = userEvent.setup();
      const store = new FakeSettingsStore();
      store.nextSaveError = new Error("quota exceeded");
      render(<OptionsPageView settingsStore={store} />);

      await user.type(await screen.findByLabelText("Action 1 label"), " edited");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect((await screen.findByRole("button", { name: "Save" })).getAttribute("aria-busy")).toBeNull();
      expect(screen.getByRole("alert").textContent).toBe("Could not save settings.");
    });
  });

  describe("quick action validation feedback", () => {
    it("marks_blank_quick_action_label_as_invalid_with_visible_error", async () => {
      const user = userEvent.setup();
      render(<OptionsPageView settingsStore={new FakeSettingsStore()} />);

      const label = await screen.findByLabelText("Action 1 label");
      await user.clear(label);

      expect(label.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText("Action label is required.")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    });

    it("marks_blank_quick_action_prompt_as_invalid_with_visible_error", async () => {
      const user = userEvent.setup();
      render(<OptionsPageView settingsStore={new FakeSettingsStore()} />);

      const prompt = await screen.findByLabelText("Action 1 prompt");
      await user.clear(prompt);

      expect(prompt.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText("Action prompt is required.")).not.toBeNull();
      expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
    });

    it("clears_quick_action_field_error_after_valid_text_is_entered", async () => {
      const user = userEvent.setup();
      render(<OptionsPageView settingsStore={new FakeSettingsStore()} />);

      const label = await screen.findByLabelText("Action 1 label");
      await user.clear(label);
      expect(screen.getByText("Action label is required.")).not.toBeNull();

      await user.type(label, "Explain");

      expect(label.getAttribute("aria-invalid")).toBeNull();
      expect(screen.queryByText("Action label is required.")).toBeNull();
    });

    it("does_not_show_quick_action_field_errors_before_user_edits", async () => {
      render(<OptionsPageView settingsStore={new FakeSettingsStore()} />);

      const label = await screen.findByLabelText("Action 1 label");
      const prompt = screen.getByLabelText("Action 1 prompt");

      expect(label.getAttribute("aria-invalid")).toBeNull();
      expect(prompt.getAttribute("aria-invalid")).toBeNull();
      expect(screen.queryByText("Action label is required.")).toBeNull();
      expect(screen.queryByText("Action prompt is required.")).toBeNull();
    });

    it("connects_quick_action_field_errors_with_dom_safe_describedby_ids", async () => {
      const user = userEvent.setup();
      render(
        <OptionsPageView
          settingsStore={
            new FakeSettingsStore({
              quickActions: {
                enabled: true,
                actions: [{ id: "custom action 1", label: "Custom action", prompt: "Custom prompt" }]
              }
            })
          }
        />
      );

      const label = await screen.findByLabelText("Action 1 label");
      await user.clear(label);
      const describedBy = label.getAttribute("aria-describedby");

      expect(describedBy).not.toBeNull();
      expect(describedBy?.startsWith("quick-action-")).toBe(true);
      expect(describedBy).not.toContain(" ");
      expect(document.getElementById(describedBy ?? "")?.textContent).toBe("Action label is required.");
    });

    it("keeps_quick_action_error_ids_distinct_for_similar_action_ids", async () => {
      const user = userEvent.setup();
      render(
        <OptionsPageView
          settingsStore={
            new FakeSettingsStore({
              quickActions: {
                enabled: true,
                actions: [
                  { id: "a b", label: "First", prompt: "First prompt" },
                  { id: "a-b", label: "Second", prompt: "Second prompt" }
                ]
              }
            })
          }
        />
      );

      const firstLabel = await screen.findByLabelText("Action 1 label");
      const secondLabel = screen.getByLabelText("Action 2 label");
      await user.clear(firstLabel);
      await user.clear(secondLabel);

      expect(firstLabel.getAttribute("aria-describedby")).not.toBe(secondLabel.getAttribute("aria-describedby"));
    });

    it("shows_quick_action_field_errors_for_initially_invalid_saved_actions", async () => {
      render(
        <OptionsPageView
          settingsStore={
            new FakeSettingsStore({
              quickActions: {
                enabled: true,
                actions: [{ id: "invalid", label: "", prompt: "" }]
              }
            })
          }
        />
      );

      const label = await screen.findByLabelText("Action 1 label");
      const prompt = screen.getByLabelText("Action 1 prompt");

      expect(label.getAttribute("aria-invalid")).toBe("true");
      expect(prompt.getAttribute("aria-invalid")).toBe("true");
      expect(screen.getByText("Action label is required.")).not.toBeNull();
      expect(screen.getByText("Action prompt is required.")).not.toBeNull();
    });
  });
});

class FakeSettingsStore
  implements
    Pick<
      SettingsStore,
      | "getSnapshot"
      | "whenReady"
      | "subscribe"
      | "saveQuickActions"
      | "saveAccentColor"
      | "saveTranscriptFontSizesPx"
      | "saveTranscriptSpeechSettings"
    >
{
  readonly saveCalls: QuickActionsSettings[] = [];
  readonly accentColorSaveCalls: string[] = [];
  readonly transcriptFontSizeSaveCalls: Array<{ promptFontSizePx: number; responseFontSizePx: number }> = [];
  readonly transcriptSpeechSaveCalls: TranscriptSpeechSettings[] = [];
  nextSaveError: Error | undefined;
  private readonly listeners = new Set<() => void>();
  private snapshot: SidraSettings;
  private readyPromise: Promise<void> = Promise.resolve();
  private resolveReady: (() => void) | undefined;
  private savePromise: Promise<void> | undefined;
  private resolvePendingSave: (() => void) | undefined;

  constructor(overrides: Partial<SidraSettings> = {}) {
    this.snapshot = {
      readableContentLimitCharacters: DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS,
      domContentLimitCharacters: DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS,
      accentColor: DEFAULT_ACCENT_COLOR,
      promptFontSizePx: DEFAULT_PROMPT_FONT_SIZE_PX,
      responseFontSizePx: DEFAULT_RESPONSE_FONT_SIZE_PX,
      quickActions: DEFAULT_QUICK_ACTIONS_SETTINGS,
      transcriptSpeech: DEFAULT_TRANSCRIPT_SPEECH_SETTINGS,
      ...overrides
    };
  }

  getSnapshot(): SidraSettings {
    return {
      ...this.snapshot,
      quickActions: {
        enabled: this.snapshot.quickActions.enabled,
        actions: this.snapshot.quickActions.actions.map((action) => ({ ...action }))
      },
      transcriptSpeech: { ...this.snapshot.transcriptSpeech }
    };
  }

  async whenReady(): Promise<void> {
    await this.readyPromise;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async saveQuickActions(nextQuickActions: QuickActionsSettings): Promise<void> {
    if (this.nextSaveError) throw this.nextSaveError;
    if (this.savePromise) await this.savePromise;
    this.saveCalls.push(nextQuickActions);
    this.snapshot = {
      ...this.snapshot,
      quickActions: {
        enabled: nextQuickActions.enabled,
        actions: nextQuickActions.actions
          .filter((action) => action.label.trim() && action.prompt.trim())
          .map((action) => ({ ...action, label: action.label.trim(), prompt: action.prompt.trim() }))
      }
    };
    for (const listener of this.listeners) listener();
  }

  async saveTranscriptSpeechSettings(nextTranscriptSpeech: TranscriptSpeechSettings): Promise<void> {
    if (this.nextSaveError) throw this.nextSaveError;
    if (this.savePromise) await this.savePromise;
    this.transcriptSpeechSaveCalls.push(nextTranscriptSpeech);
    this.snapshot = {
      ...this.snapshot,
      transcriptSpeech: { ...nextTranscriptSpeech }
    };
    for (const listener of this.listeners) listener();
  }

  async saveAccentColor(nextAccentColor: string): Promise<void> {
    if (this.nextSaveError) throw this.nextSaveError;
    if (this.savePromise) await this.savePromise;
    this.accentColorSaveCalls.push(nextAccentColor);
    this.snapshot = {
      ...this.snapshot,
      accentColor: nextAccentColor
    };
    for (const listener of this.listeners) listener();
  }

  async saveTranscriptFontSizesPx(nextFontSizesPx: {
    promptFontSizePx: number;
    responseFontSizePx: number;
  }): Promise<void> {
    if (this.nextSaveError) throw this.nextSaveError;
    if (this.savePromise) await this.savePromise;
    this.transcriptFontSizeSaveCalls.push(nextFontSizesPx);
    this.snapshot = {
      ...this.snapshot,
      ...nextFontSizesPx
    };
    for (const listener of this.listeners) listener();
  }

  replaceQuickActions(nextQuickActions: QuickActionsSettings): void {
    this.snapshot = { ...this.snapshot, quickActions: nextQuickActions };
    for (const listener of this.listeners) listener();
  }

  replaceTranscriptFontSizes(nextFontSizesPx: { promptFontSizePx: number; responseFontSizePx: number }): void {
    this.snapshot = { ...this.snapshot, ...nextFontSizesPx };
    for (const listener of this.listeners) listener();
  }

  holdReadiness(): void {
    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
  }

  resolveReadiness(): void {
    this.resolveReady?.();
  }

  holdSave(): void {
    this.savePromise = new Promise((resolve) => {
      this.resolvePendingSave = resolve;
    });
  }

  resolveSave(): void {
    this.resolvePendingSave?.();
    this.savePromise = undefined;
  }
}

type FakeSpeechCredentialStatus =
  | { configured: false }
  | { configured: true; source: "keychain" | "environment"; redactedKey: string };

class FakeSpeechCredentialClient {
  readonly calls: Array<{ type: "status" } | { type: "save"; apiKey: string } | { type: "test"; apiKey?: string } | { type: "remove" }> = [];
  private readonly listeners = new Set<() => void>();
  private readonly requestStatusError: string | undefined;
  private snapshot: { status: FakeSpeechCredentialStatus; busy: boolean; error?: string; disconnectGeneration: number };

  constructor(overrides: Partial<{ status: FakeSpeechCredentialStatus; busy: boolean; error: string; requestStatusError: string }> = {}) {
    const { requestStatusError, ...snapshotOverrides } = overrides;
    this.requestStatusError = requestStatusError;
    this.snapshot = {
      status: { configured: false },
      busy: false,
      disconnectGeneration: 0,
      ...snapshotOverrides
    };
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  requestStatus(): void {
    this.calls.push({ type: "status" });
    if (!this.requestStatusError) return;
    this.snapshot = {
      ...this.snapshot,
      busy: false,
      error: this.requestStatusError
    };
    this.emit();
  }

  saveApiKey(apiKey: string) {
    this.calls.push({ type: "save", apiKey });
    this.snapshot = {
      status: { configured: true, source: "keychain", redactedKey: "sk-...cret" },
      busy: false,
      disconnectGeneration: this.snapshot.disconnectGeneration
    };
    this.emit();
    return { ok: true as const };
  }

  testApiKey(apiKey?: string) {
    this.calls.push(apiKey === undefined ? { type: "test" } : { type: "test", apiKey });
    return { ok: true as const };
  }

  removeApiKey() {
    this.calls.push({ type: "remove" });
    this.snapshot = { status: { configured: false }, busy: false, disconnectGeneration: this.snapshot.disconnectGeneration };
    this.emit();
    return { ok: true as const };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

class FakeSpeechPreviewClient {
  readonly calls: Array<{ voice: string; speed: number; instructions: string }> = [];
  private readonly listeners = new Set<() => void>();
  private snapshot: { status: "idle" | "loading" | "playing" | "paused" | "error"; error?: string } = { status: "idle" };

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  playSample(settings: { voice: string; speed: number; instructions: string }) {
    this.calls.push(settings);
    this.snapshot = { status: "playing" };
    for (const listener of this.listeners) listener();
    return { ok: true as const };
  }
}
