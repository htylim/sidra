# UI Interaction States Implementation Plan

## Overview

Sidra's extension UI has controls that work functionally but do not consistently feel interactive. This plan adds explicit interaction-state guidelines, shared CSS state rules, component affordances, and feedback for async actions.

## Current State Analysis

The side panel and options page already use semantic controls and accessible names in many places, but visual interaction feedback is incomplete. Buttons mostly define base and disabled styles only. Inputs define base styles only. Some async actions disable controls but do not show progress or completion feedback.

## Desired End State

All enabled interactive controls have clear hover, focus-visible, active, disabled, and selected/open states where applicable. Async actions expose busy or completion feedback. The repo has a concise durable UI guideline document that future extension UI work can follow.

### Key Discoveries

- Toolbar and prompt-options icon buttons share base styles but have no hover, focus-visible, active, or open-state styling: `apps/extension/src/styles.css:75`.
- Primary buttons share base styles but have no enabled interaction states: `apps/extension/src/styles.css:258`.
- Code-copy, permission, retry, and secondary buttons each define local base styles without a shared state contract: `apps/extension/src/styles.css:422`, `apps/extension/src/styles.css:584`, `apps/extension/src/styles.css:769`.
- Disabled controls are styled globally, but enabled controls do not get `cursor: pointer`: `apps/extension/src/styles.css:779`.
- Composer and options form fields have base borders but no focus-visible or invalid styling: `apps/extension/src/styles.css:618`, `apps/extension/src/styles.css:739`.
- Transcript activity disclosure summaries are keyboard-focusable interactive controls, but only define a base cursor style: `apps/extension/src/styles.css:472`.
- Icon-only buttons have accessible labels but no visual tooltip/title affordance: `apps/extension/src/side-panel-view.tsx:86`, `apps/extension/src/side-panel-view.tsx:164`.
- Prompt options tracks `aria-expanded`, but the button has no visible open state: `apps/extension/src/side-panel-view.tsx:164`.
- Copy-code writes to the clipboard but gives no success or failure feedback: `apps/extension/src/assistant-markdown.tsx:35`.
- Options save disables editing while saving, but the Save button does not show a busy label or `aria-busy`: `apps/extension/src/options-page-view.tsx:158`.

## What We're NOT Doing

- Do not change the current-page card, chevron, favicon, layout, or component extraction. That work is in progress elsewhere.
- Do not redesign the visual brand, information architecture, transcript layout, or command model.
- Do not add an external design system dependency.
- Do not add animation-heavy behavior. State changes should be direct and accessible.
- Do not change bridge, protocol, capture, or provider behavior.

## Implementation Approach

Use the existing React and CSS structure. Add a small shared CSS interaction contract first, then wire component semantics and async feedback. Keep the changes readable for learners by using explicit class names and simple state attributes instead of dense abstractions.

## Phase 1: Shared Interaction-State CSS And UI Guidelines

### Overview

Add durable UI guidelines and establish shared CSS rules for enabled, hover, focus-visible, active, disabled, and form-field states.

### Why This Phase Can Be Validated Independently

This phase can be verified by static CSS contract tests and manual browser checks without changing component behavior.

### Changes Required

> **TDD ordering**: List the test file(s) and enumerate the test names FIRST. The implementation files come SECOND. Tests are written and run RED before any implementation lands.

#### 1. Tests (RED)

**File**: `apps/extension/src/styles.test.ts`

**Changes**: Add source-level CSS contract tests. These tests intentionally protect interaction-state selectors because jsdom does not evaluate browser hover/focus behavior.

Read `styles.css` with `readFileSync(new URL("./styles.css", import.meta.url), "utf8")`. Keep assertions specific to selectors and declarations that matter for the contract. Do not snapshot the whole stylesheet.

