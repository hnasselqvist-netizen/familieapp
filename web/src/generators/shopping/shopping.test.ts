/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * `resolveMealShoppingItems` (index.html linje ~3927), `lookupCat`/
 * `buildIngredients`/den interne mergen (`ShoppingGenerator`,
 * linje ~2742–2803), `addToList` sin rad-form (linje ~2838–2844) og
 * `onAddToList` (`MatScreen`, linje ~3847–3862), slik de er lest og
 * verifisert manuelt mot koden FØR noe ble flyttet. Ved uenighet om
 * "riktig" oppførsel senere: dette er fasiten, ikke en idealisert
 * versjon.
 */
import { describe, expect, it } from "vitest";
import {
  buildShoppingItems,
  lookupCategoryFromHistory,
  mergeIntoShoppingList,
  mergeShoppingItems,
  resolveMealShoppingItems,
  resolveMealShoppingStatuses,
  toShoppingListEntry,
} from "./shopping";
import type { Recipe } from "@app-types/recipe";
import type { MealMenuValue, MealRecipeValue } from "@app-types/meal";
import type {
  EnrichedShoppingItem,
  ItemHistoryEntry,
  MealLibraryEntry,
  MealVariant,
  ShoppingListEntry,
  Staples,
} from "@app-types/shopping";

const baseRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  id: "r1",
  name: "Taco",
  cat: "Middag",
  tags: [],
  time: 20,
  servings: 4,
  url: "",
  imageUrl: null,
  source: "quick",
  instructions: "",
  ingredients: [{ name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt" }],
  ingredientGroups: [],
  lastCooked: null,
  timesCooked: 0,
  createdAt: 0,
  ...overrides,
});

const libraryMeal = (overrides: Partial<MealLibraryEntry> = {}): MealLibraryEntry => ({
  id: "lib1",
  name: "Fiskegrateng",
  shoppingBase: [{ id: "sb1", itemId: "v1", name: "Fisk", amount: "400", unit: "g", cat: "Fisk" }],
  ...overrides,
});

describe("resolveMealShoppingItems", () => {
  it("returnerer [] for hendelse eller tom verdi", () => {
    expect(resolveMealShoppingItems(null, [], [])).toEqual([]);
    expect(resolveMealShoppingItems({ type: "event", name: "Rester" }, [], [])).toEqual([]);
  });

  it("legacy raa streng: navnematch mot recipes vinner over biblioteket", () => {
    const recipes = [baseRecipe({ name: "Taco" })];
    const mealLibrary = [libraryMeal({ name: "Taco", shoppingBase: [] })];
    const result = resolveMealShoppingItems("Taco", recipes, mealLibrary);
    expect(result).toEqual([
      { name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt", fromRecipe: "Taco" },
    ]);
  });

  it("legacy raa streng: faller tilbake til mealLibrary.shoppingBase når ingen oppskrift matcher", () => {
    const result = resolveMealShoppingItems("Fiskegrateng", [], [libraryMeal()]);
    expect(result).toEqual([
      {
        itemId: "v1",
        name: "Fisk",
        amount: "400",
        unit: "g",
        cat: "Fisk",
        fromRecipe: "Fiskegrateng",
      },
    ]);
  });

  it("eksplisitt recipeId: KUN id-oppslag, aldri navnematch, selv om et navnelikt bibliotek-måltid finnes", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Taco", recipeId: "ukjent-id" };
    const recipes = [baseRecipe({ id: "r1", name: "Taco" })];
    const mealLibrary = [libraryMeal({ name: "Taco" })];
    expect(resolveMealShoppingItems(meal, recipes, mealLibrary)).toEqual([]);
  });

  it("recipeId:null: KUN shoppingBase, aldri fallback til en navnelik oppskrift", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Taco", recipeId: null };
    const recipes = [baseRecipe({ name: "Taco" })];
    expect(resolveMealShoppingItems(meal, recipes, [])).toEqual([]);
  });

  it("meny: hver referanse resolveres uavhengig", () => {
    const meny: MealMenuValue = {
      type: "menu",
      name: "Taco · Fiskegrateng",
      recipes: [
        { name: "Taco", recipeId: "r1" },
        { name: "Fiskegrateng", recipeId: null },
      ],
    };
    const recipes = [baseRecipe({ id: "r1", name: "Taco" })];
    const result = resolveMealShoppingItems(meny, recipes, [libraryMeal()]);
    expect(result.map((i) => i.name)).toEqual(["Kjøttdeig", "Fisk"]);
  });

  it("bærer itemId videre fra en Kokebok-ingrediens når den finnes (§Kontrolltårn-handoff, Ingredient↔Vare-koblingen)", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Taco", recipeId: "r1" };
    const recipes = [
      baseRecipe({
        id: "r1",
        ingredients: [{ name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt", itemId: "v1" }],
      }),
    ];
    const result = resolveMealShoppingItems(meal, recipes, []);
    expect(result).toEqual([
      { name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt", itemId: "v1", fromRecipe: "Taco" },
    ]);
  });

  it("eldre oppskrift-ingrediens uten itemId: resolverer fortsatt fint, itemId fraværende", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Taco", recipeId: "r1" };
    const recipes = [baseRecipe({ id: "r1" })]; // baseRecipe sin ingrediens har ingen itemId
    const result = resolveMealShoppingItems(meal, recipes, []);
    expect(result[0]?.itemId).toBeUndefined();
  });
});

