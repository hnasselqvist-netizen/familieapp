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
  clearShoppingBaseItemToFreeText,
  removeShoppingBaseItem,
  replaceShoppingBaseItemFromPicker,
  updateShoppingBaseItemField,
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
