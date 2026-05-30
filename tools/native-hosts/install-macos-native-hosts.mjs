import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { deriveChromeExtensionId } from "./chrome-extension-id.mjs";

export const NATIVE_HOST_NAME = "com.sidra.agent_bridge";
export const NATIVE_HOST_MANIFEST_FILENAME = `${NATIVE_HOST_NAME}.json`;

const BROWSER_TARGETS = Object.freeze({
  chrome: {
    browser: "chrome",
    manifestDirectory: "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    researchOnly: false
  },
  brave: {
    browser: "brave",
    // Brave 148 resolves macOS Native Messaging hosts from Chromium's
    // Google Chrome directory, not BraveSoftware/Brave-Browser.
    manifestDirectory: "Library/Application Support/Google/Chrome/NativeMessagingHosts",
    researchOnly: false
  },
  helium: {
    browser: "helium",
    manifestDirectory: "Library/Application Support/net.imput.helium/NativeMessagingHosts",
    researchOnly: false
  }
});

export function getBrowserTarget(browser) {
  if (!Object.hasOwn(BROWSER_TARGETS, browser)) throw new Error(`Unsupported browser target: ${browser}`);
  const target = BROWSER_TARGETS[browser];
  return target;
}

export function buildNativeHostManifestPath({ browser, homeDirectory, manifestPath }) {
  if (manifestPath) return manifestPath;

  const target = getBrowserTarget(browser);
  if (target.researchOnly || !target.manifestDirectory) throw new Error(`${browser} requires an explicit manifest path`);
  if (!path.isAbsolute(homeDirectory ?? "")) throw new Error("homeDirectory must be absolute");

  return path.join(homeDirectory, target.manifestDirectory, NATIVE_HOST_MANIFEST_FILENAME);
}

export function buildNativeHostManifest(input) {
  const { executablePath } = input;
  if (!path.isAbsolute(executablePath)) throw new Error("Native host executable path must be absolute");
  if (input.extensionId !== undefined) throw new Error("extensionId overrides are not allowed; use extensionManifestPath");

  const extensionId = deriveExtensionIdFromManifestKey(readExtensionManifestKey(input.extensionManifestPath));
  return {
    name: NATIVE_HOST_NAME,
    description: "Sidra local agent bridge",
    path: executablePath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };
}

export function readExtensionManifestKey(extensionManifestPath) {
  if (!path.isAbsolute(extensionManifestPath ?? "")) throw new Error("extensionManifestPath must be absolute");

  const manifest = JSON.parse(readFileSync(extensionManifestPath, "utf8"));
  if (!isRecord(manifest) || typeof manifest.key !== "string") {
    throw new Error("extension manifest key is required");
  }
  return manifest.key;
}

export function validateNativeHostInputs(input) {
  const target = getBrowserTarget(input.browser);
  if (target.researchOnly && !input.research) {
    throw new Error(`${input.browser} support is research-only until verified`);
  }
  if (target.researchOnly && !input.manifestPath) {
    throw new Error(`${input.browser} research mode requires an explicit manifest path`);
  }
  if (!target.researchOnly && input.research) {
    throw new Error(`Research mode is only valid for research-only browser targets`);
  }
  return true;
}

export function installNativeHosts(input) {
  const browsers = resolveSelectedBrowsers(input);
  const wrapperPath = path.join(input.repoRoot, ".local", "sidra-agent-bridge");
  validateInstallInputs(input);
  const manifest = buildNativeHostManifest({
    executablePath: wrapperPath,
    extensionManifestPath: input.extensionManifestPath
  });
  const plannedManifests = browsers.map((browser) => {
    const target = getBrowserTarget(browser);
    validateNativeHostInputs({ browser, research: input.research, manifestPath: input.manifestPath });
    const manifestPath = resolveInstallManifestPath({
      browser,
      manifestRoot: input.manifestRoot,
      manifestPath: input.manifestPath,
      homeDirectory: input.homeDirectory
    });
    return { browser, target, manifestPath };
  });

  if (!input.dryRun) {
    writeNativeHostWrapper({
      wrapperPath,
      workspaceRoot: input.workspaceRoot ?? input.repoRoot,
      nodeExecutablePath: input.nodeExecutablePath,
      bridgeExecutablePath: input.bridgeExecutablePath,
      codexExecutablePath: input.codexExecutablePath
    });
  }

  const manifests = plannedManifests.map(({ browser, target, manifestPath }) => {
    const supported = !target.researchOnly;

    if (!input.dryRun) {
      mkdirSync(path.dirname(manifestPath), { recursive: true });
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }

    return {
      browser,
      path: manifestPath,
      supported,
      status: supported ? "supported" : "unsupported research-only manifest"
    };
  });

  return {
    wrapperPath,
    extensionId: manifest.allowed_origins[0].replace("chrome-extension://", "").replace("/", ""),
    workspaceRoot: input.workspaceRoot ?? input.repoRoot,
    codexExecutablePath: input.codexExecutablePath,
    manifests
  };
}

