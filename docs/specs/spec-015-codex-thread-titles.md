# Codex Thread Titles Implementation Plan

## Overview

Make Codex history readable for Sidra-created conversations. Sidra currently sends captured-page prompts through `codex app-server`, but Codex infers thread titles from the provider-facing prompt wrapper, so `/resume` and the Codex app show titles like `The user is viewing this browser page...`.

This plan makes one title decision for each Codex app-server thread before the first turn starts. When a usable title exists, it names the thread with a compact title derived from the raw user prompt and page metadata already present in `session.send`.

## Current State Analysis

Sidra already uses Codex App Server, not `codex exec` or the old SDK path:

- Production bridge composition starts `codex app-server` and identifies the client as `sidra-bridge`: `apps/bridge/src/bridge-runtime.ts:49`.
- The Codex provider creates one app-server thread per provider session with `thread/start`: `apps/bridge/src/codex-app-server-provider.ts:35`.
- The Codex provider starts each user turn with `turn/start`: `apps/bridge/src/codex-app-server-provider.ts:89`.
- Extension protocol sends `session.start` with only `clientSessionId` and `providerId`; page metadata is not available at that point: `packages/protocol/src/index.ts:48`.
- Extension protocol sends `session.send` with raw `prompt` and optional `pageContext`: `packages/protocol/src/index.ts:55`.
- `BridgeSessionManager` converts the extension input into provider input by calling `formatPromptForAgent`: `apps/bridge/src/session-manager.ts:140`.
- `formatPromptForAgent` prepends the untrusted-page-context safety wrapper before the actual user request: `apps/bridge/src/context-prompt.ts:8`.
- Page metadata already includes `title`, `canonicalUrl`, `url`, and other fields: `packages/protocol/src/index.ts:12`.
- Capture populates that metadata from the active page document: `apps/extension/src/capture-service.ts:190`.

Local Codex CLI `0.133.0` app-server schema confirms:

- `thread/name/set` accepts `{ threadId, name }`.
- `thread/start` accepts `serviceName`, `ephemeral`, and `threadSource`.
- `thread/metadata/update` only supports `gitInfo`, so it is not useful for Sidra page metadata.
- `turn/start` has no display-title field.

## Desired End State

- Sidra-created Codex threads show a compact user-facing name in Codex CLI `/resume` and the Codex app.
- The title decision is made once per Codex app-server thread, before the first `turn/start`.
- Title setting uses only sanitized raw user prompt and sanitized page metadata, never captured page body text, HTML, or the formatted provider prompt.
- Title setting failure or timeout is best effort: chat continues, no user-visible session error is emitted, and no prompt/title content is logged by default.
- New Chat creates a fresh provider session/thread and can set a fresh title on the first send after reset.
- Codex `thread/start` attempts to include `serviceName: "sidra"` and an explicit, easily changeable `ephemeral: false` default, with a legacy fallback if the local app-server rejects those optional fields.
- No extension UI change and no Sidra protocol change are required.

### Key Discoveries

- The bad title source is the provider-facing prompt wrapper, not the extension transcript: `apps/bridge/src/context-prompt.ts:11`.
- The bridge already has raw prompt and page metadata at `session.send`, so it can pass a small provider-neutral title source without protocol churn: `packages/protocol/src/index.ts:55`.
- The Codex provider owns the `threadId` and Codex title policy, so title construction and the "set title once" state belong inside `CodexAppServerSession`: `apps/bridge/src/codex-app-server-provider.ts:47`.
- `thread/name/set` is the only app-server method that sets a user-facing thread title. `thread/metadata/update` is not a general metadata store in the local schema.

## Title Policy

Constants:

- `SIDRA_CODEX_THREAD_TITLE_PREFIX = "Sidra: "`
- `SIDRA_CODEX_THREAD_TITLE_MAX_LENGTH = 60`
- `SIDRA_CODEX_THREAD_TITLE_MIN_PROMPT_LENGTH = 18`
- `SIDRA_CODEX_THREAD_TITLE_SEPARATOR = " - "`

Rules:

