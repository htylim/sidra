import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
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
  it("keeps side-panel.tsx free of bridge/session-client imports", () => {
    const source = readSource("./side-panel.tsx");

    expect(source).not.toContain("./bridge/session-client");
    expect(source).not.toContain("BridgeSessionClient");
  });

  it("keeps side-panel view files free of chrome runtime usage", () => {
    const source = readSource("./side-panel-view.tsx");

    expect(source).not.toContain("chrome.");
    expect(source).not.toContain("connectNative");
  });

  it("creates Chrome-backed dependencies only through the controller composition factory", () => {
    const source = readSource("./side-panel.tsx");

    expect(source).toContain("createChromeSidePanelController");
    expect(source).not.toContain("chrome.runtime");
    expect(source).not.toContain("connectNative");
  });

  it("keeps bridge availability decisions out of the React entry point", () => {
    const entrySource = readSource("./side-panel.tsx");
    const viewSource = readSource("./side-panel-view.tsx");

    expect(entrySource).toContain("createChromeSidePanelController");
    expect(entrySource).not.toContain("BridgeConnection");
    expect(entrySource).not.toContain("./bridge/connection");
    expect(viewSource).not.toContain("snapshot.bridge.connected ?");
    expect(viewSource).not.toContain("snapshot.bridge.ready ?");
  });
});

describe("side panel New Chat wiring", () => {
  it("passes controller.newChat into the New Chat button path", () => {
    const sidePanelSource = readSource("./side-panel.tsx");
    const viewSource = readSource("./side-panel-view.tsx");

    expect(sidePanelSource).toContain("onNewChat={sidePanelController.newChat}");
    expect(viewSource).toContain("onNewChat(): void");
    expect(viewSource).toContain('aria-label="New chat"');
    expect(viewSource).toContain("onClick={props.onNewChat}");
  });

  it("passes_controller_updateCaptureMode_into_the_prompt_options_path", () => {
    const sidePanelSource = readSource("./side-panel.tsx");
    const viewSource = readSource("./side-panel-view.tsx");

    expect(sidePanelSource).toContain("onCaptureModeChange={sidePanelController.updateCaptureMode}");
    expect(viewSource).toContain("onCaptureModeChange(captureMode: CaptureMode): void");
    expect(viewSource).toContain('aria-label="Prompt options"');
    expect(viewSource).toContain("Send Full DOM");
  });

  it("passes_controller_quick_action_and_settings_commands_into_the_view", () => {
    const sidePanelSource = readSource("./side-panel.tsx");
    const viewSource = readSource("./side-panel-view.tsx");

    expect(sidePanelSource).toContain("onQuickAction={sidePanelController.sendQuickAction}");
    expect(sidePanelSource).toContain("onOpenSettings={sidePanelController.openSettings}");
    expect(viewSource).toContain("onQuickAction(actionId: string)");
    expect(viewSource).toContain("onOpenSettings(): void");
  });

  it("keeps_quick_action_settings_storage_and_prompts_out_of_the_react_view", () => {
    const viewSource = readSource("./side-panel-view.tsx");

    expect(viewSource).not.toContain("DEFAULT_SUMMARIZE_PAGE_QUICK_ACTION_PROMPT");
    expect(viewSource).not.toContain("chrome.storage");
    expect(viewSource).not.toContain("SIDRA_SETTINGS_STORAGE_KEY");
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
