import { useEffect, useState } from "react";
import { subscribeWeekMeals } from "@data/meals.repository";
import type { WeekMeals } from "@app-types/meal";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseMealsRangeResult {
  allMeals: Loadable<Record<string, WeekMeals>>;
}

/**
 * Abonnerer på flere ukers middagsplan samtidig — brukt av Førsteutkast
 * (§domain/meals/forsteutkast.ts) for historikk-basert rangering, som
 * trenger å se lenger tilbake enn de 1–2 ukene en enkelt `useMeals`
 * dekker. Rent datahentings-vindu, ikke en forslags-terskel.
 *
 * `weekKeys` bør være en stabil, memoized liste — endres identiteten på
 * hvert render, abonneres det på nytt hver gang.
 */
export function useMealsRange(weekKeys: string[]): UseMealsRangeResult {
  const familyId = useFamilyId();
  const [allMeals, setAllMeals] = useState<Loadable<Record<string, WeekMeals>>>(notLoaded);

  useEffect(() => {
    if (weekKeys.length === 0) {
      setAllMeals(loaded({}));
      return;
    }
    setAllMeals(loading);
    const data: Record<string, WeekMeals> = {};
    const seen = new Set<string>();
    let cancelled = false;

    const unsubscribes = weekKeys.map((weekKey) =>
      subscribeWeekMeals(familyId, weekKey, (meals) => {
        if (cancelled) return;
        data[weekKey] = meals;
        seen.add(weekKey);
        if (seen.size === weekKeys.length) {
          setAllMeals(loaded({ ...data }));
        }
      }),
    );

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [familyId, weekKeys]);

  return { allMeals };
}
