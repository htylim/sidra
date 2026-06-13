# Sidebar Transcript UI Improvements Implementation Plan

## Overview

Improve the side panel reading experience by enlarging transcript text by default, making that size configurable from the Sidra settings page, showing quick-action prompts as compact labeled transcript entries, and replacing the composer settings button with a quiet inline `Send DOM` checkbox.

## Current State Analysis

The requested behavior belongs in `apps/extension`. `docs/ARCHITECTURE.md` says the extension owns side panel rendering, options-page rendering, URL session state, settings, and quick-action configuration. No bridge or provider protocol change is needed.

Current relevant behavior:

- Settings are persisted by `SettingsStore`, whose snapshot currently contains readable limit, DOM limit, and quick actions only: `apps/extension/src/settings-store.ts:1`.
- `OptionsPageView` currently edits only quick-action settings and saves through `saveQuickActions`: `apps/extension/src/options-page-view.tsx:4`.
- The side panel controller already reads settings and derives visible quick actions without exposing prompt text to React: `apps/extension/src/side-panel-controller.ts:133`, `apps/extension/src/side-panel-controller.ts:364`.
- Quick-action execution currently sends only the configured prompt through `captureAndSendCommand(action.prompt)`: `apps/extension/src/side-panel-controller.ts:262`.
- Transcript entries model user messages as plain text only: `apps/extension/src/transcript.ts:19`.
- The bridge session coordinator adds user prompts to the transcript from the normalized prompt text: `apps/extension/src/bridge/session-coordinator.ts:685`, `apps/extension/src/bridge/session-coordinator.ts:705`.
- Transcript rendering is isolated in `TranscriptView`; user messages render as a single `.message.user` block: `apps/extension/src/transcript-view.tsx:15`, `apps/extension/src/transcript-view.tsx:46`.
- Transcript message font size is hard-coded at `13px`: `apps/extension/src/styles.css:350`.
- The bottom-left composer settings button opens a popover that contains only `Send Full DOM`: `apps/extension/src/side-panel-view.tsx:155`, `apps/extension/src/side-panel-view.tsx:172`.

## Desired End State

1. Transcript prompt and response text defaults to `15px`, two one-pixel bumps above the current `13px`. This applies to user prompt bubbles, assistant response content, status cards, permission cards, activity details, and command output that is visually part of the transcript.
2. The Sidra settings page has a readable control for transcript font size. The saved value updates the side panel live through `SettingsStore`.
3. Quick actions still send the full configured prompt to the agent and preserve the current capture behavior. The transcript user message shows the quick-action label first, not the full prompt wall.
4. A quick-action transcript entry has an inline expand/collapse affordance inside the user prompt bubble. Collapsed state shows the quick-action label. Expanded state shows the actual prompt text.
5. Normal manually typed prompts still render as plain prompt text. They do not get quick-action UI.
6. The composer no longer has a bottom-left settings icon or prompt-options popover. The single option moves into that bottom-left area as a quiet `Send DOM` checkbox with restrained styling.

### Behavior Matrix

| Scenario | Expected Behavior | Covering Test |
| --- | --- | --- |
| No stored transcript font size | Settings default is `15` | `loads_default_transcript_font_size_when_storage_is_empty` |
| Stored font size is valid | Settings snapshot uses stored value | `loads_stored_transcript_font_size_when_valid` |
| Stored font size is invalid | Settings snapshot falls back to default | `ignores_invalid_transcript_font_size_and_keeps_default` |
| Font size changes in local storage | Side panel snapshot updates live | `updates_transcript_font_size_when_settings_change_live` |
| Settings page edits font size | Save writes the new font size without losing quick actions | `edits_transcript_font_size_from_options_page` |
| Transcript is rendered | Transcript root exposes the configured font size | `renders_transcript_with_configured_font_size` |
| Quick action is clicked | Agent receives full configured prompt | `sendQuickAction_sends_full_prompt_but_marks_transcript_as_quick_action` |
| Quick-action transcript entry is collapsed | User bubble shows label, not prompt wall | `renders_quick_action_user_message_collapsed_by_default` |
| Quick-action transcript entry is expanded | User bubble shows actual prompt text | `expands_quick_action_user_message_to_show_prompt_text` |
| Manual prompt is sent | User bubble remains plain text with no quick-action disclosure | `renders_manual_user_message_without_quick_action_disclosure` |
| Composer is idle | Bottom-left area shows quiet `Send DOM` checkbox, no settings icon | `renders_inline_send_dom_checkbox_without_prompt_options_button` |
| Send DOM is toggled | Existing capture-mode callback receives `full_dom` or `readable` | `inline_send_dom_checkbox_updates_capture_mode` |

