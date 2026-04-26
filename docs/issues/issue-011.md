# Handle Provider Permission Requests

## Status

Open

## Type

AFK

## What to build

Surface provider tool/action permission requests as inline transcript cards, block the related agent turn until the user responds, and apply session-scoped approvals only to the current URL session.

## Acceptance criteria

- [ ] Bridge protocol supports `permission.request` and `permission.respond` for the active provider session.
- [ ] Sidebar renders inline permission cards with Allow once, Allow for this session, and Deny actions.
- [ ] The agent turn waits for a decision and resumes or fails according to the user's response.
- [ ] Session-scoped approvals apply only to the current URL session and clear on New Chat, reset, close, or shutdown.
- [ ] Tests cover allow once, allow session, deny, blocked-turn behavior, cross-session isolation, and approval clearing.

## Blocked by

- Blocked by #008
