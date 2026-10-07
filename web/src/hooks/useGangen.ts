import { useMemo } from "react";
import type { GangenGrunnlag, Middag } from "@domain/gangen/dagensPunkter";
import { dayKeyForDato } from "@domain/meals/planningPeriod";
import { resolveMealDisplayName } from "@domain/meals/meals";
import { getWeekKey } from "@domain/shared/weekKey";
import { resolveMealShoppingItems } from "@generators/shopping/shopping";
import type { DayKey, MealValue, WeekMeals } from "@app-types/meal";
import type { Recipe } from "@app-types/recipe";
import type { MealLibraryEntry } from "@app-types/shopping";
import { type Loadable, loaded, loading } from "@app-types/status";
import { useFreezer } from "./useFreezer";
import { useGangenSignals } from "./useGangenSignals";
import { useMealLibrary } from "./useMealLibrary";
import { useMealsRange } from "./useMealsRange";
import { useRecipes } from "./useRecipes";
import { useShoppingList } from "./useShoppingList";

export interface Gangen extends GangenGrunnlag {
  /** Dagens ukedag, for lenken som åpner riktig dag i Middagsplan. */
  iDag: DayKey;
}

function tilMiddag(
  val: MealValue | undefined,
  recipes: Recipe[],
  mealLibrary: MealLibraryEntry[],
): Middag | null {
  if (!val) return null;
  const navn = resolveMealDisplayName(val, mealLibrary).trim();
  if (!navn) return null;
  return { navn, ingredienser: resolveMealShoppingItems(val, recipes, mealLibrary) };
}

/**
 * Alt Gangen leser (#59, retning 1), samlet til ett `Loadable`. Rent
 * lesende — Gangen skriver aldri selv. Som før blir status først
 * `"loaded"` når ALLE kilder har levert sitt første snapshot, så Gangen
 * aldri konkluderer «ingenting venter» på data som ikke har kommet.
 *
 * I morgen kan ligge i neste uke (søndag → mandag), derfor abonneres det
 * på begge ukene når de er forskjellige.
 */
export function useGangen(): Loadable<Gangen> {
  const now = new Date();
  const imorgen = new Date(now);
  imorgen.setDate(now.getDate() + 1);
  const ukeIDag = getWeekKey(now);
  const ukeIMorgen = getWeekKey(imorgen);
  const uker = useMemo(
    () => (ukeIDag === ukeIMorgen ? [ukeIDag] : [ukeIDag, ukeIMorgen]),
    [ukeIDag, ukeIMorgen],
  );

  const signals = useGangenSignals();
  const { allMeals } = useMealsRange(uker);
  const { recipes } = useRecipes();
  const { mealLibrary } = useMealLibrary();
  const { freezer } = useFreezer();
  const { shopping } = useShoppingList();

  if (
    signals.status !== "loaded" ||
    allMeals.status !== "loaded" ||
    recipes.status !== "loaded" ||
    mealLibrary.status !== "loaded" ||
    freezer.status !== "loaded" ||
    shopping.status !== "loaded"
  ) {
    return loading;
  }

  const iDag = dayKeyForDato(now);
  const uke = (k: string): WeekMeals => allMeals.data[k] ?? {};

  return loaded({
    ...signals.data,
    iDag,
    middagIDag: tilMiddag(uke(ukeIDag)[iDag], recipes.data, mealLibrary.data),
    middagIMorgen: tilMiddag(
      uke(ukeIMorgen)[dayKeyForDato(imorgen)],
      recipes.data,
      mealLibrary.data,
    ),
    handleliste: shopping.data,
    fryser: freezer.data.map((f) => ({
      itemId: f.itemId,
      name: f.name,
      antall: (f.batches ?? []).reduce((sum, b) => sum + (Number(b.count) || 0), 0),
    })),
  });
}
