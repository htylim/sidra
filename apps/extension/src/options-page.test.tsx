// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DOM_CONTENT_LIMIT_CHARACTERS,
  DEFAULT_QUICK_ACTIONS_SETTINGS,
  DEFAULT_READABLE_CONTENT_LIMIT_CHARACTERS,
  type QuickActionsSettings,
  type SidraSettings,
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
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false));
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

    expect((await screen.findByRole("alert")).textContent).toBe("Could not save quick actions.");
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

    await screen.findByLabelText("Action 1 label");
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

  describe("settings save feedback", () => {
    it("shows_saving_feedback_and_busy_state_while_quick_action_save_is_in_flight", async () => {
      const user = userEvent.setup();
      const store = new FakeSettingsStore();
      store.holdSave();
      render(<OptionsPageView settingsStore={store} />);

      await screen.findByLabelText("Action 1 label");
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

      await screen.findByLabelText("Action 1 label");
      await user.click(screen.getByRole("button", { name: "Save" }));
      store.resolveSave();

      expect((await screen.findByRole("button", { name: "Save" })).getAttribute("aria-busy")).toBeNull();
    });

    it("restores_save_button_label_after_failed_quick_action_save", async () => {
      const user = userEvent.setup();
      const store = new FakeSettingsStore();
      store.nextSaveError = new Error("quota exceeded");
      render(<OptionsPageView settingsStore={store} />);

      await screen.findByLabelText("Action 1 label");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect((await screen.findByRole("button", { name: "Save" })).getAttribute("aria-busy")).toBeNull();
      expect(screen.getByRole("alert").textContent).toBe("Could not save quick actions.");
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

class FakeSettingsStore implements Pick<SettingsStore, "getSnapshot" | "whenReady" | "subscribe" | "saveQuickActions"> {
  readonly saveCalls: QuickActionsSettings[] = [];
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
      quickActions: DEFAULT_QUICK_ACTIONS_SETTINGS,
      ...overrides
    };
  }

  getSnapshot(): SidraSettings {
    return {
      ...this.snapshot,
      quickActions: {
        enabled: this.snapshot.quickActions.enabled,
        actions: this.snapshot.quickActions.actions.map((action) => ({ ...action }))
      }
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

  replaceQuickActions(nextQuickActions: QuickActionsSettings): void {
    this.snapshot = { ...this.snapshot, quickActions: nextQuickActions };
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