## What We're NOT Doing

- Do not change the bridge/provider protocol.
- Do not change quick-action prompt configuration semantics.
- Do not expose quick-action prompt text in `VisibleQuickAction`; React should still receive only id and label for empty-state quick-action buttons.
- Do not persist font size per URL session. This is a global Sidra setting.
- Do not redesign the header settings button. It remains the way to open the Sidra settings page.
- Do not add a full theme or accessibility-preferences system.
- Do not run manual browser extension E2E as part of this spec-writing task.

## Implementation Approach

Add a global `transcriptFontSizePx` setting in `SettingsStore`. Keep validation and persistence inside the settings boundary. Expose the value through `SidePanelSnapshot` as display settings for the view. `TranscriptView` receives the size and sets a CSS custom property on the transcript root, while CSS uses that variable for transcript text.

For quick actions, carry display metadata with the prompt submission instead of inferring from text. Add a typed `UserPromptDisplay` or equivalent to transcript user messages, for example:

```ts
type UserPromptDisplay =
  | { kind: "plain" }
  | { kind: "quick_action"; label: string };
```

The prompt text stays on the transcript entry as the source prompt. The view decides whether to render the plain prompt or the quick-action label plus a disclosure for the prompt text. The controller passes quick-action metadata only when the prompt came from `sendQuickAction`.

Replace `promptOptionsOpen` and the icon-only bottom-left composer button with an inline checkbox. Keep the existing `CaptureMode` state and `onCaptureModeChange` callback. The label should be `Send DOM`, not `Send Full DOM`, and the styling should be quiet: smaller text, neutral color, compact hit target, and no primary-button weight.

## Phase 1: Persist Transcript Font Size

### Overview

Add `transcriptFontSizePx` to persisted Sidra settings with bounded validation and a targeted save method.

### Why This Phase Can Be Validated Independently

`SettingsStore` can prove defaults, parsing, validation, live updates, immutability, and saving without React.

### Changes Required

> **TDD ordering**: List tests first. Write and run these tests RED before implementation.

#### 1. Tests (RED)

**File**: `apps/extension/src/settings-store.test.ts`

Add these tests:

```ts
it("loads_default_transcript_font_size_when_storage_is_empty", async () => {});
it("loads_stored_transcript_font_size_when_valid", async () => {});
it("ignores_invalid_transcript_font_size_and_keeps_default", async () => {});
it("applies_live_transcript_font_size_changes_from_local_storage", async () => {});
it("writes_transcript_font_size_to_storage", async () => {});
it("saving_transcript_font_size_preserves_existing_capture_limits_and_quick_actions", async () => {});
it("saving_quick_actions_preserves_existing_transcript_font_size", async () => {});
it("returns_snapshots_that_cannot_mutate_transcript_font_size_state", async () => {});
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/settings-store.ts`

Changes:

- Add `transcriptFontSizePx` to `SidraSettings`.
- Add constants:
  - `DEFAULT_TRANSCRIPT_FONT_SIZE_PX = 15`
  - `MIN_TRANSCRIPT_FONT_SIZE_PX = 12`
  - `MAX_TRANSCRIPT_FONT_SIZE_PX = 22`
- Parse and validate stored values as integers within range.
- Include the value in `defaultSidraSettings`, `cloneSettings`, equality checks, and storage-change parsing.
- Add `saveTranscriptFontSizePx(nextFontSizePx: number): Promise<void>`.
- Keep `saveQuickActions` preserving the stored font size.

