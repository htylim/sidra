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
  minimum_chrome_version?: string;
  permissions: string[];
  host_permissions?: string[];
  side_panel?: { default_path?: string };
  action?: { default_title?: string };
  background?: { service_worker?: string; type?: string };
  options_ui?: { page?: string; open_in_tab?: boolean };
};

function readManifest(): ExtensionManifest {
  const manifestPath = fileURLToPath(new URL("../public/manifest.json", import.meta.url));
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
}

describe("extension manifest", () => {
  it("declares the MV3 extension permissions needed for V1", () => {
    const manifest = readManifest();

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(["sidePanel", "nativeMessaging", "storage", "tabs", "scripting"])
    );
  });

  it("declares_the_side_panel_api_chromium_floor", () => {
    const manifest = readManifest();

    expect(manifest.minimum_chrome_version).toBe("114");
  });

  it("does_not_declare_a_global_side_panel_default_path", () => {
    const manifest = readManifest();

    expect(manifest.side_panel).toBeUndefined();
  });

  it("keeps_side_panel_permission_and_toolbar_action", () => {
    const manifest = readManifest();

    expect(manifest.permissions).toEqual(expect.arrayContaining(["sidePanel"]));
    expect(manifest.action).toEqual({ default_title: "Sidra" });
  });

  it("declares_background_service_worker_for_visibility_controller", () => {
    const manifest = readManifest();

    expect(manifest.background).toEqual({
      service_worker: "background.js",
      type: "module"
    });
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

  it("documents_capture_visible_tab_permission_matrix", () => {
    const manifest = readManifest();
    const captureVisibleTabPermissionMatrix = [
      {
        pageKind: "normal http and https page",
        requiredManifestGrant: "<all_urls>",
        activeTabRequired: false
      },
      {
        pageKind: "browser, extension, and restricted pages",
        requiredManifestGrant: "browser blocks capture",
        activeTabRequired: false
      },
      {
        pageKind: "file URL",
        requiredManifestGrant: "browser file access setting",
        activeTabRequired: false
      }
    ];

    expect(manifest.permissions).toEqual(expect.arrayContaining(["tabs", "scripting"]));
    expect(manifest.host_permissions).toEqual(["<all_urls>"]);
    expect(captureVisibleTabPermissionMatrix).toContainEqual({
      pageKind: "normal http and https page",
      requiredManifestGrant: "<all_urls>",
      activeTabRequired: false
    });
  });

  it("keeps_normal_page_snapshot_capture_without_active_tab_permission", () => {
    const manifest = readManifest();

    expect(manifest.permissions).not.toContain("activeTab");
    expect(manifest.host_permissions).toContain("<all_urls>");
  });
});
