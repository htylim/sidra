# Codex SDK Investigation

Date: 2026-05-24

## Decision

Do not build Sidra V1 on `@openai/codex-sdk` as currently documented.

Use Codex App Server from the Native Messaging bridge instead:

```text
extension -> native bridge -> codex app-server -> Codex core
```

The TypeScript `@openai/codex-sdk` is real and useful, but it currently wraps `codex exec --experimental-json`. That gives us threads, streaming items, cancellation through `AbortSignal`, and config overrides. It does not expose the full bidirectional app-server protocol that Sidra needs for permission surfacing, tool input requests, rich turn state, model/account discovery, and app-server-native interruption.

Sidra should keep the product-facing provider abstraction from `prd-v1.md`, but the concrete provider should be a Codex App Server adapter, not a thin `@openai/codex-sdk` wrapper.

## What We Need

Sidra V1 needs:

- Use the user's existing local Codex auth. No Sidra-owned OpenAI key storage.
- One provider thread per URL-scoped Sidra session.
- Reused provider thread across turns.
- Streaming assistant text and activity events.
- Command, file change, and tool permission prompts surfaced in the side panel.
- User responses to those prompts.
- Cancellation of an in-flight turn.
- Reset or close of a URL-scoped provider thread.
- Restricted local permissions by default.
- Runtime validation at the extension-to-bridge boundary and at the Codex boundary.

## Official OpenAI Evidence

### `@openai/codex-sdk`

Official docs describe the SDK as a server-side Node library for controlling local Codex agents. It requires Node 18+, installs with:

```bash
npm install @openai/codex-sdk
```

The docs show:

- `new Codex()`
- `codex.startThread()`
- `thread.run(...)`
- `codex.resumeThread(threadId)`