| Case | Input | Title shape | Test coverage |
| --- | --- | --- | --- |
| Page title and prompt | metadata title exists, prompt exists | `Sidra: <page title> - <prompt>` | `builds_title_from_page_title_and_prompt` |
| Long page title and prompt | title would consume prompt space | reserve at least 18 prompt chars, then fit page identity into remaining space | `preserves_prompt_budget_when_page_title_is_long` |
| Missing page title with canonical URL | no title, canonical URL has hostname | `Sidra: <hostname> - <prompt>` | `falls_back_to_canonical_hostname` |
| Missing page title with URL | no title/canonical hostname, URL has hostname | `Sidra: <hostname> - <prompt>` | `falls_back_to_url_hostname` |
| No page metadata | prompt only | `Sidra: <prompt>` | `builds_prompt_only_title_without_page_metadata` |
| Empty title source after cleanup | defensive only | no title returned | `returns_no_title_when_sources_are_empty_after_cleanup` |
| Newlines/control whitespace | title/prompt contains tabs/newlines/control chars | one-line normalized title | `normalizes_control_whitespace` |

Truncation:

- Normalize whitespace and trim before composing.
- Strip ANSI escape sequences, remaining Unicode control characters, and Unicode format characters from both page identity and prompt before composing. This includes bidi controls.
- Preserve original capitalization and punctuation.
- Use ASCII `...` when truncating.
- The final string must never exceed 60 characters.
- When both page identity and prompt exist, the prompt budget wins first: reserve at least 18 prompt characters when possible, then fit page identity into the remaining space.
- If the prompt itself cannot fit after prefix and separator budgets, truncate the prompt to the remaining final-title budget.
- Do not include hostname when a page title exists.

Examples:

```text
Sidra: Research notes - Summarize this page
Sidra: example.com - What does this say?
Sidra: Very Long Page Title That... - Summarize this ...
Sidra: Explain this snippet
```

## What We're NOT Doing

- No extension UI changes.
- No protocol v3 or new extension-to-bridge message fields.
- No storage of arbitrary Sidra metadata in Codex.
- No use of `threadSource`; local schema values are not appropriate for Sidra.
- No `ephemeral: true` behavior in this issue.
- No retitling on later prompts in the same Codex thread, even if the first send had no usable title.
- No title generation from page body text, captured HTML, or the formatted provider prompt.
- No default logging of title-setting failures.
- No attempt to hide Sidra threads from `/resume` or the Codex app.

## Implementation Approach

Implement this as a narrow bridge/provider change.

1. Add a pure title builder in `apps/bridge/src/codex-thread-title.ts`.
2. Extend bridge-side provider input to carry an optional raw display-title source before `formatPromptForAgent`.
3. In the Codex provider session, build the Codex title from that source and make one bounded best-effort `thread/name/set` attempt before the first `turn/start`, then continue if title setting fails or times out.
4. Try `serviceName: "sidra"` and an explicit provider option/default for `ephemeral: false` on `thread/start`, with a compatibility fallback for app-server versions that reject those optional fields.
5. Update durable docs to describe that the Codex provider names app-server threads for history UX.

## Phase 1: Title Builder

### Overview

Add the pure title policy module. This phase does not touch Codex App Server.

### Why This Phase Can Be Validated Independently

The title builder can be tested with plain inputs and does not depend on Native Messaging, Codex, or extension runtime state.

### Changes Required

> TDD ordering: tests first, implementation second.

#### 1. Tests (RED)

**File**: `apps/bridge/src/codex-thread-title.test.ts`

Add tests:

```ts
describe("buildSidraCodexThreadTitle", () => {
  it("builds_title_from_page_title_and_prompt", () => {});
  it("preserves_prompt_budget_when_page_title_is_long", () => {});
  it("falls_back_to_canonical_hostname", () => {});
  it("falls_back_to_url_hostname", () => {});
  it("builds_prompt_only_title_without_page_metadata", () => {});
  it("returns_no_title_when_sources_are_empty_after_cleanup", () => {});
  it("normalizes_control_whitespace", () => {});
  it("strips_ansi_escape_sequences_and_control_format_characters", () => {});
  it("preserves_original_capitalization_and_punctuation", () => {});
  it("never_exceeds_sixty_characters", () => {});
  it("uses_ascii_ellipsis_when_truncated", () => {});
});
```

#### 2. Implementation (GREEN)

**File**: `apps/bridge/src/codex-thread-title.ts`

Changes:

- Export a named input type:

```ts
export type SidraCodexThreadTitleInput = {
  prompt: string;
  pageMetadata?: Pick<PageContextMetadata, "title" | "canonicalUrl" | "url">;
};
```

