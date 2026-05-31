import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildNativeHostManifest,
  buildNativeHostManifestPath,
  detectBrowserInstallations,
  installNativeHostForBrowsers,
  uninstallNativeHostForBrowsers,
  validatePackageRoot
} from "./macos-installer-lib.mjs";

const extensionManifestPath = fileURLToPath(new URL("../../apps/extension/public/manifest.json", import.meta.url));

describe("macOS distributable installer", () => {
  it("detects_installed_and_missing_supported_browsers", () => {
    const installedPaths = new Set(["/Applications/Google Chrome.app", "/Users/tester/Applications/Helium.app"]);

    const browsers = detectBrowserInstallations({
      homeDirectory: "/Users/tester",
      exists: (candidatePath) => installedPaths.has(candidatePath)
    });

    assert.equal(browsers.find((browser) => browser.id === "chrome").installed, true);
    assert.equal(browsers.find((browser) => browser.id === "brave").installed, false);
    assert.equal(browsers.find((browser) => browser.id === "helium").installedPath, "/Users/tester/Applications/Helium.app");
  });

  it("builds_manifest_paths_for_supported_browsers", () => {
    assert.equal(
      buildNativeHostManifestPath({ browserId: "chrome", homeDirectory: "/Users/tester" }),
      "/Users/tester/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sidra.agent_bridge.json"
    );
    assert.equal(
      buildNativeHostManifestPath({ browserId: "brave", homeDirectory: "/Users/tester" }),
      "/Users/tester/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sidra.agent_bridge.json"
    );
    assert.equal(
      buildNativeHostManifestPath({ browserId: "helium", homeDirectory: "/Users/tester" }),
      "/Users/tester/Library/Application Support/net.imput.helium/NativeMessagingHosts/com.sidra.agent_bridge.json"
    );
  });

  it("builds_manifest_from_packaged_extension_key", () => {
    const manifest = buildNativeHostManifest({
      executablePath: "/Applications/Sidra/sidra-agent-bridge",
      extensionManifestPath
    });

    assert.deepEqual(manifest.allowed_origins, ["chrome-extension://mahnogfphkjigcjomjcjifkfdnocbokh/"]);
  });

  it("rejects_incomplete_package_layout", () => {
    const packageRoot = mkdtempSync(path.join(tmpdir(), "sidra-package-missing-"));

    assert.throws(() => validatePackageRoot(packageRoot), /Package is missing/);
  });

  it("installs_and_uninstalls_manifests_from_distributable_folder", () => {
    const packageRoot = createPackageFixture();
    const homeDirectory = path.join(packageRoot, "home");
    const codexExecutablePath = path.join(packageRoot, "bin", "codex");
    mkdirSync(path.dirname(codexExecutablePath), { recursive: true });
    writeFileSync(codexExecutablePath, "", "utf8");

    const installResults = installNativeHostForBrowsers({
      packageRoot,
      browserIds: ["chrome", "helium"],
      codexExecutablePath,
      homeDirectory
    });

    assert.equal(installResults.length, 2);
    assert.equal(installResults[0].extensionId, "mahnogfphkjigcjomjcjifkfdnocbokh");

    const chromeManifest = JSON.parse(readFileSync(installResults[0].manifestPath, "utf8"));
    assert.equal(chromeManifest.path, path.join(packageRoot, ".local", "sidra-agent-bridge"));
    assert.match(readFileSync(chromeManifest.path, "utf8"), /SIDRA_CODEX_WORKSPACE_ROOT=/);

    const uninstallResults = uninstallNativeHostForBrowsers({ browserIds: ["chrome", "helium"], homeDirectory });

    assert.deepEqual(
      uninstallResults.map((result) => result.removed),
      [true, true]
    );
  });
});

function createPackageFixture() {
  const packageRoot = mkdtempSync(path.join(tmpdir(), "sidra-package-"));
  const files = [
    ["extension/manifest.json", readFileSync(extensionManifestPath, "utf8")],
    ["bridge/dist/cli.js", "console.log('bridge');\n"],
    ["node_modules/@sidra/protocol/package.json", '{"name":"@sidra/protocol","type":"module"}\n'],
    ["node_modules/@sidra/protocol/dist/index.js", "export const PROTOCOL_VERSION = 1;\n"]
  ];

  for (const [relativePath, content] of files) {
    const filePath = path.join(packageRoot, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, "utf8");
  }

  return packageRoot;
}
