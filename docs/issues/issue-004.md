# Capture Readable Page Context Explicitly

## Status

Open

## Type

AFK

## What to build

Implement the explicit `Capture + Send` path for text-heavy pages: capture readable page context from the active tab at click time, attach it to the prompt as untrusted reference material, and show compact context markers instead of dumping content into the transcript.

## Acceptance criteria

- [ ] No page content is captured on side panel open, tab switch, or passive background activity.
- [ ] `Capture + Send` reads the active tab at click time, recomputes the URL session key, extracts readable content plus metadata, and sends it with the user prompt.
- [ ] Readability extraction falls back to `document.body.innerText` when needed and metadata-only when text is unavailable.
- [ ] Transcript shows context attachment markers such as `Page context attached` or `Page metadata attached`, not raw page content.
- [ ] Tests cover explicit capture, no passive capture, extraction fallback, metadata-only fallback, and prompt wrapping as untrusted reference material.

## Blocked by

- Blocked by #003
