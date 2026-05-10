# Show Bridge Availability And Retry

## Status

Complete

## Type

AFK

## What to build

Make the side panel detect whether the Native Messaging bridge is reachable, show a blocking setup/error state when it is not, and recover through a retry action when the bridge becomes available.

## Acceptance criteria

- [x] Side panel shows a connected chat experience only after receiving `bridge.ready`.
- [x] `session.started` remains the response to `session.start`; it does not drive bridge availability in V1 because the Native Messaging bridge emits `bridge.ready` before prompts can be sent.
- [x] When the bridge is unavailable or returns `bridge.error`, the chat area shows a blocking error panel and disables prompt input.
- [x] Retry attempts to reconnect without requiring the side panel to be reloaded.
- [x] Bridge and extension reject unknown or invalid protocol messages with schema-backed errors.
- [x] Tests cover connected, unavailable, invalid-message, and retry states.

## Blocked by

- Blocked by #001