- Export constants for prefix, max length, prompt budget, and separator.
- Export `buildSidraCodexThreadTitle(input): string | undefined`.
- Keep helper functions small and readable:
  - `normalizeTitlePart`
  - `stripAnsiEscapeSequences`
  - `stripControlAndFormatCharacters`
  - `hostnameFromUrl`
  - `truncateWithEllipsis`
  - `composeTitleWithPromptBudget`
- Use only `pageMetadata.title`, host from `canonicalUrl`, host from `url`, and raw `prompt`.
- Treat page metadata as untrusted UI text. Normalize whitespace, then remove remaining `\p{Cc}` and `\p{Cf}` characters so Codex CLI/App history cannot be polluted by terminal escapes or bidi controls.
- Do not import or call `formatPromptForAgent`.

### Success Criteria

#### Automated Verification

- [x] Phase 1 tests fail before implementation lands (red): `pnpm --filter @sidra/bridge test -- src/codex-thread-title.test.ts`
- [x] Phase 1 tests pass after implementation lands (green): `pnpm --filter @sidra/bridge test -- src/codex-thread-title.test.ts`
- [x] Bridge type checking passes: `pnpm --filter @sidra/bridge check`

#### Manual Verification

- [x] Review sample outputs from the tests and confirm they are readable in a narrow Codex app sidebar.

**Implementation Note**: After completing this phase and automated verification passes, pause for manual confirmation before proceeding.

## Phase 2: Bridge Input Carries Title Source

### Overview

Keep protocol unchanged, but pass an optional provider-neutral display-title source in `BridgeSessionManager` before formatting the provider prompt.

### Why This Phase Can Be Validated Independently

Bridge session manager tests can prove that raw title source data comes from `session.send` input while provider prompts remain safety-wrapped. Codex-specific title formatting remains in the Codex provider.

### Changes Required

> TDD ordering: tests first, implementation second.

#### 1. Tests (RED)

**File**: `apps/bridge/src/session-manager.test.ts`

Add tests:

```ts
describe("BridgeSessionManager provider history title source", () => {
  it("passes_display_title_source_from_raw_prompt_and_page_metadata_to_provider", async () => {});
  it("does_not_use_formatted_provider_prompt_as_display_title_source", async () => {});
  it("omits_page_metadata_from_title_source_when_page_context_is_absent", async () => {});
  it("keeps_provider_prompt_wrapped_with_untrusted_page_context", async () => {});
  it("updates_existing_exact_provider_input_expectations_with_display_title_source", async () => {});
});
```

#### 2. Implementation (GREEN)

**File**: `apps/bridge/src/session-manager.ts`

Changes:

- Import `PageContextMetadata` from `@sidra/protocol` as a type-only import for `ProviderDisplayTitleSource`.
- Extend `AgentSendInput` to include optional provider-neutral title source data:

```ts
export type ProviderDisplayTitleSource = {
  prompt: string;
  pageMetadata?: Pick<PageContextMetadata, "title" | "canonicalUrl" | "url">;
};

export type AgentSendInput = {
  prompt: string;
  displayTitleSource?: ProviderDisplayTitleSource;
};
```

- In `sendPrompt`, build `displayTitleSource` before `formatPromptForAgent`.
- Include only `input.prompt` and a `Pick<PageContextMetadata, "title" | "canonicalUrl" | "url">` from `input.pageContext?.metadata`.
- Treat `displayTitleSource` as provider history UI metadata source. It is provider-neutral at the `AgentSendInput` boundary; the Codex app-server provider decides how to render it.
- Preserve current provider-facing prompt behavior:

```ts
const pageMetadata = pickTitlePageMetadata(input.pageContext?.metadata);
const displayTitleSource: ProviderDisplayTitleSource = pageMetadata
  ? { prompt: input.prompt, pageMetadata }
  : { prompt: input.prompt };
const providerInput: AgentSendInput = {
  prompt: formatPromptForAgent(input),
  displayTitleSource
};
```

- Update existing exact-shape session manager expectations that currently assert `{ prompt: "..." }` to include the new `displayTitleSource`.
- Do not include `displayTitleSource.pageMetadata` when page context is absent.
- Do not pass Codex-specific formatted titles through `BridgeSessionManager`.
- Do not pass raw `pageContext` to provider adapters.
- Do not change protocol validation.

**File**: `apps/bridge/src/index.ts`

Changes:

- Export the updated `AgentSendInput` type as before.

### Success Criteria

