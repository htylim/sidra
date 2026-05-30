# Rich Agent Activity Implementation Plan

## Overview

Replace the current generic `Activity` list with a useful Codex-style activity disclosure. Sidra should show `Activity` only when the agent provides meaningful reasoning summary text or tool/action details. Generic lifecycle hints such as `Working` and `Searching` must not create visible activity by themselves.

## Current State Analysis

Sidra uses Codex App Server directly, not ACP. The bridge currently listens to `item/started` and `item/completed`, maps `reasoning` to `progress / Working`, maps `webSearch` to `progress / Searching`, and maps tool-like items to generic `Tool started` / `Tool finished` entries.

The current protocol activity type is intentionally narrow. It rejects free-form activity fields and private reasoning fields. The extension stores activity as a flat array on each assistant turn and renders each entry as a pill plus label.

This causes two product bugs:

- `Activity` appears even when the only entries are generic lifecycle hints.
- The disclosure does not show reasoning summaries, command output, web search details, file activity, or MCP/tool details.

## Desired End State

Sidra assistant turns render a collapsed `Activity` disclosure only when there is real activity:

- Reasoning summary text from `item/reasoning/summaryTextDelta`.
- Tool/action lifecycle and details from App Server `item/started` and `item/completed`.
- Command output from `item/commandExecution/outputDelta`, attached to the matching command activity.

When expanded, `Activity` shows:

- A reasoning summary section if summary text exists.
- An actions/tools section if tool/action items exist.
- Tool/action details from the App Server payload when available, capped for long text.

Raw private reasoning is never shown. `item/reasoning/textDelta` is ignored.

### Key Discoveries

- Codex App Server events are handled in `apps/bridge/src/codex-app-server-provider.ts`.
- Current activity mapping happens in `parseItemActivity()` in `apps/bridge/src/codex-app-server-provider.ts`.
- Protocol activity shape is owned by `packages/protocol/src/index.ts`.
- Transcript activity state is owned by `apps/extension/src/transcript.ts`.
- Activity rendering is owned by `apps/extension/src/transcript-view.tsx`.
- App Server docs list the needed streams: `item/reasoning/summaryTextDelta`, `item/commandExecution/outputDelta`, `item/started`, and `item/completed`.

## What We're NOT Doing

- Do not integrate ACP. Sidra remains on direct Codex App Server for this work.
- Do not show raw reasoning text from `item/reasoning/textDelta`.
- Do not add model/provider settings.
- Do not build aggregation as smart as Codex's exact desktop wording in this pass.
- Do not parse arbitrary raw provider events in React.
- Do not remove the protocol safety boundary.

## Implementation Approach

Grow the protocol from a flat allowlisted activity label into a safe, structured activity model. Keep App Server parsing in the bridge, keep validation in `packages/protocol`, and keep rendering decisions in the extension. The bridge may pass real App Server tool/action details, but it must normalize them into bounded display fields before they cross the Native Messaging boundary.

Use a turn-level activity shape:

```ts
type SafeAgentActivity =
  | { kind: "reasoning_summary_delta"; text: string }
  | {
      kind: "tool";
      itemId: string;
      toolKind: "command" | "file_change" | "mcp_tool" | "dynamic_tool" | "web_search" | "unknown";
      phase: "started" | "completed";
      title: string;
      details: SafeActivityDetail[];
    }
  | {
      kind: "command_output_delta";
      itemId: string;
      stream: "stdout" | "stderr" | "unknown";
      text: string;
    };

type SafeActivityDetail = {
  label: string;
  value: string;
};
```

Exact field names may change during implementation if tests preserve the behavior. The important boundary is that each event is structured, bounded, and safe to render.

## Behavior Matrix

| App Server event | Sidra activity behavior | Visible `Activity`? | Required test |
| --- | --- | --- | --- |
| `item/started` with `reasoning` | Do not create visible activity | No | `does_not_render_activity_for_reasoning_started_without_summary` |
| `item/started` with `webSearch` | Create web search action with available details | Yes | `maps_web_search_item_to_action_activity_with_details` |
| `item/reasoning/summaryTextDelta` | Append reasoning summary text | Yes | `maps_reasoning_summary_delta_to_activity_summary` |
| `item/reasoning/textDelta` | Ignore raw reasoning | No | `ignores_raw_reasoning_text_delta` |
| `item/started` with `commandExecution` | Create command action with command/details if present | Yes | `maps_command_started_to_action_activity_with_command_details` |
| `item/commandExecution/outputDelta` | Attach output to matching command | Yes | `attaches_command_output_delta_to_matching_command_activity` |
| `item/completed` with tool item | Mark matching tool/action complete or append completion event | Yes | `marks_tool_activity_complete_when_item_completed` |
| generic `Working` / `Searching` only | No visible activity | No | `does_not_show_activity_for_generic_progress_only` |

## Phase 1: Protocol Activity Model

### Overview

Replace the flat `SafeAgentActivity` allowlist with structured activity events that can carry reasoning summaries, tool/action details, and command output safely.

