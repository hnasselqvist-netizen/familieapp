import { describe, expect, it } from "vitest";
import type { MealLibraryEntry, MealVariant, ShoppingBaseItem } from "@app-types/shopping";
import {
  medBevartePostfelt,
  parseMealLibraryEntry,
  TvetydigIdentitet,
} from "./mealLibrary.repository";

/**
 * #20 6749312086: hva `transactMealLibraryEntry` skriver tilbake. `lest` er
 * det appen ser (som parseren gir). Emulatortestene dekker selve transaksjonen.
 */
const rad = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  itemId: `i-${id}`,
  name: `Vare ${id}`,
  amount: "",
  unit: "",
  cat: "K",
  ...over,
});

/** Det appen ser: den ekte parseren, som i transaksjonen. */
const lest = (raa: Record<string, unknown>): MealLibraryEntry => parseMealLibraryEntry("post", raa);

const raaPost = () => ({
  name: "Syntetisk",
  notat: "post",
  shoppingBase: [rad("a", { notat: "rad a" }), rad("b")],
  variants: [
    { id: "v1", name: "Hjemme", source: "recipe", recipeId: "r1", notat: "variant" },
    {
      id: "v2",
      name: "Kjøpt",
      source: "shoppingBase",
      shoppingBase: [rad("c", { notat: "rad c" })],
    },
  ],
});

/*
 * Datalaget får ikke importere domenet (eslint-modulgrensene), så endringene
 * appen gjør, gjenskapes her som rene kopier. Emulatortestene bruker de ekte
 * domenefunksjonene.
 */
const updateEntryFields = (e: MealLibraryEntry, patch: Partial<MealLibraryEntry>) => ({
  ...e,
  ...patch,
});
const updateShoppingBaseItemField = (
  e: MealLibraryEntry,
  id: string,
  felt: "amount" | "unit",
  verdi: string,
) => ({
  ...e,
  shoppingBase: (e.shoppingBase ?? []).map((v) => (v.id !== id ? v : { ...v, [felt]: verdi })),
});
const removeShoppingBaseItem = (e: MealLibraryEntry, id: string) => ({
  ...e,
  shoppingBase: (e.shoppingBase ?? []).filter((v) => v.id !== id),
});
const addShoppingBaseItem = (e: MealLibraryEntry, ny: ShoppingBaseItem) => ({
  ...e,
  shoppingBase: [...(e.shoppingBase ?? []), ny],
});
const updateVariant = (
  e: MealLibraryEntry,
  id: string,
  endre: (v: MealVariant) => MealVariant,
) => ({ ...e, variants: (e.variants ?? []).map((v) => (v.id !== id ? v : endre(v))) });
const removeVariant = (e: MealLibraryEntry, id: string) => ({
  ...e,
  variants: (e.variants ?? []).filter((v) => v.id !== id),
});