Source: [OpenAI Codex SDK docs](https://developers.openai.com/codex/sdk).

The official TypeScript README in `openai/codex` is more specific: the TypeScript SDK wraps the `codex` CLI from `@openai/codex`, spawns it, and exchanges JSONL over stdin/stdout.

Source: [openai/codex SDK README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md).

The TypeScript SDK source confirms the transport:

- `Thread.runStreamed(...)` delegates to `CodexExec.run(...)`.
- `CodexExec.run(...)` launches `codex exec --experimental-json`.
- A resumed thread becomes `codex exec --experimental-json resume <threadId>`.
- Input is written to child stdin.
- Cancellation is an `AbortSignal` passed to `spawn`.

Sources:

- [thread.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/thread.ts)
- [exec.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/exec.ts)

The SDK event union is intentionally small:

- `thread.started`
- `turn.started`
- `turn.completed`
- `turn.failed`
- `item.started`
- `item.updated`
- `item.completed`
- `error`

Source: [events.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/events.ts).

The item union includes agent messages, reasoning summaries, command execution, file changes, MCP tool calls, web search, todo lists, and errors. It does not include a bidirectional approval request/response API.

Source: [items.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/items.ts).

The SDK can pass sandbox and approval config:

```ts
type ApprovalMode = "never" | "on-request" | "on-failure" | "untrusted";
type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
```

Source: [threadOptions.ts](https://github.com/openai/codex/blob/main/sdk/typescript/src/threadOptions.ts).

That is not enough for Sidra. Passing an approval policy is different from receiving a permission request in the side panel and replying to it.

### Codex App Server

OpenAI describes Codex App Server as the client-friendly bidirectional JSON-RPC API for the Codex harness.

Source: [Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/).

Important official details:

- The app-server hosts Codex core threads in a long-lived process.
- One client request can produce many event updates.
- The protocol is bidirectional.
- The server can initiate requests when the agent needs input, including approvals, and pause the turn until the client responds.
- App Server is the recommended first-class integration method when a client wants the full Codex harness as a stable, UI-friendly event stream.
- The same OpenAI post explicitly distinguishes the SDK as smaller-surface-area than App Server.

Official App Server docs say to start with:

```bash
codex app-server
```

Then:

1. Connect over stdio, WebSocket, or Unix socket.
2. Send `initialize`.
3. Send `initialized`.
4. Start a thread and a turn.
5. Keep reading notifications.

The docs also say protocol schemas can be generated from the installed CLI:

```bash
codex app-server generate-ts --out ./schemas
codex app-server generate-json-schema --out ./schemas
```

Source: [OpenAI Codex App Server docs](https://developers.openai.com/codex/app-server).

Local verification in this workspace:

```text
codex-cli 0.133.0
```

The local CLI supports:

```bash
codex app-server
codex app-server generate-ts --out <DIR>
codex app-server generate-json-schema --out <DIR>
```

### App Server Capabilities That Match Sidra

The official app-server docs expose:

- `account/read` for auth state.
- `model/list` for model discovery.
- `thread/start` and `thread/resume`.
- `thread/name/set` for user-facing thread titles.
- `turn/start`.
- `turn/interrupt`.
- `thread/read`, `thread/list`, `thread/unsubscribe`, archive/unarchive, and related lifecycle APIs.
- `item/agentMessage/delta` for assistant streaming.
- `item/commandExecution/outputDelta` for command output streaming.
- `turn/diff/updated` and file change items.
- `error` notifications with Codex error info.

Permission support is explicit:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput`
- `serverRequest/resolved`

Command decisions:

- `accept`
- `acceptForSession`
- `decline`
- `cancel`
- `acceptWithExecpolicyAmendment`

File change decisions:

- `accept`
- `acceptForSession`
- `decline`
- `cancel`

Source: [OpenAI App Server approvals](https://developers.openai.com/codex/app-server).

Codex permission profiles also exist for filesystem and network access. They are under active development, but they provide least-privilege local command boundaries. Built-ins include `:read-only`, `:workspace`, and `:danger-full-access`.

Source: [OpenAI Codex permissions docs](https://developers.openai.com/codex/permissions).

## t3code Evidence

Repository inspected: `pingdotgg/t3code` at commit `4f0f24f055fe5f5346f7e73372e8cdc167e052f9`.

t3code does not use `@openai/codex-sdk` for its rich Codex UI.

It wraps `codex app-server`:

- Its architecture doc says the Node server wraps `codex app-server` over JSON-RPC stdio.
- The browser talks to t3code's Node server over WebSocket.
- The Node server translates app-server events into its orchestration model.

Sources:

- [t3code architecture](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/.docs/architecture.md#L1-L38)
- [t3code user turn flow](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/.docs/architecture.md#L69-L98)

t3code requires local Codex CLI and local Codex auth:

- Install `codex` on PATH.
- Authenticate Codex with API key or ChatGPT auth supported by Codex.
- t3code starts `codex app-server` per session.

Source: [t3code Codex prerequisites](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/.docs/codex-prerequisites.md#L1-L5).

t3code runtime modes map to app-server approval and sandbox settings:

- Full access: `approvalPolicy: never`, `sandboxMode: danger-full-access`.
- Supervised: `approvalPolicy: on-request`, `sandboxMode: workspace-write`.

Source: [t3code runtime modes](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/.docs/runtime-modes.md#L1-L6).

t3code implementation details:

- It spawns `codex app-server`.
- It sends `initialize` then `initialized`.
- It opens or resumes a Codex thread.
- It starts turns with `turn/start`.
- It interrupts with `turn/interrupt`.
- It handles command approval requests.
- It handles file change approval requests.
- It handles tool user input requests.

Sources:

- [spawn app-server](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L720-L746)
- [thread and turn params](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L261-L299)
- [initialize and open thread](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1180-L1208)
- [send turn](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1241-L1277)
- [interrupt turn](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1278-L1290)
- [command approval handler](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L934-L988)
- [respond to approvals](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1312-L1340)

t3code also generated or vendored app-server protocol bindings in `packages/effect-codex-app-server`, including typed request, notification, and schema plumbing.

Source: [effect-codex-app-server client](https://github.com/pingdotgg/t3code/blob/4f0f24f055fe5f5346f7e73372e8cdc167e052f9/packages/effect-codex-app-server/src/client.ts).

## Zed Evidence

Repository inspected: `zed-industries/zed` at commit `b0911ccc9e8bb2b9eab4cc53ec2c98b0471e2759`.

Zed does not use `@openai/codex-sdk`.

Zed uses ACP for external agents. For Codex specifically, Zed runs Codex through `codex-acp`, a dedicated ACP adapter.

Sources:

- [Zed external agents docs](https://github.com/zed-industries/zed/blob/b0911ccc9e8bb2b9eab4cc53ec2c98b0471e2759/docs/src/ai/external-agents.md#L131-L180)
- [Zed Codex config docs](https://github.com/zed-industries/zed/blob/b0911ccc9e8bb2b9eab4cc53ec2c98b0471e2759/docs/src/ai/external-agents.md#L288-L310)

Zed docs say:

- Zed runs Codex CLI and communicates over ACP through `codex-acp`.
- Zed's own OpenAI API key settings are not used by Codex.
- Codex auth is separate.
- Login with ChatGPT can use the user's paid ChatGPT subscription.
- `CODEX_API_KEY` and `OPENAI_API_KEY` are also supported.
- Codex reads its own `~/.codex/config.toml` and env vars.

Zed implementation details:

- `CODEX_ID` is `codex-acp`.
- Zed registry-agent connection setup forwards relevant env vars to the agent process.
- ACP cancellation sends a cancel notification.
- ACP permission requests are routed into Zed's thread UI and resolved through user selection.

Sources:

- [codex-acp id](https://github.com/zed-industries/zed/blob/b0911ccc9e8bb2b9eab4cc53ec2c98b0471e2759/crates/agent_servers/src/custom.rs#L17-L20)
- [registry env forwarding](https://github.com/zed-industries/zed/blob/b0911ccc9e8bb2b9eab4cc53ec2c98b0471e2759/crates/agent_servers/src/custom.rs#L285-L335)
- [ACP cancel notification](https://github.com/zed-industries/zed/blob/b0911ccc9e8bb2b9eab4cc53ec2c98b0471e2759/crates/agent_servers/src/acp.rs#L1925-L1931)
- [ACP request permission handling](https://github.com/zed-industries/zed/blob/b0911ccc9e8bb2b9eab4cc53ec2c98b0471e2759/crates/agent_servers/src/acp.rs#L3933-L3966)
- [thread permission UI state](https://github.com/zed-industries/zed/blob/b0911ccc9e8bb2b9eab4cc53ec2c98b0471e2759/crates/acp_thread/src/acp_thread.rs#L2180-L2250)
- [thread cancellation](https://github.com/zed-industries/zed/blob/b0911ccc9e8bb2b9eab4cc53ec2c98b0471e2759/crates/acp_thread/src/acp_thread.rs#L2527-L2542)

`codex-acp` itself is an adapter around Codex CLI for ACP clients. Its README says it supports context mentions, images, tool calls with permission requests, edit review, TODO lists, slash commands, client MCP servers, and auth through ChatGPT subscription, `CODEX_API_KEY`, or `OPENAI_API_KEY`.

Source: [zed-industries/codex-acp](https://github.com/zed-industries/codex-acp).

## Comparison

| Option | Fit for Sidra V1 | Why |
| --- | --- | --- |
| `@openai/codex-sdk` | Not enough | Wraps `codex exec`; no bidirectional approval request handling; smaller event surface. |
| Codex App Server JSON-RPC | Best fit | Official rich UI protocol; supports threads, turns, streaming, permission requests, auth/account, model discovery, cancellation. |
| t3code approach | Good reference | Node server wraps `codex app-server` and maps provider events to app state. |
| Zed approach with ACP | Useful reference, not ideal for Sidra | ACP is cross-agent and works well for editor UIs. Sidra needs Codex-specific browser page context and can use App Server directly. |
| `codex-acp` | Possible fallback | Already maps Codex to ACP permissions and cancellation, but adds an extra protocol layer and may hide Codex-specific app-server features. |

## Sidra Integration Spec

### Architecture

Sidra should use:

```text
apps/extension
  -> Chrome Native Messaging
apps/bridge
  -> CodexAppServerProvider
  -> CodexAppServerClient
  -> codex app-server
```

The extension must remain provider-agnostic. It should not know whether Codex uses App Server, SDK, CLI, ACP, or any other implementation.

The bridge owns Codex integration.

### Bridge Modules

Add these bridge-side modules:

```text
apps/bridge/src/codex-app-server/
  CodexAppServerProcess.ts
  CodexAppServerTransport.ts
  CodexAppServerClient.ts
  CodexAppServerProvider.ts
  CodexAppServerEventMapper.ts
  CodexAppServerSchemas.ts
```

Responsibilities:

- `CodexAppServerProcess`: spawn and stop `codex app-server`; configure cwd, env, and `CODEX_HOME`; collect safe stderr diagnostics.
- `CodexAppServerTransport`: JSON-RPC-lite over JSONL stdio; request IDs; pending request map; incoming requests; notifications; timeouts; shutdown.
- `CodexAppServerClient`: typed methods for `initialize`, `account/read`, `model/list`, `thread/start`, `thread/resume`, `turn/start`, `turn/interrupt`, `thread/read`, `thread/unsubscribe`, approval responses, and bounded auxiliary requests such as `thread/name/set`.
- `CodexAppServerProvider`: implements Sidra's `AgentProvider` and `AgentSession`.
- `CodexAppServerEventMapper`: maps app-server notifications and requests to Sidra `SafeProviderTurnEvent` and permission requests.
- `CodexAppServerSchemas`: generated or checked-in protocol types from `codex app-server generate-ts`, plus local runtime validators.

### Process Lifecycle

Use one app-server process per Native Messaging bridge connection.

Reason:

- The App Server can host multiple Codex threads.
- Sidra has multiple URL-scoped sessions while the side panel is alive.
- One process per bridge connection avoids starting one Codex process per URL.
- Closing the side panel or losing heartbeat should close the app-server process and all bridge sessions.

Open question for implementation:

- Verify resource behavior with many loaded threads. If the app-server keeps unloaded threads cheap, one process per bridge connection is best. If not, fall back to one process per provider session.

### Startup

On bridge start:

1. Resolve Codex binary path.
   - Default: `codex` on PATH.
   - Optional setting later: explicit binary path.
2. Spawn:

   ```bash
   codex app-server
   ```

3. Send `initialize` with Sidra client info and experimental capability enabled if required for richer permission payloads.
4. Send `initialized`.
5. Call `account/read`.
6. If unauthenticated, surface `Codex auth/setup error` and tell the user to authenticate Codex. Do not ask for or store credentials.
7. Optionally call `model/list` for diagnostics or later settings.

### Session Start

For each Sidra `clientSessionId`:

1. Create a Codex thread with `thread/start`.
2. Store:
   - Sidra `clientSessionId`
   - Codex `threadId`
   - active `turnId`
   - pending approval requests
   - running state
3. Configure default safety:

Preferred V1 posture:

```ts
{
  approvalPolicy: "on-request",
  sandbox: "workspace-write"
}
```

If we want stricter browser-page Q&A first:

```ts
{
  approvalPolicy: "untrusted",
  sandbox: "read-only"
}
```

Use read-only until Sidra intentionally exposes workspace-mutating workflows. The PRD says Sidra is about the browser page, not repository editing.

### Sending a Turn

For `session.send` from the extension:

1. Bridge validates payload size and shape through `packages/protocol`.
2. Bridge derives provider-neutral display-title source from the raw user prompt plus selected page metadata: `title`, `canonicalUrl`, and `url`.
3. Bridge wraps page context as untrusted reference material for the provider prompt.
4. On the first send for a Codex thread, the Codex provider derives a compact Sidra thread title and makes one bounded best-effort `thread/name/set` request before `turn/start`.
   - Title setting must not use captured body text, captured HTML, or the provider-facing safety wrapper.
   - Title-setting failure or timeout must not fail the chat turn or log prompt/title content by default.
5. Bridge sends `turn/start`:

```ts
{
  threadId,
  input: [
    { type: "text", text: formattedPrompt }
  ],
  approvalPolicy,
  sandboxPolicy,
  model,
  effort
}
```

6. Bridge records returned `turnId`.
7. Bridge emits normalized provider events back to the extension.

### Streaming Event Mapping

Map app-server events like this:

| App Server event | Sidra event |
| --- | --- |
| `turn/started` | turn started/running |
| `item/agentMessage/delta` | assistant text delta |
| `item/reasoning/summaryTextDelta` | safe activity summary |
| `item/commandExecution/outputDelta` | safe command output activity |
| `item/started` command/file/tool | activity item started |
| `item/completed` command/file/tool | activity item completed |
| `turn/completed` | turn completed/cancelled/failed |
| `error` | provider error |
| `thread/status/changed` | session status update |

Do not surface raw private reasoning text. Only surface summary events intended for users.

### Permission Requests

Handle these app-server server requests:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput`

Bridge behavior:

1. Allocate Sidra `requestId`.
2. Keep app-server JSON-RPC request open.
3. Emit `permission.request` to extension with:
   - Sidra `requestId`
   - `clientSessionId`
   - request kind
   - title
   - description
   - command preview or file-change summary
   - allowed decisions
4. Extension renders inline permission card.
5. User responds with:
   - allow once
   - allow for session
   - deny
6. Bridge maps Sidra decision to app-server decision:

| Sidra | Command decision | File decision |
| --- | --- | --- |
| allow once | `accept` | `accept` |
| allow for session | `acceptForSession` | `acceptForSession` |
| deny | `decline` | `decline` |
| cancel turn | `cancel` | `cancel` |

7. Bridge responds to the app-server request.
8. Bridge emits a status card update when `serverRequest/resolved` arrives.

Session-scoped approvals must remain Sidra-owned. Clear them on New Chat, reset, close, or side-panel shutdown.

### Cancellation

For `session.cancel`:

1. Look up active Codex `threadId` and `turnId`.
2. Send:

```ts
{
  method: "turn/interrupt",
  params: { threadId, turnId }
}
```

3. Resolve all pending Sidra permission cards for that turn as cancelled.
4. Preserve partial output.
5. Mark the turn cancelled when `turn/completed` or relevant cleanup events arrive.

Do not implement cancellation by killing the bridge unless the app-server process is wedged.

### New Chat

For Sidra `New Chat` on one URL session:

1. Cancel active turn if any.
2. Resolve pending approvals with `cancel`.
3. Unsubscribe or close the old app-server thread if supported by the current generated protocol.
4. Drop Sidra transcript and draft for that URL.
5. Start a fresh Codex thread for the same Sidra URL session.

If app-server only supports unsubscribe/archive semantics for loaded threads, use the least destructive close/unsubscribe operation and keep durable Codex thread history outside Sidra's visible state.

### Authentication

Sidra must not store Codex credentials.

Use Codex's own auth:

- ChatGPT login where Codex supports it.
- `CODEX_API_KEY` if present in the bridge environment.
- `OPENAI_API_KEY` if present in the bridge environment.
- `~/.codex/config.toml` and Codex-managed auth state.

Bridge diagnostics should call `account/read` and surface a setup error if Codex is unauthenticated.

### Protocol Generation

Use the local Codex CLI to generate app-server protocol artifacts:

```bash
codex app-server generate-ts --experimental --out apps/bridge/src/codex-app-server/generated
```

Check generated files into the repo only if they are stable enough and not huge. Otherwise, generate during development and keep a narrow handwritten schema for the V1 subset.

Recommended V1 subset:

- `initialize`
- `initialized`
- `account/read`
- `model/list`
- `thread/start`
- `thread/resume`
- `thread/read`
- `thread/name/set`
- `thread/unsubscribe`
- `turn/start`
- `turn/interrupt`
- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput`
- `serverRequest/resolved`
- `thread/status/changed`
- `turn/started`
- `turn/completed`
- `item/started`
- `item/completed`
- `item/agentMessage/delta`
- `item/reasoning/summaryTextDelta`
- `item/commandExecution/outputDelta`
- `turn/diff/updated`
- `error`

### Testing

Add bridge tests with a fake app-server peer:

- handshake sends `initialize` and `initialized`
- unauthenticated `account/read` maps to setup error
- `session.start` creates one app-server thread
- `session.send` captures raw display-title source before prompt formatting
- first titled `session.send` sends best-effort `thread/name/set` before `turn/start`
- `session.send` sends `turn/start`
- assistant deltas stream to extension protocol
- command approval request blocks until extension response
- file approval request blocks until extension response
- `allow_once`, `allow_for_session`, and `deny` map to app-server decisions
- `session.cancel` sends `turn/interrupt`
- process exit maps to bridge/provider error
- heartbeat shutdown closes app-server process

Add contract tests for generated or handwritten schemas.

### Documentation Updates Needed

Update `docs/prd-v1.md`:

- Replace "`codex-sdk` as an npm dependency" with "Codex App Server over JSON-RPC stdio".
- Keep `@openai/codex-sdk` as non-goal or rejected option for V1 rich UI integration.
- Replace "Codex provider implemented with `codex-sdk`" with "Codex provider implemented by a bridge-owned Codex App Server adapter".
- Update open research items to focus on exact app-server method schemas, thread close semantics, and permission-profile defaults.

Update `docs/ARCHITECTURE.md` only when implementation changes ownership boundaries.

## Open Questions

- Does `thread/unsubscribe` fully release loaded thread resources quickly enough for side-panel shutdown, or should Sidra use another close API from generated schemas?
- Should V1 start Codex in read-only mode because page Q&A should not mutate local files?
- Should Sidra allow any command execution at all in V1, or deny by default unless a future product setting enables it?
- Should generated app-server TypeScript schemas be checked in, or should we write narrow Zod schemas for the V1 subset?
- How should Sidra configure `CODEX_HOME`? Default to the user's normal `~/.codex`, or allow a Sidra-specific Codex home for isolation?

## Final Recommendation

Use Codex App Server directly from `apps/bridge`.

Do not use `@openai/codex-sdk` for Sidra V1 unless OpenAI updates the TypeScript SDK to wrap App Server and expose bidirectional server requests. t3code and Zed both validate the same conclusion: rich Codex UIs do not rely on the current TypeScript SDK. t3code uses `codex app-server` directly. Zed uses `codex-acp`, which is an ACP adapter around Codex for editor-agent interoperability.