describe("resolveMealShoppingItems — variantmodell (§Kontrolltårn-handoff, Issue #2, skive 2)", () => {
  const recipeVariant = (recipeId: string): MealVariant => ({
    id: "var1",
    name: "Hjemmelaget",
    source: "recipe",
    recipeId,
  });
  const baseVariant = (): MealVariant => ({
    id: "var2",
    name: "Kjøpepizza",
    source: "shoppingBase",
    shoppingBase: [
      { id: "sb1", itemId: "v9", name: "Pizza", amount: "1", unit: "stk", cat: "Frys" },
    ],
  });

  it("bibliotekskonsept UTEN variants: UENDRET, bruker flat shoppingBase direkte (regresjon)", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Fiskegrateng", recipeId: null };
    const result = resolveMealShoppingItems(meal, [], [libraryMeal()]);
    expect(result).toEqual([
      {
        itemId: "v1",
        name: "Fisk",
        amount: "400",
        unit: "g",
        cat: "Fisk",
        fromRecipe: "Fiskegrateng",
      },
    ]);
  });

  it("bibliotekskonsept med NØYAKTIG ÉN recipe-kildet variant: auto-resolveres uten brukerbeslutning", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Fiskegrateng", recipeId: null };
    const recipes = [
      baseRecipe({
        id: "r1",
        name: "Ekte Fiskegrateng",
        ingredients: [{ name: "Torsk", amount: "1 kg", cat: "Fisk" }],
      }),
    ];
    const mealLibrary = [libraryMeal({ shoppingBase: undefined, variants: [recipeVariant("r1")] })];
    const result = resolveMealShoppingItems(meal, recipes, mealLibrary);
    expect(result).toEqual([
      { name: "Torsk", amount: "1 kg", cat: "Fisk", fromRecipe: "Ekte Fiskegrateng" },
    ]);
  });

  it("bibliotekskonsept med NØYAKTIG ÉN shoppingBase-kildet variant: auto-resolveres til variantens eget handlegrunnlag", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Fiskegrateng", recipeId: null };
    const mealLibrary = [libraryMeal({ shoppingBase: undefined, variants: [baseVariant()] })];
    const result = resolveMealShoppingItems(meal, [], mealLibrary);
    expect(result).toEqual([
      {
        itemId: "v9",
        name: "Pizza",
        amount: "1",
        unit: "stk",
        cat: "Frys",
        fromRecipe: "Fiskegrateng",
      },
    ]);
  });

  it("bibliotekskonsept med 2+ varianter og INGEN valgt: uløst, gir [] — ikke en vilkårlig fallback", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Fiskegrateng", recipeId: null };
    const mealLibrary = [
      libraryMeal({ shoppingBase: undefined, variants: [recipeVariant("r1"), baseVariant()] }),
    ];
    const result = resolveMealShoppingItems(meal, [], mealLibrary);
    expect(result).toEqual([]);
  });

  it("recipe-kildet variant med slettet/manglende oppskrift-referanse: degraderes kontrollert til 0 varer, ingen krasj", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Fiskegrateng", recipeId: null };
    const mealLibrary = [
      libraryMeal({ shoppingBase: undefined, variants: [recipeVariant("finnes-ikke")] }),
    ];
    expect(() => resolveMealShoppingItems(meal, [], mealLibrary)).not.toThrow();
    expect(resolveMealShoppingItems(meal, [], mealLibrary)).toEqual([]);
  });

  it("gjelder likt inni en meny — hver referanse resolveres uavhengig med variant-reglene", () => {
    const meny: MealMenuValue = {
      type: "menu",
      name: "Fiskegrateng · Taco",
      recipes: [
        { name: "Fiskegrateng", recipeId: null },
        { name: "Taco", recipeId: "r1" },
      ],
    };
    const recipes = [baseRecipe({ id: "r1", name: "Taco" })];
    const mealLibrary = [libraryMeal({ shoppingBase: undefined, variants: [baseVariant()] })];
    const result = resolveMealShoppingItems(meny, recipes, mealLibrary);
    expect(result.map((i) => i.name)).toEqual(["Pizza", "Kjøttdeig"]);
  });
});

