import { useEffect, useState } from "react";
import { subscribeWeekMealFeedback } from "@data/mealFeedback.repository";
import type { WeekMealFeedback } from "@app-types/mealFeedback";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseMealFeedbackRangeResult {
  allFeedback: Loadable<Record<string, WeekMealFeedback>>;
}

/**
 * Abonnerer på flere ukers måltidsavvik/feedback samtidig — speiler
 * `useMealsRange` sitt mønster 1:1, brukt av Førsteutkast
 * (§domain/meals/forsteutkast.ts) for å utlede faktisk historikk og
 * pausede middager over samme datahentings-vindu som `useMealsRange`
 * allerede henter planen for.
 *
 * `weekKeys` bør være en stabil, memoized liste — endres identiteten på
 * hvert render, abonneres det på nytt hver gang.
 */
export function useMealFeedbackRange(weekKeys: string[]): UseMealFeedbackRangeResult {
  const familyId = useFamilyId();
  const [allFeedback, setAllFeedback] =
    useState<Loadable<Record<string, WeekMealFeedback>>>(notLoaded);

  useEffect(() => {
    if (weekKeys.length === 0) {
      setAllFeedback(loaded({}));
      return;
    }
    setAllFeedback(loading);
    const data: Record<string, WeekMealFeedback> = {};
    const seen = new Set<string>();
    let cancelled = false;

    const unsubscribes = weekKeys.map((weekKey) =>
      subscribeWeekMealFeedback(familyId, weekKey, (weekFeedback) => {
        if (cancelled) return;
        data[weekKey] = weekFeedback;
        seen.add(weekKey);
        if (seen.size === weekKeys.length) {
          setAllFeedback(loaded({ ...data }));
        }
      }),
    );

    return () => {
      cancelled = true;
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [familyId, weekKeys]);

  return { allFeedback };
}
