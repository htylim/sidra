import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

function moduleSpecifiers(relativePath: string): string[] {
  const source = readSource(relativePath);
  const specifierMatches = source.matchAll(
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  );
  return Array.from(specifierMatches).map((match) => match[1] ?? match[2] ?? "");
}

function importsBridgeModule(specifier: string): boolean {
  return specifier === "./bridge" || specifier.startsWith("./bridge/");
}

function sidePanelViewSourceFiles(): string[] {
  return ["./side-panel-view.tsx", "./transcript-view.tsx", "./assistant-markdown.tsx"];
}

function productionSourceFiles(relativeDirectory = "."): string[] {
  const directoryUrl = new URL(relativeDirectory, import.meta.url);
  return readdirSync(fileURLToPath(directoryUrl), { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    if (entry.isDirectory()) return productionSourceFiles(relativePath);
    if (!entry.isFile()) return [];
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) return [];
    if (entry.name === "chrome.d.ts") return [];
    return [relativePath];
  });
}

describe("side panel architecture boundary", () => {
  it("keeps_the_react_entry_point_composed_through_the_controller_boundary", () => {
    const imports = moduleSpecifiers("./side-panel.tsx");

    expect(imports).toContain("./side-panel-controller");
    expect(imports).toContain("./side-panel-view");
    expect(imports.some(importsBridgeModule)).toBe(false);
  });

  it("keeps side-panel view files free of chrome runtime usage", () => {
    const sources = sidePanelViewSourceFiles().map((relativePath) => readSource(relativePath));

    expect(sources.some((source) => source.includes("chrome."))).toBe(false);
    expect(sources.some((source) => source.includes("connectNative"))).toBe(false);
  });

  it("creates Chrome-backed dependencies only through the controller composition factory", () => {
    const source = readSource("./side-panel.tsx");

    expect(source).toContain("createChromeSidePanelController");
    expect(source).not.toContain("chrome.runtime");
    expect(source).not.toContain("connectNative");
  });

  it("keeps bridge availability decisions out of the React entry point", () => {
    const imports = moduleSpecifiers("./side-panel.tsx");

    expect(imports).toContain("./side-panel-controller");
    expect(imports.some(importsBridgeModule)).toBe(false);
  });

  it("keeps_raw_bridge_readiness_decisions_out_of_side_panel_view_files", () => {
    const sources = sidePanelViewSourceFiles().map((relativePath) => readSource(relativePath));

    expect(sources.some((source) => source.includes("snapshot.bridge.connected"))).toBe(false);
    expect(sources.some((source) => source.includes("snapshot.bridge.ready"))).toBe(false);
  });
});

describe("side panel settings and quick-action boundary", () => {
  it("keeps_quick_action_storage_and_prompt_ownership_out_of_the_react_view", () => {
    const viewSource = readSource("./side-panel-view.tsx");
    const imports = moduleSpecifiers("./side-panel-view.tsx");

    expect(imports).not.toContain("./quick-actions");
    expect(imports).not.toContain("./settings-store");
    expect(viewSource).not.toContain("chrome.storage");
  });
});

describe("active page tracking boundary", () => {
  it("does_not_use_scripting_or_page_content_capture_for_page_identity", () => {
    const source = readSource("./active-page.ts");

    expect(source).not.toContain("chrome.scripting");
    expect(source).not.toContain("executeScript");
    expect(source).not.toContain("document.body");
    expect(source).not.toContain("querySelector");
    expect(source).not.toContain("innerText");
    expect(source).not.toContain("Readability");
  });

  it("keeps_active_page_tracker_free_of_scripting_and_content_capture", () => {
    const activePageSource = readSource("./active-page.ts");
    const captureServiceSource = readSource("./capture-service.ts");

    expect(activePageSource).not.toContain("chrome.scripting");
    expect(activePageSource).not.toContain("executeScript");
    expect(activePageSource).not.toContain("document.body");
    expect(activePageSource).not.toContain("innerText");
    expect(captureServiceSource).toContain("CaptureService");
  });

  it("keeps_chrome_scripting_usage_inside_capture_service", () => {
    const activePageSource = readSource("./active-page.ts");
    const captureServiceSource = readSource("./capture-service.ts");
    const controllerSource = readSource("./side-panel-controller.ts");

    expect(activePageSource).not.toContain("chrome.scripting");
    expect(controllerSource).not.toContain("chrome.scripting");
    expect(captureServiceSource).toContain("chrome.scripting");
    expect(captureServiceSource).toContain("executeScript");
  });

  it("keeps_capture_orchestration_out_of_the_react_view", () => {
    const viewSource = readSource("./side-panel-view.tsx");

    expect(viewSource).not.toContain("captureActivePageContext");
    expect(viewSource).not.toContain("CaptureService");
    expect(viewSource).not.toContain("chrome.scripting");
    expect(viewSource).not.toContain("session.send");
  });

  it("keeps_readable_size_policy_inside_capture_service", () => {
    const captureServiceSource = readSource("./capture-service.ts");
    const filesWithReadablePolicy = productionSourceFiles()
      .filter((relativePath) => readSource(relativePath).includes("readableContentLimitCharacters"))
      .sort();

    expect(captureServiceSource).toContain("readableContentLimitCharacters");
    expect(filesWithReadablePolicy).toEqual(["./capture-service.ts", "./settings-store.ts"]);
  });

  it("keeps_dom_size_policy_inside_capture_service", () => {
    const captureServiceSource = readSource("./capture-service.ts");
    const settingsStoreSource = readSource("./settings-store.ts");
    const filesWithDomPolicy = productionSourceFiles()
      .filter((relativePath) => readSource(relativePath).includes("domContentLimitCharacters"))
      .sort();

    expect(captureServiceSource).toContain("domContentLimitCharacters");
    expect(settingsStoreSource).toContain("domContentLimitCharacters");
    expect(filesWithDomPolicy).toEqual(["./capture-service.ts", "./settings-store.ts"]);
  });
});

describe("settings storage boundary", () => {
  it("keeps_runtime_settings_storage_access_inside_settings_store", () => {
    const filesWithStorageAccess = productionSourceFiles()
      .filter((relativePath) => readSource(relativePath).includes("chrome.storage"))
      .sort();

    expect(filesWithStorageAccess).toEqual(["./settings-store.ts"]);
  });
});
