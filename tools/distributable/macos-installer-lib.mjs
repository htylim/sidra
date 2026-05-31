import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const NATIVE_HOST_NAME = "com.sidra.agent_bridge";
export const NATIVE_HOST_MANIFEST_FILENAME = `${NATIVE_HOST_NAME}.json`;

const CHROME_EXTENSION_ID_ALPHABET = "abcdefghijklmnop";

export const BROWSER_TARGETS = Object.freeze({
  chrome: {
    id: "chrome",
    label: "Google Chrome",
    appPaths: ["/Applications/Google Chrome.app", "~/Applications/Google Chrome.app"],
    manifestDirectory: "Library/Application Support/Google/Chrome/NativeMessagingHosts"
  },
  brave: {
    id: "brave",
    label: "Brave",
    appPaths: ["/Applications/Brave Browser.app", "~/Applications/Brave Browser.app"],
    // Brave 148 resolves macOS Native Messaging hosts from Chromium's
    // Google Chrome directory, not BraveSoftware/Brave-Browser.
    manifestDirectory: "Library/Application Support/Google/Chrome/NativeMessagingHosts"
  },
  helium: {
    id: "helium",
    label: "Helium",
    appPaths: ["/Applications/Helium.app", "~/Applications/Helium.app"],
    manifestDirectory: "Library/Application Support/net.imput.helium/NativeMessagingHosts"
  }
});

export function getBrowserTargets() {
  return Object.values(BROWSER_TARGETS);
}

export function detectBrowserInstallations({ homeDirectory = process.env.HOME, exists = existsSync } = {}) {
  return getBrowserTargets().map((target) => {
    const installedPath = target.appPaths.map((appPath) => expandHome(appPath, homeDirectory)).find((appPath) => exists(appPath));
    return {
      ...target,
      installed: Boolean(installedPath),
      installedPath
    };
  });
}

export function buildNativeHostManifestPath({ browserId, homeDirectory = process.env.HOME }) {
  const target = BROWSER_TARGETS[browserId];
  if (!target) throw new Error(`Unsupported browser target: ${browserId}`);
  if (!path.isAbsolute(homeDirectory ?? "")) throw new Error("homeDirectory must be absolute");
  return path.join(homeDirectory, target.manifestDirectory, NATIVE_HOST_MANIFEST_FILENAME);
}

export function buildNativeHostManifest({ executablePath, extensionManifestPath }) {
  if (!path.isAbsolute(executablePath)) throw new Error("Native host executable path must be absolute");
  const manifest = JSON.parse(readFileSync(extensionManifestPath, "utf8"));
  if (typeof manifest.key !== "string") throw new Error("extension manifest key is required");
  const extensionId = deriveChromeExtensionId(manifest.key);
  return {
    name: NATIVE_HOST_NAME,
    description: "Sidra local agent bridge",
    path: executablePath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  };
}

export function validatePackageRoot(packageRoot) {
  const requiredPaths = [
    "extension/manifest.json",
    "bridge/dist/cli.js",
    "node_modules/@sidra/protocol/package.json",
    "node_modules/@sidra/protocol/dist/index.js"
  ];
  const missingPaths = requiredPaths.filter((relativePath) => !existsSync(path.join(packageRoot, relativePath)));
  if (missingPaths.length > 0) throw new Error(`Package is missing required files: ${missingPaths.join(", ")}`);
}

export function installNativeHostForBrowsers({
  packageRoot,
  browserIds,
  codexExecutablePath,
  nodeExecutablePath = process.execPath,
  workspaceRoot = packageRoot,
  homeDirectory = process.env.HOME
}) {
  validatePackageRoot(packageRoot);
  validateAbsolutePath("packageRoot", packageRoot);
  validateAbsolutePath("codexExecutablePath", codexExecutablePath);
  validateAbsolutePath("nodeExecutablePath", nodeExecutablePath);
  validateAbsolutePath("workspaceRoot", workspaceRoot);

  const wrapperPath = path.join(packageRoot, ".local", "sidra-agent-bridge");
  const bridgeExecutablePath = path.join(packageRoot, "bridge", "dist", "cli.js");
  const extensionManifestPath = path.join(packageRoot, "extension", "manifest.json");
  const manifest = buildNativeHostManifest({ executablePath: wrapperPath, extensionManifestPath });

  writeNativeHostWrapper({
    wrapperPath,
    workspaceRoot,
    nodeExecutablePath,
    bridgeExecutablePath,
    codexExecutablePath
  });

  return browserIds.map((browserId) => {
    const manifestPath = buildNativeHostManifestPath({ browserId, homeDirectory });
    mkdirSync(path.dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    return { browserId, manifestPath, wrapperPath, extensionId: manifest.allowed_origins[0].slice("chrome-extension://".length, -1) };
  });
}

export function uninstallNativeHostForBrowsers({ browserIds, homeDirectory = process.env.HOME }) {
  return browserIds.map((browserId) => {
    const manifestPath = buildNativeHostManifestPath({ browserId, homeDirectory });
    const existed = existsSync(manifestPath);
    if (existed) rmSync(manifestPath);
    return { browserId, manifestPath, removed: existed };
  });
}

export function findCodexExecutable() {
  const candidates = [process.env.SIDRA_CODEX_PATH, "/opt/homebrew/bin/codex", "/usr/local/bin/codex"].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const result = spawnSync("which", ["codex"], { encoding: "utf8" });
  if (result.status === 0) {
    const foundPath = result.stdout.trim();
    if (foundPath) return foundPath;
  }

  return undefined;
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

function deriveChromeExtensionId(publicKeyBase64) {
  if (typeof publicKeyBase64 !== "string" || publicKeyBase64.trim().length === 0) {
    throw new Error("Chrome extension public key is required");
  }
  if (publicKeyBase64.trim() !== publicKeyBase64 || !isCanonicalBase64(publicKeyBase64)) {
    throw new Error("Chrome extension public key must be valid base64");
  }

  const publicKeyBytes = Buffer.from(publicKeyBase64, "base64");
  const digest = createHash("sha256").update(publicKeyBytes).digest();
  let extensionId = "";

  for (const byte of digest.subarray(0, 16)) {
    extensionId += CHROME_EXTENSION_ID_ALPHABET[byte >> 4];
    extensionId += CHROME_EXTENSION_ID_ALPHABET[byte & 0x0f];
  }

  return extensionId;
}

function isCanonicalBase64(value) {
  if (value.length % 4 !== 0) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;

  const firstPaddingIndex = value.indexOf("=");
  if (firstPaddingIndex !== -1 && !/^=+$/.test(value.slice(firstPaddingIndex))) return false;

  return Buffer.from(value, "base64").toString("base64") === value;
}

function expandHome(inputPath, homeDirectory) {
  if (inputPath === "~") return homeDirectory;
  if (inputPath.startsWith("~/")) return path.join(homeDirectory, inputPath.slice(2));
  return inputPath;
}

function shellQuote(value) {
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function validateAbsolutePath(label, value) {
  if (!path.isAbsolute(value ?? "")) throw new Error(`${label} must be absolute`);
}
