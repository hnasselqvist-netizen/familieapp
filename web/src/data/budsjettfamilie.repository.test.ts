/**
 * Karakteriseringstest for `parseBudsjettGrupper` — låser parsingen mot
 * den EKTE Firebase-formen for `budget`/`incomeGroups`/`sparingGroups`
 * (§index.html linje 15965, 16123, 16168, samme form som Spillerom sin
 * `parseForecastGroups` allerede har låst en tilsvarende test for,
 * §data/liquidity.repository.test.ts — skrevet proaktivt her for å
 * unngå samme regresjonsklasse Kontrolltårn-reviewen av PR #35 fant).
 */
import { describe, expect, it } from "vitest";
import { parseBudsjettGrupper } from "./budsjettfamilie.repository";

describe("parseBudsjettGrupper", () => {
  it("parser den ekte Firebase-formen ({groupId: {itemId: {name, months, meta}}}) uten .items/.label-wrapper", () => {
    const raw = {
      bolig: {
        strom: {
          name: "Strøm",
          months: { 5: { budget: 3000, spent: 2710 } },
          meta: { eier: "Felles", niva: "opprettholde" },
        },
      },
    };

    const result = parseBudsjettGrupper(raw, "budget");

    const bolig = result.find((g) => g.id === "bolig");
    expect(bolig).toBeDefined();
    // Etiketten kommer fra GROUP_TEMPLATES, ikke fra Firebase (som aldri lagrer den).
    expect(bolig?.label).toBe("Bolig");
    expect(bolig?.items).toHaveLength(1);
    expect(bolig?.items[0]).toMatchObject({
      id: "strom",
      name: "Strøm",
      meta: { eier: "Felles", niva: "opprettholde" },
    });
    expect(bolig?.items[0]?.months[5]).toEqual({ budget: 3000, spent: 2710 });
    expect(bolig?.items[0]?.months[0]).toEqual({ budget: 0, spent: 0 });
  });

  it("dropper _gruppeplassholder — signal om en bevisst tom gruppe, aldri en ekte post", () => {
    const raw = { buffer: { _gruppeplassholder: true } };
    const result = parseBudsjettGrupper(raw, "sparingGroups");
    expect(result.find((g) => g.id === "buffer")?.items).toHaveLength(0);
  });

  it("viser kun malgrupper Firebase faktisk har en nøkkel for, når noden ikke er tom", () => {
    const raw = { bolig: { strom: { name: "Strøm", months: {}, meta: null } } };
    const result = parseBudsjettGrupper(raw, "budget");
    expect(result.map((g) => g.id)).toEqual(["bolig"]);
  });

  it("viser ALLE malgrupper tomme som scaffold når hele noden aldri er skrevet (null)", () => {
    const result = parseBudsjettGrupper(null, "incomeGroups");
    expect(result.map((g) => g.id)).toEqual(["lonn", "offentlig", "kapital", "annet"]);
    expect(result.every((g) => g.items.length === 0)).toBe(true);
  });

  it("bevarer gruppenes malrekkefølge, ikke Firebase sin nøkkelrekkefølge", () => {
    const raw = {
      annet: { a: { name: "A", months: {}, meta: null } },
      lonn: { b: { name: "B", months: {}, meta: null } },
    };
    const result = parseBudsjettGrupper(raw, "incomeGroups");
    expect(result.map((g) => g.id)).toEqual(["lonn", "annet"]);
  });
});
