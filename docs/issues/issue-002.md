# Show Bridge Availability And Retry

## Status

Open

## Type

AFK

## What to build

Make the side panel detect whether the Native Messaging bridge is reachable, show a blocking setup/error state when it is not, and recover through a retry action when the bridge becomes available.

## Acceptance criteria

- [ ] Side panel shows a connected chat experience only after receiving `bridge.ready` or a successful session start.
- [ ] When the bridge is unavailable or returns `bridge.error`, the chat area shows a blocking error panel and disables prompt input.
- [ ] Retry attempts to reconnect without requiring the side panel to be reloaded.
- [ ] Bridge and extension reject unknown or invalid protocol messages with schema-backed errors.
- [ ] Tests cover connected, unavailable, invalid-message, and retry states.

## Blocked by

- Blocked by #001
