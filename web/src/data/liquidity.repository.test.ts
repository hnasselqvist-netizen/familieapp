/**
 * Karakteriseringstest for `parseForecastGroups` — låser parsingen mot
 * den EKTE Firebase-formen for `budget`/`incomeGroups`/`sparingGroups`,
 * verifisert direkte mot legacy sine `listen(...)`-lyttere (§index.html
 * linje 15965, 16123, 16168): `{groupId: {itemId: {name, months, meta}}}`,
 * ingen `.items`-undernøkkel, intet lagret `.label`-felt.
 *
 * Skrevet etter en Kontrolltårn-review av PR #35 fant at den opprinnelige
 * parseren feilaktig antok `{groupId: {label, items: {itemId: {...}}}}`
 * — en form som aldri har eksistert i Firebase. Konsekvensen var alvorlig:
 * `subscribeForecastInputs` leverte grupper med `items: []`, som fikk
 * `useLiquidity` sin auto-regenerering (§useLiquidity.ts) til å kjøre
 * `generateForecastPosts` med tomme budsjett-/inntekts-/sparegrupper —
 * som IKKE genererer noen poster — og deretter `regenerateLiquidityPosts`
 * erstattet hele `posts`-undernoden med resultatet, og slettet dermed
 * stille alle ekte genererte prognoseposter. Denne testen skal fange
 * akkurat denne regresjonsklassen automatisk.
 */
import { describe, expect, it } from "vitest";
import { parseForecastGroups } from "./liquidity.repository";

describe("parseForecastGroups", () => {
  it("parser den ekte Firebase-formen ({groupId: {itemId: {name, months, meta}}}) uten .items/.label-wrapper", () => {
    const raw = {
      faste_utgifter: {
        strom: {
          name: "Strøm",
          months: { 5: { budget: 1000, spent: 0 }, 6: { budget: 1000, spent: 1234 } },
          meta: { automatisk: true, forfallsdag: "15", oppforsel: "fast", eier: "Felles" },
        },
      },
    };

    const result = parseForecastGroups(raw);

    expect(result).toHaveLength(1);
    const group = result[0];
    if (!group) throw new Error("expected a parsed group");
    // Ingen ekte label finnes i Firebase for denne read-only-konsumenten
    // — groupId brukes som fallback (§types/liquidity.ts ForecastGroup.label).
    expect(group.id).toBe("faste_utgifter");
    expect(group.label).toBe("faste_utgifter");
    expect(group.items).toHaveLength(1);
    const item = group.items[0];
    if (!item) throw new Error("expected a parsed item");
    expect(item.id).toBe("strom");
    expect(item.name).toBe("Strøm");
    expect(item.meta).toEqual({
      automatisk: true,
      forfallsdag: "15",
      oppforsel: "fast",
      eier: "Felles",
    });
    expect(item.months[5]).toEqual({ budget: 1000, spent: 0 });
    expect(item.months[6]).toEqual({ budget: 1000, spent: 1234 });
    expect(item.months[0]).toBeUndefined();
  });

  it("dropper _gruppeplassholder — legacy sitt signal om en bevisst tom gruppe, aldri en ekte post", () => {
    const raw = {
      tom_gruppe: {
        _gruppeplassholder: true,
      },
    };

    const result = parseForecastGroups(raw);

    expect(result).toHaveLength(1);
    expect(result[0]?.items).toHaveLength(0);
  });

  it("returnerer tomt array for null/manglende data (aldri skrevet ennå)", () => {
    expect(parseForecastGroups(null)).toEqual([]);
    expect(parseForecastGroups(undefined)).toEqual([]);
  });

  it("håndterer flere grupper og flere poster per gruppe", () => {
    const raw = {
      g1: {
        i1: { name: "A", months: {}, meta: null },
        i2: { name: "B", months: {}, meta: null },
      },
      g2: {
        i3: { name: "C", months: {}, meta: null },
      },
    };

    const result = parseForecastGroups(raw);

    expect(result.map((g) => g.id).sort()).toEqual(["g1", "g2"]);
    expect(
      result
        .find((g) => g.id === "g1")
        ?.items.map((i) => i.id)
        .sort(),
    ).toEqual(["i1", "i2"]);
    expect(result.find((g) => g.id === "g2")?.items.map((i) => i.id)).toEqual(["i3"]);
  });
});
