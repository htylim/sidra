# Sidra

Sidra is a Chromium side panel extension for chatting with Codex about the current page.

V1 targets article and text-heavy pages on macOS. The extension captures page content only when the user chooses **Capture + Send**, then sends the prompt and page context to a local Native Messaging bridge. The bridge starts `codex app-server` and uses the user's existing Codex auth.

## Current status

This repository contains product planning artifacts and a runnable local slice:

- V1 PRD: [docs/prd-v1.md](docs/prd-v1.md)
- Implementation issues: [docs/issues](docs/issues)
- UI mockups: [docs/ui-mockups](docs/ui-mockups)
- Ubiquitous language glossary: [UBIQUITOUS_LANGUAGE.md](UBIQUITOUS_LANGUAGE.md)
- Chromium extension with explicit readable page capture: [apps/extension](apps/extension)
- Native Messaging bridge with Codex App Server provider wiring: [apps/bridge](apps/bridge)
- Shared protocol types and validation: [packages/protocol](packages/protocol)

## Development

```sh
pnpm install
pnpm --filter @sidra/extension exec playwright install chromium
pnpm test
pnpm check
pnpm build
pnpm test:e2e
```

Native host installer tests can be run directly:

```sh
pnpm test:native-hosts
```

Build a macOS zip distributable:

```sh
pnpm package:macos
```

This creates `release/sidra-macos.zip`. The unzipped folder is self-contained:
it contains the unpacked extension, the bridge runtime, and an interactive
`install-macos.mjs` script. The script lists installed and missing supported
browsers, then lets the user install or uninstall the Native Messaging bridge
manifest for Chrome, Brave, and Helium. The user still loads the extension from
the unzipped folder's `extension` directory.

`pnpm test:e2e` currently runs the extension Playwright smoke test. It builds
`apps/extension/dist`, launches a temporary Chromium profile with that unpacked
extension loaded, verifies the Manifest V3 service worker starts, and opens the
side panel page to confirm Sidra shows the bridge setup state when the Native
Messaging host is not installed.

## Run Locally

The current runnable path is a developer install. It loads the extension,
captures page context only when **Capture + Send** is pressed, and connects to
the local Native Messaging bridge. The bridge uses Codex App Server. It does not
store Codex credentials.

1. Clone and install dependencies:

```sh
git clone <repo-url> sidra
cd sidra
pnpm install
```

2. Build the extension and bridge:

```sh
pnpm build
```

3. Install the Native Messaging host for Chrome, Brave, or Helium:

Chrome:

```sh
node tools/native-hosts/install-macos-native-hosts.mjs --browser chrome --codex "$(command -v codex)"
```

Brave:

```sh
node tools/native-hosts/install-macos-native-hosts.mjs --browser brave --codex "$(command -v codex)"
```

Helium:

```sh
node tools/native-hosts/install-macos-native-hosts.mjs --browser helium --codex "$(command -v codex)"
```

Install both built-in manifest targets:

```sh
node tools/native-hosts/install-macos-native-hosts.mjs --all-supported --codex "$(command -v codex)"
```

The installer writes `.local/sidra-agent-bridge`, makes it executable, exports
`SIDRA_CODEX_WORKSPACE_ROOT` to the repo root, and prepends the directory
containing `codex` to `PATH` before launching `apps/bridge/dist/cli.js`.

Sidra's development extension ID is pinned by `apps/extension/public/manifest.json`.
The expected allowlisted origin is:

```json
"chrome-extension://mahnogfphkjigcjomjcjifkfdnocbokh/"
```

Manual smoke status as of 2026-05-30: Chrome, Brave, and Helium are verified
with the pinned extension ID. Brave 148 resolves the Sidra host from
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts`. Helium
support was verified against `/Applications/Helium.app` version `0.12.4.1`;
its Native Messaging manifest path is
`~/Library/Application Support/net.imput.helium/NativeMessagingHosts`.

4. Load the unpacked extension:

- Open `chrome://extensions`.
- Enable **Developer mode**.
- Choose **Load unpacked**.
- Select `apps/extension/dist`.
- Confirm the Sidra extension ID is `mahnogfphkjigcjomjcjifkfdnocbokh`.

5. Reload Sidra from `chrome://extensions`, open a normal article page, open
Sidra's side panel, and confirm no capture marker appears just from opening the
panel.

6. Type a prompt and press **Capture + Send** only after the side panel reports
that the bridge and Codex provider are ready. Raw page content should not appear
in the transcript.

7. Open an unsupported page such as `chrome://extensions`. Confirm capture is
unavailable and the prompt controls are disabled.

If the bridge does not connect, check:

- the side panel shows `Sidra cannot connect to the local bridge.` and a
  **Retry** button while the host is missing or unavailable;
- after fixing the host manifest or rebuilding the bridge, click **Retry** in
  the side panel instead of reloading the side panel;
- the extension has the `nativeMessaging` permission in `apps/extension/dist/manifest.json`;
- the host manifest filename is exactly `com.sidra.agent_bridge.json`;
- the host manifest `name` is exactly `com.sidra.agent_bridge`;
- `allowed_origins` contains the exact extension ID and trailing slash;
- `path` is absolute and points to an executable file;
- `.local/sidra-agent-bridge` is executable;
- `.local/sidra-agent-bridge` exports the intended `SIDRA_CODEX_WORKSPACE_ROOT`;
- `.local/sidra-agent-bridge` puts the directory containing `codex` on `PATH`;
- `pnpm build` has produced `apps/bridge/dist/cli.js`;
- the browser was restarted or the extension was reloaded after installing the host manifest.
- Codex CLI is authenticated for the current user.
- If Codex setup fails, the bridge emits `bridge.error` with code
  `codex_setup_failed`. `bridge.ready` is not expected until setup succeeds.

Chrome's Native Messaging documentation defines the manifest shape, absolute
path requirement, `allowed_origins`, and the macOS host manifest directories:
https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging

## Planned stack

- pnpm workspaces
- TypeScript
- React
- Vite
- Chromium Manifest V3
- Node/TypeScript Native Messaging bridge
- Codex App Server over stdio
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
