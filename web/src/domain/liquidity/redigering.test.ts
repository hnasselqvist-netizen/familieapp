import { describe, expect, it } from "vitest";
import { endredeFelt } from "./redigering";

const start = {
  name: "Husleie",
  amount: 100,
  date: "2026-11-20",
  direction: "out",
  type: "fast",
} as const;

describe("endredeFelt (samtidighet, #59)", () => {
  it("bare endrede felt sendes, med grunnlagsverdiene", () => {
    expect(endredeFelt(start, { ...start, amount: 150 })).toEqual({
      patch: { amount: 150 },
      grunnlag: { amount: 100 },
    });
  });
  it("flere felt", () => {
    expect(endredeFelt(start, { ...start, name: "Leie", date: "2026-11-21" })).toEqual({
      patch: { name: "Leie", date: "2026-11-21" },
      grunnlag: { name: "Husleie", date: "2026-11-20" },
    });
  });
  it("ingen endring gir tom patch (ingen skriving)", () => {
    expect(endredeFelt(start, { ...start })).toEqual({ patch: {}, grunnlag: {} });
  });
});