### Success Criteria

#### Automated Verification

- [ ] Phase-1 tests fail before implementation lands: `pnpm --filter @sidra/extension test -- src/settings-store.test.ts -t "transcript_font_size|saving_quick_actions_preserves_existing_transcript_font_size"`
- [ ] Phase-1 tests pass after implementation lands: `pnpm --filter @sidra/extension test -- src/settings-store.test.ts`
- [ ] Type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [ ] Not applicable in this phase. This phase is store-only.

---

## Phase 2: Add Font Size Control To Settings Page

### Overview

Expose `transcriptFontSizePx` in the options page with a compact control that saves through `SettingsStore`.

### Why This Phase Can Be Validated Independently

The options page can prove that it renders the saved value, edits it, validates bounds, blocks save while loading/saving, and preserves quick-action settings.

### Changes Required

> **TDD ordering**: List tests first. Write and run these tests RED before implementation.

#### 1. Tests (RED)

**File**: `apps/extension/src/options-page.test.tsx`

Add these tests:

```ts
it("renders_transcript_font_size_control_after_settings_are_ready", async () => {});
it("edits_transcript_font_size_from_options_page", async () => {});
it("does_not_save_invalid_transcript_font_size", async () => {});
it("does_not_overwrite_unsaved_font_size_when_live_settings_change", async () => {});
it("disables_font_size_control_while_save_is_in_flight", async () => {});
it("resyncs_font_size_from_store_after_successful_save", async () => {});
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/options-page-view.tsx`

Changes:

- Extend `OptionsSettingsStore` with `saveTranscriptFontSizePx`.
- Add local draft state for `transcriptFontSizePx`.
- Render a settings section labeled `Transcript text size`.
- Use a number input or range plus numeric readout. The accessible name must be `Transcript text size`.
- Enforce `MIN_TRANSCRIPT_FONT_SIZE_PX` and `MAX_TRANSCRIPT_FONT_SIZE_PX`.
- Keep unsaved edits from being overwritten by live settings changes, matching the quick-action dirty-state pattern.
- Save font size and quick-action edits through explicit store methods. A single `Save` button may save both dirty groups, but it must preserve unrelated settings.

**File**: `apps/extension/src/styles.css`

Changes:

- Add restrained options-page styles for the font-size control.
- Keep inputs readable and aligned with current options-page form styling.

### Success Criteria

#### Automated Verification

- [ ] Phase-2 tests fail before implementation lands: `pnpm --filter @sidra/extension test -- src/options-page.test.tsx -t "font_size|Transcript text size"`
- [ ] Phase-2 tests pass after implementation lands: `pnpm --filter @sidra/extension test -- src/options-page.test.tsx`
- [ ] Existing settings store tests still pass: `pnpm --filter @sidra/extension test -- src/settings-store.test.ts`
- [ ] Type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [ ] Open the Sidra settings page.
- [ ] Confirm the transcript text size control starts at `15`.
- [ ] Save a larger value, reopen the settings page, and confirm the value persists.
- [ ] Save a smaller valid value and confirm the value persists.

---

## Phase 3: Apply Configurable Font Size To Transcript

### Overview

Expose the font size through the side panel controller snapshot and apply it to transcript rendering.

### Why This Phase Can Be Validated Independently

The controller and React view can prove the configured font size reaches transcript DOM without changing message semantics.

### Changes Required

> **TDD ordering**: List tests first. Write and run these tests RED before implementation.

#### 1. Tests (RED)

**File**: `apps/extension/src/side-panel-controller.test.ts`

Add these tests:

```ts
it("snapshot_exposes_default_transcript_font_size", async () => {});
it("updates_transcript_font_size_when_settings_change_live", async () => {});
```

**File**: `apps/extension/src/side-panel-view.test.tsx`

Add these tests:

```ts
it("passes_transcript_font_size_to_transcript_view", () => {});
it("renders_transcript_with_configured_font_size", () => {});
```

**File**: `apps/extension/src/styles.test.ts`

