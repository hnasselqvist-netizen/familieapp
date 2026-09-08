/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * `finnNesteTorsdag`/`beregnPlanperiode`/`beregnAktivPlanperiode`
 * (index.html linje ~842–902) slik den er lest og verifisert manuelt
 * mot koden FØR noe ble flyttet. Datoene under er valgt slik at
 * 2026-09-07 er en mandag (samme referansepunkt som
 * §domain/shared/weekKey.test.ts).
 */
import { describe, expect, it } from "vitest";
import { beregnAktivPlanperiode, beregnPlanperiode, finnNesteTorsdag } from "./planningPeriod";

describe("finnNesteTorsdag", () => {
  it("returnerer samme dato når datoen selv er en torsdag", () => {
    const torsdag = new Date(2026, 8, 10); // torsdag
    expect(finnNesteTorsdag(torsdag)).toEqual(new Date(2026, 8, 10));
  });

  it("finner nærmeste torsdag fremover fra en tirsdag", () => {
    const tirsdag = new Date(2026, 8, 8);
    expect(finnNesteTorsdag(tirsdag)).toEqual(new Date(2026, 8, 10));
  });

  it("hopper til NESTE ukes torsdag når torsdagen denne uken allerede er passert", () => {
    const fredag = new Date(2026, 8, 11); // dagen etter torsdag 10.
    expect(finnNesteTorsdag(fredag)).toEqual(new Date(2026, 8, 17));
  });
});

describe("beregnPlanperiode", () => {
  it("gir 8 dager fra en torsdag til og med neste torsdag", () => {
    const dager = beregnPlanperiode(new Date(2026, 8, 10));
    expect(dager).toHaveLength(8);
    expect(dager[0]?.dato).toEqual(new Date(2026, 8, 10));
    expect(dager[0]?.dayKey).toBe("Thu");
    expect(dager[7]?.dato).toEqual(new Date(2026, 8, 17));
    expect(dager[7]?.dayKey).toBe("Thu");
  });

  it("mapper hver dag til riktig weekKey/dayKey", () => {
    const dager = beregnPlanperiode(new Date(2026, 8, 10));
    expect(dager.map((d) => d.dayKey)).toEqual([
      "Thu",
      "Fri",
      "Sat",
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
    ]);
    // Perioden krysser en Firebase-uke (søndag→mandag): siste 4 dager har en annen weekKey.
    expect(dager[3]?.weekKey).not.toBe(dager[4]?.weekKey);
  });
});

describe("beregnAktivPlanperiode", () => {
  it("bruker beregnPlanperiode uendret når fraDato selv er en torsdag", () => {
    const dager = beregnAktivPlanperiode(new Date(2026, 8, 10));
    expect(dager).toHaveLength(8);
    expect(dager[0]?.dato).toEqual(new Date(2026, 8, 10));
  });

  it("bygger en kortere periode (ingen dag hoppet over) når fraDato ikke er en torsdag", () => {
    const dager = beregnAktivPlanperiode(new Date(2026, 8, 8)); // tirsdag
    expect(dager).toHaveLength(3);
    expect(dager.map((d) => d.dato)).toEqual([
      new Date(2026, 8, 8),
      new Date(2026, 8, 9),
      new Date(2026, 8, 10),
    ]);
  });

  it("kan ha kun 1 dag når fraDato er torsdagen selv sett fra dagen før neste beregning", () => {
    const dager = beregnAktivPlanperiode(new Date(2026, 8, 11)); // fredag, rett etter torsdag
    expect(dager[0]?.dato).toEqual(new Date(2026, 8, 11));
    expect(dager[dager.length - 1]?.dato).toEqual(new Date(2026, 8, 17));
  });
});
