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
        sidePanel: fileURLToPath(new URL("side-panel.html", import.meta.url)),
        options: fileURLToPath(new URL("options.html", import.meta.url)),
        background: fileURLToPath(new URL("src/background.ts", import.meta.url))
      },
      output: {
        entryFileNames: (chunkInfo) =>
          chunkInfo.name === "background" ? "background.js" : "assets/[name]-[hash].js"
      }
    }
  }
});