Add these tests:

```ts
it("uses_transcript_font_size_variable_for_transcript_text", () => {});
it("uses_transcript_font_size_variable_for_assistant_markdown_code_text", () => {});
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/side-panel-controller.ts`

Changes:

- Add a display/settings section to `SidePanelSnapshot`, for example:

```ts
display: {
  transcriptFontSizePx: number;
}
```

- Populate it from `settingsSnapshot.transcriptFontSizePx`.
- Include it in snapshot refresh comparisons.

**File**: `apps/extension/src/side-panel-view.tsx`

Changes:

- Pass `snapshot.display.transcriptFontSizePx` into `TranscriptView`.

**File**: `apps/extension/src/transcript-view.tsx`

Changes:

- Accept `fontSizePx`.
- Set a CSS custom property on `.transcript`, for example `--sidra-transcript-font-size: 15px`.

**File**: `apps/extension/src/styles.css`

Changes:

- Change transcript text selectors from fixed sizes to `var(--sidra-transcript-font-size)`.
- Apply the configured size to:
  - `.message`
  - `.status-card`
  - `.permission-card`
  - `.assistant-markdown`
  - `.assistant-markdown code`
  - `.code-block code`
  - activity text that is part of transcript content
- Keep smaller utility labels allowed where they are not transcript body text, such as disclosure summaries or button labels.

### Success Criteria

#### Automated Verification

- [ ] Phase-3 tests fail before implementation lands: `pnpm --filter @sidra/extension test -- src/side-panel-controller.test.ts src/side-panel-view.test.tsx src/styles.test.ts -t "transcript_font_size|configured_font_size|transcript text"`
- [ ] Phase-3 tests pass after implementation lands: `pnpm --filter @sidra/extension test -- src/side-panel-controller.test.ts src/side-panel-view.test.tsx src/styles.test.ts`
- [ ] Type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [ ] Open the side panel on an article.
- [ ] Send a prompt and confirm user prompt and assistant response text use the saved size.
- [ ] Change the font size in settings and confirm the side panel updates without reloading.
- [ ] Confirm header, page card, composer, and primary buttons do not become oversized.

---

## Phase 4: Compact Quick-Action Transcript Entries

### Overview

Keep full quick-action prompts going to the agent, but render quick-action user messages as compact labeled bubbles with an expandable prompt body.

### Why This Phase Can Be Validated Independently

Transcript state and rendering can prove the compact display while controller tests prove the full prompt is still sent.

### Changes Required

> **TDD ordering**: List tests first. Write and run these tests RED before implementation.

#### 1. Tests (RED)

**File**: `apps/extension/src/transcript.test.ts`

Add these tests:

```ts
it("adds_quick_action_user_prompt_entries_with_label_display_metadata", () => {});
it("keeps_plain_user_prompt_entries_without_quick_action_metadata", () => {});
it("trims_quick_action_label_and_prompt_before_storage_in_transcript", () => {});
```

**File**: `apps/extension/src/bridge/session-coordinator.test.ts`

Add these tests:

```ts
it("adds_quick_action_display_metadata_to_queued_submission_transcript", () => {});
it("adds_quick_action_display_metadata_to_started_session_submission_transcript", () => {});
it("still_posts_full_quick_action_prompt_to_the_bridge", () => {});
```

**File**: `apps/extension/src/side-panel-controller.test.ts`

Add these tests:

```ts
it("sendQuickAction_sends_full_prompt_but_marks_transcript_as_quick_action", async () => {});
it("visible_quick_actions_still_do_not_expose_prompt_text_or_display_metadata", async () => {});
```

**File**: `apps/extension/src/side-panel-view.test.tsx`

Add these tests:

```ts
it("renders_quick_action_user_message_collapsed_by_default", () => {});
it("expands_quick_action_user_message_to_show_prompt_text", async () => {});
it("renders_manual_user_message_without_quick_action_disclosure", () => {});
it("escapes_quick_action_prompt_text_when_expanded", async () => {});
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/transcript.ts`

Changes:

