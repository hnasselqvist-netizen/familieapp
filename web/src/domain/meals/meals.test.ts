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
  setVariantOnMeal,
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

  it("fører variantId med for en enkeltoppskrift (Middagsplan v1) — feltet skal IKKE gå tapt på lesing", () => {
    expect(getMealRecipes(recipeVal({ name: "Pizza", recipeId: null, variantId: "v1" }))).toEqual([
      { name: "Pizza", recipeId: null, variantId: "v1" },
    ]);
  });

  it("utelater variantId-nøkkelen helt når den ikke er satt — ingen variantId:undefined i outputet", () => {
    const [ref] = getMealRecipes(recipeVal({ name: "Pizza", recipeId: null }));
    expect(ref).not.toHaveProperty("variantId");
  });
});

describe("setVariantOnMeal", () => {
  it("setter variantId på en enkeltoppskrift (indeks 0)", () => {
    const result = setVariantOnMeal(recipeVal({ name: "Pizza", recipeId: null }), 0, "v1");
    expect(result).toEqual({ type: "recipe", name: "Pizza", recipeId: null, variantId: "v1" });
  });

  it("overstyrer en eksisterende variantId på samme dag", () => {
    const result = setVariantOnMeal(
      recipeVal({ name: "Pizza", recipeId: null, variantId: "gammel" }),
      0,
      "ny",
    );
    expect(result).toEqual({ type: "recipe", name: "Pizza", recipeId: null, variantId: "ny" });
  });

  it("setter variantId kun på riktig element i en meny, resten uendret", () => {
    const result = setVariantOnMeal(menuVal(), 1, "v2");
    expect(result).toEqual({
      type: "menu",
      name: "Taco · Pannekaker",
      recipes: [
        { name: "Taco", recipeId: "r1" },
        { name: "Pannekaker", recipeId: "r2", variantId: "v2" },
      ],
    });
  });

  it("oppgraderer en legacy raa streng til et type:recipe-objekt med recipeId:null og variantId — navnet er uendret", () => {
    const result = setVariantOnMeal("Pizza", 0, "v1");
    expect(result).toEqual({ type: "recipe", name: "Pizza", recipeId: null, variantId: "v1" });
  });

  it("returnerer undefined (avbryter transaksjonen) for en tom dag", () => {
    expect(setVariantOnMeal(null, 0, "v1")).toBeUndefined();
    expect(setVariantOnMeal(undefined, 0, "v1")).toBeUndefined();
  });

  it("returnerer undefined for en hendelse — hendelser har ingen oppskrift-referanse å sette variant på", () => {
    expect(setVariantOnMeal(eventVal(), 0, "v1")).toBeUndefined();
  });

  it("returnerer undefined for en indeks utenfor menyens faktiske lengde", () => {
    expect(setVariantOnMeal(menuVal(), 5, "v1")).toBeUndefined();
    expect(setVariantOnMeal(menuVal(), -1, "v1")).toBeUndefined();
  });

  it("returnerer undefined for en enkeltoppskrift ved en annen indeks enn 0", () => {
    expect(setVariantOnMeal(recipeVal(), 1, "v1")).toBeUndefined();
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

  it("bevarer variantId på det gjenværende elementet ved kollaps til type:recipe (Middagsplan v1)", () => {
    const meny = menuVal({
      recipes: [
        { name: "Taco", recipeId: "r1", variantId: "v1" },
        { name: "Pannekaker", recipeId: "r2" },
      ],
    });
    const result = removeRecipeFromMeal(meny, 1);
    expect(result).toEqual({ type: "recipe", name: "Taco", recipeId: "r1", variantId: "v1" });
  });
});
