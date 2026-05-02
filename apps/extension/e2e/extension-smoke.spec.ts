import { chromium, expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const extensionPath = fileURLToPath(new URL("../dist", import.meta.url));

test("loads the Sidra extension and renders the side panel", async ({ browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "Chromium extensions require a Chromium browser");
  expect(existsSync(extensionPath), "extension dist must exist before launching Chromium").toBe(true);

  const userDataDir = testInfo.outputPath("user-data-dir");
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });

  try {
    const serviceWorker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
    const extensionId = new URL(serviceWorker.url()).host;

    expect(extensionId, "extension service worker should expose an extension id").toBeTruthy();

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/side-panel.html`);
    await page.screenshot({ path: testInfo.outputPath("side-panel.png"), fullPage: true });

    await expect(page.getByRole("heading", { name: "Sidra" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ask anything about this page" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Capture + Send" })).toBeVisible();
  } finally {
    await context.close();
  }
});
