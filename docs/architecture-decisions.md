# Architecture Decisions

This document records project-level decisions that should guide future implementation. Update it when a decision changes.

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