### Why This Phase Can Be Validated Independently

The protocol can validate the new event shapes before the bridge emits them or the UI renders them.

### Changes Required

> **TDD ordering**: Add tests first. They must fail before implementation.

#### 1. Tests (RED)

**File**: `packages/protocol/src/protocol.test.ts`

Add tests:

```ts
it("accepts_reasoning_summary_delta_activity");
it("accepts_tool_activity_with_bounded_details");
it("accepts_command_output_delta_activity");
it("rejects_raw_reasoning_text_activity");
it("rejects_activity_details_with_private_reasoning_fields");
it("rejects_activity_details_with_prompt_or_page_content_fields");
it("rejects_activity_detail_values_over_the_length_limit");
it("accepts_new_activity_shapes_through_bridge_message_envelopes");
```

#### 2. Implementation (GREEN)

**File**: `packages/protocol/src/index.ts`

Changes:

- Replace or extend `SafeAgentActivity`.
- Add runtime parsing for reasoning summary delta, tool activity, and command output delta.
- Add strict max text lengths for summary/detail/output strings.
- Keep rejecting `reasoning`, `chainOfThought`, `prompt`, `pageContent`, raw `stdout`, and raw `stderr` field names unless represented through the explicit command output event.
- Keep unknown activity event shapes invalid.

### Success Criteria

#### Automated Verification

- [x] Phase 1 tests fail before implementation: `pnpm --filter @sidra/protocol test -- protocol.test.ts -t "activity"` failed 4 activity tests before implementation
- [x] Phase 1 tests pass after implementation: `pnpm --filter @sidra/protocol test -- protocol.test.ts -t "activity"`
- [x] Protocol typecheck passes: `pnpm --filter @sidra/protocol check`

#### Manual Verification

- [ ] Review the accepted activity shapes and confirm no raw reasoning event can cross the protocol boundary.

---

## Phase 2: Bridge App Server Mapping

### Overview

Consume the App Server streams that Sidra currently ignores and normalize them into the new safe protocol activity events.

### Why This Phase Can Be Validated Independently

The bridge provider tests can use fake App Server notifications and assert emitted provider events without involving extension UI.

### Changes Required

#### 1. Tests (RED)

**File**: `apps/bridge/src/codex-app-server-provider.test.ts`

Add tests:

```ts
it("maps_reasoning_summary_delta_to_activity_summary");
it("ignores_raw_reasoning_text_delta");
it("does_not_emit_activity_for_reasoning_started_without_summary");
it("maps_web_search_item_to_action_activity_with_details");
it("maps_command_started_to_action_activity_with_command_details");
it("attaches_command_output_delta_to_matching_command_activity");
it("marks_tool_activity_complete_when_item_completed");
it("maps_mcp_tool_started_and_completed_to_action_activity");
it("caps_activity_detail_and_output_text");
it("does_not_emit_prompt_page_content_or_raw_private_reasoning_fields");
```

#### 2. Implementation (GREEN)

**File**: `apps/bridge/src/codex-app-server-provider.ts`

Changes:

- Handle `item/reasoning/summaryTextDelta`.
- Ignore `item/reasoning/textDelta`.
- Handle `item/commandExecution/outputDelta`.
- Stop mapping `reasoning` item start to `Working`.
- Stop mapping bare `webSearch` start to generic `Searching`; map it as an action with details.
- Normalize `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, and `webSearch` items into structured tool/action activity.
- Extract useful App Server fields into bounded detail pairs.
- Do not log or emit raw private reasoning or captured page content.

### Success Criteria

#### Automated Verification

- [x] Phase 2 tests fail before implementation: `pnpm --filter @sidra/bridge test -- codex-app-server-provider.test.ts -t "activity|reasoning|command_output"` failed new bridge activity tests before implementation
- [x] Phase 2 tests pass after implementation: `pnpm --filter @sidra/bridge test -- codex-app-server-provider.test.ts -t "activity|reasoning|command_output"`
- [x] Bridge check passes: `pnpm --filter @sidra/bridge check`

#### Manual Verification

- [ ] Inspect fake event fixtures and confirm they represent the App Server event names from the docs.

---

## Phase 3: Transcript Activity State

### Overview

Change extension transcript state from a flat activity list into a turn-level activity model that can aggregate reasoning summary text, tool/action items, and command output by item id.

### Why This Phase Can Be Validated Independently

Transcript reducers can be tested without React or the bridge connection.

### Changes Required

#### 1. Tests (RED)

**File**: `apps/extension/src/transcript.test.ts`

Add tests:

```ts
it("adds_reasoning_summary_delta_to_the_current_assistant_turn");
it("appends_multiple_reasoning_summary_deltas_in_order");
it("adds_tool_activity_to_the_current_assistant_turn");
it("updates_existing_tool_activity_by_item_id_when_completed");
it("attaches_command_output_to_the_matching_tool_activity");
it("does_not_create_visible_activity_for_generic_progress_only");
it("starts_new_streaming_turns_when_real_activity_arrives_after_terminal_turns");
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/transcript.ts`

Changes:

- Replace `activity: SafeActivityEntry[]` with a view-friendly activity state.
- Add helpers that derive whether an assistant turn has visible activity.
- Merge command output deltas into the matching command action.
- Preserve current behavior for assistant text streaming and terminal turn status.

**File**: `apps/extension/src/bridge/session-coordinator.ts`

Changes:

- Keep routing `assistant.activity` into transcript updates.
- Use the updated transcript helper without leaking protocol parsing into the coordinator.

### Success Criteria

#### Automated Verification

- [x] Phase 3 tests fail before implementation: `pnpm --filter @sidra/extension test -- src/transcript.test.ts -t "activity|reasoning|command_output"` failed 7 transcript activity tests before implementation
- [x] Phase 3 tests pass after implementation: `pnpm --filter @sidra/extension test -- src/transcript.test.ts -t "activity|reasoning|command_output"`
- [x] Existing session coordinator activity tests pass: `pnpm --filter @sidra/extension test -- src/bridge/session-coordinator.test.ts -t "activity"`

#### Manual Verification

- [ ] Review transcript state snapshots and confirm generic progress entries no longer make activity visible.

---

## Phase 4: Activity Disclosure UI

### Overview

Render a useful collapsed `Activity` disclosure that resembles Codex's activity affordance: one collapsed entry per assistant turn, with reasoning summary and actions/tools shown when expanded.

### Why This Phase Can Be Validated Independently

React tests can render assistant turns with representative activity state and assert visible UI behavior.

### Changes Required

#### 1. Tests (RED)

**File**: `apps/extension/src/side-panel-view.test.tsx`

Add tests:

```tsx
it("does_not_render_activity_when_assistant_turn_has_no_visible_activity");
it("renders_activity_collapsed_when_reasoning_summary_exists");
it("renders_reasoning_summary_when_activity_is_expanded");
it("renders_tool_action_summary_when_activity_is_expanded");
it("renders_command_output_under_the_matching_command_action");
it("shows_tool_completion_state_when_available");
it("does_not_render_progress_kind_pills_or_working_labels");
```

**File**: `apps/extension/src/styles.test.ts`

Add tests:

```ts
it("defines_activity_disclosure_reasoning_and_action_styles");
```

#### 2. Implementation (GREEN)

**File**: `apps/extension/src/transcript-view.tsx`

Changes:

- Render `Activity` only when the assistant turn has visible activity.
- Show reasoning summary text in a `Reasoning` section.
- Show actions/tools in an `Actions` section.
- Show command output under the matching command action.
- Remove `progress` kind pills from the UI.
- Keep the disclosure collapsed by default.

**File**: `apps/extension/src/styles.css`

Changes:

- Style activity as a compact disclosure with clear sections.
- Use subdued metadata treatment for tool details.
- Ensure long commands/output wrap and do not overflow the side panel.

### Success Criteria

#### Automated Verification

- [x] Phase 4 tests fail before implementation: `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx -t "activity|reasoning|command_output"` failed 7 UI/style activity tests before implementation
- [x] Phase 4 tests pass after implementation: `pnpm --filter @sidra/extension test -- src/side-panel-view.test.tsx -t "activity|reasoning|command_output"`
- [x] Style tests pass: `pnpm --filter @sidra/extension test -- src/styles.test.ts -t "activity"`
- [x] Extension check passes: `pnpm --filter @sidra/extension check`

#### Manual Verification

- [ ] In a local side panel run, an assistant answer with no reasoning summary or tool action shows no `Activity`.
- [ ] A turn with reasoning summary opens to show the summary.
- [ ] A turn with command/tool/web-search activity opens to show action details.

---

## Phase 5: End-to-End Validation And Docs

### Overview

Run the full package checks and update durable docs only if ownership or product behavior changed.

### Why This Phase Can Be Validated Independently

It proves the integrated protocol, bridge, transcript, and UI behavior still works together.

### Changes Required

#### 1. Tests (RED)

No new tests required in this phase. TDD does not apply because this phase validates the integrated work from earlier phases.

#### 2. Implementation (GREEN)

**File**: `docs/ARCHITECTURE.md`

Changes:

- Update only if the provider/activity ownership description needs to mention rich App Server activity mapping.

**File**: `docs/prd-v1.md`

Changes:

- Update only if the product behavior section describes transcript activity.

### Success Criteria

#### Automated Verification

- [x] Protocol tests pass: `pnpm --filter @sidra/protocol test`
- [x] Bridge tests pass: `pnpm --filter @sidra/bridge test`
- [x] Extension tests pass: `pnpm --filter @sidra/extension test`
- [x] All checks pass: `pnpm check`

#### Manual Verification

- [ ] Activity is absent for simple answer-only turns.
- [ ] Activity is present for reasoning summary turns.
- [ ] Activity is present for tool/action turns.
- [ ] Expanded activity shows reasoning summary and action details without exposing raw private reasoning.