- Add a typed display field to `UserMessageEntry`.
- Add a helper for quick-action prompts, or extend `addUserPrompt` with an optional display input:

```ts
type UserPromptDisplay =
  | { kind: "plain" }
  | { kind: "quick_action"; label: string };
```

- Keep plain prompts unchanged by default.
- Keep full prompt text in `UserMessageEntry.text`.

**File**: `apps/extension/src/bridge/session-coordinator.ts`

Changes:

- Extend `PromptSubmission` with optional user-prompt display metadata.
- Preserve that metadata through `prepareSubmission`.
- `addSubmissionTranscriptEntries` passes it to transcript creation.
- `session.send` still posts `submission.prompt`, never the label.

**File**: `apps/extension/src/url-session-store.ts`

Changes:

- Extend `sendPromptWithContext` input with optional display metadata.
- Forward metadata to coordinator without owning rendering decisions.

**File**: `apps/extension/src/side-panel-controller.ts`

Changes:

- Change the private `captureAndSendCommand` helper to accept optional transcript display metadata along with the prompt.
- When `sendQuickAction` finds a visible action, call capture-and-send with full prompt plus quick-action display metadata containing the action label.
- Keep `VisibleQuickAction` as `{ id, label }`.

**File**: `apps/extension/src/transcript-view.tsx`

Changes:

- Render quick-action user messages as:
  - Label row inside the green user bubble.
  - A small disclosure control such as `Show prompt` / `Hide prompt`.
  - Expanded prompt text inside the same bubble.
- Use semantic `<details>` / `<summary>` unless styling or accessible naming requires a small button.
- Do not use `dangerouslySetInnerHTML`.

**File**: `apps/extension/src/styles.css`

Changes:

- Add styles for quick-action transcript disclosure inside `.message.user`.
- Keep the collapsed bubble compact.
- Ensure expanded long prompts wrap and stay within the green bubble.

### Success Criteria

#### Automated Verification

- [ ] Phase-4 tests fail before implementation lands: `pnpm --filter @sidra/extension test -- src/transcript.test.ts src/bridge/session-coordinator.test.ts src/side-panel-controller.test.ts src/side-panel-view.test.tsx -t "quick_action.*transcript|quick_action_user_message|full_quick_action_prompt"`
- [ ] Phase-4 tests pass after implementation lands: `pnpm --filter @sidra/extension test -- src/transcript.test.ts src/bridge/session-coordinator.test.ts src/side-panel-controller.test.ts src/side-panel-view.test.tsx`
- [ ] Type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [ ] Open the side panel on a page with an empty transcript.
- [ ] Click `Summarize this page`.
- [ ] Confirm the transcript shows a compact green bubble labeled `Summarize this page`.
- [ ] Expand the bubble and confirm the full prompt text is visible inside the same green bubble.
- [ ] Confirm the assistant response still answers the full prompt.
- [ ] Send a manual prompt and confirm it renders normally.

---

## Phase 5: Replace Composer Options Button With Inline Send DOM Checkbox

### Overview

Remove the bottom-left settings icon and popover. Render the existing capture-mode option directly as a quiet inline checkbox.

### Why This Phase Can Be Validated Independently

The side panel view can prove the old button is gone, the new checkbox is present, and it still calls the existing capture-mode callback.

### Changes Required

> **TDD ordering**: List tests first. Write and run these tests RED before implementation.

#### 1. Tests (RED)

**File**: `apps/extension/src/side-panel-view.test.tsx`

Replace or add tests:

```ts
it("renders_inline_send_dom_checkbox_without_prompt_options_button", () => {});
it("renders_inline_send_dom_checkbox_off_for_readable_capture_mode", () => {});
it("renders_inline_send_dom_checkbox_on_for_full_dom_capture_mode", () => {});
it("inline_send_dom_checkbox_updates_capture_mode_to_full_dom_when_checked", async () => {});
it("inline_send_dom_checkbox_updates_capture_mode_to_readable_when_unchecked", async () => {});
it("disables_inline_send_dom_checkbox_when_chat_controls_are_disabled", () => {});
it("does_not_send_prompt_when_only_toggling_inline_send_dom", async () => {});
```

