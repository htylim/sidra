# Codex SDK Contract

Integration status: blocked

Validated on 2026-05-21.

Installed packages:

- @openai/codex-sdk: 0.132.0
- @openai/codex: 0.132.0
- @modelcontextprotocol/sdk: 1.24.0

Commands used:

`pnpm --filter @sidra/bridge add @openai/codex-sdk@0.132.0 @openai/codex@0.132.0`

`pnpm --filter @sidra/bridge add -D @modelcontextprotocol/sdk@1.24.0`

`@modelcontextprotocol/sdk` is a dev dependency because the installed Codex SDK declaration file imports `ContentBlock` from `@modelcontextprotocol/sdk/types.js`. Sidra bridge runtime code does not import it.

## Auth and environment

`new Codex(options)` accepts `apiKey`, `baseUrl`, `env`, `config`, and `codexPathOverride`. The SDK spawns the Codex CLI and passes `CODEX_API_KEY` when `apiKey` is provided. If `env` is provided, the CLI receives that explicit environment plus SDK-required variables. Otherwise it inherits `process.env`.

Sidra must keep credentials in the bridge process environment or official Codex auth storage. The extension must not store or forward credentials.

## Session lifecycle

The package exports `Codex`, `Thread`, `ThreadOptions`, `TurnOptions`, `ThreadEvent`, and related item/event types. `Codex.startThread(options)` creates a `Thread`. `Codex.resumeThread(id, options)` resumes an existing thread. `Thread.id` is populated after a `thread.started` event.

One Sidra `AgentSession` can map to one SDK `Thread` and reuse it for repeated turns. Reset can be modeled by closing the Sidra provider session and creating a new SDK thread.

## Streaming events

`thread.runStreamed(input, turnOptions)` returns `{ events }`, where `events` is an async generator of `ThreadEvent`.

The installed event union includes:

- `thread.started`
- `turn.started`
- `item.started`
- `item.updated`
- `item.completed`
- `turn.completed`
- `turn.failed`
- `error`

Item types include agent messages, reasoning, command execution, file changes, MCP tool calls, web search, todo lists, and errors. Raw item fields include command text, aggregated command output, MCP arguments, MCP results, reasoning text, search query, and error messages. Sidra must not pass those raw fields through to the extension.

## Cancellation

`TurnOptions` includes `signal?: AbortSignal`. The SDK passes the signal to the spawned Codex CLI process. Sidra cancellation can use the existing bridge `AbortSignal` path.

## Permissions

Interactive permission request/response API: not exposed.

The installed public TypeScript API exposes `approvalPolicy?: "never" | "on-request" | "on-failure" | "untrusted"` in `ThreadOptions`, but it does not expose a callback, event type, response method, or decision channel for runtime permission requests. `ThreadEvent` also has no permission request event.

Blocked because @openai/codex-sdk 0.132.0 does not expose an interactive permission request/response API that Sidra can map to its existing inline permission UI. Production Codex provider wiring must not continue while issue 013 requires permission requests to surface and be answered through Sidra.

## Restricted thread options

The installed `ThreadOptions` type accepts the planned restricted defaults:

```ts
{
  sandboxMode: "read-only",
  approvalPolicy: "on-request",
  networkAccessEnabled: false,
  webSearchMode: "disabled",
  skipGitRepoCheck: true,
  workingDirectory: codexWorkspaceRoot
}
```

`workingDirectory` must come from explicit bridge configuration. Production startup must not fall back to the Native Messaging process cwd, the user's home directory, the extension path, or page-derived values.
