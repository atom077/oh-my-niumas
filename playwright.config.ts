import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4318",
    headless: true,
    viewport: { width: 1440, height: 1000 },
    launchOptions: {
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    },
    screenshot: "only-on-failure",
  },
  webServer: {
    command:
      "PORT=4318 NIUMAS_LOG_ROOT=fixtures/import-smoke NIUMAS_DB_PATH=.local/e2e.sqlite node --import tsx app/server.ts",
    url: "http://127.0.0.1:4318/api/analysis",
    reuseExistingServer: false,
  },
});
