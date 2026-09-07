/**
 * Datamodellen er UENDRET fra dagens `families/familie1/recipes`
 * (§index.html RecipesScreen/RecipeForm/AddRecipeModal, linje ~4150–4900,
 * §designbok.md 3.1 Kokebok) — dette er en karakteriseringstype, ikke et
 * nytt skjema. Kun feltene som faktisk finnes i dagens lagrede data er
 * tatt med.
 */
export interface Ingredient {
  name: string;
  amount: string;
  /** Kun satt når raden ble bygget fra strukturerte skjemafelt (§RecipeForm); fritekst-kilder kan mangle den. */
  unit?: string;
  cat: string;
}

export interface IngredientGroup {
  id: string;
  name: string;
  ingredients: Ingredient[];
}

export interface Recipe {
  id: string;
  name: string;
  cat: string;
  tags: string[];
  time: number;
  servings: number;
  url: string;
  imageUrl: string | null;
  source: string;
  instructions: string;
  /** Brukes når `ingredientGroups` er tom — se domain/recipes/recipes.ts sin `getIngredients()`. */
  ingredients: Ingredient[];
  ingredientGroups: IngredientGroup[];
  lastCooked: number | null;
  timesCooked: number;
  createdAt: number;
  updatedAt?: number;
}

/**
 * Formen data faktisk lagres i på én oppskrift-node — id-en er stien,
 * ikke et felt. Delt mellom domain (rene transformasjoner) og data
 * (Firebase-transaksjoner), som §types/freezer.ts sin FreezerItemFields.
 */
export type RecipeFields = Omit<Recipe, "id">;
