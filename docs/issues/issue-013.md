# Integrate The Codex Provider

## Status

Open

## Type

HITL

## What to build

Replace the mock provider path with a V1 Codex provider behind the bridge provider interface, after validating the current `codex-sdk` API for auth, session lifecycle, streaming, cancellation, permission requests, and restricted permissions.

## Acceptance criteria

- [ ] Current `codex-sdk` install and API surface are documented in the issue implementation notes or repo docs before integration decisions are finalized.
- [ ] Bridge creates one Codex session/thread per browser URL session and reuses it until reset or close.
- [ ] Extension chat can send prompts with optional page context and receive streamed Codex responses through the existing protocol.
- [ ] Codex SDK errors, auth/setup failures, cancellation, and permission requests surface inline in the correct URL session.
- [ ] Codex credentials are never stored by the extension, and bridge logs exclude prompts and captured page content by default.
- [ ] Tests use mocks where needed to cover session creation, streaming, cancellation, permissions, and provider error mapping.

## Blocked by

- Blocked by #011
- Blocked by #012