**File**: `apps/extension/src/styles.test.ts`

Add this test:

```ts
it("styles_inline_send_dom_checkbox_as_secondary_composer_option", () => {});
it("does_not_keep_prompt_options_button_styles_after_inline_send_dom_replaces_it", () => {});
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/side-panel-view.tsx`

Changes:

- Remove `promptOptionsOpen`, `promptOptionsVisible`, prompt-options effects, prompt-options button, and popover.
- Render a label in `.composer-actions` before the send controls:

```tsx
<label className="composer-dom-toggle">
  <input type="checkbox" checked={sendFullDom} ... />
  <span>Send DOM</span>
</label>
```

- Keep the checkbox disabled when prompt entry is disabled.
- Keep send mode menu behavior unchanged.

**File**: `apps/extension/src/styles.css`

Changes:

- Remove or stop using `.options-button`, `.prompt-options-popover`, and `.prompt-option-toggle` styles where they only supported the removed control.
- Add `.composer-dom-toggle` styling:
  - inline-flex
  - compact gap
  - neutral text
  - smaller font than primary send button
  - stable checkbox size
  - no filled button background
- Remove stale prompt-options button state selectors when no element uses them.

### Success Criteria

#### Automated Verification

- [ ] Phase-5 tests fail before implementation lands: `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx src/styles.test.ts -t "send_dom|prompt_options|composer option"`
- [ ] Phase-5 tests pass after implementation lands: `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx src/styles.test.ts`
- [ ] Type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [ ] Confirm the bottom-left composer settings icon is gone.
- [ ] Confirm the bottom-left composer area shows a quiet `Send DOM` checkbox.
- [ ] Toggle `Send DOM` on and send a prompt with `Capture + Send`; confirm the page card shows full DOM context when capture succeeds.
- [ ] Toggle `Send DOM` off and confirm later captures use readable context again.
- [ ] Confirm the checkbox does not visually compete with `Capture + Send` / `Send`.

---

## Final Verification

### Automated

- [ ] Extension tests pass: `pnpm --filter @sidra/extension test`
- [ ] Extension type checking passes: `pnpm --filter @sidra/extension check`
- [ ] Extension build passes: `pnpm --filter @sidra/extension build`

### Manual

1. Open an article with the Sidra side panel.
2. Confirm transcript text is visibly larger than before at the default setting.
3. Change transcript text size in Sidra settings and confirm the side panel transcript updates.
4. Click a quick action and confirm the transcript shows its label collapsed.
5. Expand the quick-action prompt and confirm the full prompt appears inside the same green user bubble.
6. Confirm manual prompts still show as normal prompt text.
7. Confirm the inline `Send DOM` checkbox is quiet and works.

## Performance Considerations

- Font-size changes should be simple React state/style updates. They should not recreate sessions or mutate transcript contents.
- Quick-action prompt text already exists in transcript state today. Adding display metadata should not materially increase storage or render cost.
- Expanded quick-action prompt rendering must wrap long text and must not cause horizontal overflow.

## Migration Notes

- Existing stored settings will not have `transcriptFontSizePx`; parsing must default to `15`.
- Existing in-memory transcript entries will not have quick-action display metadata. They render as plain user messages.
- Existing quick-action settings remain valid.

## References

- Architecture ownership: `docs/ARCHITECTURE.md`
- Settings store: `apps/extension/src/settings-store.ts`
- Options page: `apps/extension/src/options-page-view.tsx`
- Side panel controller: `apps/extension/src/side-panel-controller.ts`
- URL session store: `apps/extension/src/url-session-store.ts`
- Bridge session coordinator transcript submission: `apps/extension/src/bridge/session-coordinator.ts`
- Transcript model: `apps/extension/src/transcript.ts`
- Transcript view: `apps/extension/src/transcript-view.tsx`
- Side panel view: `apps/extension/src/side-panel-view.tsx`
- Extension styles: `apps/extension/src/styles.css`
