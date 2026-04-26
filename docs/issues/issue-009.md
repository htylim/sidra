# Cancel In-Flight Responses

## Status

Open

## Type

AFK

## What to build

Support one in-flight prompt per URL session with visible cancel behavior that aborts the running bridge/provider operation, preserves partial assistant output, and marks the turn as cancelled.

## Acceptance criteria

- [ ] While a prompt is running, the send control becomes Cancel for that URL session.
- [ ] A second prompt cannot be sent in the same URL session while one is in flight.
- [ ] Other URL sessions can still run prompts concurrently.
- [ ] Clicking Cancel or pressing Escape sends `session.cancel`, aborts the provider stream, preserves partial output, and adds a cancelled status marker.
- [ ] Tests cover cancel button, Escape, duplicate-send prevention, partial output preservation, and concurrent sessions.

## Blocked by

- Blocked by #008
