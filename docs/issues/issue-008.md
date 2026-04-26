# Render Streaming Assistant Turns

## Status

Open

## Type

AFK

## What to build

Render assistant responses as streamed chat turns, including sanitized Markdown, safe activity events collapsed under an Activity section, inline operational errors, and link/code-block behavior suitable for V1.

## Acceptance criteria

- [ ] Assistant answer text streams into the active URL session as bridge `agent.event` messages arrive.
- [ ] Assistant Markdown is sanitized, links open in a new tab, and code blocks include copy buttons.
- [ ] User prompts render as escaped user text in compact right-aligned bubbles.
- [ ] Safe activity events are preserved under a collapsed Activity section without exposing private chain-of-thought.
- [ ] Inline errors render as distinct transcript status cards tied to the correct session.
- [ ] Tests cover streaming updates, Markdown sanitization, escaped user text, activity filtering, link behavior, code copy, and session isolation.

## Blocked by

- Blocked by #003
