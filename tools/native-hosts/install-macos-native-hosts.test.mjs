import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildNativeHostManifest,
  buildNativeHostManifestPath,
  getBrowserTarget,
  installNativeHosts,
  validateNativeHostInputs
} from "./install-macos-native-hosts.mjs";

const extensionManifestPath = fileURLToPath(new URL("../../apps/extension/public/manifest.json", import.meta.url));

describe("macOS native host manifest model", () => {
  it("builds_chrome_manifest_path", () => {
    assert.equal(
      buildNativeHostManifestPath({ browser: "chrome", homeDirectory: "/Users/tester" }),
      "/Users/tester/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sidra.agent_bridge.json"
    );
  });

  it("builds_brave_manifest_path", () => {
    assert.equal(
      buildNativeHostManifestPath({ browser: "brave", homeDirectory: "/Users/tester" }),
      "/Users/tester/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/com.sidra.agent_bridge.json"
    );
  });

  it("builds_native_host_manifest_with_absolute_executable_path", () => {
    assert.deepEqual(
      buildNativeHostManifest({
        executablePath: "/repo/.local/sidra-agent-bridge",
        extensionManifestPath
      }),
      {
        name: "com.sidra.agent_bridge",
        description: "Sidra local agent bridge",
        path: "/repo/.local/sidra-agent-bridge",
        type: "stdio",
        allowed_origins: ["chrome-extension://mahnogfphkjigcjomjcjifkfdnocbokh/"]
      }
    );
  });

  it("builds_native_host_manifest_with_allowed_origin_derived_from_manifest_key", () => {
    assert.deepEqual(
      buildNativeHostManifest({
        executablePath: "/repo/.local/sidra-agent-bridge",
        extensionManifestPath
      }).allowed_origins,
      ["chrome-extension://mahnogfphkjigcjomjcjifkfdnocbokh/"]
    );
  });

  it("rejects_relative_native_host_path", () => {
    assert.throws(
      () =>
        buildNativeHostManifest({
          executablePath: ".local/sidra-agent-bridge",
          extensionManifestPath
        }),
      /absolute/
    );
  });

  it("rejects_invalid_manifest_key_base64", () => {
    const invalidManifestPath = writeTemporaryExtensionManifest({ key: "AQID!!!!" });

    assert.throws(
      () =>
        buildNativeHostManifest({
          executablePath: "/repo/.local/sidra-agent-bridge",
          extensionManifestPath: invalidManifestPath
        }),
      /valid base64/
    );
  });

  it("does_not_allow_extension_id_override", () => {
    assert.throws(
      () =>
        buildNativeHostManifest({
          executablePath: "/repo/.local/sidra-agent-bridge",
          extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }),
      /extensionId overrides/
    );
  });

  it("rejects_unknown_browser_target", () => {
    assert.throws(() => getBrowserTarget("safari"), /Unsupported browser/);
  });

  it("rejects_inherited_browser_target_names", () => {
    assert.throws(() => getBrowserTarget("toString"), /Unsupported browser/);
  });

  it("helium_target_is_supported_after_manual_verification", () => {
    assert.equal(getBrowserTarget("helium").researchOnly, false);
    assert.equal(getBrowserTarget("helium").manifestDirectory, "Library/Application Support/net.imput.helium/NativeMessagingHosts");
  });

  it("builds_helium_manifest_path", () => {
    assert.equal(
      buildNativeHostManifestPath({ browser: "helium", homeDirectory: "/Users/tester" }),
      "/Users/tester/Library/Application Support/net.imput.helium/NativeMessagingHosts/com.sidra.agent_bridge.json"
    );
  });

  it("rejects_research_mode_for_supported_helium", () => {
    assert.throws(() => validateNativeHostInputs({ browser: "helium", research: true }), /Research mode/);
  });

  it("dry_run_reports_chrome_manifest_without_writing", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, browser: "chrome", dryRun: true });

    assert.equal(result.manifests[0].browser, "chrome");
    assert.equal(existsSync(result.manifests[0].path), false);
  });

  it("dry_run_reports_brave_manifest_without_writing", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, browser: "brave", dryRun: true });

    assert.equal(result.manifests[0].browser, "brave");
    assert.equal(existsSync(result.manifests[0].path), false);
  });

  it("writes_selected_browser_manifest_json", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, browser: "chrome" });
    const manifest = JSON.parse(readFileSync(result.manifests[0].path, "utf8"));

    assert.equal(manifest.name, "com.sidra.agent_bridge");
    assert.deepEqual(manifest.allowed_origins, ["chrome-extension://mahnogfphkjigcjomjcjifkfdnocbokh/"]);
    assert.equal(existsSync(path.join(root.manifestRoot, "BraveSoftware/Brave-Browser/NativeMessagingHosts/com.sidra.agent_bridge.json")), false);
  });

  it("creates_manifest_parent_directory", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, browser: "brave" });

    assert.equal(existsSync(path.dirname(result.manifests[0].path)), true);
  });

  it("writes_helium_manifest_without_research_mode", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, browser: "helium" });

    assert.equal(result.manifests[0].browser, "helium");
    assert.equal(existsSync(path.join(root.manifestRoot, "net.imput.helium/NativeMessagingHosts/com.sidra.agent_bridge.json")), true);
  });

  it("labels_helium_manifest_as_supported", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, browser: "helium" });

    assert.equal(result.manifests[0].supported, true);
    assert.equal(result.manifests[0].status, "supported");
  });

  it("all_supported_includes_chrome_brave_and_helium", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, allSupported: true, dryRun: true });

    assert.deepEqual(
      result.manifests.map((manifest) => manifest.browser),
      ["chrome", "brave", "helium"]
    );
  });

  it("writes_manifest_under_injected_manifest_root_in_tests", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, browser: "chrome" });

    assert.equal(result.manifests[0].path.startsWith(root.manifestRoot), true);
  });

  it("requires_existing_bridge_executable_unless_dry_run", () => {
    const root = createInstallerFixture();

    assert.throws(() => installNativeHosts({ ...root, browser: "chrome", bridgeExecutablePath: "/missing/bridge.js" }), /bridge executable/);
    assert.doesNotThrow(() => installNativeHosts({ ...root, browser: "chrome", bridgeExecutablePath: "/missing/bridge.js", dryRun: true }));
  });

  it("creates_native_host_wrapper_with_sidra_codex_workspace_root", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, browser: "chrome" });
    const wrapper = readFileSync(result.wrapperPath, "utf8");

    assert.match(wrapper, /SIDRA_CODEX_WORKSPACE_ROOT=/);
    assert.match(wrapper, new RegExp(escapeRegExp(root.workspaceRoot)));
  });

  it("creates_native_host_wrapper_with_codex_executable_directory_on_path", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, browser: "chrome" });
    const wrapper = readFileSync(result.wrapperPath, "utf8");

    assert.match(wrapper, new RegExp(`PATH="${escapeRegExp(path.dirname(root.codexExecutablePath))}":\\$PATH`));
  });

  it("creates_native_host_wrapper_with_executable_permissions", () => {
    const root = createInstallerFixture();

    const result = installNativeHosts({ ...root, browser: "chrome" });

    assert.equal((statSync(result.wrapperPath).mode & 0o111) !== 0, true);
  });

  it("requires_absolute_codex_executable_path", () => {
    const root = createInstallerFixture();

    assert.throws(() => installNativeHosts({ ...root, browser: "chrome", codexExecutablePath: "codex" }), /codex executable path/);
  });

  it("requires_absolute_workspace_root", () => {
    const root = createInstallerFixture();

    assert.throws(() => installNativeHosts({ ...root, browser: "chrome", workspaceRoot: "." }), /workspaceRoot/);
  });

  it("requires_absolute_manifest_root", () => {
    const root = createInstallerFixture();

    assert.throws(() => installNativeHosts({ ...root, browser: "chrome", manifestRoot: "NativeMessagingRoots" }), /manifestRoot/);
  });

  it("requires_absolute_manifest_path", () => {
    const root = createInstallerFixture();

    assert.throws(
      () => installNativeHosts({ ...root, browser: "helium", research: true, manifestPath: "helium-host.json" }),
      /manifestPath/
    );
  });

  it("does_not_write_wrapper_before_rejecting_invalid_supported_research_mode", () => {
    const root = createInstallerFixture();

    assert.throws(() => installNativeHosts({ ...root, browser: "helium", research: true }), /Research mode/);
    assert.equal(existsSync(path.join(root.repoRoot, ".local", "sidra-agent-bridge")), false);
  });

  it("does_not_write_wrapper_before_rejecting_invalid_extension_manifest", () => {
    const root = createInstallerFixture();
    const invalidManifestPath = writeTemporaryExtensionManifest({ name: "Sidra" });

    assert.throws(() => installNativeHosts({ ...root, browser: "chrome", extensionManifestPath: invalidManifestPath }), /key/);
    assert.equal(existsSync(path.join(root.repoRoot, ".local", "sidra-agent-bridge")), false);
  });

  it("quotes_codex_executable_directory_without_expanding_shell_characters", () => {
    const root = createInstallerFixture({ codexDirectoryName: 'codex "$`bin' });

    const result = installNativeHosts({ ...root, browser: "chrome" });
    const wrapper = readFileSync(result.wrapperPath, "utf8");

    assert.match(wrapper, /export PATH=".*\\\".*\\\$.*\\`.*":\$PATH/);
  });
});

function writeTemporaryExtensionManifest(manifest) {
  const directory = mkdtempSync(path.join(tmpdir(), "sidra-extension-manifest-"));
  const manifestPath = path.join(directory, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");
  return manifestPath;
}

function createInstallerFixture(options = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "sidra-native-hosts-"));
  const bridgeExecutablePath = path.join(directory, "bridge.js");
  const nodeExecutablePath = path.join(directory, "node");
  const codexExecutablePath = path.join(directory, options.codexDirectoryName ?? "bin", "codex");
  mkdirSync(path.dirname(codexExecutablePath), { recursive: true });
  writeFileSync(bridgeExecutablePath, "console.log('bridge');\n", "utf8");
  writeFileSync(nodeExecutablePath, "", "utf8");
  writeFileSync(codexExecutablePath, "", "utf8");
  return {
    repoRoot: directory,
    workspaceRoot: path.join(directory, "workspace"),
    manifestRoot: path.join(directory, "NativeMessagingRoots"),
    extensionManifestPath,
    bridgeExecutablePath,
    nodeExecutablePath,
    codexExecutablePath
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
