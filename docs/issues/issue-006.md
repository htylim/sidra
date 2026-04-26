# Add Full DOM Capture Mode

## Status

Open

## Type

AFK

## What to build

Add the prompt options popover with a `Send Full DOM` toggle and use it to switch capture mode between readable text and full DOM, with a separate DOM size limit and clear skipped-context markers.

## Acceptance criteria

- [ ] Composer includes an options control that opens a compact popover anchored above the composer.
- [ ] `Send Full DOM` defaults off and is mutually exclusive with readable text capture.
- [ ] When enabled, `Capture + Send` sends full DOM plus metadata, not readable text.
- [ ] If DOM exceeds the configured DOM limit, Sidra skips DOM content, sends metadata only, and shows `Full DOM skipped: too large` or equivalent.
- [ ] Tests cover toggle behavior, mutual exclusion, DOM size limits, marker text, and settings live updates.

## Blocked by

- Blocked by #005