```ts
// Group: extension UI interaction state CSS
it("defines_enabled_button_cursor_hover_focus_visible_and_active_states", () => {});
it("keeps_disabled_controls_visually_inert_without_hover_override", () => {});
it("defines_focus_visible_states_for_text_inputs_and_textareas", () => {});
it("defines_hover_focus_visible_and_active_states_for_activity_disclosure_summaries", () => {});
it("defines_invalid_field_styles_for_options_form_validation", () => {});
```

#### 2. Documentation

**File**: `docs/UI-GUIDELINES.md`

**Changes**: Add a concise current-state UI guideline document.

Cover:
- Required states for interactive controls: default, hover, focus-visible, active, disabled, busy, selected/open.
- Keyboard accessibility expectations.
- Icon-only button expectations: accessible name plus visual affordance such as `title` or tooltip.
- Form validation expectations: `aria-invalid`, visible error text, and disabled submit when invalid.
- Manual verification expectations for side panel and options page.

#### 3. Implementation (GREEN)

**File**: `apps/extension/src/styles.css`

**Changes**:
- Add enabled button cursor rules using `button:not(:disabled)`.
- Add shared hover, focus-visible, and active rules for:
  - `.toolbar-button`
  - `.options-button`
  - `.quick-action-button`
  - `.send-button`
  - `.retry-button`
  - `.secondary-button`
  - `.code-copy-button`
  - `.permission-actions button`
- Add `:focus-visible` rules for `input` and `textarea`.
- Add hover, `:focus-visible`, and active rules for `.activity-disclosure summary` because it is keyboard-focusable interactive UI.
- Add invalid field styling with `[aria-invalid="true"]`.
- Keep disabled controls visually inert by scoping hover/active styles to `:not(:disabled)`.
- Use color changes, border changes, and focus rings. Avoid layout-shifting transforms.

### Success Criteria

#### Automated Verification

- [x] Phase 1 CSS tests fail BEFORE implementation lands (red): `pnpm --filter @sidra/extension test -- src/styles.test.ts`
- [x] Phase 1 CSS tests pass AFTER implementation lands (green): `pnpm --filter @sidra/extension test -- src/styles.test.ts`
- [x] Extension type checking passes: `pnpm --filter @sidra/extension check`
- [x] No related extension tests regress: `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx src/options-page.test.tsx`

#### Manual Verification

- [ ] In the side panel, enabled buttons visibly change on hover.
- [ ] Keyboard tabbing shows a clear focus ring on buttons, textarea, and prompt options.
- [x] Keyboard tabbing shows a clear focus ring on transcript activity disclosures when they are present.
- [ ] Mouse press shows a clear active state without moving layout.
- [ ] Disabled controls remain muted and do not show enabled hover/active styling.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Component Affordances And Open States

### Overview

Wire visual-state semantics into the side panel components. Icon-only buttons get title affordances, and Prompt options gets a visible open state.

### Why This Phase Can Be Validated Independently

The component output can be tested with React Testing Library. Manual checks can verify hover/focus/open states without depending on async work.

### Changes Required

#### 1. Tests (RED)

**File**: `apps/extension/src/side-panel-view.test.tsx`

**Changes**: Add tests.

```ts
// Group: interaction affordances
it("adds_title_affordances_to_icon_only_header_buttons", () => {});
it("adds_title_affordance_to_prompt_options_button", () => {});
it("marks_prompt_options_button_open_for_visual_state_when_expanded", async () => {});
it("does_not_mark_prompt_options_button_open_after_closing", async () => {});
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/side-panel-view.tsx`

**Changes**:
- Add `title="Settings"` to the Settings icon button.
- Add `title="New chat"` to the New chat icon button.
- Add `title="Prompt options"` to the Prompt options icon button.
- Add an explicit visual-state attribute to the Prompt options button, such as `data-state={promptOptionsOpen ? "open" : "closed"}`.
- Do not touch the current-page card.

**File**: `apps/extension/src/styles.css`

**Changes**:
- Add visible styling for `.options-button[data-state="open"]`.
- Keep open-state styling compatible with hover, focus-visible, active, and disabled states.

