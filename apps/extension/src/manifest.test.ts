import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("extension manifest", () => {
  it("declares the MV3 side-panel and native-messaging permissions needed for V1", () => {
    const manifestPath = fileURLToPath(new URL("../public/manifest.json", import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      manifest_version: number;
      permissions: string[];
      side_panel?: { default_path?: string };
      options_ui?: { page?: string; open_in_tab?: boolean };
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.side_panel?.default_path).toBe("side-panel.html");
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(["sidePanel", "nativeMessaging", "storage", "tabs", "scripting"])
    );
  });

  it("declares_the_extension_options_page", () => {
    const manifestPath = fileURLToPath(new URL("../public/manifest.json", import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      options_ui?: { page?: string; open_in_tab?: boolean };
    };

    expect(manifest.options_ui).toEqual({
      page: "options.html",
      open_in_tab: true
    });
  });
});
