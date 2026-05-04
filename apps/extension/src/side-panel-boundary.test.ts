import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
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
});
