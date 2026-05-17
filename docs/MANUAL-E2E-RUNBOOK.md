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

## Build

Run from the repo root:

```sh
pnpm build
```

This must produce:

- `apps/extension/dist`
- `apps/bridge/dist/cli.js`

## Install The Bridge Wrapper

Create a repo-local executable wrapper. Use absolute paths because browsers
launch native hosts with a minimal environment.

```sh
mkdir -p .local
cat > .local/sidra-agent-bridge <<'SH'
#!/bin/sh
exec "/Users/hernantylim/.nvm/versions/node/v22.14.0/bin/node" "/Users/hernantylim/Dev/sandbox/sidra/apps/bridge/dist/cli.js"
SH
chmod +x .local/sidra-agent-bridge
```

If Node moves, update the wrapper with the current absolute Node path from
`command -v node`. Do not leave `command -v node` inside the wrapper. The browser
launches native hosts with a minimal environment.

Check the wrapper emits a Native Messaging frame:

```sh
.local/sidra-agent-bridge >/tmp/sidra-bridge-test.bin &
pid=$!
sleep 1
kill "$pid" 2>/dev/null || true
od -An -t x1 -N 48 /tmp/sidra-bridge-test.bin
```

Expected bytes start with a four-byte length, then JSON containing:

```json
{"type":"bridge.ready","version":2}
```

A sandbox warning like `nice(5) failed: operation not permitted` is not fatal if
the frame is emitted.

## Get The Extension ID

The Brave extension ID is stable for the current unpacked extension path:

```text
dkogbjooeahemlnkpdnhhjbhojhdlnpd
```

If the path or manifest key changes, relaunch Brave with the extension and read
the service worker URL host from Playwright.

## Install The Brave Native Host Manifest

The extension calls:

```ts
chrome.runtime.connectNative("com.sidra.agent_bridge")
```

The manifest filename and `name` must match that host name exactly.

Install this file:

```text
~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.sidra.agent_bridge.json
```

Content:

```json
{
  "name": "com.sidra.agent_bridge",
  "description": "Sidra local agent bridge",
  "path": "/Users/hernantylim/Dev/sandbox/sidra/.local/sidra-agent-bridge",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://dkogbjooeahemlnkpdnhhjbhojhdlnpd/"]
}
```

Writing under `~/Library/Application Support/...` may require sandbox
escalation. Ask for escalation when the write fails with `operation not
permitted`.

In Codex, installing this manifest is different from using an already configured
browser from the Codex app. A fresh Playwright-launched Brave profile still needs
the browser-level manifest so `chrome.runtime.connectNative` can resolve
`com.sidra.agent_bridge`.

Use this setup command from the repo root:

```sh
mkdir -p "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
cat > "$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.sidra.agent_bridge.json" <<'JSON'
{
  "name": "com.sidra.agent_bridge",
  "description": "Sidra local agent bridge",
  "path": "/Users/hernantylim/Dev/sandbox/sidra/.local/sidra-agent-bridge",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://dkogbjooeahemlnkpdnhhjbhojhdlnpd/"]
}
JSON
```

## Manual Smoke With Playwright

Use this shape for a manual smoke check. It starts a local article page, launches
Brave with the unpacked extension, opens the side panel page, keeps the article
tab active, clicks `Capture + Send`, and verifies the bridge response.

Run from `apps/extension` after build and manifest install:

```sh
/Users/hernantylim/.nvm/versions/node/v22.14.0/bin/node --input-type=module -e '
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const html = `<!doctype html>
<html>
  <head><title>Manual Sidra Article</title></head>
  <body>
    <article>
      <h1>Manual Sidra Article</h1>
      <p>This is a local article used for Sidra manual extension verification.</p>
      <p>Sidra should attach page context and send the prompt through the native bridge.</p>
    </article>
  </body>
</html>`;

const server = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const articleUrl = `http://127.0.0.1:${port}/article`;

