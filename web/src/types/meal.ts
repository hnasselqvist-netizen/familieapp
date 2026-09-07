/**
 * Datamodellen er UENDRET fra dagens `families/familie1/meals/{weekKey}/{day}`
 * (§index.html, linje ~378–400, §designbok.md 3.2 Middagsplan) — dette er en
 * karakteriseringstype, ikke et nytt skjema. `weekKey` er en ISO-8601-ukenøkkel
 * (`getWeekKey()`, f.eks. "2026-W37"), behandlet som en ugjennomsiktig streng
 * her — hverken domenet eller datalaget beregner den selv, kun mottar den.
 */
export type DayKey = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

export const DAYS: readonly DayKey[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** En oppskrift-referanse slik den forekommer inni en dagverdi — ALDRI en hel Recipe. */
export interface MealRecipeRef {
  name: string;
  recipeId: string | null;
}

export interface MealRecipeValue {
  type: "recipe";
  name: string;
  recipeId: string | null;
}

/** `recipes.length` er alltid ≥ 2 i praksis — domenet kollapser til `MealRecipeValue` ved 1 og "" ved 0 (§meals.ts). */
export interface MealMenuValue {
  type: "menu";
  name: string;
  recipes: MealRecipeRef[];
}

export interface MealEventValue {
  type: "event";
  name: string;
  emoji?: string;
}

/**
 * Legacy raa streng (gammelt format, fortsatt lest og skrevet av
 * dagens `index.html` enkelte steder — f.eks. `clearDay`/`removeRecFromMenu`
 * sin tomme-dag-verdi) — bevart som gyldig input/output-form, ikke bare
 * lest defensivt.
 */
export type MealValue = string | MealRecipeValue | MealMenuValue | MealEventValue;

/** Én ukes middagsplan slik den lagres under `meals/{weekKey}` — dagnøkler som mangler betyr "ingen middag planlagt". */
export type WeekMeals = Partial<Record<DayKey, MealValue>>;
