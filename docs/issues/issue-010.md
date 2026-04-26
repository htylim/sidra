# Reset The Current URL Session With New Chat

## Status

Open

## Type

AFK

## What to build

Make `New Chat` reset only the currently visible URL session by closing/resetting its provider session, clearing local session state, and showing the empty state again without affecting other URL sessions.

## Acceptance criteria

- [ ] `New Chat` sends the correct bridge reset or close/start sequence for the current `clientSessionId`.
- [ ] Current transcript, draft, context state, running state, and session-scoped approvals are cleared.
- [ ] The same page key gets a fresh provider session/thread after reset.
- [ ] Other URL sessions keep their transcripts, drafts, running state, and provider sessions.
- [ ] Tests cover same-session reset, cross-session preservation, approval clearing, and reset during or after a running turn.

## Blocked by

- Blocked by #009