const extensionPath = resolve("dist");
const userDataDir = await mkdtemp(join(tmpdir(), "sidra-brave-profile-"));

const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false,
  args: [
    "--disable-crash-reporter",
    "--disable-crashpad",
    "--disable-breakpad",
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});

try {
  const articlePage = await context.newPage();
  await articlePage.goto(articleUrl);

  const serviceWorker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 10000 }));
  const extensionId = new URL(serviceWorker.url()).host;

  const sidePanelPage = await context.newPage();
  await sidePanelPage.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await sidePanelPage.waitForLoadState("domcontentloaded");

  await articlePage.bringToFront();
  await sidePanelPage.waitForFunction(
    () =>
      document.body.innerText.includes("Manual Sidra Article") &&
      !document.querySelector("textarea")?.disabled,
    undefined,
    { timeout: 10000 }
  );

  await sidePanelPage.locator("textarea").evaluate((element, value) => {
    const textarea = element;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, "Summarize this local article");

  await articlePage.bringToFront();
  await sidePanelPage.getByRole("button", { name: "Capture + Send" }).dispatchEvent("click");

  await sidePanelPage.waitForFunction(
    () =>
      document.body.innerText.includes("Page context attached") &&
      document.body.innerText.includes("Mock response"),
    undefined,
    { timeout: 10000 }
  );

  console.log(await sidePanelPage.locator("body").innerText());
} finally {
  await context.close();
  server.close();
}
'
```

Expected output includes:

```text
Manual Sidra Article
Context attached
Page context attached
Summarize this local article
Session started
Mock response received.
```

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

### Agent Full DOM Smoke Script

Use this script when an agent should validate readable capture, full DOM capture,
and oversized full DOM in one run. Run it from `apps/extension` after build,
wrapper install, and Brave manifest install.

```sh
/Users/hernantylim/.nvm/versions/node/v22.14.0/bin/node --input-type=module -e '
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const largeText = "oversized-dom-content ".repeat(120);
const html = `<!doctype html>
<html>
  <head><title>Manual Sidra Article</title></head>
  <body>
    <article>
      <h1>Manual Sidra Article</h1>
      <p>This is a local article used for Sidra manual extension verification.</p>
      <p>Sidra should attach page context and send the prompt through the native bridge.</p>
      <section id="large-dom-section">${largeText}</section>
    </article>
  </body>
</html>`;

const server = createServer((_, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end(html);
});

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const port = server.address().port;
const articleUrl = `http://127.0.0.1:${port}/article`;
const extensionPath = resolve("dist");
const userDataDir = await mkdtemp(join(tmpdir(), "sidra-brave-profile-"));

