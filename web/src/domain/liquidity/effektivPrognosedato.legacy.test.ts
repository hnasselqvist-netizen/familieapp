/**
 * Legacy-H (#59, ordre 6679393283): legacy-dashbordet, legacy-Spillerom og
 * legacy-generatoren bruker samme effektive prognosedato som React (#116).
 * `effektivPrognosedato` og standardregelen trekkes ut ORDRETT fra
 * `index.html` og kjøres side om side med web-porten. Kalenderforventninger,
 * så testene gjelder i både UTC og Europe/Oslo (`npm run test:tz-oslo`).
 * Syntetiske data, ingen skriving.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadLegacy } from "../../test/legacy";
import { effektivPrognosedato } from "./liquidity";

type Effektiv = (lagret: unknown, naa: Date) => { dato: string; standard: boolean };
const legacy = loadLegacy<{ effektivPrognosedato: Effektiv }>({
  functions: ["lokalKalenderdato", "beregnStandardPrognosisDate", "effektivPrognosedato"],
});
const SRC = readFileSync(path.resolve(import.meta.dirname, "../../../../index.html"), "utf8");

describe("legacy effektivPrognosedato ≡ web", () => {
  it.each([
    ["19. kl. 23:59", new Date(2026, 10, 19, 23, 59), "2026-11-20"],
    ["20. ved lokal midnatt", new Date(2026, 10, 20, 0, 0), "2026-12-20"],
    ["20. kl. 00:30 (UTC: fortsatt 19.)", new Date(2026, 10, 20, 0, 30), "2026-12-20"],
    ["21.", new Date(2026, 10, 21, 8, 0), "2026-12-20"],
    ["månedsskifte 31. okt. 23:30", new Date(2026, 9, 31, 23, 30), "2026-11-20"],
    ["1. nov. rett etter midnatt", new Date(2026, 10, 1, 0, 5), "2026-11-20"],
    ["årsskifte 21. des.", new Date(2026, 11, 21, 9, 0), "2027-01-20"],
  ])("uten lagret dato, %s → %s, merket standard", (_n, naa, forventet) => {
    for (const lagret of [undefined, null, ""]) {
      expect(legacy.effektivPrognosedato(lagret, naa)).toEqual({ dato: forventet, standard: true });
      expect(legacy.effektivPrognosedato(lagret, naa)).toEqual(
        effektivPrognosedato(lagret as string | null | undefined, naa),
      );
    }
  });

  it("lagret dato gjelder, også passert, og er ikke merket standard", () => {
    const naa = new Date(2026, 10, 25, 10);
    for (const lagret of ["2026-12-05", "2026-08-31", "2026-11-25"]) {
      expect(legacy.effektivPrognosedato(lagret, naa)).toEqual({ dato: lagret, standard: false });
      expect(legacy.effektivPrognosedato(lagret, naa)).toEqual(effektivPrognosedato(lagret, naa));
    }
  });
});

describe("én regel i legacy: dashbord, Spillerom og generator", () => {
  it("dashbordet bruker effektiv dato, ikke «i dag» (UTC)", () => {
    expect(SRC).toContain("const progEff = effektivPrognosedato(liq.prognosisDate, new Date());");
    expect(SRC).not.toContain("liq.prognosisDate||new Date().toISOString()");
  });

  it("Spillerom: også tom lagret dato gir standard (ingen destrukturerings-default)", () => {
    expect(SRC).toContain(
      "const prognose = effektivPrognosedato(lagretPrognosisDate, new Date());",
    );
    expect(SRC).not.toContain("prognosisDate = beregnStandardPrognosisDate(new Date()),");
  });

  it("generatoren bruker samme regel for tilDato", () => {
    expect(SRC).toContain(
      "const tilDato = new Date(effektivPrognosedato(prev && prev.prognosisDate, new Date()).dato);",
    );
    // standardregelen kalles bare via effektivPrognosedato
    expect(SRC.match(/beregnStandardPrognosisDate\(/g)).toHaveLength(2); // definisjon + én bruk
  });

  it("OK uten endring av standarddato lagrer ikke", () => {
    expect(SRC).toContain(
      "if(!(prognose.standard && dateInput===prognosisDate)) save({prognosisDate:dateInput});",
    );
  });
});
