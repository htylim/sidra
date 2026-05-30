# Send Mode After Context Implementation Plan

## Overview

Implement the PRD send-mode contract for URL sessions. A new session defaults to `Capture + Send`, a successful context send switches that session's default action to plain `Send`, and the user can manually choose `Capture + Send` again later.

## Current State Analysis

The PRD says capture happens only when the user explicitly triggers `Capture + Send`; the first prompt in a new session defaults to `Capture + Send`; after a successful context send, the default action changes to `Send`; and users can manually select `Capture + Send` again later.

Current implementation does not model send mode. `SidePanelView` always routes composer sends through `onCaptureAndSend` and always labels the idle primary button `Capture + Send`. `UrlSessionStore` tracks `captureMode`, draft, context state, transcript, and running state per URL session, but not whether the next default send should capture. `SidePanelController.sendPrompt` already sends plain prompts without page context, and `captureAndSend` already sends optional page context through the existing protocol shape.

## Desired End State

Each URL session owns a `sendMode` value:

- `capture`: primary composer action captures page context and sends prompt plus page context.
- `send`: primary composer action sends only the prompt.

New URL sessions start in `capture`. A successful `sendPromptWithContext` changes only that URL session to `send`. `New Chat` resets the active URL session to `capture`. Manual mode selection can switch the active URL session back to `capture` or to `send` before any context is attached. Quick actions still use `Capture + Send` by default, independent of the composer default mode.

### Behavior Matrix

| State | User action | Expected command | Expected resulting mode | Test |
| --- | --- | --- | --- | --- |
| New URL session | Primary button or Enter | capture and send page context | `send` after accepted context send | `new_url_session_defaults_to_capture_send` |
| Context already attached | Primary button or Enter | plain send, no capture call, no `pageContext` | `send` | `primary_send_after_context_uses_plain_send_without_recapture` |
| Context already attached | User manually selects `Capture + Send`, then primary button | capture and send page context | `send` after accepted context send | `manual_capture_mode_recaptures_context_after_context_was_attached` |
| New URL session | User manually selects `Send`, then primary button | plain send, no capture call, no `pageContext` | `send` | `manual_send_mode_before_context_sends_plain_prompt` |
| URL session A has context, URL session B is new | Switch between pages | A remains `send`, B remains `capture` | unchanged per session | `send_mode_is_scoped_per_url_session` |
| Active session reset | New Chat | no prompt sent | `capture` | `new_chat_resets_send_mode_to_capture` |
| Empty session quick action | Click quick action | capture and send configured prompt | `send` after accepted context send | `quick_action_still_uses_capture_send_by_default` |

### Key Discoveries

- PRD send-mode rule lives in `docs/prd-v1.md`: `Capture + Send` is explicit, first prompt defaults to capture, after successful context send default changes to `Send`, and users can manually choose either mode.
- View already receives both callbacks: `apps/extension/src/side-panel-view.tsx:11` and `apps/extension/src/side-panel-view.tsx:12`.
- View currently always calls `onCaptureAndSend`: `apps/extension/src/side-panel-view.tsx:54`.
- View currently always renders `Capture + Send` when idle: `apps/extension/src/side-panel-view.tsx:164`.
- `UrlSessionStore` owns URL-session state and already exposes context state and capture mode: `apps/extension/src/url-session-store.ts:29`.
- `sendPromptWithContext` already records context state after an accepted captured send: `apps/extension/src/url-session-store.ts:181`.
- `SidePanelController.sendPrompt` already sends a plain prompt without capture: `apps/extension/src/side-panel-controller.ts:249`.
- `SidePanelController.captureAndSend` already captures the active tab at click time and sends page context: `apps/extension/src/side-panel-controller.ts:198`.
- Protocol already allows `session.send` with optional `pageContext`, so no protocol change is needed.

## What We're NOT Doing

- No bridge or provider changes.
- No protocol version bump.
- No automatic background capture.
- No persistent send-mode storage across side-panel lifetime.
- No change to quick-action settings or default prompt text.
- No visual redesign beyond the send-mode controls required to expose the existing PRD behavior.

## Implementation Approach

Add send mode to the extension-owned URL session state, then expose it through the controller snapshot to the React view. Keep capture mode (`readable` versus `full_dom`) separate from send mode (`capture` versus `send`). The primary composer action reads `sendMode` to decide whether to call `onCaptureAndSend` or `onSendPrompt`. The prompt-options popover should expose an explicit send-mode segmented control so the user can switch back to `Capture + Send` after context has been attached, or choose plain `Send` before any context has been attached.

## Phase 1: URL Session Send Mode State

### Overview

Model send mode as URL-session state and update it at the session boundary where captured context is accepted.

### Why This Phase Can Be Validated Independently

`UrlSessionStore` can prove mode defaults, context-send transitions, URL-session scoping, and `New Chat` reset without React or active-tab capture.

