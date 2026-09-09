/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * `MealLibraryScreen` sine `shoppingBase`-mutasjoner (index.html linje
 * ~3114–3146: `leggTilVareFraItemPicker`, `oppdaterVare`,
 * `endreVareNavnFritekst`, `byttVareIShoppingBase`, `slettVare`), slik den
 * er lest og verifisert manuelt mot koden FØR noe ble flyttet.
 */
import { describe, expect, it } from "vitest";
import {
  addShoppingBaseItem,
  addVariant,
  clearShoppingBaseItemToFreeText,
  removeShoppingBaseItem,
  removeVariant,
  replaceShoppingBaseItemFromPicker,
  updateShoppingBaseItemField,
  updateVariant,
} from "./mealLibrary";
import type { MealLibraryEntry } from "@app-types/shopping";

const entry = (overrides: Partial<MealLibraryEntry> = {}): MealLibraryEntry => ({
  id: "m1",
  name: "Fiskegrateng",
  ...overrides,
});

describe("addShoppingBaseItem", () => {
  it("legger til en ny rad med tomt amount/unit, uavhengig av mastervaren sine felt", () => {
    const next = addShoppingBaseItem(entry(), "sb1", { itemId: "v1", name: "Fisk", cat: "Fisk" });
    expect(next.shoppingBase).toEqual([
      { id: "sb1", itemId: "v1", name: "Fisk", amount: "", unit: "", cat: "Fisk" },
    ]);
  });

  it("legger til bak eksisterende rader uten å røre dem, når shoppingBase mangler fra før", () => {
    const withoutBase = entry();
    expect(withoutBase.shoppingBase).toBeUndefined();
    const next = addShoppingBaseItem(withoutBase, "sb1", {
      itemId: "v1",
      name: "Fisk",
      cat: "Fisk",
    });
    expect(next.shoppingBase).toHaveLength(1);
  });

  it("bevarer eksisterende rader ved påfølgende tillegg", () => {
    const withOne = addShoppingBaseItem(entry(), "sb1", {
      itemId: "v1",
      name: "Fisk",
      cat: "Fisk",
    });
    const withTwo = addShoppingBaseItem(withOne, "sb2", {
      itemId: "v2",
      name: "Poteter",
      cat: "Grønt",
    });
    expect(withTwo.shoppingBase).toHaveLength(2);
    expect(withTwo.shoppingBase?.[0]?.id).toBe("sb1");
    expect(withTwo.shoppingBase?.[1]?.id).toBe("sb2");
  });
});

describe("updateShoppingBaseItemField", () => {
  const withRow = entry({
    shoppingBase: [{ id: "sb1", itemId: "v1", name: "Fisk", amount: "", unit: "", cat: "Fisk" }],
  });

  it("oppdaterer kun det angitte feltet på den angitte raden", () => {
    const next = updateShoppingBaseItemField(withRow, "sb1", "amount", "400");
    expect(next.shoppingBase?.[0]).toEqual({
      id: "sb1",
      itemId: "v1",
      name: "Fisk",
      amount: "400",
      unit: "",
      cat: "Fisk",
    });
  });

  it("lar andre rader være urørt", () => {
    const twoRows = addShoppingBaseItem(withRow, "sb2", {
      itemId: "v2",
      name: "Poteter",
      cat: "Grønt",
    });
    const next = updateShoppingBaseItemField(twoRows, "sb1", "unit", "g");
    expect(next.shoppingBase?.[1]).toEqual(twoRows.shoppingBase?.[1]);
  });

  it("er en no-op dersom raden ikke finnes", () => {
    const next = updateShoppingBaseItemField(withRow, "ukjent", "amount", "400");
    expect(next.shoppingBase).toEqual(withRow.shoppingBase);
  });
});

describe("clearShoppingBaseItemToFreeText", () => {
  it("setter navn og nullstiller itemId/cat UMIDDELBART", () => {
    const withRow = entry({
      shoppingBase: [
        { id: "sb1", itemId: "v1", name: "Fisk", amount: "400", unit: "g", cat: "Fisk" },
      ],
    });
    const next = clearShoppingBaseItemToFreeText(withRow, "sb1", "Ukjent fisk");
    expect(next.shoppingBase?.[0]).toEqual({
      id: "sb1",
      itemId: null,
      name: "Ukjent fisk",
      amount: "400",
      unit: "g",
      cat: "",
    });
  });
});

