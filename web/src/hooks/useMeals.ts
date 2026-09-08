import { useEffect, useState } from "react";
import { subscribeWeekMeals, transactMealDay } from "@data/meals.repository";
import type { DayKey, MealRecipeRef, WeekMeals } from "@app-types/meal";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseMealsResult {
  meals: Loadable<WeekMeals>;
  setDayToRecipe: (day: DayKey, recipe: MealRecipeRef) => Promise<void>;
}

/**
 * React-binding for én ukes middagsplan. Speiler `AddToPlanCard` sitt
 * skrivemønster (index.html linje ~4674–4680): `setDayToRecipe` setter
 * dagen UBETINGET til `{type:"recipe",...}` — ingen sammenslåing med en
 * eventuell eksisterende `menu` (det er `addRecipeToMeal` sin jobb,
 * §domain/meals/meals.ts, brukt av PlanScreen, ikke av denne kortvisningen).
 * Trygt likevel: `transactMealDay` skriver til ÉN DAG sin egen node, og
 * kalleren (`AddToPlanCard`) viser kun dager som er tomme eller allerede
 * har akkurat denne oppskriften.
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
    }));
  };

  return { meals, setDayToRecipe };
}
