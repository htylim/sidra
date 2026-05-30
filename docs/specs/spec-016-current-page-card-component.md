# Current Page Card Component Implementation Plan

## Overview

Extract the current page card markup from `SidePanelView` into a named React component, remove the misleading chevron, and show the browser tab favicon at the left of the card.

## Current State Analysis

`SidePanelView` currently renders the current page card inline. The markup is a plain `<section className="page-card" aria-label="Current page">`, not a separate component. It shows a hard-coded document icon on the left and a non-clickable chevron on the right.

The current active page data model does not carry favicon data. `ActivePageTracker` reads `url` and `title` from the active tab, and `CaptureService` recomputes page identity after capture from the captured document. Both paths must preserve the tab favicon for the UI to stay stable.

## Desired End State

The side panel renders a dedicated `CurrentPageCard` component. The card still shows the active page title and context state, but it has no chevron. The left visual uses the active tab favicon when Chrome provides one and falls back to the existing document icon when no favicon is available or the image fails to load.

### Key Discoveries:
- `SidePanelView` owns the inline current page card markup today: `apps/extension/src/side-panel-view.tsx:94`.
- The page card styles are centralized in `apps/extension/src/styles.css:97`.
- `PageIdentity` has no favicon field today: `apps/extension/src/page-key.ts:3`.
- `ActivePageTracker` reads active tab metadata and resolves `PageIdentity`: `apps/extension/src/active-page.ts:48`.
- `CaptureService.captureActivePageDocument` recomputes page identity after capture and would drop favicon data unless updated: `apps/extension/src/capture-service.ts:65`.
- `docs/prd-v1.md:122` currently says to include a chevron for future expansion, which conflicts with the new desired behavior.

## What We're NOT Doing

- No expanded current page details panel.
- No click behavior on the current page card.
- No page content preview inside the card.
- No favicon discovery or URL guessing outside Chrome tab metadata. Rendering the Chrome-provided `favIconUrl` in an image may still load that URL.
- No Native Messaging or bridge protocol changes.

## Implementation Approach

First extend the active page identity model to carry `favIconUrl` from Chrome tab metadata through active tracking and capture. Then extract the UI into `CurrentPageCard` and render the favicon. Finally update durable product documentation that still describes the chevron.

The component should receive display data, not reach into browser APIs. Browser metadata collection stays in `ActivePageTracker` and `CaptureService`.

## Phase 1: Carry Favicon Through Page Identity

### Overview

Add optional `favIconUrl` support to page identity and preserve it through active tab tracking and capture-time page identity recomputation.

### Why This Phase Can Be Validated Independently

The data model can be verified without changing the visible UI. Tests can prove favicon data is present in snapshots before any component renders it.

### Changes Required:

> **TDD ordering**: List the test file(s) and enumerate the test names FIRST. The implementation files come SECOND. Tests are written and run RED before any implementation lands.

#### 1. Tests (RED)
**File**: `apps/extension/src/page-key.test.ts`
**Changes**: Add these tests:

```ts
// Group: favicon identity modeling
it("preserves_favicon_url_for_ready_page_identity", () => {
  // asserts: resolvePageIdentity returns favIconUrl for supported http/https pages.
});

it("preserves_favicon_url_for_unsupported_page_identity", () => {
  // asserts: unsupported identities still preserve tab favicon metadata when available.
});
```

**File**: `apps/extension/src/active-page.test.ts`
**Changes**: Add these tests:

```ts
// Group: active tab favicon tracking
it("reads_favicon_url_from_initial_active_tab", async () => {
  // asserts: ActivePageTracker snapshot includes favIconUrl from the active tab.
});

it("emits_page_change_when_active_tab_favicon_changes", async () => {
  // asserts: chrome.tabs.onUpdated favicon changes refresh the active page snapshot.
});
```

**File**: `apps/extension/src/capture-service.test.ts`
**Changes**: Add these tests:

```ts
// Group: capture-time favicon preservation
it("carries_active_tab_favicon_url_when_capture_recomputes_page_identity", async () => {
  // asserts: captured page identity keeps activeTab.favIconUrl after canonical URL recomputation.
});

it("carries_active_tab_favicon_url_when_capture_is_unavailable", async () => {
  // asserts: unavailable capture identity keeps activeTab.favIconUrl for card display.
});
```

#### 2. Implementation (GREEN)
**File**: `apps/extension/src/page-key.ts`
**Changes**:
- Add `favIconUrl?: string` to `PageIdentityInput`.
- Add `favIconUrl?: string` to both `PageIdentity` variants.
- Copy a trimmed non-empty `favIconUrl` into the returned identity.

**File**: `apps/extension/src/active-page.ts`
**Changes**:
- Add `favIconUrl?: string` to `ActivePageTab`.
- Add `favIconUrl?: string` to `ActivePageGateway.onUpdated` change info.
- Pass `activeTab?.favIconUrl` into `resolvePageIdentity`.
- Refresh when `changeInfo.favIconUrl !== undefined`.

