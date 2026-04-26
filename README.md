# Sidra

Sidra is a planned Chromium side panel extension for chatting with a local AI agent about the current page.

V1 targets article and text-heavy pages on macOS. The extension will capture readable page content only when the user explicitly chooses **Capture + Send**, then send the prompt and page context to a local Native Messaging bridge that talks to Codex through `codex-sdk`.

## Current status

This repository currently contains product and planning artifacts:

- V1 PRD: [docs/prd-v1.md](docs/prd-v1.md)
- Implementation issues: [docs/issues](docs/issues)
- UI mockups: [docs/ui-mockups](docs/ui-mockups)
- Ubiquitous language glossary: [UBIQUITOUS_LANGUAGE.md](UBIQUITOUS_LANGUAGE.md)

No application code has been scaffolded yet.

## Planned stack

- pnpm workspaces
- TypeScript
- React
- Vite
- Chromium Manifest V3
- Node/TypeScript Native Messaging bridge
- `codex-sdk`
- `@mozilla/readability`

## Planned repository shape

```text
apps/extension
apps/bridge
packages/protocol
packages/extractor
```

`packages/extractor` is optional if extraction stays simple enough inside the extension package.

## V1 goals

- Provide a Chromium side panel chat UI.
- Capture page context explicitly, not passively.
- Use a local bridge process to communicate with Codex.
- Keep the extension independent from provider implementation details.
- Support multiple URL-scoped sessions while the side panel is alive.
- Surface agent activity, permission requests, errors, and cancellation clearly.
