/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * `getMealName`/`getMealType`/`getMealRecipes`/`isEvent`/`isMenu`
 * (linje ~380–400) og `addRecToMenu`/`removeRecFromMenu`
 * (linje ~3327–3343) i dagens index.html, slik den er lest og
 * verifisert manuelt mot koden FØR noe ble flyttet. Ved uenighet om
 * "riktig" oppførsel senere: dette er fasiten, ikke en idealisert
 * versjon.
 *
 * §Kontrolltårn-handoff: `menu`/flere retter samme dag er en gyldig
 * modell og skal karakteriseres FULLT ut her, ikke bare det som er
 * nåbart fra dagens-dag-UI-et (som i praksis kun tillater én rett —
 * se PR #3 sin pre-implementeringskartlegging).
 */
import { describe, expect, it } from "vitest";
import {
  addRecipeToMeal,
  getMealName,
  getMealRecipes,
  getMealType,
  isEvent,
  isMenu,
  removeRecipeFromMeal,
} from "./meals";
import type { MealEventValue, MealMenuValue, MealRecipeValue } from "@app-types/meal";

const recipeVal = (overrides: Partial<MealRecipeValue> = {}): MealRecipeValue => ({
  type: "recipe",
  name: "Taco",
  recipeId: "r1",
  ...overrides,
});

const menuVal = (overrides: Partial<MealMenuValue> = {}): MealMenuValue => ({
  type: "menu",
  name: "Taco · Pannekaker",
  recipes: [
    { name: "Taco", recipeId: "r1" },
    { name: "Pannekaker", recipeId: "r2" },
  ],
  ...overrides,
});

const eventVal = (overrides: Partial<MealEventValue> = {}): MealEventValue => ({
  type: "event",
  name: "Middag hos svigermor",
  emoji: "🏡",
  ...overrides,
});

describe("getMealName", () => {
  it("returnerer tom streng for null/undefined/tom verdi", () => {
    expect(getMealName(null)).toBe("");
    expect(getMealName(undefined)).toBe("");
    expect(getMealName("")).toBe("");
  });

  it("returnerer den raa strengen uendret for legacy-format", () => {
    expect(getMealName("Grandiosa")).toBe("Grandiosa");
  });

  it("slaar sammen menynavn med ' · '-separator fra recipes-listen", () => {
    expect(getMealName(menuVal())).toBe("Taco · Pannekaker");
  });

  it("bruker .name for recipe- og event-verdier", () => {
    expect(getMealName(recipeVal({ name: "Lasagne" }))).toBe("Lasagne");
    expect(getMealName(eventVal({ name: "Rester" }))).toBe("Rester");
  });
});

describe("getMealType", () => {
  it("returnerer null for tom verdi", () => {
    expect(getMealType(null)).toBeNull();
  });

  it("returnerer 'recipe' for en raa streng (legacy)", () => {
    expect(getMealType("Taco")).toBe("recipe");
  });

  it("returnerer objektets eget type-felt", () => {
    expect(getMealType(recipeVal())).toBe("recipe");
    expect(getMealType(menuVal())).toBe("menu");
    expect(getMealType(eventVal())).toBe("event");
  });
});

describe("isEvent / isMenu", () => {
  it("kjenner igjen hendelser og menyer korrekt, uten falske positiver", () => {
    expect(isEvent(eventVal())).toBe(true);
    expect(isEvent(recipeVal())).toBe(false);
    expect(isEvent("Taco")).toBe(false);
    expect(isMenu(menuVal())).toBe(true);
    expect(isMenu(recipeVal())).toBe(false);
  });
});

describe("getMealRecipes", () => {
  it("returnerer tom liste for tom verdi", () => {
    expect(getMealRecipes(null)).toEqual([]);
    expect(getMealRecipes(undefined)).toEqual([]);
  });

  it("returnerer tom liste for en hendelse", () => {
    expect(getMealRecipes(eventVal())).toEqual([]);
  });

  it("wrapper en legacy raa streng som ett recipeId:null-element", () => {
    expect(getMealRecipes("Grandiosa")).toEqual([{ name: "Grandiosa", recipeId: null }]);
  });

  it("returnerer recipes-listen direkte for en meny", () => {
    expect(getMealRecipes(menuVal())).toEqual([
      { name: "Taco", recipeId: "r1" },
      { name: "Pannekaker", recipeId: "r2" },
    ]);
  });

  it("wrapper en enkeltoppskrift som ett-element-liste", () => {
    expect(getMealRecipes(recipeVal({ name: "Lasagne", recipeId: "r9" }))).toEqual([
      { name: "Lasagne", recipeId: "r9" },
    ]);
  });
});

describe("addRecipeToMeal", () => {
  it("bygger en ny meny av to oppskrifter naar dagen allerede har én", () => {
    const result = addRecipeToMeal(recipeVal({ name: "Taco", recipeId: "r1" }), {
      name: "Pannekaker",
      id: "r2",
    });
    expect(result).toEqual({
      type: "menu",
      name: "Taco · Pannekaker",
      recipes: [
        { name: "Taco", recipeId: "r1" },
        { name: "Pannekaker", recipeId: "r2" },
      ],
    });
  });

  it("legger til en tredje rett i en eksisterende meny", () => {
    const result = addRecipeToMeal(menuVal(), { name: "Salat", id: "r3" });
    expect(result).toEqual({
      type: "menu",
      name: "Taco · Pannekaker · Salat",
      recipes: [
        { name: "Taco", recipeId: "r1" },
        { name: "Pannekaker", recipeId: "r2" },
        { name: "Salat", recipeId: "r3" },
      ],
    });
  });

  it("returnerer undefined (ikke en uendret verdi) naar oppskriften allerede finnes, matchet paa id", () => {
    const result = addRecipeToMeal(recipeVal({ recipeId: "r1" }), { name: "Annet navn", id: "r1" });
    expect(result).toBeUndefined();
  });

  it("returnerer undefined naar oppskriften allerede finnes, matchet paa navn (recipeId ulik)", () => {
    const result = addRecipeToMeal(recipeVal({ name: "Taco", recipeId: "r1" }), {
      name: "Taco",
      id: "r-annen-id",
    });
    expect(result).toBeUndefined();
  });

  it("kanttilfelle: kalt mot en TOM dag produserer en meny med kun ÉN oppskrift (speiler dagens funksjon eksakt, ikke en idealisert versjon)", () => {
    const result = addRecipeToMeal(null, { name: "Taco", id: "r1" });
    expect(result).toEqual({
      type: "menu",
      name: "Taco",
      recipes: [{ name: "Taco", recipeId: "r1" }],
    });
  });
});

describe("removeRecipeFromMeal", () => {
  it("kollapser til type:recipe naar kun én oppskrift gjenstaar", () => {
    const result = removeRecipeFromMeal(menuVal(), 1);
    expect(result).toEqual({ type: "recipe", name: "Taco", recipeId: "r1" });
  });

  it("returnerer '' (ikke null/undefined) naar siste oppskrift fjernes", () => {
    const result = removeRecipeFromMeal(recipeVal({ name: "Taco", recipeId: "r1" }), 0);
    expect(result).toBe("");
  });

  it("forblir en meny med redusert recipes-liste naar 3+ blir til 2", () => {
    const treRetter = menuVal({
      name: "Taco · Pannekaker · Salat",
      recipes: [
        { name: "Taco", recipeId: "r1" },
        { name: "Pannekaker", recipeId: "r2" },
        { name: "Salat", recipeId: "r3" },
      ],
    });
    const result = removeRecipeFromMeal(treRetter, 1);
    expect(result).toEqual({
      type: "menu",
      name: "Taco · Salat",
      recipes: [
        { name: "Taco", recipeId: "r1" },
        { name: "Salat", recipeId: "r3" },
      ],
    });
  });

  it("haandterer en legacy raa streng som input (ett element, index 0)", () => {
    expect(removeRecipeFromMeal("Grandiosa", 0)).toBe("");
  });
});
