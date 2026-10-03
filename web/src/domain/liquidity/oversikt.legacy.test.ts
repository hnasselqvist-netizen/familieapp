/**
 * Differensiell karakterisering av Spillerom-dashbordet (§Issue #34,
 * pre-cutover 1): beregningsblokken i legacy `ForvaltningScreen`
 * (`const liq = …` frem til `NivaKort`) og kontantflyt-motoren trekkes ut
 * ORDRETT fra `index.html` (kun lesing) og kjøres side om side med
 * `oversikt.ts` på samme data og klokke.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { Liquidity, LiquidityPost } from "@app-types/liquidity";
import { loadLegacy } from "../../test/legacy";
import {
  type Niva,
  budsjettPerNiva,
  calculateCommittedCashflow,
  finnNesteStorreUtbetaling,
  spilleromOversikt,
} from "./oversikt";

const NAA = "2026-10-03T09:00:00.000Z";
const IDAG = "2026-10-03";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NAA));
});
afterAll(() => vi.useRealTimers());

const SRC = readFileSync(path.resolve(import.meta.dirname, "../../../../index.html"), "utf8");
/** Legacy-dashbordets beregningsblokk, frem til `NivaKort`-komponenten. */
const BLOKK = (() => {
  const start = SRC.indexOf("  const liq = liquidity||{};");
  const slutt = SRC.indexOf("  const NivaKort = ", start);
  if (start < 0 || slutt < 0) throw new Error("Fant ikke dashbordblokken i legacy");
  return SRC.slice(start, slutt);
})();

type AnyFn = (...args: unknown[]) => unknown;
const legacy = loadLegacy<Record<string, AnyFn>>({
  functions: ["calcSpillerom", "calculateCommittedCashflow", "finnNesteStorreUtbetaling"],
});

function legacyDashbord(liquidity: unknown, budgetGroups: unknown, month: number) {
  return new Function(
    "liquidity",
    "budgetGroups",
    "month",
    "calcSpillerom",
    "finnNesteStorreUtbetaling",
    `"use strict";\n${BLOKK}\nreturn { saldo, harSaldo, harPoster, bundet, spillerom, muligheter, nesteUtbetaling, totalMonth };`,
  )(
    liquidity,
    budgetGroups,
    month,
    legacy.calcSpillerom,
    legacy.finnNesteStorreUtbetaling,
  ) as Record<string, unknown> & { totalMonth: (n: string) => number };
}

// ── Fixtures ────────────────────────────────────────────────────────
const mnd = (budget: number, unntak: Record<number, number> = {}) =>
  Array.from({ length: 12 }, (_, i) => ({ budget: unntak[i] ?? budget, spent: 0 }));
const grupper: BudsjettGruppe[][] = [
  [],
  [
    {
      id: "bolig",
      label: "Bolig",
      items: [
        { id: "husleie", name: "Husleie", months: mnd(12000), meta: { niva: "beskytte" } },
        {
          id: "forsikring",
          name: "Forsikring hus",
          months: mnd(0, { 10: 8400 }),
          meta: { niva: "beskytte", paymentPattern: "yearly" },
        },
        {
          id: "kommunale",
          name: "Kommunale avgifter",
          months: mnd(0, { 9: 3100, 0: 3100 }),
          meta: { paymentPattern: "quarterly" },
        },
        {
          // Samme beløp i januar som «Kommunale avgifter» — den første vinner.
          id: "renovasjon",
          name: "Renovasjon",
          months: mnd(0, { 0: 3100 }),
          meta: { paymentPattern: "quarterly" },
        },
      ],
    },
    {
      id: "mat",
      label: "Mat",
      items: [
        { id: "dagligvarer", name: "Dagligvarer", months: mnd(9000) },
        { id: "gammel", name: "Gammel modell", months: mnd(500), meta: { niva: "nodvendig" } },
        { id: "valgfritt", name: "Valgfritt", months: mnd(250), meta: { niva: "valgfritt" } },
        { id: "restaurant", name: "Restaurant", months: mnd(1500), meta: { niva: "velge" } },
        {
          id: "ferie",
          name: "Ferie",
          months: mnd(0, { 11: 20000 }),
          meta: { niva: "velge", paymentPattern: "custom" },
        },
        { id: "uten-months", name: "Uten måneder", months: undefined as never },
      ],
    },
  ],
];

