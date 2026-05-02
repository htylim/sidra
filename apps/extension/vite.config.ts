import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@sidra/protocol": fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url))
    }
  },
  build: {
    rollupOptions: {
      input: {
        sidePanel: fileURLToPath(new URL("side-panel.html", import.meta.url))
      }
    }
  }
});
