# Clean Up Sessions On Shutdown And Heartbeat Loss

## Status

Open

## Type

AFK

## What to build

Use extension heartbeats and connection lifecycle handling so bridge sessions are scoped to the live side panel/native connection and are closed when the side panel goes away or heartbeats stop.

## Acceptance criteria

- [ ] Extension sends regular `heartbeat` messages while the side panel is alive.
- [ ] Bridge tracks sessions by native connection and closes provider sessions on disconnect or heartbeat timeout.
- [ ] Closing the side panel clears in-memory extension sessions where detectable and triggers bridge cleanup.
- [ ] Cleanup cancels in-flight turns and emits or records safe cancellation/error state without logging prompts or page content.
- [ ] Tests cover heartbeat success, heartbeat timeout, native disconnect, in-flight cleanup, and no prompt/content logging by default.

## Blocked by

- Blocked by #010