const post = (id: string, o: Partial<LiquidityPost>): LiquidityPost =>
  ({ id, name: id, amount: 0, direction: "out", date: "2026-10-10", ...o }) as LiquidityPost;
const likviditeter: (Partial<Liquidity> | null)[] = [
  null,
  {},
  { saldo: 0, posts: {} },
  { saldo: 52000, prognosisDate: "2026-10-25", posts: {} },
  {
    saldo: 52000,
    prognosisDate: "2026-10-25",
    posts: {
      lonn: post("lonn", { direction: "in", amount: 41000, date: "2026-10-20" }),
      husleie: post("husleie", { amount: 12000, date: "2026-10-05" }),
      etter: post("etter", { amount: 999, date: "2026-11-02" }), // etter prognosedato
      foer: post("foer", { amount: 777, date: "2026-10-01" }), // før i dag
      udatert: post("udatert", { amount: 5, date: "" }),
      tekst: post("tekst", { amount: "1500.5" as never, date: "2026-10-15" }),
    },
  },
  {
    saldo: "3000" as never,
    posts: { stor: post("stor", { amount: 9000, date: "2026-10-04" }) }, // uten prognosedato → i dag
  },
  { saldo: "2500 kr" as never, posts: {} }, // parseFloat leser tallet foran teksten
  {
    saldo: 9000,
    prognosisDate: "2026-10-31",
    posts: { liten: post("liten", { amount: 100, date: "2026-10-03" }) }, // i dag teller med
  },
];

describe("Spillerom-dashbordet ≡ legacy ForvaltningScreen", () => {
  it("beslutningskort og muligheter for alle likviditetstilstander", () => {
    for (const liq of likviditeter) {
      const L = legacyDashbord(liq, grupper[1], 9);
      const p = spilleromOversikt(liq, IDAG);
      expect(p, JSON.stringify(liq)).toEqual({
        saldo: L.saldo,
        harSaldo: L.harSaldo,
        harPoster: L.harPoster,
        bundet: L.bundet,
        spillerom: L.spillerom,
        muligheter: L.muligheter,
      });
    }
  });

  it("dekker alle fire muligheter og begge typer", () => {
    const tekster = new Set(
      likviditeter.flatMap((l) => spilleromOversikt(l, IDAG).muligheter.map((m) => m.tekst)),
    );
    expect(tekster.size).toBe(4);
  });

  it("neste større utbetaling og kontantflyt for alle måneder", () => {
    for (const g of grupper) {
      for (let m = 0; m < 12; m++) {
        expect(finnNesteStorreUtbetaling(g, m), `måned ${m}`).toEqual(
          legacyDashbord(null, g, m).nesteUtbetaling,
        );
        expect(calculateCommittedCashflow(g, m)).toEqual(legacy.calculateCommittedCashflow!(g, m));
      }
    }
  });

  it("fordeling per nivå (inkl. gammel modell og uten nivå) for alle måneder", () => {
    for (const g of grupper) {
      for (let m = 0; m < 12; m++) {
        const L = legacyDashbord(null, g, m);
        for (const niva of ["beskytte", "opprettholde", "velge"] as Niva[]) {
          expect(budsjettPerNiva(g, niva, m), `${niva} ${m}`).toBe(L.totalMonth(niva));
        }
      }
    }
  });

  it("låst: månedlige poster er aldri «større utbetaling»; størst i første måned vinner", () => {
    expect(finnNesteStorreUtbetaling(grupper[1], 9)).toEqual({
      maanedIndex: 9,
      navn: "Kommunale avgifter",
      belop: 3100,
    });
    expect(finnNesteStorreUtbetaling(grupper[1], 10)).toEqual({
      maanedIndex: 10,
      navn: "Forsikring hus",
      belop: 8400,
    });
    expect(finnNesteStorreUtbetaling([], 0)).toBeNull();
  });
});
