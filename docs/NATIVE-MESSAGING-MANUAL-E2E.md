# Native Messaging Manual E2E Setup

Use this guide when manually testing the extension against the local Native
Messaging bridge.

## What The Test Needs

Manual end-to-end testing needs both packages installed locally:

- The unpacked extension from `apps/extension/dist`.
- The bridge executable from `apps/bridge/dist/cli.js`.

The extension package is not enough. Chromium browsers only launch a native
host after they find a browser-specific Native Messaging host manifest.

## Build First

```sh
pnpm build
```

## Native Host Wrapper

Create a local executable wrapper that starts the built bridge. Use an absolute
Node path because browsers launch native hosts with a minimal environment.

```sh
mkdir -p .local
cat > .local/sidra-agent-bridge <<'SH'
#!/bin/sh
exec "/absolute/path/to/node" "/absolute/path/to/sidra/apps/bridge/dist/cli.js"
SH
chmod +x .local/sidra-agent-bridge
```

Check the wrapper emits a Native Messaging frame:

```sh
.local/sidra-agent-bridge >/tmp/sidra-bridge-test.bin &
pid=$!
sleep 0.2
kill "$pid" 2>/dev/null || true
od -An -t x1 -N 32 /tmp/sidra-bridge-test.bin
```

The bytes should begin with a 4-byte length followed by JSON containing
`bridge.ready`.

## Install The Host Manifest

The bridge installer owns this manifest. The extension package does not install
it.

Create `com.sidra.agent_bridge.json` with the extension ID from the loaded
browser:

```json
{
  "name": "com.sidra.agent_bridge",
  "description": "Sidra local agent bridge",
  "path": "/absolute/path/to/sidra/.local/sidra-agent-bridge",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<EXTENSION_ID>/"]
}
```

The `name` must match the extension code:

```ts
chrome.runtime.connectNative("com.sidra.agent_bridge")
```

## Browser-Specific Manifest Directories

Native Messaging manifest lookup is browser-specific. On macOS, common
user-level directories are:

```text
~/Library/Application Support/Google/Chrome/NativeMessagingHosts/
~/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/
~/Library/Application Support/Chromium/NativeMessagingHosts/
~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/
~/Library/Application Support/net.imput.helium/NativeMessagingHosts/
```

If Chrome reports `Specified native messaging host not found`, check:

- The manifest is in the directory for that exact browser.
- The filename is exactly `com.sidra.agent_bridge.json`.
- The manifest `name` is exactly `com.sidra.agent_bridge`.
- `path` is absolute and executable.
- `allowed_origins` contains the exact extension ID and trailing slash.
- The wrapper uses an absolute Node path.

Chrome for Testing can be stricter or differ by version. If it cannot find a
user-level manifest, use another installed Chromium browser that resolves the
same host, or install the manifest in the system path when that is the behavior
being tested.

## Manual Smoke Checklist

1. Load `apps/extension/dist` as an unpacked extension.
2. Install the Native Messaging host manifest for that browser and extension ID.
3. Open a normal article page.
4. Open Sidra side panel.
5. Confirm no capture marker appears on open.
6. Type a prompt and press `Capture + Send`.
7. Confirm the transcript shows `Page context attached`, the user prompt, and
   the mock response.
8. Confirm raw page text does not appear in the transcript.
9. Switch to another article tab and press `Capture + Send`; confirm the page
   card reflects the tab active at click time.
10. Open a short page and confirm `Page metadata attached`.
11. Open `chrome://extensions` and confirm capture is unavailable and prompt
    controls are disabled.

Save screenshots for each state when asked for proof.