**File**: `apps/extension/src/chrome.d.ts`
**Changes**:
- Add `favIconUrl?: string` to `chrome.tabs.Tab`.
- Add `favIconUrl?: string` to `chrome.tabs.TabChangeInfo`.

**File**: `apps/extension/src/capture-service.ts`
**Changes**:
- Pass `activeTab?.favIconUrl` into every `resolvePageIdentity` call based on active tab metadata.
- Preserve `activeTab.favIconUrl` when returning unsupported identities after `readTabDocument` fails.
- When capture succeeds, recompute URL/title/canonical URL from the captured document but keep favicon from the active tab.

### Success Criteria:

#### Automated Verification:
- [x] Phase 1 tests fail BEFORE implementation lands (red): `pnpm --filter @sidra/extension test -- src/page-key.test.ts src/active-page.test.ts src/capture-service.test.ts -t "favicon"`
- [x] Phase 1 tests pass AFTER implementation lands (green): `pnpm --filter @sidra/extension test -- src/page-key.test.ts src/active-page.test.ts src/capture-service.test.ts -t "favicon"`
- [x] No related extension tests regress: `pnpm --filter @sidra/extension test -- src/page-key.test.ts src/active-page.test.ts src/capture-service.test.ts src/side-panel-controller.test.ts`
- [x] Type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification:
- [ ] Inspect a controller snapshot in a local side panel session and confirm `activePage.favIconUrl` exists for a normal page with a tab favicon.
- [ ] Switch to a page without a favicon and confirm the snapshot omits `favIconUrl` rather than using a guessed URL.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Extract CurrentPageCard And Render Favicon

### Overview

Move current page card rendering out of `SidePanelView` into a dedicated `CurrentPageCard` component. Remove the chevron. Render the active page favicon on the left with fallback to the existing document icon.

### Why This Phase Can Be Validated Independently

The extracted component can be tested directly, and `SidePanelView` can be tested only for wiring the active page display data into that component. Tests can prove the card still displays page state, uses favicon data, resets favicon error fallback state, and no longer renders the chevron.

### Changes Required:

> **TDD ordering**: List the test file(s) and enumerate the test names FIRST. The implementation files come SECOND. Tests are written and run RED before any implementation lands.

#### 1. Tests (RED)
**File**: `apps/extension/src/current-page-card.test.tsx`
**Changes**: Add these tests:

```tsx
describe("current page card", () => {
it("renders_favicon_image_when_available", () => {
  // asserts: a ready page with favIconUrl renders an img with that src.
});

it("falls_back_to_document_icon_when_favicon_is_missing", () => {
  // asserts: no img is rendered and the document fallback icon remains visible.
});

it("falls_back_to_document_icon_when_favicon_image_errors", async () => {
  // asserts: firing an error event on the favicon img hides it and shows fallback icon.
});

it("resets_favicon_error_fallback_when_favicon_url_changes", async () => {
  // asserts: after one favicon errors, rerendering with a new favIconUrl shows the new image.
});

it("does_not_render_current_page_card_chevron", () => {
  // asserts: the old chevron glyph/class is absent.
});

it("renders_unsupported_page_state_in_current_page_card", () => {
  // asserts: unsupported page title/status still render through the extracted card.
});
});
```

**File**: `apps/extension/src/side-panel-view.test.tsx`
**Changes**: Add this test:

```tsx
describe("current page card integration", () => {
it("renders_current_page_card_from_side_panel_snapshot", () => {
  // asserts: SidePanelView delegates current page display data to CurrentPageCard.
});
});
```

#### 2. Implementation (GREEN)
**File**: `apps/extension/src/current-page-card.tsx`
**Changes**:
- Add `CurrentPageCard` as a named component.
- Accept props in page-card terms, for example:

```tsx
export type CurrentPageCardProps = {
  title: string;
  statusLabel: string;
  favIconUrl?: string;
};
```

- Render:
  - `<section className="page-card" aria-label="Current page">`
- favicon image when `favIconUrl` exists
- existing `file-text` fallback icon when favicon is absent or fails to load
- title and status label
- Do not render a chevron.
- Keep the favicon image decorative with empty `alt` and `aria-hidden="true"` because the title text names the page.
- Reset any image-error fallback state when `favIconUrl` changes so switching pages can show a new favicon after a previous broken favicon.

**File**: `apps/extension/src/side-panel-view.tsx`
**Changes**:
- Import `CurrentPageCard`.
- Remove inline page card markup.
- Pass `title`, `statusLabel`, and `favIconUrl` from `getPageCardDisplay`.
- Keep `SidePanelView` responsible for top-level layout and user intent wiring.
- Do not import `SidraIcon` back from `side-panel-view.tsx` into `CurrentPageCard`; that would create a circular dependency.

