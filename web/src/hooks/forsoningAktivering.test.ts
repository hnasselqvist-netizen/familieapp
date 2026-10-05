import { describe, expect, it } from "vitest";
import pakke from "../../package.json?raw";
import playwrightKonfig from "../../playwright.config.ts?raw";
import playwrightSkrivingKonfig from "../../playwright.skriving.config.ts?raw";
import kilde from "./forsoningAktivering.ts?raw";
import {
  E2E_SKRIVING_MODUS,
  FORSONING_CUTOVER_GJENNOMFORT,
  forsoningSkrivingAktiv,
} from "./forsoningAktivering";

/**
 * Forsoningsporten (§Issue #34 R3b) er PÅ etter cutover (2026-10-05), styrt
 * av ett kodeflagg. Rollback er å sette flagget til `false`; da er porten
 * igjen AV overalt unntatt i et bygg med modus «e2e-skriving», som bare
 * brukes av `npm run test:e2e:skriving` mot emulatoren. Disse testene låser
 * at det ikke finnes noen annen vei til porten.
 */
describe("forsoningsporten", () => {
  it("er PÅ etter R3b-cutover, også i enhetstester (Vitest-modus «test»)", () => {
    expect(import.meta.env.MODE).toBe("test");
    expect(FORSONING_CUTOVER_GJENNOMFORT).toBe(true);
    expect(forsoningSkrivingAktiv()).toBe(true);
  });

  it("avhenger bare av cutover-flagget og byggmodusen — ingen miljøvariabel, URL eller lagret verdi", () => {
    expect(kilde).toContain("export const FORSONING_CUTOVER_GJENNOMFORT = true;");
    const kropp = kilde.slice(kilde.indexOf("export function forsoningSkrivingAktiv"));
    expect(kropp.slice(0, kropp.indexOf("\n}") + 2)).toBe(
      "export function forsoningSkrivingAktiv(): boolean {\n  return FORSONING_CUTOVER_GJENNOMFORT || import.meta.env.MODE === E2E_SKRIVING_MODUS;\n}",
    );
    expect(E2E_SKRIVING_MODUS).toBe("e2e-skriving");
  });

  it("bare testskriptet og dets Playwright-konfig bygger i modusen", () => {
    const scripts = JSON.parse(pakke).scripts as Record<string, string>;
    const medModus = Object.entries(scripts).filter(
      ([, cmd]) => cmd.includes("e2e-skriving") || cmd.includes("playwright.skriving"),
    );
    expect(medModus.map(([navn]) => navn)).toEqual(["test:e2e:skriving"]);
    expect(Object.values(scripts).some((cmd) => cmd.includes("--mode e2e-skriving"))).toBe(false);
    expect(scripts.build).not.toMatch(/--mode/);
    expect(playwrightSkrivingKonfig).toContain("--mode e2e-skriving");
    expect(playwrightKonfig).not.toContain("e2e-skriving");
  });

  it("testkonfigen nekter å starte uten emulator og demo-prosjekt", () => {
    expect(playwrightSkrivingKonfig).toContain("loadEnv(E2E_SKRIVING_MODUS");
    expect(playwrightSkrivingKonfig).toContain("VITE_FIREBASE_USE_EMULATOR");
  });
});
