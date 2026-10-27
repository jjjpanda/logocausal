import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    acceptDownloads: true,
    trace: "retain-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      downloadsPath: path.resolve("test-results/downloads"),
    },
  },
  webServer: [
    {
      command: "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4174 --strictPort --base /logocausal/",
      url: "http://127.0.0.1:4174/logocausal/",
      reuseExistingServer: !process.env.CI,
    },
  ],
});
