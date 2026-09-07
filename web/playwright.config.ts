import { defineConfig, devices } from "@playwright/test";

/**
 * E2E/smoke-tester. Kjører KUN mot en app bygget med
 * VITE_FIREBASE_USE_EMULATOR=true, servert lokalt av `vite preview` —
 * aldri mot en Hosting-forhåndsvisning eller produksjon
 * (§arkitekturbeslutning: preview vs. produksjonsdata). `webServer`
 * under starter selv den emulator-bakte appen; testen forutsetter at
 * Firebase Emulator Suite allerede kjører ved siden av (se
 * package.json sitt `test:e2e`-oppsett i CI, eller kjør
 * `npm run emulators` i et eget vindu lokalt).
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Valgfri override for miljøer med en forhåndsinstallert Chromium
        // på en fast sti (f.eks. dette sandkasse-miljøet) i stedet for
        // Playwright sin egen nedlastede browser. Umodifisert i vanlig
        // CI/lokalt, der `npx playwright install` styrer dette normalt.
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
          ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
          : undefined,
      },
    },
  ],
  webServer: {
    // --mode test laster .env.test (VITE_FIREBASE_USE_EMULATOR=true er satt
    // der) INN I selve byggetidspunktet — en env-variabel satt på
    // `preview`-prosessen ville vært for sent, siden Vite bytter ut
    // import.meta.env.* ved bygg, ikke ved kjøretid.
    command: "npm run build -- --mode test && npm run preview -- --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    // Rotårsak til at dette timet ut i GitHub Actions (fungerte lokalt):
    // `vite preview` uten en eksplisitt --host bandt seg til det OS-avhengige
    // resultatet av "localhost" — på GitHub Actions sin ubuntu-runner
    // resolver det annerledes enn i utviklingsmiljøet dette ble bygget i,
    // slik at serveren kjørte og logget klar, men aldri ble nåbar på
    // 127.0.0.1 — nøyaktig adressen Playwright pollet mot her. Fikset i
    // package.json sitt `preview`-script (`--host 127.0.0.1`), som fjerner
    // tvetydigheten helt i stedet for å gjette på riktig OS-oppførsel.
    // Timeout økt fra standard 60s til 90s som et bevisst sikkerhetsmarginer
    // for et kaldt CI-bygg (ingen varm Vite/TS-cache) — IKKE hovedfiksen.
    timeout: 90_000,
  },
});
