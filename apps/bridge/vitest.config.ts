import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@sidra/protocol": fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url))
    }
  },
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**"]
  }
});
