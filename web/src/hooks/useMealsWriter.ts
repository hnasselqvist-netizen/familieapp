import { transactMealDay } from "@data/meals.repository";
import type { DayKey, MealRecipeRef } from "@app-types/meal";
import { useFamilyId } from "./useFamilyId";

export interface UseMealsWriterResult {
  setDayToRecipeForWeek: (weekKey: string, day: DayKey, recipe: MealRecipeRef) => Promise<void>;
}

/**
 * Skrive-only variant av `useMeals` for kallere som må skrive til FLERE,
 * på forhånd ukjente uker i samme handling — `useMeals(weekKey)` binder
 * ukenøkkelen til selve hook-instansen, som fungerer fint når kalleren
 * kjenner nøyaktig 1–2 uker på forhånd (slik `PlanScreen`/`AddToPlanCard`
 * gjør), men ikke når antallet uker varierer med brukervalg (Middagsplan
 * v1, §ForsteutkastPanel sin dynamiske sluttdato — en periode kan nå
 * spenne over vilkårlig mange uker, ikke bare de to en fast torsdag→
 * torsdag-periode maks kunne krysse). React tillater ikke et variabelt
 * antall `useMeals`-kall (ett per uke), så denne hooken tar `weekKey` som
 * PARAMETER til selve skrivefunksjonen i stedet for til hooken selv.
 */
export function useMealsWriter(): UseMealsWriterResult {
  const familyId = useFamilyId();

  const setDayToRecipeForWeek = async (weekKey: string, day: DayKey, recipe: MealRecipeRef) => {
    await transactMealDay(familyId, weekKey, day, () => ({
      type: "recipe",
      name: recipe.name,
      recipeId: recipe.recipeId,
      ...(recipe.variantId !== undefined ? { variantId: recipe.variantId } : {}),
    }));
  };

  return { setDayToRecipeForWeek };
}
