/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * `getIngredients` (linje ~3892), `RecipeIngredients.scaleAmt`
 * (linje ~4702) og "bekreft middag"-statistikkoppdateringen
 * (linje ~3828–3831) i dagens index.html, slik den er lest og
 * verifisert manuelt mot koden FØR noe ble flyttet. Ved uenighet om
 * "riktig" oppførsel senere: dette er fasiten, ikke en idealisert
 * versjon.
 */
import { describe, expect, it } from "vitest";
import { getIngredients, markRecipeCooked, scaleIngredientAmount } from "./recipes";
import type { Ingredient, Recipe, RecipeFields } from "@app-types/recipe";

const ing = (overrides: Partial<Ingredient> = {}): Ingredient => ({
  name: "Kjøttdeig",
  amount: "500 g",
  cat: "Kjøtt",
  ...overrides,
});

describe("getIngredients", () => {
  it("returnerer tom liste for null/undefined", () => {
    expect(getIngredients(null)).toEqual([]);
    expect(getIngredients(undefined)).toEqual([]);
  });

  it("flater ut ingredientGroups når den finnes og ikke er tom", () => {
    const recipe = {
      ingredients: [],
      ingredientGroups: [
        { id: "g1", name: "Bunn", ingredients: [ing({ name: "Pasta" })] },
        { id: "g2", name: "Fyll", ingredients: [ing({ name: "Ost" }), ing({ name: "Skinke" })] },
      ],
    } as unknown as Recipe;
    expect(getIngredients(recipe).map((i) => i.name)).toEqual(["Pasta", "Ost", "Skinke"]);
  });

  it("bruker de flate ingredients når ingredientGroups er tom", () => {
    const recipe = {
      ingredients: [ing({ name: "Løk" })],
      ingredientGroups: [],
    } as unknown as Recipe;
    expect(getIngredients(recipe).map((i) => i.name)).toEqual(["Løk"]);
  });

  it("bruker de flate ingredients når ingredientGroups mangler helt", () => {
    const recipe = { ingredients: [ing({ name: "Gulrot" })] } as unknown as Recipe;
    expect(getIngredients(recipe).map((i) => i.name)).toEqual(["Gulrot"]);
  });

  it("returnerer tom liste når verken ingredients eller ingredientGroups finnes", () => {
    expect(getIngredients({} as Recipe)).toEqual([]);
  });
});

describe("scaleIngredientAmount", () => {
  it("skalerer opp det ledende tallet proporsjonalt, beholder enhetssuffikset", () => {
    expect(scaleIngredientAmount("500 g", 4, 8)).toBe("1000 g");
  });

  it("skalerer ned og runder til to desimaler", () => {
    expect(scaleIngredientAmount("100 g", 3, 1)).toBe("33.33 g");
  });

  it("returnerer mengden uendret når baseServings er 0", () => {
    expect(scaleIngredientAmount("500 g", 0, 8)).toBe("500 g");
  });

  it("returnerer tom streng for tom/manglende mengde", () => {
    expect(scaleIngredientAmount("", 4, 8)).toBe("");
  });

  it("returnerer mengden uendret når den ikke starter med et lesbart tall", () => {
    expect(scaleIngredientAmount("etter behov", 4, 8)).toBe("etter behov");
  });

  it("gjør ingenting når target===base", () => {
    expect(scaleIngredientAmount("500 g", 4, 4)).toBe("500 g");
  });
});

describe("markRecipeCooked", () => {
  it("setter lastCooked og teller opp timesCooked fra 0", () => {
    const current = { timesCooked: 0 } as RecipeFields;
    const result = markRecipeCooked(current, 1720000000);
    expect(result.lastCooked).toBe(1720000000);
    expect(result.timesCooked).toBe(1);
  });

  it("teller opp timesCooked fra en eksisterende verdi", () => {
    const current = { timesCooked: 6 } as RecipeFields;
    const result = markRecipeCooked(current, 1720000000);
    expect(result.timesCooked).toBe(7);
  });

  it("behandler manglende timesCooked som 0", () => {
    const current = {} as RecipeFields;
    const result = markRecipeCooked(current, 1720000000);
    expect(result.timesCooked).toBe(1);
  });

  it("endrer ikke andre felt på posten", () => {
    const current = { name: "Taco", cat: "Middag", timesCooked: 2 } as RecipeFields;
    const result = markRecipeCooked(current, 1720000000);
    expect(result.name).toBe("Taco");
    expect(result.cat).toBe("Middag");
  });
});
