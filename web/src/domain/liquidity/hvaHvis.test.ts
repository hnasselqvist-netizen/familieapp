import { describe, expect, it } from "vitest";
import type { LiquidityPost } from "@app-types/liquidity";
import { calcSpillerom } from "./liquidity";
import { hvaHvis } from "./hvaHvis";

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
const FRA = "2026-10-06";
const TIL = "2026-10-25";
const poster = [
  post("husleie", { amount: 12000, date: "2026-10-15" }),
  post("lonn", { amount: 38000, direction: "in", date: "2026-10-20" }),
];

describe("hvaHvis (#59)", () => {
  it("et kjøp trekker spillerommet ned med beløpet", () => {
    const r = hvaHvis(15000, poster, FRA, TIL, { belop: 5000, retning: "ut", dato: "2026-10-08" });
    expect(r.endring).toBe(-5000);
    expect(r.etter.slutt).toBe(r.for.slutt - 5000);
    expect(r.utenforPerioden).toBe(false);
  });

  it("viser når et kjøp får saldoen under null før lønn, selv om slutten er positiv", () => {
    const r = hvaHvis(15000, poster, FRA, TIL, { belop: 5000, retning: "ut", dato: "2026-10-08" });
    expect(r.for.laveste).toEqual({ saldo: 3000, dato: "2026-10-15" });
    expect(r.etter.laveste).toEqual({ saldo: -2000, dato: "2026-10-15" });
    expect(r.etter.slutt).toBeGreaterThan(0);
  });

  it("samme kjøp etter lønn påvirker ikke laveste punkt", () => {
    const r = hvaHvis(15000, poster, FRA, TIL, { belop: 5000, retning: "ut", dato: "2026-10-21" });
    expect(r.etter.laveste).toEqual(r.for.laveste);
    expect(r.endring).toBe(-5000);
  });

  it("en innbetaling øker spillerommet", () => {
    const r = hvaHvis(15000, poster, FRA, TIL, { belop: 2000, retning: "inn", dato: "2026-10-09" });
    expect(r.endring).toBe(2000);
  });

  it("utenfor perioden: ingen endring, og det sies tydelig", () => {
    const r = hvaHvis(15000, poster, FRA, TIL, { belop: 5000, retning: "ut", dato: "2026-11-02" });
    expect(r.endring).toBe(0);
    expect(r.utenforPerioden).toBe(true);
  });

  it("endrer aldri postlisten den får inn", () => {
    const kopi = structuredClone(poster);
    hvaHvis(15000, poster, FRA, TIL, { belop: 5000, retning: "ut", dato: "2026-10-08" });
    expect(poster).toEqual(kopi);
  });

  it("sluttsaldoen med scenarioet er lik calcSpillerom med den tenkte posten", () => {
    const r = hvaHvis(15000, poster, FRA, TIL, { belop: 777, retning: "ut", dato: "2026-10-12" });
    const tenkt = post("x", { amount: 777, date: "2026-10-12", type: "extra" });
    expect(r.etter.slutt).toBe(calcSpillerom(15000, [...poster, tenkt], TIL, FRA).spillerom);
  });
});
