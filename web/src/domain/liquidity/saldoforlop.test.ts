import { describe, expect, it } from "vitest";
import type { LiquidityPost } from "@app-types/liquidity";
import { calcSpillerom, erAktivPrognosepost, erPrognosepostIPeriode } from "./liquidity";
import { saldoforlop } from "./saldoforlop";

const post = (id: string, o: Partial<LiquidityPost>): LiquidityPost => ({
  id,
  name: id,
  amount: 0,
  direction: "out",
  date: "2026-10-10",
  type: "fast",
  kilde: "manuell",
  ...o,
});

const FRA = "2026-10-05";
const TIL = "2026-10-25";

describe("saldoforlop", () => {
  it("dag for dag, med løpende saldo og sluttsaldo", () => {
    const f = saldoforlop(
      10000,
      [
        post("strom", { amount: 1800, date: "2026-10-12" }),
        post("husleie", { amount: 12000, date: "2026-10-15" }),
        post("lonn", { amount: 38000, direction: "in", date: "2026-10-20" }),
      ],
      FRA,
      TIL,
    );
    expect(f.dager.map((d) => [d.dato, d.netto, d.saldoEtter])).toEqual([
      ["2026-10-12", -1800, 8200],
      ["2026-10-15", -12000, -3800],
      ["2026-10-20", 38000, 34200],
    ]);
    expect(f.slutt).toBe(34200);
  });

  it("finner laveste punkt selv når spillerommet ved slutten er positivt", () => {
    const f = saldoforlop(
      10000,
      [
        post("husleie", { amount: 12000, date: "2026-10-15" }),
        post("lonn", { amount: 38000, direction: "in", date: "2026-10-20" }),
      ],
      FRA,
      TIL,
    );
    expect(f.laveste).toEqual({ saldo: -2000, dato: "2026-10-15" });
    expect(f.slutt).toBeGreaterThan(0);
  });

  it("laveste punkt er startsaldoen når ingenting trekker den ned", () => {
    const f = saldoforlop(5000, [post("lonn", { amount: 100, direction: "in" })], FRA, TIL);
    expect(f.laveste).toEqual({ saldo: 5000, dato: null });
  });

  it("samme dag: posten tas samlet, rekkefølgen innen dagen avgjør ikke laveste punkt", () => {
    const f = saldoforlop(
      1000,
      [
        post("ut", { amount: 5000, date: "2026-10-20" }),
        post("inn", { amount: 6000, direction: "in", date: "2026-10-20" }),
      ],
      FRA,
      TIL,
    );
    expect(f.dager).toHaveLength(1);
    expect(f.dager[0]!.poster.map((p) => p.id)).toEqual(["ut", "inn"]);
    expect(f.laveste).toEqual({ saldo: 1000, dato: null });
  });

  it("utelater oppfylte poster og poster utenfor perioden, som Spillerom-detaljene", () => {
    const f = saldoforlop(
      1000,
      [
        post("oppfylt", { amount: 500, status: "oppfylt" }),
        post("for", { amount: 500, date: "2026-10-04" }),
        post("etter", { amount: 500, date: "2026-10-26" }),
        post("uten-dato", { amount: 500, date: "" }),
      ],
      FRA,
      TIL,
    );
    expect(f.dager).toEqual([]);
    expect(f.slutt).toBe(1000);
  });

  it("sluttsaldoen er alltid lik calcSpillerom på de aktive postene i perioden", () => {
    const datoer = ["2026-10-04", "2026-10-05", "2026-10-11", "2026-10-25", "2026-10-26", ""];
    const poster: LiquidityPost[] = [];
    let n = 0;
    for (const date of datoer) {
      for (const direction of ["in", "out"] as const) {
        for (const status of [undefined, "aktiv", "oppfylt"] as const) {
          poster.push(post(`p${n++}`, { amount: 100 + n * 37, direction, date, status }));
        }
      }
    }
    const aktive = poster.filter(
      (p) => erAktivPrognosepost(p) && erPrognosepostIPeriode(p, FRA, TIL),
    );
    expect(saldoforlop(4321, poster, FRA, TIL).slutt).toBe(
      calcSpillerom(4321, aktive, TIL, FRA).spillerom,
    );
  });
});
