import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  reporter: "list",
  timeout: 30_000,
  use: {
    ...devices["Desktop Chrome"]
  }
});
