# Manual E2E Runbook

Use this runbook when an agent needs to manually verify the Sidra extension with
the local Native Messaging bridge. This is the known-good path for the current
macOS sandbox.

Do not improvise with Chrome for Testing first. Use Brave.

## Scope

This runbook covers:

- building the extension and bridge
- installing the local Native Messaging bridge for Brave
- launching Brave with the unpacked extension
- driving a manual smoke flow with Playwright
- cleaning up installed files

This is different from `pnpm test:e2e`. The automated E2E test proves the
extension can load. This manual path proves the browser extension can talk to
the local native bridge and capture a real page.

## Best Practices For Agents

- Read this file before any manual extension E2E with the local bridge.
- Prefer Brave for local manual verification.
- Keep setup minimal: install only the Brave manifest unless testing browser
  compatibility.
- Expect approval prompts in Codex for two steps: writing the Brave Native
  Messaging manifest under `~/Library/Application Support/...`, and launching
  Brave through Playwright.
- Report the exact browser, extension ID, manifest path, and observed panel text.
- If a browser cannot find the native host, check manifest path, host name,
  executable bit, absolute wrapper path, and `allowed_origins` before changing
  code.
- Do not modify product code to work around local manifest or sandbox setup
  failures.

## Automated E2E Is Separate

Do not use this runbook for the normal automated E2E suite.

`pnpm test:e2e` uses the extension Playwright config and smoke spec. It launches
Playwright's bundled Chromium and verifies the extension loads when the native
host is missing. It does not require Brave, the bridge wrapper, or a Native
Messaging host manifest.

Manual setup can affect browser runs that use the same extension ID and a
browser with an installed manifest. The current automated E2E path uses Chrome
for Testing and should stay independent from the Brave manual setup.

## Known-Good Browser

Use Brave:

```text
/Applications/Brave Browser.app/Contents/MacOS/Brave Browser
```

Brave works in this sandbox with Playwright, the unpacked extension, and the
Native Messaging host manifest.

Do not start with Chrome for Testing:

- It can crash in this sandbox while opening Crashpad files under
  `~/Library/Application Support/Google/Chrome for Testing/Crashpad`.
- It needs `--disable-crash-reporter --disable-crashpad --disable-breakpad` just
  to launch reliably.
- Even after launching, it did not resolve the user-level Native Messaging
  manifest during verification.

Do not redirect `HOME` as a first fix:

- Playwright and Corepack derive cache paths from `HOME`.
- Redirecting `HOME` can make Corepack lose cached `pnpm` state and try the
  network, which is blocked in the sandbox.

Do not use Computer Use unless the user explicitly allows it.

## Manual Run Gotchas

- Run ad hoc Playwright scripts from `apps/extension`, or use
  `node --input-type=module -e` from that directory. Temp files under `/tmp` may
  not resolve `@playwright/test`.
- Brave may resolve the repo-local `.local/native-messaging-hosts` manifest and
  `.local/sidra-agent-bridge` wrapper before the user-level Brave manifest. If a
  controlled host or alternate bridge does not appear to run, inspect both the
  user-level manifest and repo-local wrapper before debugging product code.
- When temporarily pointing `.local/sidra-agent-bridge` at a controlled manual
  host, restore it to `apps/bridge/dist/cli.js` before the real bridge smoke.
- Browser clipboard reads can hang behind permission prompts during manual
  automation. To verify a code-copy button, stub `navigator.clipboard.writeText`
  in the extension page and assert the text passed to the stub.
- Match manual assertions to current UI copy. Context markers can differ by
  capture path, such as `Page context attached` versus
  `Page metadata attached`.

## Build

Run from the repo root:

```sh
pnpm build
```

This must produce:

- `apps/extension/dist`
- `apps/bridge/dist/cli.js`

## Install The Native Host

The extension calls:

```ts
chrome.runtime.connectNative("com.sidra.agent_bridge")
```

The manifest filename and `name` must match that host name exactly.