describe("replaceShoppingBaseItemFromPicker", () => {
  it("setter itemId/name/cat SAMLET fra samme mastervare, bevarer amount/unit", () => {
    const withRow = entry({
      shoppingBase: [
        { id: "sb1", itemId: null, name: "Ukjent fisk", amount: "400", unit: "g", cat: "" },
      ],
    });
    const next = replaceShoppingBaseItemFromPicker(withRow, "sb1", {
      id: "v2",
      name: "Torsk",
      cat: "Fisk",
    });
    expect(next.shoppingBase?.[0]).toEqual({
      id: "sb1",
      itemId: "v2",
      name: "Torsk",
      amount: "400",
      unit: "g",
      cat: "Fisk",
    });
  });
});

describe("removeShoppingBaseItem", () => {
  it("fjerner kun den angitte raden", () => {
    const twoRows = addShoppingBaseItem(
      addShoppingBaseItem(entry(), "sb1", { itemId: "v1", name: "Fisk", cat: "Fisk" }),
      "sb2",
      { itemId: "v2", name: "Poteter", cat: "Grønt" },
    );
    const next = removeShoppingBaseItem(twoRows, "sb1");
    expect(next.shoppingBase).toEqual([
      { id: "sb2", itemId: "v2", name: "Poteter", amount: "", unit: "", cat: "Grønt" },
    ]);
  });

  it("gir en tom liste, ikke undefined, når siste rad fjernes", () => {
    const oneRow = addShoppingBaseItem(entry(), "sb1", { itemId: "v1", name: "Fisk", cat: "Fisk" });
    const next = removeShoppingBaseItem(oneRow, "sb1");
    expect(next.shoppingBase).toEqual([]);
  });
});

describe("addVariant", () => {
  it("legger til en oppskrift-kildet variant (source:recipe, recipeId satt) på et måltid uten varianter fra før", () => {
    const withoutVariants = entry();
    expect(withoutVariants.variants).toBeUndefined();
    const next = addVariant(withoutVariants, "var1", {
      name: "Hjemmelaget",
      source: "recipe",
      recipeId: "r1",
    });
    expect(next.variants).toEqual([
      { id: "var1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" },
    ]);
  });

  it("legger til en handlegrunnlag-kildet variant (source:shoppingBase, ikke recipeId)", () => {
    const next = addVariant(entry(), "var1", {
      name: "Kjøpepizza",
      source: "shoppingBase",
      shoppingBase: [
        { id: "sb1", itemId: "v9", name: "Pizza", amount: "1", unit: "stk", cat: "Frys" },
      ],
    });
    expect(next.variants).toEqual([
      {
        id: "var1",
        name: "Kjøpepizza",
        source: "shoppingBase",
        shoppingBase: [
          { id: "sb1", itemId: "v9", name: "Pizza", amount: "1", unit: "stk", cat: "Frys" },
        ],
      },
    ]);
  });

  it("legger til en fersk handlegrunnlag-kildet variant med TOM shoppingBase — ingen varer lagt til ennå", () => {
    const next = addVariant(entry(), "var1", {
      name: "Kjøpepizza",
      source: "shoppingBase",
      shoppingBase: [],
    });
    expect(next.variants).toEqual([
      { id: "var1", name: "Kjøpepizza", source: "shoppingBase", shoppingBase: [] },
    ]);
  });

  it("legger til bak eksisterende varianter uten å røre dem — 2+ varianter", () => {
    const withOne = addVariant(entry(), "var1", {
      name: "Hjemmelaget",
      source: "recipe",
      recipeId: "r1",
    });
    const withTwo = addVariant(withOne, "var2", {
      name: "Kjøpepizza",
      source: "recipe",
      recipeId: "r2",
    });
    expect(withTwo.variants).toHaveLength(2);
    expect(withTwo.variants?.[0]?.id).toBe("var1");
    expect(withTwo.variants?.[1]?.id).toBe("var2");
  });

  it("rører ikke måltidets egen flate shoppingBase når en variant legges til", () => {
    const withFlatBase = entry({
      shoppingBase: [{ id: "sb1", itemId: "v1", name: "Fisk", amount: "", unit: "", cat: "Fisk" }],
    });
    const next = addVariant(withFlatBase, "var1", {
      name: "Ny variant",
      source: "recipe",
      recipeId: "r1",
    });
    expect(next.shoppingBase).toEqual(withFlatBase.shoppingBase);
  });
});