describe("resolveMealShoppingStatuses (§Kontrolltårn-handoff, Issue #2, skive 2)", () => {
  it("returnerer [] for hendelse eller tom verdi", () => {
    expect(resolveMealShoppingStatuses(null, [], [])).toEqual([]);
    expect(resolveMealShoppingStatuses({ type: "event", name: "Rester" }, [], [])).toEqual([]);
  });

  it("konkret recipeId med treff: resolved", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Taco", recipeId: "r1" };
    expect(resolveMealShoppingStatuses(meal, [baseRecipe({ id: "r1" })], [])).toEqual([
      { status: "resolved" },
    ]);
  });

  it("konkret recipeId UTEN treff: not-found (samme presedens som 0-varer-oppførselen)", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Taco", recipeId: "finnes-ikke" };
    expect(resolveMealShoppingStatuses(meal, [], [])).toEqual([
      { status: "not-found", name: "Taco" },
    ]);
  });

  it("bibliotekskonsept uten variants: resolved (flat shoppingBase, uendret)", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Fiskegrateng", recipeId: null };
    expect(resolveMealShoppingStatuses(meal, [], [libraryMeal()])).toEqual([
      { status: "resolved" },
    ]);
  });

  it("bibliotekskonsept med 1 variant: resolved (auto-resolvert)", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Fiskegrateng", recipeId: null };
    const mealLibrary = [
      libraryMeal({
        shoppingBase: undefined,
        variants: [{ id: "var1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" }],
      }),
    ];
    expect(resolveMealShoppingStatuses(meal, [], mealLibrary)).toEqual([{ status: "resolved" }]);
  });

  it("bibliotekskonsept med 2+ varianter: unresolved, med biblioteks-id/-navn/antall for senere UI", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Fiskegrateng", recipeId: null };
    const mealLibrary = [
      libraryMeal({
        id: "lib1",
        shoppingBase: undefined,
        variants: [
          { id: "var1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" },
          {
            id: "var2",
            name: "Kjøpepizza",
            source: "shoppingBase",
            shoppingBase: [],
          },
        ],
      }),
    ];
    expect(resolveMealShoppingStatuses(meal, [], mealLibrary)).toEqual([
      {
        status: "unresolved",
        libraryEntryId: "lib1",
        libraryEntryName: "Fiskegrateng",
        variantCount: 2,
      },
    ]);
  });

  it("bibliotekskonsept-navn uten treff i biblioteket i det hele tatt: not-found", () => {
    const meal: MealRecipeValue = { type: "recipe", name: "Finnes ikke", recipeId: null };
    expect(resolveMealShoppingStatuses(meal, [], [])).toEqual([
      { status: "not-found", name: "Finnes ikke" },
    ]);
  });

  it("legacy fritekst-navn med oppskriftmatch: resolved, samme prioritet som items-siden", () => {
    const recipes = [baseRecipe({ name: "Taco" })];
    expect(resolveMealShoppingStatuses("Taco", recipes, [])).toEqual([{ status: "resolved" }]);
  });

  it("meny: én status per referanse, uavhengig av hverandre", () => {
    const meny: MealMenuValue = {
      type: "menu",
      name: "Fiskegrateng · Taco",
      recipes: [
        { name: "Fiskegrateng", recipeId: null },
        { name: "Taco", recipeId: "r1" },
      ],
    };
    const mealLibrary = [
      libraryMeal({
        id: "lib1",
        shoppingBase: undefined,
        variants: [
          { id: "var1", name: "A", source: "recipe", recipeId: "r1" },
          { id: "var2", name: "B", source: "recipe", recipeId: "r2" },
        ],
      }),
    ];
    const result = resolveMealShoppingStatuses(
      meny,
      [baseRecipe({ id: "r1", name: "Taco" })],
      mealLibrary,
    );
    expect(result).toEqual([
      {
        status: "unresolved",
        libraryEntryId: "lib1",
        libraryEntryName: "Fiskegrateng",
        variantCount: 2,
      },
      { status: "resolved" },
    ]);
  });
});

