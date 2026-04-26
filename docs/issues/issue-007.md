# Configure Empty-State Quick Actions

## Status

Open

## Type

AFK

## What to build

Show configurable quick actions in empty URL sessions and make the default `Summarize this page` action send its configured prompt through `Capture + Send`.

## Acceptance criteria

- [ ] Empty sessions show the specified centered empty state with heading, helper text, and quick action grid.
- [ ] V1 ships one default quick action labeled `Summarize this page` with the PRD-defined prompt.
- [ ] Settings can enable/disable quick actions and add/remove action entries with `label` and `prompt`.
- [ ] Clicking a quick action fills or sends the configured prompt using `Capture + Send` by default.
- [ ] Tests cover default configuration, disabled quick actions, custom actions, empty-session-only visibility, and capture mode.

## Blocked by

- Blocked by #004