### Success Criteria

#### Automated Verification

- [x] Phase 2 tests fail BEFORE implementation lands (red): `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx -t "interaction affordances"`
- [x] Phase 2 tests pass AFTER implementation lands (green): `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx -t "interaction affordances"`
- [x] Phase 1 CSS contract still passes: `pnpm --filter @sidra/extension test -- src/styles.test.ts`
- [x] Extension type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [x] Hovering icon-only buttons exposes native title text or an equivalent browser affordance.
- [x] Opening Prompt options visibly marks the button as open.
- [x] Closing Prompt options removes the open visual state.
- [ ] Keyboard focus remains clear when Prompt options is open.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Async And Completion Feedback

### Overview

Add user-visible feedback for async actions that currently feel silent: saving settings and copying code.

### Why This Phase Can Be Validated Independently

The changed behavior is isolated to the options page and assistant markdown code block. Tests can verify busy labels, disabled state, and copy success/failure feedback.

### Changes Required

#### 1. Tests (RED)

**File**: `apps/extension/src/options-page.test.tsx`

**Changes**: Add tests.

```ts
// Group: settings save feedback
it("shows_saving_feedback_and_busy_state_while_quick_action_save_is_in_flight", async () => {});
it("restores_save_button_label_after_successful_quick_action_save", async () => {});
it("restores_save_button_label_after_failed_quick_action_save", async () => {});
```

**File**: `apps/extension/src/side-panel-view.test.tsx`

**Changes**: Keep the existing clipboard-write coverage and add feedback tests for rendered assistant markdown code blocks.

```ts
// Group: code copy feedback
it("shows_copied_feedback_after_copying_code", async () => {});
it("shows_copy_failed_feedback_when_clipboard_write_fails", async () => {});
it("shows_copy_failed_feedback_when_clipboard_api_is_unavailable", async () => {});
it("resets_code_copy_feedback_after_a_short_timeout", async () => {});
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/options-page-view.tsx`

**Changes**:
- Render `Saving...` while `saving` is true.
- Add `aria-busy={saving ? "true" : undefined}` to the Save button or nearby action region.
- Keep existing disabled behavior while saving.
- Restore `Save` after success or failure.

**File**: `apps/extension/src/assistant-markdown.tsx`

**Changes**:
- Track copy status locally in `CodeBlock`.
- Change button text to `Copied` after successful clipboard write.
- Change button text to `Copy failed` when clipboard write rejects or `navigator.clipboard.writeText` is unavailable.
- Reset status to `Copy code` before each new copy attempt and after a short timeout.
- Clear any pending copy-status reset timer when the code block unmounts.
- Keep the button accessible by preserving a meaningful accessible name.

**File**: `apps/extension/src/styles.css`

**Changes**:
- Add state styling for copy success and failure if state attributes or classes are introduced.
- Ensure busy and feedback states preserve button dimensions enough to avoid jarring layout shift.

### Success Criteria

#### Automated Verification

- [x] Options feedback tests fail BEFORE implementation lands (red): `pnpm --filter @sidra/extension test -- src/options-page.test.tsx -t "settings save feedback"`
- [x] Code-copy feedback tests fail BEFORE implementation lands (red): `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx -t "code copy feedback"`
- [x] Options feedback tests pass AFTER implementation lands (green): `pnpm --filter @sidra/extension test -- src/options-page.test.tsx -t "settings save feedback"`
- [x] Code-copy feedback tests pass AFTER implementation lands (green): `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx -t "code copy feedback"`
- [x] Existing clipboard-write behavior still passes: `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx -t "clicking_code_copy_writes_code_to_clipboard"`
- [x] Extension type checking passes: `pnpm --filter @sidra/extension check`
- [x] Related view tests pass: `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx src/options-page.test.tsx`

#### Manual Verification

- [x] Saving settings visibly changes Save to Saving while the save is in flight.
- [x] Save returns to its normal label after success.
- [x] Copy code changes to Copied after a successful copy.
- [x] Copy code shows Copy failed when clipboard write fails or is unavailable.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Options Form Validation Feedback