### Changes Required

> **TDD ordering**: List tests first. Write and run these tests RED before implementation.

#### 1. Tests (RED)

**File**: `apps/extension/src/url-session-store.test.ts`

Add tests:

```ts
// Group: send mode state
it("new_url_session_defaults_to_capture_send", () => {});
it("successful_context_send_switches_active_session_to_plain_send", () => {});
it("manual_send_mode_before_context_is_preserved_for_plain_send", () => {});
it("send_mode_is_scoped_per_url_session", () => {});
it("new_chat_resets_send_mode_to_capture", () => {});
```

Each test must assert `store.getSnapshot().activeSession.sendMode` or inactive session snapshots from `sessionsByClientSessionId`.

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/url-session-store.ts`

Changes:

- Add `export type SendMode = "capture" | "send"`.
- Add `sendMode: SendMode` to `UrlSessionRecord` and `UrlSessionSnapshot`.
- Initialize new records and empty snapshots with `sendMode: "capture"`.
- Add `updateActiveSendMode(sendMode: SendMode): void`.
- In `sendPromptWithContext`, switch `activeRecord.sendMode` to `"send"` only after `coordinator.sendPrompt(input)` accepts the submission.
- In `newChat`, reset `activeRecord.sendMode` to `"capture"`.
- Keep `captureMode` unchanged except where existing reset logic already resets it.

### Success Criteria

#### Automated Verification

- [ ] Phase 1 tests fail before implementation lands: `pnpm --filter @sidra/extension test -- src/url-session-store.test.ts -t "send_mode|context_send_switches|new_url_session_defaults|new_chat_resets_send_mode"`
- [ ] Phase 1 tests pass after implementation lands: `pnpm --filter @sidra/extension test -- src/url-session-store.test.ts -t "send_mode|context_send_switches|new_url_session_defaults|new_chat_resets_send_mode"`
- [ ] Existing URL session tests still pass: `pnpm --filter @sidra/extension test -- src/url-session-store.test.ts`
- [ ] Type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [ ] No manual UI verification required for this phase. This phase has no React behavior yet.

---

## Phase 2: Controller Snapshot And Commands

### Overview

Expose send mode through `SidePanelController`, route manual mode changes into `UrlSessionStore`, and prove controller-level capture versus plain-send behavior.

### Why This Phase Can Be Validated Independently

Controller tests can use fake capture services and fake native ports to prove whether page capture happens and whether `session.send` includes `pageContext`.

### Changes Required

> **TDD ordering**: List tests first. Write and run these tests RED before implementation.

#### 1. Tests (RED)

**File**: `apps/extension/src/side-panel-controller.test.ts`

Add tests:

```ts
// Group: send mode controller behavior
it("controller_snapshot_exposes_active_session_send_mode", () => {});
it("capture_and_send_switches_snapshot_send_mode_to_plain_send_after_success", async () => {});
it("plain_send_after_context_posts_without_page_context_and_does_not_capture", async () => {});
it("manual_capture_mode_recaptures_context_after_context_was_attached", async () => {});
it("manual_send_mode_before_context_sends_plain_prompt", () => {});
it("send_mode_is_scoped_to_the_captured_canonical_url_session", async () => {});
it("quick_action_still_uses_capture_send_by_default", async () => {});
```

Required assertions:

- Plain `sendPrompt` after context must not increment the fake capture service's `captureCalls`.
- Plain `session.send` must not have a `pageContext` property.
- Manual `capture` mode must cause a later primary capture path to include `pageContext`.
- Quick action must still call the capture path even if composer `sendMode` is `send`.

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/side-panel-controller.ts`

Changes:

- Import `SendMode`.
- Add `sendMode: SendMode` to `SidePanelSnapshot["activeSession"]`.
- Add `updateSendMode(sendMode: SendMode): void` to `SidePanelController`.
- Include `activeSession.sendMode` in `createSnapshot`.
- Implement `updateSendMode` by delegating to `urlSessionStore.updateActiveSendMode`.
- When `captureAndSendCommand` creates/selects a captured canonical URL session, carry the pre-capture send mode only for newly created records if needed. Existing canonical sessions keep their own send mode.
- Do not change `sendQuickAction`; it should continue delegating to `captureAndSendCommand`.

### Success Criteria

#### Automated Verification

- [ ] Phase 2 tests fail before implementation lands: `pnpm --filter @sidra/extension test -- src/side-panel-controller.test.ts -t "send mode|send_mode|plain_send_after_context|quick_action_still_uses_capture"`
- [ ] Phase 2 tests pass after implementation lands: `pnpm --filter @sidra/extension test -- src/side-panel-controller.test.ts -t "send mode|send_mode|plain_send_after_context|quick_action_still_uses_capture"`
- [ ] Existing controller capture tests still pass: `pnpm --filter @sidra/extension test -- src/side-panel-controller.test.ts -t "Capture \\+ Send"`
- [ ] Type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [ ] No manual browser verification required for this phase. Fake capture and fake native port assertions prove the command routing.

