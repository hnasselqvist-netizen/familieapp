/**
 * Funn H (#59, ordre 6669823460): uten lagret prognosedato bruker
 * React-Spillerom samme standarddato som generatoren. Kalender-
 * forventninger, så testene gjelder i både UTC og Europe/Oslo
 * (`npm run test:tz-oslo`). Syntetiske data.
 */
import { describe, expect, it } from "vitest";
import type { ForecastGroup, LiquidityPost } from "@app-types/liquidity";
import {
  beregnStandardPrognosisDate,
  calcSpillerom,
  effektivPrognosedato,
  erAktivPrognosepost,
  erPrognosedatoPassert,
  erPrognosepostIPeriode,
  generateForecastPosts,
} from "./liquidity";

describe("effektivPrognosedato", () => {
  it.each([
    ["19. kl. 23:59", new Date(2026, 10, 19, 23, 59), "2026-11-20"],
    ["20. ved lokal midnatt", new Date(2026, 10, 20, 0, 0), "2026-12-20"],
    ["20. kl. 12", new Date(2026, 10, 20, 12, 0), "2026-12-20"],
    ["21.", new Date(2026, 10, 21, 8, 0), "2026-12-20"],
    ["månedsskifte 31. okt.", new Date(2026, 9, 31, 23, 30), "2026-11-20"],
    ["årsskifte 21. des.", new Date(2026, 11, 21, 9, 0), "2027-01-20"],
    ["1. jan. rett etter midnatt", new Date(2027, 0, 1, 0, 5), "2027-01-20"],
  ])("uten lagret dato, %s → %s (= generatorens standard)", (_n, naa, forventet) => {
    expect(effektivPrognosedato("", naa)).toEqual({ dato: forventet, standard: true });
    expect(effektivPrognosedato(undefined, naa).dato).toBe(beregnStandardPrognosisDate(naa));
    expect(effektivPrognosedato(null, naa).dato).toBe(forventet);
  });

  it("lagret dato respekteres alltid, også passert", () => {
    const naa = new Date(2026, 10, 25, 10);
    expect(effektivPrognosedato("2026-12-05", naa)).toEqual({
      dato: "2026-12-05",
      standard: false,
    });
    expect(effektivPrognosedato("2026-08-31", naa)).toEqual({
      dato: "2026-08-31",
      standard: false,
    });
    expect(erPrognosedatoPassert("2026-08-31", naa)).toBe(true);
    // Standarddatoen er aldri passert.
    expect(erPrognosedatoPassert(effektivPrognosedato("", naa).dato, naa)).toBe(false);
  });
});

describe("tom dato: samme periode og tall som generatoren", () => {
  const tolv = (b: number) => Array.from({ length: 12 }, () => ({ budget: b, spent: 0 }));
  const kilde = (id: string, dag: string, b: number) => ({
    id,
    name: id,
    meta: { automatisk: true, forfallsdag: dag, oppforsel: "fast" },
    months: tolv(b),
  });
  const g = (...items: ReturnType<typeof kilde>[]) =>
    [{ id: "bolig", label: "Bolig", items }] as unknown as ForecastGroup[];

  it.each([
    ["10. nov.", new Date(2026, 10, 10, 9), "2026-11-20"],
    ["21. des. (årsskifte)", new Date(2026, 11, 21, 9), "2027-01-20"],
  ])(
    "%s: genererte poster til og med standarddatoen telles; manuell etter grensen gjør ikke",
    (_n, naa, std) => {
      const startIdag = new Date(naa);
      startIdag.setHours(0, 0, 0, 0);
      const manuellInne: LiquidityPost = {
        id: "m1",
        name: "Manuell",
        amount: 7,
        direction: "out",
        date: std,
        type: "extra",
        kilde: "manuell",
      };
      const manuellEtter: LiquidityPost = {
        ...manuellInne,
        id: "m2",
        amount: 1000,
        date: "2027-02-01",
      };
      const overstyrt: LiquidityPost = {
        id: "ov",
        name: "x",
        amount: 150,
        direction: "out",
        date: std,
        type: "fast",
        kilde: "generator",
        manueltOverstyrt: true,
        sourceType: "kostnader",
        sourceBudgetItemId: "x",
        sourceBudgetGroupId: "bolig",
        _genKey: `x_${std.slice(0, 4)}_${Number(std.slice(5, 7)) - 1}_20`,
      };
      // Som useLiquidity.regenerate: fra = nå, til = effektiv dato.
      const til = effektivPrognosedato("", naa).dato;
      expect(til).toBe(std);
      const poster = Object.values(
        generateForecastPosts(
          g(kilde("x", "20", 100), kilde("y", "15", 10)),
          { m1: manuellInne, m2: manuellEtter, ov: overstyrt },
          naa,
          new Date(til),
          [],
          [],
          () => `gen-${Math.random()}`,
        ),
      );
      expect(poster.find((p) => p.id === "ov")).toEqual(overstyrt);
      expect(poster.find((p) => p.id === "m2")).toEqual(manuellEtter);
      const genererte = poster.filter((p) => p.kilde === "generator" && !p.manueltOverstyrt);
      expect(genererte.length).toBeGreaterThan(0);
      // Som SpilleromScreen: periodefilter og totaler mot samme effektive dato.
      const iPeriode = poster.filter(
        (p) => erAktivPrognosepost(p) && erPrognosepostIPeriode(p, startIdag, til),
      );
      for (const p of genererte) expect(iPeriode).toContain(p);
      expect(iPeriode).toContain(manuellInne);
      expect(iPeriode).toContain(overstyrt);
      expect(iPeriode).not.toContain(manuellEtter);
      const forventetUt = [...genererte, manuellInne, overstyrt].reduce((s, p) => s + p.amount, 0);
      expect(calcSpillerom(5000, iPeriode, til, startIdag).utbetalinger).toBe(forventetUt);
      // Den gamle rå tomme verdien ga en tom periode (funn H).
      expect(poster.filter((p) => erPrognosepostIPeriode(p, startIdag, ""))).toEqual([]);
    },
  );
});