describe("medBevartePostfelt", () => {
  it("«Lettvint» bevarer ukjente felt på posten, varelinjer, varianter og variantens varelinjer", () => {
    const raa = raaPost();
    const ut = medBevartePostfelt(raa, updateEntryFields(lest(raa), { lettvint: true }));
    expect(ut).toEqual({ ...raa, lettvint: true });
    expect(ut).not.toHaveProperty("id");
  });

  it("uendrede samlinger skrives ordrett, også med duplikate eller manglende id-er", () => {
    const raa = {
      name: "Syntetisk",
      shoppingBase: [rad("a", { x: 1 }), rad("a", { x: 2 }), { name: "uten id", x: 3 }],
    };
    const ut = medBevartePostfelt(raa, updateEntryFields(lest(raa), { name: "Nytt navn" }));
    expect(ut).toEqual({ ...raa, name: "Nytt navn" });
  });

  it("endret varelinje beholder sine ukjente felt; fjernet linje forsvinner; ny linje får ingen", () => {
    const raa = raaPost();
    let neste = updateShoppingBaseItemField(lest(raa), "a", "amount", "2");
    neste = removeShoppingBaseItem(neste, "b");
    neste = addShoppingBaseItem(neste, {
      id: "n",
      itemId: "i-n",
      name: "Ny",
      amount: "",
      unit: "",
      cat: "K",
    });
    const ut = medBevartePostfelt(raa, neste);
    expect(ut.shoppingBase).toEqual([
      rad("a", { notat: "rad a", amount: "2" }),
      { id: "n", itemId: "i-n", name: "Ny", amount: "", unit: "", cat: "K" },
    ]);
    expect(ut.variants).toEqual(raa.variants);
    expect(ut.notat).toBe("post");
  });

  it("siste varelinje fjernet gir tom liste (RTDB lagrer den ikke), som før", () => {
    const raa = { name: "S", shoppingBase: [rad("a", { notat: "x" })] };
    expect(medBevartePostfelt(raa, removeShoppingBaseItem(lest(raa), "a")).shoppingBase).toEqual(
      [],
    );
  });

  it("variant: navneendring beholder ukjente felt; kildebytte erstatter kilden; fjernet variant forsvinner", () => {
    const raa = raaPost();
    const omdopt = medBevartePostfelt(
      raa,
      updateVariant(lest(raa), "v2", (v) => ({ ...v, name: "Butikk" })),
    );
    expect(omdopt.variants).toEqual([raa.variants[0], { ...raa.variants[1], name: "Butikk" }]);

    const byttet = medBevartePostfelt(
      raa,
      updateVariant(lest(raa), "v1", (v) => ({
        id: v.id,
        name: v.name,
        source: "shoppingBase",
        shoppingBase: [],
      })),
    );
    expect((byttet.variants as unknown[])[0]).toEqual({
      id: "v1",
      name: "Hjemme",
      source: "shoppingBase",
      notat: "variant",
      shoppingBase: [],
    });

    const fjernet = medBevartePostfelt(raa, removeVariant(lest(raa), "v1"));
    expect(fjernet.variants).toEqual([raa.variants[1]]);
  });

  it("endret varelinje i en variant beholder ukjente felt på linjen og varianten", () => {
    const raa = raaPost();
    const neste = updateVariant(lest(raa), "v2", (v) => ({
      id: v.id,
      name: v.name,
      source: "shoppingBase",
      shoppingBase: [{ ...rad("c"), amount: "3" }, rad("d")],
    }));
    const ut = medBevartePostfelt(raa, neste);
    expect((ut.variants as Record<string, unknown>[])[1]?.shoppingBase).toEqual([
      rad("c", { notat: "rad c", amount: "3" }),
      rad("d"),
    ]);
  });

  it("stopper når en endret samling har ukjente felt uten entydig id", () => {
    const duplikat = { name: "S", shoppingBase: [rad("a", { notat: "x" }), rad("a")] };
    expect(() =>
      medBevartePostfelt(duplikat, updateShoppingBaseItemField(lest(duplikat), "a", "unit", "g")),
    ).toThrow(TvetydigIdentitet);

    const utenId = { name: "S", shoppingBase: [{ name: "Løs", notat: "x" }, rad("b")] };
    expect(() => medBevartePostfelt(utenId, removeShoppingBaseItem(lest(utenId), "b"))).toThrow(
      TvetydigIdentitet,
    );
  });

  it("duplikate id-er uten ukjente felt skrives som appens verdi, uten stopp", () => {
    const raa = { name: "S", shoppingBase: [rad("a"), rad("a")] };
    const neste = updateShoppingBaseItemField(lest(raa), "a", "unit", "g");
    expect(medBevartePostfelt(raa, neste).shoppingBase).toEqual([
      rad("a", { unit: "g" }),
      rad("a", { unit: "g" }),
    ]);
  });

  it("et kjent felt appens verdi utelater, forsvinner; tom post gir bare appens felt", () => {
    const raa = { name: "S", variationTags: ["fisk"], ukjent: 1 };
    const { variationTags: _v, ...uten } = lest(raa);
    void _v;
    expect(medBevartePostfelt(raa, uten)).toEqual({ name: "S", ukjent: 1 });
    expect(medBevartePostfelt({}, { id: "x", name: "Ny" })).toEqual({ name: "Ny" });
  });
});
