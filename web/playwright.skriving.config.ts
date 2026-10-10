import { defineConfig, devices } from "@playwright/test";
import { loadEnv } from "vite";

const E2E_SKRIVING_MODUS = "e2e-skriving";

// Sikkerhetssperre: porten er PÅ i dette bygget, så det skal aldri kunne
// peke mot noe annet enn den lokale emulatoren og et «demo-»-prosjekt.
const env = loadEnv(E2E_SKRIVING_MODUS, import.meta.dirname, "VITE_");
if (
  env.VITE_FIREBASE_USE_EMULATOR !== "true" ||
  !env.VITE_FIREBASE_PROJECT_ID?.startsWith("demo-") ||
  !env.VITE_FIREBASE_DATABASE_URL?.startsWith("http://127.0.0.1:")
) {
  throw new Error(
    "test:e2e:skriving: .env.e2e-skriving må peke mot emulatoren (VITE_FIREBASE_USE_EMULATOR=true, demo-prosjekt, 127.0.0.1).",
  );
}

/**
 * E2E med forsoningsporten PÅ (§Issue #34, pre-cutover 3). Kjøres med
 * `npm run test:e2e:skriving`, KUN mot Firebase-emulatoren — aldri mot en
 * Hosting-forhåndsvisning eller produksjon.
 *
 * Appen bygges med `--mode e2e-skriving` (miljø fra `.env.e2e-skriving`,
 * som bare peker på emulatoren). Den modusen er den eneste veien til porten,
 * se `src/hooks/forsoningAktivering.ts`. Bygget går til en egen mappe og
 * serveres på en egen port, så det aldri kan forveksles med `dist`.
 *
 * Testene skriver via React-UI-et og leser resultatet rett fra emulatoren
 * med firebase-admin, for å verifisere at nodene forblir legacy-arrays.
 */
export default defineConfig({
  testDir: "./e2e-skriving",
  globalSetup: "./e2e/global-setup.ts",
  // Testene deler familie-noden i emulatoren og seeder den selv.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // I CI skriver «github»-reporteren feilmeldingen som annotasjon på
  // check-runen, så en rød E2E kan diagnostiseres uten å laste ned loggen.
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
  },
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
  webServer: {
    command:
      "npx tsc -b && npx vite build --mode e2e-skriving --outDir dist-e2e-skriving && npx vite preview --host 127.0.0.1 --port 4174 --outDir dist-e2e-skriving",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