describe("lookupCategoryFromHistory", () => {
  it("returnerer 'Diverse' uten treff", () => {
    expect(lookupCategoryFromHistory("Løk", [])).toBe("Diverse");
  });

  it("returnerer FØRSTE treff, ikke sist lagt til", () => {
    const history: ItemHistoryEntry[] = [
      { name: "Løk", cat: "Grønnsaker" },
      { name: "Løk", cat: "Diverse" },
    ];
    expect(lookupCategoryFromHistory("løk", history)).toBe("Grønnsaker");
  });
});

describe("buildShoppingItems + mergeShoppingItems", () => {
  it("slår sammen like varer (samme navn+enhet, case-insensitivt) på tvers av flere dager", () => {
    const recipes = [
      baseRecipe({
        id: "r1",
        name: "Taco",
        ingredients: [{ name: "Løk", amount: "1", unit: "stk", cat: "Diverse" }],
      }),
      baseRecipe({
        id: "r2",
        name: "Wok",
        ingredients: [{ name: "løk", amount: "2", unit: "STK", cat: "Diverse" }],
      }),
    ];
    const mealValues = [
      { type: "recipe", name: "Taco", recipeId: "r1" } as const,
      { type: "recipe", name: "Wok", recipeId: "r2" } as const,
    ];
    const flat = buildShoppingItems(mealValues, {
      recipes,
      mealLibrary: [],
      itemHistory: [],
      staples: {},
    });
    const merged = mergeShoppingItems(flat);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ name: "Løk", amount: "3", fromRecipes: ["Taco", "Wok"] });
  });

  it("itemId fra en Kokebok-ingrediens overlever helt frem til det berikede handlelisteelementet", () => {
    const recipes = [
      baseRecipe({
        id: "r1",
        ingredients: [{ name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt", itemId: "v1" }],
      }),
    ];
    const mealValues = [{ type: "recipe", name: "Taco", recipeId: "r1" } as const];
    const flat = buildShoppingItems(mealValues, {
      recipes,
      mealLibrary: [],
      itemHistory: [],
      staples: {},
    });
    expect(flat).toEqual([
      {
        itemId: "v1",
        name: "Kjøttdeig",
        amount: "500 g",
        unit: "",
        cat: "Kjøtt",
        fromRecipe: "Taco",
        isStaple: false,
      },
    ]);
  });

  it("summerer IKKE når enheten er ulik — blir to separate elementer", () => {
    const recipes = [
      baseRecipe({
        id: "r1",
        name: "Taco",
        ingredients: [{ name: "Melk", amount: "1", unit: "l", cat: "Meieri" }],
      }),
      baseRecipe({
        id: "r2",
        name: "Kake",
        ingredients: [{ name: "Melk", amount: "2", unit: "dl", cat: "Meieri" }],
      }),
    ];
    const mealValues = [
      { type: "recipe", name: "Taco", recipeId: "r1" } as const,
      { type: "recipe", name: "Kake", recipeId: "r2" } as const,
    ];
    const flat = buildShoppingItems(mealValues, {
      recipes,
      mealLibrary: [],
      itemHistory: [],
      staples: {},
    });
    const merged = mergeShoppingItems(flat);
    expect(merged).toHaveLength(2);
  });

  it("isStaple er AND av alle bidrag — kun staple hvis ALLE forekomster er det", () => {
    const items: EnrichedShoppingItem[] = [
      {
        itemId: null,
        name: "Melk",
        amount: "1",
        unit: "l",
        cat: "Meieri",
        fromRecipe: "A",
        isStaple: true,
      },
      {
        itemId: null,
        name: "Melk",
        amount: "1",
        unit: "l",
        cat: "Meieri",
        fromRecipe: "B",
        isStaple: false,
      },
    ];
    expect(mergeShoppingItems(items)[0]?.isStaple).toBe(false);
  });

  it("kategori faller tilbake til historikk kun når ingrediensens egen cat er fraværende/'Diverse'", () => {
    const recipes = [
      baseRecipe({
        id: "r1",
        ingredients: [{ name: "Fisk", amount: "1", unit: "kg", cat: "Diverse" }],
      }),
    ];
    const itemHistory: ItemHistoryEntry[] = [{ name: "Fisk", cat: "Fisk og skalldyr" }];
    const mealValues = [{ type: "recipe", name: "Taco", recipeId: "r1" } as const];
    const flat = buildShoppingItems(mealValues, {
      recipes,
      mealLibrary: [],
      itemHistory,
      staples: {},
    });
    expect(flat[0]?.cat).toBe("Fisk og skalldyr");
  });

  it("basisvare-flagg slås opp case-insensitivt mot staples", () => {
    const recipes = [
      baseRecipe({
        id: "r1",
        ingredients: [{ name: "Melk", amount: "1", unit: "l", cat: "Meieri" }],
      }),
    ];
    const staples: Staples = { melk: true };
    const mealValues = [{ type: "recipe", name: "Taco", recipeId: "r1" } as const];
    const flat = buildShoppingItems(mealValues, {
      recipes,
      mealLibrary: [],
      itemHistory: [],
      staples,
    });
    expect(flat[0]?.isStaple).toBe(true);
  });
});

