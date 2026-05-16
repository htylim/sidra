# Add Plain Send Mode And Capture Send Defaults

## Status

Open

## Type

AFK

## What to build

Add the composer send-mode behavior from the V1 PRD: new URL sessions default to `Capture + Send`, successful context sends switch that URL session to plain `Send`, and users can manually choose `Capture + Send` again when they want to refresh page context.

## Acceptance criteria

- [ ] New URL sessions default to `Capture + Send`.
- [ ] After a successful context send, that URL session defaults to plain `Send`.
- [ ] Plain `Send` sends the user prompt without capturing page context.
- [ ] User can manually choose `Capture + Send` again after context has already been attached.
- [ ] Send mode and default action are scoped per URL session.
- [ ] Tests cover default mode, post-capture switch to `Send`, manual capture resend, plain send without context, and URL-session isolation.

## Blocked by

- Blocked by #004