### Overview

Make invalid quick-action drafts visible at the field level instead of only disabling Save.

### Why This Phase Can Be Validated Independently

This phase only changes options-page validation rendering and styles. Tests can verify `aria-invalid`, error text, and submit blocking.

### Changes Required

#### 1. Tests (RED)

**File**: `apps/extension/src/options-page.test.tsx`

**Changes**: Add tests.

```ts
// Group: quick action validation feedback
it("marks_blank_quick_action_label_as_invalid_with_visible_error", async () => {});
it("marks_blank_quick_action_prompt_as_invalid_with_visible_error", async () => {});
it("clears_quick_action_field_error_after_valid_text_is_entered", async () => {});
it("does_not_show_quick_action_field_errors_before_user_edits", async () => {});
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/options-page-view.tsx`

**Changes**:
- Derive per-field validation state for quick action label and prompt.
- Track field interaction by action ID and field name so errors appear after user edits the specific field, not globally for the whole form.
- Add `aria-invalid="true"` to invalid fields.
- Add concise visible error text near each invalid field.
- Connect error text with stable `aria-describedby` IDs derived from the action ID and field name.
- Keep Save disabled while any action draft is invalid.
- Avoid showing noisy errors before the user edits a field unless an existing saved/draft value is already invalid.
- Clear touched validation state for a quick action when that action is removed.

**File**: `apps/extension/src/styles.css`

**Changes**:
- Add compact validation-error styling.
- Use existing error color direction from `.settings-error`.
- Keep labels and errors readable in narrow extension widths.

### Success Criteria

#### Automated Verification

- [x] Phase 4 tests fail BEFORE implementation lands (red): `pnpm --filter @sidra/extension test -- src/options-page.test.tsx -t "quick action validation feedback"`
- [x] Phase 4 tests pass AFTER implementation lands (green): `pnpm --filter @sidra/extension test -- src/options-page.test.tsx -t "quick action validation feedback"`
- [x] Phase 1 CSS contract still passes: `pnpm --filter @sidra/extension test -- src/styles.test.ts`
- [x] Extension type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [x] Blank quick-action labels and prompts show clear inline errors.
- [x] Save remains disabled while errors are present.
- [ ] Errors clear after valid text is entered.
- [x] Keyboard users can identify invalid fields and associated error text.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before final validation.

---

## Testing Strategy

This section covers final validation only. It does not replace the phase-specific checks above.

### Unit And Component Tests

- `apps/extension/src/styles.test.ts` protects CSS interaction-state selectors.
- `apps/extension/src/side-panel-view.test.tsx` protects side panel affordances and copy-code feedback.
- `apps/extension/src/options-page.test.tsx` protects save feedback and validation feedback.

### Final Automated Checks

- [x] Full extension test suite passes: `pnpm --filter @sidra/extension test`
- [x] Extension type checking passes: `pnpm --filter @sidra/extension check`
- [x] Repo check passes: `pnpm check`

### Manual Testing Steps

1. Open the side panel.
2. Hover Settings, New chat, quick actions, Prompt options, Capture + Send, permission buttons, and Copy code.
3. Tab through the same controls and confirm the focus ring is clear.
4. Press buttons and confirm active feedback is visible without layout shift.
5. Open Prompt options and confirm the button has a visible open state.
6. Save options and confirm Saving feedback appears during the in-flight save.
7. Make quick-action fields blank and confirm inline validation appears.
8. Copy a code block and confirm success feedback appears.

## Performance Considerations

The work is CSS and small React state only. It should not affect bridge, capture, or provider performance. Avoid adding timers globally; any copy-status reset timer should be scoped to the code block component and cleaned up on unmount.

## Documentation

Add `docs/UI-GUIDELINES.md` in Phase 1. No architecture doc update is required unless implementation creates a new UI ownership boundary, which this plan should avoid.