**File**: `apps/extension/src/sidra-icon.tsx`
**Changes**:
- Move the shared `SidraIcon` component and `IconName` type out of `side-panel-view.tsx`.
- Import `SidraIcon` from this module in both `SidePanelView` and `CurrentPageCard`.
- Avoid duplicating SVG paths.

**File**: `apps/extension/src/styles.css`
**Changes**:
- Remove `.chevron` styling.
- Add favicon image styling, for example `.page-favicon`.
- Keep dimensions stable so fallback and favicon do not shift layout.

### Success Criteria:

#### Automated Verification:
- [x] Phase 2 tests fail BEFORE implementation lands (red): `pnpm --filter @sidra/extension test -- src/current-page-card.test.tsx src/side-panel-view.test.tsx -t "current page card"`
- [x] Phase 2 tests pass AFTER implementation lands (green): `pnpm --filter @sidra/extension test -- src/current-page-card.test.tsx src/side-panel-view.test.tsx -t "current page card"`
- [x] Full current page card and side-panel view tests pass: `pnpm --filter @sidra/extension test -- src/current-page-card.test.tsx src/side-panel-view.test.tsx`
- [x] Type checking passes: `pnpm --filter @sidra/extension check`

#### Manual Verification:
- [ ] Open Sidra on a normal web page with a visible tab favicon and confirm the same favicon appears in the current page card.
- [ ] Open Sidra on a page without a favicon and confirm the document fallback icon appears.
- [ ] Confirm the right-side chevron is gone.
- [ ] Confirm the card still does not look clickable.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Update Product Documentation

### Overview

Remove stale documentation that says the current page card should include a chevron.

### Why This Phase Can Be Validated Independently

This phase is documentation-only. TDD does not apply. The verification is a source search that proves durable docs no longer describe the removed behavior.

### Changes Required:

> **TDD ordering**: This phase is documentation-only. No RED/GREEN test cycle applies.

#### 1. Documentation Verification
**Command**:

```sh
rg -n "chevron|expand/collapse" docs README.md apps/extension/src -g '!docs/specs/**' -g '!docs/issues/**'
```

**Expected result**:
- No durable docs or source files describe a chevron in the current page card.
- Source may still contain unrelated chevron references only if they are not about this card.

#### 2. Documentation Update
**File**: `docs/prd-v1.md`
**Changes**:
- Remove the current page card chevron requirement.
- Update every current page card icon reference to say the card displays the page favicon when available and falls back to a document/page icon.
- Keep the expanded-details paragraph only if expansion is still planned. If it remains planned, state that V1 does not show an expansion affordance until details exist.

### Success Criteria:

#### Automated Verification:
- [x] Documentation search confirms stale chevron wording is gone from durable docs and source: `rg -n "chevron|expand/collapse" docs README.md apps/extension/src -g '!docs/specs/**' -g '!docs/issues/**'`
- [x] Type checking still passes after doc changes are staged with code changes: `pnpm --filter @sidra/extension check`

#### Manual Verification:
- [ ] Read the updated `docs/prd-v1.md` section and confirm it matches the implemented card behavior.

**Implementation Note**: After completing this phase and all verification passes, pause here for manual confirmation from the human that the documentation matches the product decision.

---

## Testing Strategy

### Unit Tests:
- `resolvePageIdentity` preserves optional favicon metadata for ready and unsupported page identities.
- `ActivePageTracker` emits snapshots when favicon metadata changes.
- `CaptureService` preserves favicon metadata through capture success and unavailable paths.
- `CurrentPageCard` renders favicon, fallback icon, no chevron, resets image-error fallback on favicon URL changes, and preserves unsupported-page display state.
- `SidePanelView` renders the extracted current page card from its snapshot.

### Integration Tests:
- Existing side-panel controller tests should keep passing because `SidePanelSnapshot.activePage` remains the source of page identity.
- No bridge or protocol integration tests are needed because favicon is browser-side UI metadata only.

### Manual Testing Steps:
1. Open Sidra on a site with a visible tab favicon.
2. Confirm the current page card shows that favicon.
3. Send a captured prompt and confirm the favicon remains after capture.
4. Open Sidra on a page with no favicon and confirm the fallback document icon appears.
5. Confirm there is no chevron and the card does not imply click behavior.

## Performance Considerations

Using the Chrome-provided `favIconUrl` avoids app-owned favicon discovery logic and guessed favicon URLs. The browser may still load the provided favicon URL when the image renders. The favicon image must have stable dimensions and an error fallback so broken favicon URLs do not create layout shifts or broken-image UI.

## Rollback Plan

If favicon rendering causes browser-specific problems, keep the extracted `CurrentPageCard` component and temporarily render the fallback document icon only. The favicon data model can remain because it is optional and browser-side.
