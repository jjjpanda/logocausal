import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react()],
  define: mode === "component" ? { "process.env.NODE_ENV": JSON.stringify("production") } : {},
  build: mode === "component" ? {
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL("./src/element.tsx", import.meta.url)),
      formats: ["es"],
      fileName: () => "logocausal.js",
    },
  } : {
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL("./index.html", import.meta.url)),
        embed: fileURLToPath(new URL("./embed/index.html", import.meta.url)),
      },
    },
  },
  test: { include: ["src/**/*.test.ts"] },
}));