#### Automated Verification

- [x] Phase 2 tests fail before implementation lands (red): `pnpm --filter @sidra/bridge test -- src/session-manager.test.ts -t "display title source|formatted provider prompt"`
- [x] Phase 2 tests pass after implementation lands (green): `pnpm --filter @sidra/bridge test -- src/session-manager.test.ts -t "display title source|formatted provider prompt"`
- [x] Existing session manager tests still pass after exact provider input expectations are updated: `pnpm --filter @sidra/bridge test -- src/session-manager.test.ts`
- [x] Existing bridge context prompt tests still pass: `pnpm --filter @sidra/bridge test -- src/context-prompt.test.ts`
- [x] Bridge type checking passes: `pnpm --filter @sidra/bridge check`

#### Manual Verification

- [x] Code review confirms title input is derived before prompt formatting and uses no captured body text or HTML.

**Implementation Note**: After completing this phase and automated verification passes, pause for manual confirmation before proceeding.

## Phase 3: Codex Provider Sets Thread Name Once

### Overview

Teach the Codex app-server provider to make one bounded thread-name decision before the first turn starts, using `thread/name/set` when a usable display title exists.

### Why This Phase Can Be Validated Independently

Provider tests already use a fake app-server boundary. They can assert exact JSON-RPC request order and failure behavior without launching real Codex.

### Changes Required

> TDD ordering: tests first, implementation second.

#### 1. Tests (RED)

**File**: `apps/bridge/src/codex-app-server-provider.test.ts`

Add tests:

```ts
describe("Codex App Server thread naming", () => {
  it("starts_threads_with_sidra_service_name_and_explicit_ephemeral_false", async () => {});
  it("falls_back_to_legacy_thread_start_when_optional_thread_metadata_is_rejected", async () => {});
  it("sets_thread_name_before_first_turn_start", async () => {});
  it("builds_thread_name_inside_codex_provider_from_display_title_source", async () => {});
  it("sets_thread_name_only_once_per_provider_session", async () => {});
  it("continues_turn_start_when_thread_name_set_fails", async () => {});
  it("continues_turn_start_when_thread_name_set_does_not_resolve_before_timeout", async () => {});
  it("does_not_emit_or_log_title_setting_failure", async () => {});
  it("does_not_set_thread_name_when_display_title_is_absent", async () => {});
  it("does_not_set_thread_name_on_second_send_when_first_send_had_no_display_title", async () => {});
  it("new_provider_session_can_set_a_fresh_thread_name", async () => {});
});
```

Update existing restricted-defaults test to expect:

```ts
{
  cwd: "/tmp/sidra-workspace",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandbox: "read-only",
  serviceName: "sidra",
  ephemeral: false
}
```

Add a fallback test where the first `thread/start` rejects with an app-server compatibility error such as `Invalid params`, `unknown field`, or `failed to deserialize`, and the provider retries `thread/start` once with only the current required fields:

```ts
{
  cwd: "/tmp/sidra-workspace",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandbox: "read-only"
}
```

**File**: `apps/bridge/src/codex-app-server-client.test.ts`

Add focused transport tests:

```ts
describe("CodexAppServerClient request timeout", () => {
  it("rejects_and_forgets_timed_out_requests", async () => {});
  it("ignores_late_response_for_timed_out_request_without_protocol_error", async () => {});
});
```

#### 2. Implementation (GREEN)

**File**: `apps/bridge/src/codex-app-server-client.ts`

Changes:

- Add a bounded request API for provider best-effort calls:

```ts
requestWithTimeout(method: string, params: unknown, timeoutMs: number): Promise<unknown>
```

- Implement the timeout inside the client, where pending request ownership lives.
- On timeout:
  - Remove the request from `pendingRequests`.
  - Reject with a generic timeout error that contains no prompt or title content.
  - Record the timed-out request id in a small `timedOutRequestIds` set.
- If a response arrives later for a timed-out request id, ignore it and remove the id from `timedOutRequestIds`. Do not emit a protocol error for that late response.
- Keep normal `request` behavior unchanged for existing calls.

**File**: `apps/bridge/src/codex-app-server-provider.ts`

Changes:

- Extend the local `AppServerClientBoundary` with `requestWithTimeout(method, params, timeoutMs)` so the provider can use the bounded transport API in production and tests.
- Update provider and runtime fakes that satisfy `AppServerClientBoundary` or `RunningCodexAppServer["client"]` with a small `requestWithTimeout` implementation. In tests it can delegate to `request` unless the test is specifically covering timeout behavior.
- Add provider constants:

```ts
const SIDRA_CODEX_SERVICE_NAME = "sidra";
const DEFAULT_SIDRA_CODEX_THREAD_EPHEMERAL = false;
const SIDRA_CODEX_THREAD_NAME_SET_TIMEOUT_MS = 500;
```

- Add `serviceName: SIDRA_CODEX_SERVICE_NAME` and `ephemeral: DEFAULT_SIDRA_CODEX_THREAD_EPHEMERAL` to `thread/start`.
- Keep the explicit `ephemeral` value in one obvious constant/config point so a future setting can wire it without changing call-site semantics.
- Keep these optional `thread/start` fields out of the hard startup path:
  - First try `thread/start` with `serviceName` and `ephemeral`.
  - If app-server rejects with a compatibility-shaped error message such as `Invalid params`, `unknown field`, or `failed to deserialize`, retry `thread/start` once without those optional fields.
  - Do not retry for auth, transport closed, or thread id extraction failures.
  - Do not log prompt, title, or page metadata during fallback.
- Add `threadNameDecisionMade = false` state inside `CodexAppServerSession`.
- Before constructing/running `CodexAppServerTurn`, call a private best-effort method:

```ts
private async decideThreadNameOnce(source: ProviderDisplayTitleSource | undefined): Promise<void>
```

- Behavior:
  - If `threadNameDecisionMade` is true, return.
  - Set `threadNameDecisionMade = true` on the first provider `send`, even when title is missing.
  - Build the title inside the Codex provider by calling `buildSidraCodexThreadTitle(source)` after the first-send decision is marked.
  - If title is missing, return after marking the decision made.
  - If title exists, call `appServer.requestWithTimeout("thread/name/set", { threadId, name: title }, SIDRA_CODEX_THREAD_NAME_SET_TIMEOUT_MS)`.
  - Catch and ignore failures.
  - Treat timeout like failure. Do not wait indefinitely before `turn/start`.
  - Do not emit `session.error`.
  - Do not log the title or failure by default.
- Call the bounded title decision before `turn/start`, so the history title is available as early as possible when app-server responds quickly.
- If title setting fails or times out, still call `turn/start`.

### Success Criteria

#### Automated Verification

- [x] Phase 3 tests fail before implementation lands (red): `pnpm --filter @sidra/bridge test -- src/codex-app-server-provider.test.ts -t "thread naming|service name|ephemeral"`
- [x] Phase 3 tests pass after implementation lands (green): `pnpm --filter @sidra/bridge test -- src/codex-app-server-provider.test.ts -t "thread naming|service name|ephemeral"`
- [x] Thread-start compatibility fallback tests pass: `pnpm --filter @sidra/bridge test -- src/codex-app-server-provider.test.ts -t "legacy thread start|optional thread metadata"`
- [x] App-server client timeout tests pass: `pnpm --filter @sidra/bridge test -- src/codex-app-server-client.test.ts -t "request timeout"`
- [x] Existing app-server provider tests still pass: `pnpm --filter @sidra/bridge test -- src/codex-app-server-provider.test.ts`
- [x] Existing runtime composition tests still pass after `thread/start` expectation updates: `pnpm --filter @sidra/bridge test -- src/bridge-runtime.test.ts`
- [x] Full bridge test suite passes: `pnpm --filter @sidra/bridge test`
- [x] Bridge type checking passes: `pnpm --filter @sidra/bridge check`

#### Manual Verification

- [x] Review fake app-server request order and confirm `thread/name/set` precedes `turn/start`.
- [x] Confirm no test fixtures or code paths print prompt/title content on naming failure.

**Implementation Note**: After completing this phase and automated verification passes, pause for manual confirmation before proceeding.

## Phase 4: Durable Docs And Manual Smoke

### Overview

Document the current behavior and verify it with real Codex CLI/App history.

### Why This Phase Can Be Validated Independently

Docs and manual smoke validate the user-visible history behavior after the provider boundary has tests.

### Changes Required

> TDD does not apply to docs-only edits. Use documentation review and manual smoke verification instead.

#### 1. Documentation

**File**: `docs/ARCHITECTURE.md`

Changes:

- In the `apps/bridge` ownership bullet, add that the Codex provider owns app-server thread naming for Sidra history UX.
- State that `BridgeSessionManager` may pass raw prompt plus selected page metadata as provider-neutral display-title source, but Codex-specific title derivation and app-server naming belong to the Codex provider and must not use captured body/HTML or the provider-facing safety wrapper.

**File**: `docs/LEARNING-GUIDE.md`

Changes:

- Update the message flow walkthrough after `session.send` to note that the bridge passes raw display-title source before formatting the provider prompt, and the Codex provider derives a compact Codex thread title before making one bounded title-setting attempt before the first `turn/start`.

**File**: `docs/codex-sdk-investigation.md`

Changes:

- Update the app-server method list to include `thread/name/set`.
- Update the sending-a-turn walkthrough so it describes display-title source capture before prompt formatting, Codex-provider title derivation, and the bounded best-effort `thread/name/set` request before the first `turn/start`.
- Update any fake app-server test checklist items that describe `session.send` only as `turn/start`.

#### 2. Manual Smoke

Use `docs/MANUAL-E2E-RUNBOOK.md` before launching any browser or native-host manual test.

Manual steps:

1. Build and install the native host through the current runbook.
2. Load the extension on a page with a recognizable title.
3. Send `Summarize this page` with `Capture + Send`.
4. Open Codex CLI in the same workspace and run `/resume`.
5. Confirm the new Sidra thread title starts with `Sidra:` and fits in the visible list.
6. Confirm the title includes page identity plus prompt intent, not `The user is viewing this browser page`.
7. Click New Chat in Sidra, send a different prompt, run `/resume`, and confirm the fresh thread has a fresh Sidra title.

### Success Criteria

#### Automated Verification

- [x] Docs are updated and no code tests are required for this phase.
- [x] Full bridge tests pass after docs/code phases: `pnpm --filter @sidra/bridge test`
- [x] Root checks pass if the implementation touched package exports or docs scripts: `pnpm check`

#### Manual Verification

- [x] Codex CLI `/resume` shows Sidra-created thread names such as `Sidra: <page> - <prompt>` instead of the untrusted-page-context wrapper.
- [x] Codex app sidebar shows the same improved title for new Sidra threads.
- [x] New Chat creates a fresh titled Codex thread on first send.
- [x] Existing chat streaming, cancellation, permission prompts, and page-context safety behavior still work.

## Testing Strategy

### Unit Tests

- Pure title generation in `apps/bridge/src/codex-thread-title.test.ts`.
- Bridge session manager forwarding of provider-neutral title source from raw input in `apps/bridge/src/session-manager.test.ts`.
- App-server request timeout cleanup in `apps/bridge/src/codex-app-server-client.test.ts`.
- Codex app-server provider request order and failure behavior in `apps/bridge/src/codex-app-server-provider.test.ts`.

### Integration Tests

- Existing bridge smoke tests should keep proving `session.start`, queued prompt flush, streaming, errors, and provider lifecycle behavior.
- No extension tests are required unless implementation unexpectedly changes protocol or controller behavior. That would be a spec violation unless the implementer first revises the plan.

### Manual Testing Steps

1. Follow `docs/MANUAL-E2E-RUNBOOK.md`.
2. Send a captured prompt from Sidra.
3. Check Codex CLI `/resume`.
4. Check Codex app sidebar.
5. Repeat after Sidra New Chat.

## Performance Considerations

Title generation is O(length of prompt plus metadata strings) and bounded by small string operations. `thread/name/set` adds at most one app-server request per provider session before the first turn, bounded by `SIDRA_CODEX_THREAD_NAME_SET_TIMEOUT_MS`. It is best effort and should not be retried after failure, timeout, or a missing first-send title.

## Migration Notes

No persisted data migration. Existing Codex threads keep their old inferred names. New Sidra-created Codex threads get explicit names after this change.

## References

- Architecture source of truth: `docs/ARCHITECTURE.md`
- Codex provider issue context: `docs/issues/issue-013.md`
- App-server process wiring: `apps/bridge/src/codex-app-server-process.ts`
- App-server provider: `apps/bridge/src/codex-app-server-provider.ts`
- Bridge session manager: `apps/bridge/src/session-manager.ts`
- Prompt safety wrapper: `apps/bridge/src/context-prompt.ts`
- Protocol page context metadata: `packages/protocol/src/index.ts`
- Capture metadata source: `apps/extension/src/capture-service.ts`
