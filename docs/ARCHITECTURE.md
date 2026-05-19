# Architecture Decisions

This document records project-level decisions that should guide future implementation. Update it when a decision changes.

## Project Map

Use this map to decide where behavior belongs. It is not a file catalog.

- `apps/extension`: Browser extension UI and browser-side application state.
  - Owns side panel rendering, options-page rendering, active page tracking, URL Session mapping, Draft Prompt state, capture orchestration, settings, quick-action configuration, and bridge-facing application commands.
  - Must not own provider lifecycle, low-level bridge protocol sequencing, or raw Native Messaging IO.
- `apps/extension/src/bridge`: Extension-side bridge boundary.
  - Owns Chrome Native Messaging connection state, bridge readiness, reconnect/disconnect behavior, and session-start coordination before prompts are sent.
  - Must expose application-level behavior to the side panel instead of leaking transport sequencing into React code.
- `apps/bridge`: Local Native Messaging bridge.
  - Owns process IO, protocol command handling, provider session lifecycle, in-flight turn state, cancellation, reset/close, heartbeat/disconnect cleanup, and provider allowlisting.
  - Must keep raw transport, protocol dispatch, and provider session management in separate modules as those concerns grow.
- `packages/protocol`: Versioned extension-to-bridge message contract.
  - Owns message types and runtime validation for the Native Messaging boundary.
  - Must grow protocol commands before UI or bridge code depends on new message shapes.
- `docs`: Current architecture and engineering guidance.
  - Owns durable decisions, ownership boundaries, and non-obvious lifecycle rules.
  - Must stay concise and describe the current state, not a historical migration log.

## ADR-001: Keep Side Panel UI Out Of Bridge Protocol Coordination

Status: Accepted

Context:

- Sidra's side panel receives user input and renders chat state.
- The bridge owns Native Messaging communication with the local agent bridge.
- Upcoming work adds bridge availability and retry, URL-scoped sessions, explicit page capture, streaming turns, cancellation, New Chat reset, permission requests, heartbeats, and Codex provider lifecycle.
- A small controller inside the side panel can fix one sequencing bug, but it creates a pattern where future protocol behavior may accrete inside UI code.

Decision:

- The side panel must not coordinate low-level bridge protocol sequencing.
- Add a dedicated bridge/session boundary before expanding bridge behavior.
- UI code should call application-level commands such as `sendPrompt`, `retryBridge`, `cancelTurn`, and `newChat`, then render derived state.
- Non-React bridge/session code should own `chrome.runtime.connectNative`, bridge readiness, retry/disconnect handling, provider session start, prompt queueing until `session.started`, and later URL session lifecycle.

Consequences:

- More scaffolding is acceptable now to avoid architectural drift later.
- Tests should target bridge/session behavior directly instead of relying only on static side-panel rendering.
- Future issues should extend the bridge/session boundary rather than adding protocol state machines to `SidePanel`.

## ADR-002: Prefer Refactor Over Extending Temporary Patterns

Status: Accepted

Context:

- This project is being built in thin vertical slices.
- Thin slices are useful, but temporary shortcuts can become the architecture if each follow-up issue extends them.

Decision:

- Temporary scaffolding must remain easy to delete.
- When a new feature would deepen a known temporary pattern, stop and refactor the boundary first.
- If the correct implementation requires a larger refactor than the user requested, surface the tradeoff before coding unless the user has already authorized the larger change.

Consequences:

- Some issues may include preparatory refactors before product-visible behavior.
- Reviews should flag code that preserves a scaffold shortcut past the point where a cleaner boundary is needed.

## ADR-003: Keep V1 Session Architecture In Deep Modules

Status: Accepted

Context:

- Sidra has several independent lifecycle concerns: side-panel rendering, URL-scoped session state, explicit page capture, bridge transport, provider sessions, streaming turns, cancellation, New Chat reset, permission requests, heartbeats, and provider adapters.
- These concerns interact in product workflows, but each has different ownership, failure modes, test boundaries, and reasons to change.
- A shallow module that merely forwards calls or mixes multiple lifecycles makes future behavior harder to reason about, because every feature must understand transport details, session state, UI state, and provider state at the same time.
- The architecture should preserve information hiding: small public interfaces should hide the complexity of session coordination, bridge IO, provider lifecycle, capture, and UI derivation.
- The extension owns browser-side user/session state and capture state. The bridge owns provider sessions and provider lifecycle. The protocol package owns the versioned message contract between them.

Decision:

- Extension code must be organized around a deep application boundary, not a React component plus a transport helper.
- The side panel view renders a derived UI snapshot and invokes application commands. It must not own URL session mapping, capture orchestration, bridge protocol sequencing, provider lifecycle, cancellation, permissions, or heartbeat cleanup.
  Draft Prompt state is part of the URL Session snapshot and is controlled by the extension application boundary, not by React-local state.
- The extension application boundary should expose commands such as `sendPrompt`, `captureAndSend`, `cancelTurn`, `newChat`, `retryBridge`, and later `respondToPermission`, backed by non-React modules.
- Extension modules should separate at least these responsibilities before related behavior expands:
  - `BridgeConnection`: Chrome Native Messaging connection, reconnect, disconnect, raw protocol IO, and bridge availability.
  - `ActivePageTracker`: active tab URL/title metadata reads and tab/window change subscriptions. It must not use scripting or page content extraction.
  - `UrlSessionStore`: page-keyed URL sessions, session-scoped `CaptureMode`, Draft Prompt, Context State, session approval state, New Chat approval clearing, running state, and Client Session IDs. Transcript and provider-session state are derived from each session's coordinator.
  - `SidePanelController`: application commands, active-page selection, bridge availability composition, quick-action command routing, and derived UI snapshots.
  - `CaptureService`: active-tab capture, extraction, size decisions, and page-context construction.
  - `SettingsStore`: persisted extension settings, quick-action validation, quick-action writes, and live settings updates.
- The bridge must manage provider sessions behind a session manager. A raw message switch must not accumulate provider lifecycle, cancellation, reset, close, heartbeat, or permission logic.
- Bridge modules should separate at least these responsibilities before related behavior expands:
  - `NativeMessagingTransport`: frame parsing/writing and process IO only.
  - `BridgeProtocolHandler`: protocol validation, command dispatch, and safe error mapping.
  - `BridgeSessionManager`: provider-session map, per-session in-flight turn state, cancellation, reset/close, heartbeat/disconnect cleanup, and provider allowlist.
  - `ProviderAdapter`: Codex or mock provider implementation behind the same bridge-owned provider interface.
- Protocol message shape belongs in `packages/protocol`. Runtime validation must happen at Native Messaging boundaries. The protocol package must be the hard boundary for message shape, avoid unsafe casts after shallow validation, and grow protocol commands before UI or bridge code depends on them.
- Provider-affecting lifecycle operations such as New Chat, reset, close, and cancel must be represented in protocol and handled by the bridge before the UI exposes them. Local-only provider lifecycle behavior is a bug.
- One URL session may have only one in-flight prompt, but different URL sessions must be able to run concurrently. Bridge implementation must retain per-session abort controllers and must not serialize unrelated provider streams behind one long-running turn.
- Mock provider behavior is valid for tests and developer smoke paths only. Production bridge composition must wire an explicit provider and fail closed if no allowed provider is configured.
- New work should be built with vertical TDD slices at the owning boundary first. Tests should exercise public module interfaces and user-visible behavior, with targeted boundary tests only when they protect architecture directly.

Consequences:

- Implementation order should establish these ownership boundaries before adding behavior that depends on them.
- Small compatibility wrappers are acceptable during refactor, but they must remain temporary and be deleted once callers move to the deeper boundary.
- Specs and reviews should reject changes that put ownership into `SidePanel` or a bridge message switch when it belongs behind the extension controller, protocol package, or bridge session manager.
- Documentation should describe current ownership, not historical migration steps.
