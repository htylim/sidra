# Maintain URL-Scoped Chat Sessions

## Status

Open

## Type

AFK

## What to build

Tie visible chat state to the active page identity so each normalized URL has its own transcript, draft prompt, running state, page-context state, and bridge provider session while the side panel is alive.

## Acceptance criteria

- [ ] Session keys prefer canonical URL when available, otherwise current URL without hash, with common tracking parameters stripped.
- [ ] Switching active tabs or URLs switches the visible session without showing another page's transcript.
- [ ] Returning to a previously seen URL restores its in-memory transcript and draft.
- [ ] Each URL session starts or reuses its own bridge `clientSessionId`.
- [ ] Tests cover URL normalization, tracking-parameter stripping, draft restoration, and tab-switch isolation.

## Blocked by

- Blocked by #002