---

## Phase 3: Side Panel Send Mode UI

### Overview

Make the composer primary action reflect and use the active session's send mode, and expose manual send-mode selection in the prompt options popover.

### Why This Phase Can Be Validated Independently

React tests can prove visible labels and callback routing without launching the extension in a browser.

### Changes Required

> **TDD ordering**: List tests first. Write and run these tests RED before implementation.

#### 1. Tests (RED)

**File**: `apps/extension/src/side-panel-view.test.tsx`

Add or update tests:

```tsx
// Group: send mode UI
it("renders_capture_send_button_when_send_mode_is_capture", () => {});
it("renders_send_button_when_send_mode_is_send", () => {});
it("clicking_primary_button_in_capture_mode_calls_onCaptureAndSend", async () => {});
it("clicking_primary_button_in_send_mode_calls_onSendPrompt", async () => {});
it("pressing_enter_in_send_mode_calls_onSendPrompt", async () => {});
it("prompt_options_expose_send_mode_controls", async () => {});
it("selecting_capture_send_in_prompt_options_calls_onSendModeChange", async () => {});
it("selecting_send_in_prompt_options_calls_onSendModeChange", async () => {});
it("send_mode_controls_are_disabled_while_prompt_controls_are_disabled", () => {});
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/side-panel-view.tsx`

Changes:

- Add `onSendModeChange(sendMode: SendMode): void` to props.
- Read `props.snapshot.activeSession.sendMode`.
- Rename the local submit helper from `sendPrompt` to a clearer name such as `submitPrompt`.
- If idle and `sendMode === "capture"`, call `props.onCaptureAndSend(prompt)` and label the primary button `Capture + Send`.
- If idle and `sendMode === "send"`, call `props.onSendPrompt(prompt)` and label the primary button `Send`.
- Keep `Cancel` behavior unchanged while a turn is running.
- Add a compact send-mode segmented control to the prompt-options popover with `Capture + Send` and `Send`. The control must call `onSendModeChange`.
- Keep `Send Full DOM` visible as a capture-content option. It should remain disabled when prompt entry is disabled.

**File**: composition/test helpers that render `SidePanelView`

Changes:

- Pass the new `onSendModeChange` prop from production composition and test render helpers.

### Success Criteria

#### Automated Verification

- [ ] Phase 3 tests fail before implementation lands: `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx -t "send mode|primary_button|prompt_options"`
- [ ] Phase 3 tests pass after implementation lands: `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx -t "send mode|primary_button|prompt_options"`
- [ ] Existing side-panel view tests still pass: `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx`
- [ ] Type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [ ] In a running unpacked extension, a new article session shows `Capture + Send`.
- [ ] After a captured prompt succeeds, the idle primary button changes to `Send`.
- [ ] Sending a follow-up with `Send` does not add another page-context marker.
- [ ] Opening prompt options and selecting `Capture + Send` makes the next primary action capture again.
- [ ] Selecting `Send` in a brand-new session sends a prompt without adding a page-context marker.
- [ ] While a turn is running, primary action remains `Cancel` and send-mode controls are disabled.

---

## Phase 4: Final Regression

### Overview

Run the extension validation suite that covers the changed state, controller, and view boundaries.

### Why This Phase Can Be Validated Independently

All implementation behavior has landed by this phase; this verifies no changed boundary regressed adjacent workflows.

### Changes Required

No code changes expected. TDD does not apply because this is final validation only.

### Success Criteria

#### Automated Verification

- [ ] Extension test suite passes: `pnpm --filter @sidra/extension test`
- [ ] Extension typecheck passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [ ] Manual browser smoke confirms the exact scenario from the bug report: summarize with context, ask a follow-up, confirm only the first turn shows `Page context attached`, and confirm the follow-up used plain `Send`.

## Testing Strategy

Unit and integration-style tests should stay at the owning extension boundaries:

- `UrlSessionStore` for send-mode state and URL-session scoping.
- `SidePanelController` for active-tab capture versus plain send command routing.
- `SidePanelView` for labels, Enter behavior, prompt option controls, and callback routing.

No bridge tests are expected because `pageContext` is already optional in the protocol and bridge behavior should remain unchanged.

## Performance Considerations

The fix should reduce unnecessary capture work after context is already attached. Plain `Send` must return before active-tab capture, settings lookup for page-context building, or DOM extraction begins.

## Migration Notes

No persisted migration is needed. URL sessions are in-memory, and new sessions can default to `capture`.

## References

- PRD page capture behavior: `docs/prd-v1.md`
- Extension session state owner: `apps/extension/src/url-session-store.ts`
- Controller command routing: `apps/extension/src/side-panel-controller.ts`
- Composer rendering: `apps/extension/src/side-panel-view.tsx`
