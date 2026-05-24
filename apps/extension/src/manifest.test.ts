import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  deriveChromeExtensionId,
  EXPECTED_DEVELOPMENT_EXTENSION_ID
} from "../../../tools/native-hosts/chrome-extension-id.mjs";

type ExtensionManifest = {
  manifest_version: number;
  key?: string;
  permissions: string[];
  side_panel?: { default_path?: string };
  options_ui?: { page?: string; open_in_tab?: boolean };
};

function readManifest(): ExtensionManifest {
  const manifestPath = fileURLToPath(new URL("../public/manifest.json", import.meta.url));
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
}

describe("extension manifest", () => {
  it("declares the MV3 side-panel and native-messaging permissions needed for V1", () => {
    const manifest = readManifest();

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.side_panel?.default_path).toBe("side-panel.html");
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(["sidePanel", "nativeMessaging", "storage", "tabs", "scripting"])
    );
  });

  it("declares_the_extension_options_page", () => {
    const manifest = readManifest();

    expect(manifest.options_ui).toEqual({
      page: "options.html",
      open_in_tab: true
    });
  });

  it("declares_a_pinned_development_extension_key", () => {
    const manifest = readManifest();

    expect(manifest.key).toEqual(expect.any(String));
    expect(manifest.key?.trim()).toBe(manifest.key);
  });

  it("derives_the_development_extension_id_from_the_manifest_key", () => {
    const manifest = readManifest();

    expect(deriveChromeExtensionId(manifest.key ?? "")).toBe(EXPECTED_DEVELOPMENT_EXTENSION_ID);
  });

  it("derives_chrome_extension_id_from_known_public_key_fixture", () => {
    expect(deriveChromeExtensionId("AQIDBAUGBwgJCgsMDQ4PEA==")).toBe("fnplkloonpdbilpddmajchmednhgdapf");
  });

  it("documents_the_expected_development_extension_id_for_native_host_allowlisting_from_the_derived_id", () => {
    const manifest = readManifest();
    const derivedExtensionId = deriveChromeExtensionId(manifest.key ?? "");

    expect(`chrome-extension://${derivedExtensionId}/`).toBe(
      `chrome-extension://${EXPECTED_DEVELOPMENT_EXTENSION_ID}/`
    );
  });
});
