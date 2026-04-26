# Bootstrap Sidra With A Mock Chat Path

## Status

Open

## Type

AFK

## What to build

Create the initial pnpm/TypeScript workspace and a minimal Sidra vertical path: a Chromium side panel can open, accept a prompt, send it through the extension-to-bridge protocol to a local bridge using a mock provider, and render the mock response.

## Acceptance criteria

- [ ] Workspace contains `apps/extension`, `apps/bridge`, and `packages/protocol` with shared TypeScript configuration and runnable build/test scripts.
- [ ] Extension manifest uses Manifest V3 with `sidePanel`, `nativeMessaging`, `storage`, `tabs`, and `scripting` permissions declared for V1 development.
- [ ] Side panel renders Sidra header, empty chat area, prompt composer, and a send control.
- [ ] Bridge accepts a validated `session.start` and `session.send` message, then emits a mock `session.started` and assistant response event.
- [ ] A local test or smoke script verifies the prompt-to-mock-response path without Codex.

## Blocked by

None - can start immediately