describe("toShoppingListEntry", () => {
  it("slår sammen mengde+enhet til ÉN streng når begge finnes", () => {
    expect(
      toShoppingListEntry({ itemId: "v1", name: "Melk", amount: "1", unit: "l", cat: "Meieri" }),
    ).toEqual({ itemId: "v1", name: "Melk", amount: "1 l", cat: "Meieri", done: false });
  });

  it("bruker kun mengden når enhet mangler", () => {
    expect(
      toShoppingListEntry({ itemId: null, name: "Egg", amount: "6", unit: "", cat: "Diverse" }),
    ).toEqual({
      itemId: null,
      name: "Egg",
      amount: "6",
      cat: "Diverse",
      done: false,
    });
  });
});

describe("mergeIntoShoppingList", () => {
  it("beholder eksisterende manuelle varer, legger til nye", () => {
    const existing = [
      { id: "e1", itemId: null, name: "Såpe", amount: "", cat: "Diverse", done: false },
    ];
    const newEntries = [
      { id: "n1", itemId: null, name: "Melk", amount: "1 l", cat: "Meieri", done: false },
    ];
    const result = mergeIntoShoppingList(existing, newEntries);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(existing[0]);
  });

  it("matcher KUN på navn (ikke enhet) — kan summere ulike enheter (kjent, uendret kvirk)", () => {
    const existing = [
      { id: "e1", itemId: null, name: "Melk", amount: "1", cat: "Meieri", done: false },
    ];
    const newEntries = [
      { id: "n1", itemId: null, name: "Melk", amount: "2", cat: "Meieri", done: false },
    ];
    const result = mergeIntoShoppingList(existing, newEntries);
    expect(result).toHaveLength(1);
    expect(result[0]?.amount).toBe("3");
  });

  it("gjenbruker ALDRI et allerede fullført (done) element — legger til en ny duplikatlinje i stedet", () => {
    const existing = [
      { id: "e1", itemId: null, name: "Melk", amount: "1", cat: "Meieri", done: true },
    ];
    const newEntries: (ShoppingListEntry & { id: string })[] = [
      { id: "n1", itemId: null, name: "Melk", amount: "1", cat: "Meieri", done: false },
    ];
    const result = mergeIntoShoppingList(existing, newEntries);
    expect(result).toHaveLength(2);
  });
});