function resolveSelectedBrowsers(input) {
  if (input.allSupported) return ["chrome", "brave", "helium"];
  if (!input.browser) throw new Error("browser is required");
  return [input.browser];
}

function validateInstallInputs(input) {
  for (const [label, value] of [
    ["repoRoot", input.repoRoot],
    ["bridge executable path", input.bridgeExecutablePath],
    ["node executable path", input.nodeExecutablePath],
    ["codex executable path", input.codexExecutablePath],
    ["workspaceRoot", input.workspaceRoot ?? input.repoRoot],
    ["extensionManifestPath", input.extensionManifestPath],
    ["manifestRoot", input.manifestRoot],
    ["manifestPath", input.manifestPath]
  ]) {
    if (value === undefined) continue;
    if (!path.isAbsolute(value ?? "")) throw new Error(`${label} must be absolute`);
  }
  if (!input.dryRun && !existsSync(input.bridgeExecutablePath)) throw new Error("bridge executable must exist");
}

function resolveInstallManifestPath({ browser, manifestRoot, manifestPath, homeDirectory }) {
  if (manifestPath) return manifestPath;
  if (manifestRoot) {
    const target = getBrowserTarget(browser);
    if (!target.manifestDirectory) throw new Error(`${browser} requires an explicit manifest path`);
    const appSupportPrefix = "Library/Application Support/";
    return path.join(manifestRoot, target.manifestDirectory.slice(appSupportPrefix.length), NATIVE_HOST_MANIFEST_FILENAME);
  }
  return buildNativeHostManifestPath({ browser, homeDirectory: homeDirectory ?? process.env.HOME });
}

function writeNativeHostWrapper({ wrapperPath, workspaceRoot, nodeExecutablePath, bridgeExecutablePath, codexExecutablePath }) {
  mkdirSync(path.dirname(wrapperPath), { recursive: true });
  const codexDirectory = path.dirname(codexExecutablePath);
  const content = [
    "#!/bin/sh",
    `export SIDRA_CODEX_WORKSPACE_ROOT=${shellQuote(workspaceRoot)}`,
    `export PATH=${shellQuote(codexDirectory)}:$PATH`,
    `exec ${shellQuote(nodeExecutablePath)} ${shellQuote(bridgeExecutablePath)}`,
    ""
  ].join("\n");
  writeFileSync(wrapperPath, content, "utf8");
  chmodSync(wrapperPath, 0o755);
}

function shellQuote(value) {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function deriveExtensionIdFromManifestKey(manifestKey) {
  if (!manifestKey) throw new Error("manifestKey is required");
  return deriveChromeExtensionId(manifestKey);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultRepoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function parseCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--browser") options.browser = argv[++index];
    else if (argument === "--all-supported") options.allSupported = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--research") options.research = true;
    else if (argument === "--manifest-path") options.manifestPath = argv[++index];
    else if (argument === "--manifest-root") options.manifestRoot = argv[++index];
    else if (argument === "--repo-root") options.repoRoot = argv[++index];
    else if (argument === "--workspace-root") options.workspaceRoot = argv[++index];
    else if (argument === "--bridge") options.bridgeExecutablePath = argv[++index];
    else if (argument === "--node") options.nodeExecutablePath = argv[++index];
    else if (argument === "--codex") options.codexExecutablePath = argv[++index];
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function printInstallResult(result) {
  console.log(`Build: pnpm build`);
  console.log(`Load unpacked: apps/extension/dist`);
  console.log(`Expected extension ID: ${result.extensionId}`);
  console.log(`SIDRA_CODEX_WORKSPACE_ROOT: ${result.workspaceRoot}`);
  console.log(`Codex executable: ${result.codexExecutablePath}`);
  for (const manifest of result.manifests) {
    console.log(`${manifest.browser}: ${manifest.path} (${manifest.status})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const repoRoot = defaultRepoRoot();
  const options = parseCliArguments(process.argv.slice(2));
  const result = installNativeHosts({
    repoRoot,
    workspaceRoot: repoRoot,
    extensionManifestPath: path.join(repoRoot, "apps/extension/public/manifest.json"),
    bridgeExecutablePath: path.join(repoRoot, "apps/bridge/dist/cli.js"),
    nodeExecutablePath: process.execPath,
    codexExecutablePath: options.codex ?? "/opt/homebrew/bin/codex",
    homeDirectory: process.env.HOME,
    ...options
  });
  printInstallResult(result);
}