const context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  headless: false,
  args: [
    "--disable-crash-reporter",
    "--disable-crashpad",
    "--disable-breakpad",
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`
  ]
});

const result = { browser: "Brave", articleUrl, extensionId: "", userDataDir, checks: [] };
const pass = (name, details = {}) => result.checks.push({ name, ok: true, ...details });
const fail = (name, details = {}) => result.checks.push({ name, ok: false, ...details });

async function setPrompt(sidePanelPage, text) {
  await sidePanelPage.locator("textarea").evaluate((element, value) => {
    const textarea = element;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, text);
}

async function captureAndWait(articlePage, sidePanelPage, prompt, expectedMarker) {
  await setPrompt(sidePanelPage, prompt);
  await articlePage.bringToFront();
  await sidePanelPage.getByRole("button", { name: "Capture + Send" }).dispatchEvent("click");
  await sidePanelPage.waitForFunction(
    ([marker, promptText]) =>
      document.body.innerText.includes(marker) &&
      document.body.innerText.includes(promptText) &&
      document.body.innerText.includes("Mock response"),
    [expectedMarker, prompt],
    { timeout: 10000 }
  );
  return await sidePanelPage.locator("body").innerText();
}

try {
  const articlePage = await context.newPage();
  await articlePage.goto(articleUrl);

  const serviceWorker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker", { timeout: 10000 }));
  const extensionId = new URL(serviceWorker.url()).host;
  result.extensionId = extensionId;

  const sidePanelPage = await context.newPage();
  await sidePanelPage.goto(`chrome-extension://${extensionId}/side-panel.html`);
  await sidePanelPage.waitForLoadState("domcontentloaded");

  await articlePage.bringToFront();
  await sidePanelPage.waitForFunction(
    () =>
      document.body.innerText.includes("Manual Sidra Article") &&
      !document.querySelector("textarea")?.disabled,
    undefined,
    { timeout: 10000 }
  );
  pass("side panel connected to native bridge and active article", { extensionId });

  const readableText = await captureAndWait(
    articlePage,
    sidePanelPage,
    "Summarize this local article",
    "Page context attached"
  );
  if (
    readableText.includes("Context attached") &&
    readableText.includes("Session started") &&
    readableText.includes("Mock response received.")
  ) {
    pass("readable Capture + Send shows expected markers");
  } else {
    fail("readable Capture + Send shows expected markers", { body: readableText });
  }

  await sidePanelPage.getByRole("button", { name: "Prompt options" }).click();
  await sidePanelPage.getByRole("checkbox", { name: "Send Full DOM" }).check();
  const checked = await sidePanelPage.getByRole("checkbox", { name: "Send Full DOM" }).isChecked();
  if (checked) pass("Send Full DOM toggle can be enabled");
  else fail("Send Full DOM toggle can be enabled");

  const fullDomText = await captureAndWait(articlePage, sidePanelPage, "Send full DOM now", "Full DOM attached");
  if (
    fullDomText.includes("Full DOM attached") &&
    !fullDomText.includes("<html") &&
    !fullDomText.includes("<body") &&
    !fullDomText.includes("large-dom-section")
  ) {
    pass("full DOM send shows marker without raw HTML in transcript");
  } else {
    fail("full DOM send shows marker without raw HTML in transcript", { body: fullDomText });
  }

  await sidePanelPage.evaluate(async () => {
    await chrome.storage.local.set({
      "sidra.settings.v1": {
        readableContentLimitCharacters: 120000,
        domContentLimitCharacters: 1000
      }
    });
  });
  await sidePanelPage.waitForTimeout(250);

  const oversizedText = await captureAndWait(
    articlePage,
    sidePanelPage,
    "Send oversized full DOM",
    "Full DOM skipped; content too large"
  );
  if (
    oversizedText.includes("Full DOM skipped: too large") &&
    oversizedText.includes("Full DOM skipped; content too large") &&
    !oversizedText.includes("<html") &&
    !oversizedText.includes("large-dom-section")
  ) {
    pass("oversized full DOM sends metadata-only marker without raw HTML");
  } else {
    fail("oversized full DOM sends metadata-only marker without raw HTML", { body: oversizedText });
  }

  console.log(JSON.stringify(result, null, 2));
} finally {
  await context.close();
  server.close();
}
'
```

All checks should return `"ok": true`. Clean up the manifest and temporary
profile listed in the JSON result after the run.

## Manual Play Setup For The User

Use this path when the user wants a browser left open so they can test manually.
Do the build, bridge wrapper, and Brave manifest steps above first.

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
  https://example.com \
  chrome-extension://dkogbjooeahemlnkpdnhhjbhojhdlnpd/side-panel.html
```

This leaves Brave running after the agent command exits.

Report these details to the user:

- Browser: Brave
- Manual profile: `/private/tmp/sidra-brave-play-profile-detached`
- Extension path: `/Users/hernantylim/Dev/sandbox/sidra/apps/extension/dist`
- Extension ID: `dkogbjooeahemlnkpdnhhjbhojhdlnpd`
- Side panel URL: `chrome-extension://dkogbjooeahemlnkpdnhhjbhojhdlnpd/side-panel.html`
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
