import { useEffect, useState } from "react";
import { subscribeWeekMeals, transactMealDay } from "@data/meals.repository";
import { addRecipeToMeal, removeRecipeFromMeal, setVariantOnMeal } from "@domain/meals/meals";
import type { DayKey, MealRecipeRef, WeekMeals } from "@app-types/meal";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseMealsResult {
  meals: Loadable<WeekMeals>;
  setDayToRecipe: (day: DayKey, recipe: MealRecipeRef) => Promise<void>;
  setDayToText: (day: DayKey, text: string) => Promise<void>;
  addRecipeToDay: (day: DayKey, recipe: { id: string; name: string }) => Promise<void>;
  removeRecipeFromDay: (day: DayKey, idx: number) => Promise<void>;
  setDayToEvent: (day: DayKey, event: { name: string; emoji?: string }) => Promise<void>;
  clearDay: (day: DayKey) => Promise<void>;
  setVariantForRecipe: (day: DayKey, recipeIndex: number, variantId: string) => Promise<void>;
}

/**
 * React-binding for én ukes middagsplan. `setDayToRecipe` speiler
 * `AddToPlanCard` sitt skrivemønster (index.html linje ~4674–4680) —
 * dagen settes UBETINGET til `{type:"recipe",...}` — mens
 * `addRecipeToDay`/`removeRecipeFromDay` komponerer `transactMealDay`
 * med de allerede karakteriserte motorfunksjonene i
 * `domain/meals/meals.ts` (§PlanScreen sin `addRecToMenu`/
 * `removeRecFromMenu`, linje ~3327–3343), samme mønster som
 * `useFreezer`/`useMealLibrary` allerede bruker.
 *
 * `addRecipeToMeal` returnerer bevisst `undefined` ved duplikat — det
 * signalet føres videre uendret til `transactMealDay`, som da avbryter
 * transaksjonen uten å skrive noe (§domain/meals/meals.ts sin
 * toppkommentar).
 */
export function useMeals(weekKey: string): UseMealsResult {
  const familyId = useFamilyId();
  const [meals, setMeals] = useState<Loadable<WeekMeals>>(notLoaded);

  useEffect(() => {
    setMeals(loading);
    const unsubscribe = subscribeWeekMeals(familyId, weekKey, (data) => setMeals(loaded(data)));
    return unsubscribe;
  }, [familyId, weekKey]);

  const setDayToRecipe = async (day: DayKey, recipe: MealRecipeRef) => {
    await transactMealDay(familyId, weekKey, day, () => ({
      type: "recipe",
      name: recipe.name,
      recipeId: recipe.recipeId,
      ...(recipe.variantId !== undefined ? { variantId: recipe.variantId } : {}),
    }));
  };

  /**
   * Speiler dagens `setMeal(day, e.target.value)` i input-feltets
   * `onChange` (index.html linje ~3617) — skriver den rå fritekst-
   * strengen direkte til dagens node på hvert tastetrykk. `MealValue`
   * tillater `string` som en gyldig, legacy-kompatibel form (§types/meal.ts),
   * og `transactMealDay` tolker en tom streng som "ingen middag" akkurat
   * som ethvert annet falsy resultat.
   */
  const setDayToText = async (day: DayKey, text: string) => {
    await transactMealDay(familyId, weekKey, day, () => text);
  };

  const addRecipeToDay = async (day: DayKey, recipe: { id: string; name: string }) => {
    await transactMealDay(familyId, weekKey, day, (current) => addRecipeToMeal(current, recipe));
  };

  const removeRecipeFromDay = async (day: DayKey, idx: number) => {
    await transactMealDay(familyId, weekKey, day, (current) => removeRecipeFromMeal(current, idx));
  };

  const setDayToEvent = async (day: DayKey, event: { name: string; emoji?: string }) => {
    await transactMealDay(familyId, weekKey, day, () => ({
      type: "event",
      name: event.name,
      ...(event.emoji !== undefined ? { emoji: event.emoji } : {}),
    }));
  };

  const clearDay = async (day: DayKey) => {
    await transactMealDay(familyId, weekKey, day, () => "");
  };

  /**
   * Setter et variantvalg (Middagsplan v1, §domain/meals/meals.ts sin
   * `setVariantOnMeal`) på oppskrift-referansen ved `recipeIndex` — 0 for
   * en enkeltoppskrift, en indeks inn i en menys `recipes[]` ellers.
   */
  const setVariantForRecipe = async (day: DayKey, recipeIndex: number, variantId: string) => {
    await transactMealDay(familyId, weekKey, day, (current) =>
      setVariantOnMeal(current, recipeIndex, variantId),
    );
  };

  return {
    meals,
    setDayToRecipe,
    setDayToText,
    addRecipeToDay,
    removeRecipeFromDay,
    setDayToEvent,
    clearDay,
    setVariantForRecipe,
  };
}
