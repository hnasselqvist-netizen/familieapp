import { defineConfig, devices } from "@playwright/test";

/**
 * Legacy-QA for overgangsplanen (ADR 0003): den uendrede `index.html` mot
 * Firebase Emulator Suite. `e2e-legacy/server.mjs` serverer bare filen;
 * `e2e-legacy/legacy-harness.ts` leverer CDN-skriptene, kobler Firebase til
 * emulatoren og stenger all annen trafikk.
 * Kjøres med `npm run test:legacy-overgang`.
 */
export default defineConfig({
  testDir: "./e2e-legacy",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  timeout: 90_000,
  use: {
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "node e2e-legacy/server.mjs",
      url: "http://127.0.0.1:4180/",
      reuseExistingServer: !process.env.CI,
    },
    {
      // Foreslått index.html-sperre (ADR 0003-vedlegg) på en midlertidig kopi.
      command:
        "node e2e-legacy/server.mjs --port 4181 --diff ../docs/beslutninger/0003-vedlegg-index-html-sperre.diff",
      url: "http://127.0.0.1:4181/",
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : undefined,
      },
    },
  ],
});