Use the installer. It creates `.local/sidra-agent-bridge`, makes it executable,
sets `SIDRA_CODEX_WORKSPACE_ROOT` to the repo root, puts the directory
containing `codex` on `PATH`, and writes the selected browser manifest.

Brave:

```sh
node tools/native-hosts/install-macos-native-hosts.mjs --browser brave --codex "$(command -v codex)"
```

Chrome:

```sh
node tools/native-hosts/install-macos-native-hosts.mjs --browser chrome --codex "$(command -v codex)"
```

Helium:

```sh
node tools/native-hosts/install-macos-native-hosts.mjs --browser helium --codex "$(command -v codex)"
```

Writing under `~/Library/Application Support/...` may require sandbox
escalation. Ask for escalation when the write fails with `operation not
permitted`.

The pinned development extension ID is:

```text
mahnogfphkjigcjomjcjifkfdnocbokh
```

The manifest `allowed_origins` must contain:

```text
chrome-extension://mahnogfphkjigcjomjcjifkfdnocbokh/
```

## Manual Smoke Checklist

Run this checklist for Chrome, Brave, or Helium after build and install:

- Run `pnpm build`.
- Install the selected manifest with the script above.
- Load `apps/extension/dist`.
- Verify the extension ID is `mahnogfphkjigcjomjcjifkfdnocbokh`.
- Inspect for stale manifests, including repo-local `.local/native-messaging-hosts`.
- Click the toolbar action from a normal web page and confirm the real side panel opens or focuses.
- Confirm `.local/sidra-agent-bridge` has the intended `SIDRA_CODEX_WORKSPACE_ROOT` and Codex path.
- Confirm the side panel connects to the native bridge.
- If Codex setup fails, confirm the side panel surfaces a blocking setup error. `bridge.ready` is not expected when setup fails.
- Send a prompt only after the bridge and Codex provider are ready.

Report:

- browser name and version
- extension ID
- manifest path
- bridge executable path
- whether Codex App Server authenticated
- observed side panel status text

Known local smoke status on 2026-05-24:

- Brave: verified with the pinned extension ID, the user-level Native Messaging
  manifest, toolbar action side-panel opening, and a ready bridge.
- Chrome 148: verified by manual install with the pinned extension ID, toolbar
  action side-panel opening, and a ready bridge.
- Helium 0.12.4.1: verified by manual install with the pinned extension ID,
  toolbar action side-panel opening, and a ready bridge.

Troubleshooting setup failures:

- Missing `SIDRA_CODEX_WORKSPACE_ROOT`: rerun the installer and inspect `.local/sidra-agent-bridge`.
- `codex` not found: pass `--codex "$(command -v codex)"` and confirm the wrapper `PATH`.
- Codex account/auth failure: run `codex` directly and complete auth.
- App Server startup or handshake failure: rerun `pnpm build`, inspect the wrapper, then click Retry.
- Native host lookup failure: verify manifest path, manifest `name`, executable bit, absolute wrapper path, and `allowed_origins`.

### Helium Research Notes

- Main repo: `imputnet/helium`
- macOS packaging repo: `imputnet/helium-macos`
- Installed app path verified on 2026-05-24: `/Applications/Helium.app`
- Installed app version verified on 2026-05-24: `0.12.4.1`
- Chromium version verified on 2026-05-24: `148.0.7778.178`
- Bundle identifier verified on 2026-05-24: `net.imput.helium`
- Native Messaging host directory verified on 2026-05-24:
  `~/Library/Application Support/net.imput.helium/NativeMessagingHosts`
- `chrome.sidePanel`, `chrome.sidePanel.open({ tabId })`, and browser toolbar
  action side-panel opening were verified.

### Full DOM Smoke

After the readable smoke passes, keep the same side panel open.

1. Click `Prompt options`.
2. Enable `Send Full DOM`.
3. Send another prompt with `Capture + Send`.
4. Confirm the page card shows `Full DOM attached`.
5. Confirm the transcript shows `Full DOM attached` and does not show raw HTML.

For the oversized-DOM path, set a small DOM limit in the loaded extension page before sending:

```js
await sidePanelPage.evaluate(async () => {
  await chrome.storage.local.set({
    "sidra.settings.v1": {
      readableContentLimitCharacters: 120000,
      domContentLimitCharacters: 1000
    }
  });
});
```

Then keep `Send Full DOM` enabled and send from a page whose HTML is over that limit. Expected marker:

```text
Full DOM skipped; content too large
```

Raw DOM should not appear in the transcript.

## Manual Play Setup For The User

Use this path when the user wants a browser left open so they can test manually.
Do the build and installer steps above first.

Launch a detached Brave window from the repo root:

```sh
open -na "Brave Browser" --args \
  --user-data-dir=/private/tmp/sidra-brave-play-profile-detached \
  --no-first-run \
  --no-default-browser-check \
  --disable-crash-reporter \
  --disable-crashpad \
  --disable-breakpad \
  --disable-extensions-except=/Users/hernantylim/Dev/sandbox/sidra/apps/extension/dist \
  --load-extension=/Users/hernantylim/Dev/sandbox/sidra/apps/extension/dist \
  https://example.com
```

This leaves Brave running after the agent command exits.

Report these details to the user:

- Browser: Brave
- Manual profile: `/private/tmp/sidra-brave-play-profile-detached`
- Extension path: `/Users/hernantylim/Dev/sandbox/sidra/apps/extension/dist`
- Extension ID: `mahnogfphkjigcjomjcjifkfdnocbokh`
- Native host manifest:
  `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.sidra.agent_bridge.json`

Tell the user how to play:

- Use the `example.com` tab or navigate it to any page.
- Click the Sidra extension icon to open the real side panel.
- Type a prompt and send.
- Use `Prompt options` to enable `Send Full DOM`, then send. Expected marker:
  `Full DOM attached`.
- To smoke oversized DOM, set `domContentLimitCharacters` in extension local
  storage as shown above, then send from a page with HTML over the limit.
  Expected marker: `Full DOM skipped; content too large`.
- For oversized-payload behavior, paste a prompt over about `1 MB` and send.
  Expected transcript marker: `Payload is too large.` The bridge should stay
  usable.

If a terminal-attached Brave was also launched by mistake, list profile-specific
processes and stop only that parent process:

```sh
ps -axo pid,ppid,command | rg "sidra-brave-play-profile"
kill <terminal-attached-parent-pid>
```

Leave the `sidra-brave-play-profile-detached` process running for the user.

## Gotchas

- Opening `side-panel.html` as a normal tab makes the extension page the active
  tab. Capture will be unavailable unless the article tab is brought to front
  before the panel reads active-tab state and before clicking `Capture + Send`.
- The side panel is tested as `chrome-extension://<id>/side-panel.html`, not as
  a real browser side-panel surface. That is enough for bridge, capture, and UI
  state verification.
- Native Messaging manifests are browser-specific. A manifest under Chrome does
  not install the host for Brave.
- `allowed_origins` must include the exact extension ID and trailing slash.
- The manifest path must point to an executable file.
- Use an absolute Node path in the wrapper when in doubt.
- Save screenshots only when the user asks for proof.

## Cleanup

Remove the Brave manifest:

```sh
rm -f "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.sidra.agent_bridge.json"
```

Remove manifests created during failed browser experiments, if present:

```sh
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sidra.agent_bridge.json"
rm -f "$HOME/Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts/com.sidra.agent_bridge.json"
rm -f "$HOME/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/com.sidra.agent_bridge.json"
rm -f "$HOME/Library/Application Support/Chromium/NativeMessagingHosts/com.sidra.agent_bridge.json"
```

Remove the wrapper:

```sh
rm -f .local/sidra-agent-bridge
```

Remove temporary manual browser profiles if they remain:

```sh
find /var/folders \( -name "sidra-brave-profile-*" -o -name "sidra-manual-profile-*" \) -type d -print 2>/dev/null
```

Delete only Sidra manual profiles that were created by this run. Removal under
`~/Library/Application Support/...` or `/var/folders` may require escalation in
the sandbox.
