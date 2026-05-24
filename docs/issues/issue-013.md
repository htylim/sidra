# Integrate The Codex Provider

## Status

Open

## Type

HITL

## What to build

Replace the mock provider path with a V1 Codex provider behind the bridge provider interface.

Use Codex App Server over JSON-RPC stdio from the Native Messaging bridge. Do not use `@openai/codex-sdk` for V1. The investigation in [codex-sdk-investigation.md](../codex-sdk-investigation.md) found that the current TypeScript SDK wraps `codex exec` and does not expose the bidirectional permission-request surface Sidra needs.

The bridge should spawn `codex app-server`, use the user's existing Codex CLI auth/config, create one Codex thread per browser URL session, stream App Server events back through Sidra's protocol, and handle App Server approval/user-input requests through the side panel.

## Acceptance criteria

- [ ] Bridge starts and supervises `codex app-server` over stdio, sends `initialize`/`initialized`, and validates App Server messages at the bridge boundary.
- [ ] Bridge checks Codex auth/setup through App Server, uses Codex's existing auth/config, and never stores Codex credentials in the extension.
- [ ] Bridge creates one Codex thread per browser URL session and reuses it until reset or close.
- [ ] Extension chat can send prompts with optional page context through `turn/start` and receive streamed Codex responses through the existing Sidra protocol.
- [ ] Codex App Server errors, auth/setup failures, cancellation, and permission requests surface inline in the correct URL session.
- [ ] Command approval, file-change approval, and tool user-input requests from App Server block the turn until the side panel sends the user's decision.
- [ ] Cancellation sends App Server turn interruption for the active URL session and preserves partial output.
- [ ] Codex credentials are never stored by the extension, and bridge logs exclude prompts and captured page content by default.
- [ ] Tests use a fake App Server peer where needed to cover handshake, thread creation, streaming, cancellation, permissions, and provider error mapping.

## Blocked by

- Blocked by #011
- Blocked by #012