describe("updateVariant", () => {
  const withRecipeVariant = () =>
    addVariant(entry(), "var1", { name: "Original", source: "recipe", recipeId: "r1" });
  const withBaseVariant = () =>
    addVariant(entry(), "var1", {
      name: "Original",
      source: "shoppingBase",
      shoppingBase: [{ id: "sb1", itemId: "v9", name: "Pizza", amount: "", unit: "", cat: "Frys" }],
    });

  it("oppdaterer kun navnet og beholder eksisterende recipeId-kilde urørt", () => {
    const next = updateVariant(withRecipeVariant(), "var1", { name: "Nytt navn" });
    expect(next.variants?.[0]).toEqual({
      id: "var1",
      name: "Nytt navn",
      source: "recipe",
      recipeId: "r1",
    });
  });

  it("bytte til shoppingBase-kilde fjerner recipeId helt, ikke bare setter den til undefined ved siden av", () => {
    const next = updateVariant(withRecipeVariant(), "var1", {
      source: "shoppingBase",
      shoppingBase: [{ id: "sb1", itemId: "v9", name: "Pizza", amount: "", unit: "", cat: "Frys" }],
    });
    expect(next.variants?.[0]).toEqual({
      id: "var1",
      name: "Original",
      source: "shoppingBase",
      shoppingBase: [{ id: "sb1", itemId: "v9", name: "Pizza", amount: "", unit: "", cat: "Frys" }],
    });
    expect(next.variants?.[0]).not.toHaveProperty("recipeId");
  });

  it("bytte til recipeId-kilde fjerner shoppingBase helt", () => {
    const next = updateVariant(withBaseVariant(), "var1", { source: "recipe", recipeId: "r2" });
    expect(next.variants?.[0]).toEqual({
      id: "var1",
      name: "Original",
      source: "recipe",
      recipeId: "r2",
    });
    expect(next.variants?.[0]).not.toHaveProperty("shoppingBase");
  });

  it("lar andre varianter være urørt", () => {
    const withTwo = addVariant(withRecipeVariant(), "var2", {
      name: "Nummer to",
      source: "recipe",
      recipeId: "r2",
    });
    const next = updateVariant(withTwo, "var1", { name: "Endret" });
    expect(next.variants?.[1]).toEqual(withTwo.variants?.[1]);
  });

  it("er en no-op dersom varianten ikke finnes", () => {
    const withRecipe = withRecipeVariant();
    const next = updateVariant(withRecipe, "ukjent", { name: "Skal ikke skje" });
    expect(next.variants).toEqual(withRecipe.variants);
  });
});

describe("removeVariant", () => {
  it("fjerner kun den angitte varianten", () => {
    const withTwo = addVariant(
      addVariant(entry(), "var1", { name: "A", source: "recipe", recipeId: "r1" }),
      "var2",
      { name: "B", source: "recipe", recipeId: "r2" },
    );
    const next = removeVariant(withTwo, "var1");
    expect(next.variants).toEqual([{ id: "var2", name: "B", source: "recipe", recipeId: "r2" }]);
  });

  it("gir en tom liste, ikke undefined, når siste variant fjernes", () => {
    const oneVariant = addVariant(entry(), "var1", { name: "A", source: "recipe", recipeId: "r1" });
    const next = removeVariant(oneVariant, "var1");
    expect(next.variants).toEqual([]);
  });

  it("er en no-op dersom varianten ikke finnes, inkludert på et måltid uten variants fra før", () => {
    const withoutVariants = entry();
    const next = removeVariant(withoutVariants, "ukjent");
    expect(next.variants).toEqual([]);
  });
});
