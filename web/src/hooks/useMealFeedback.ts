import { useEffect, useState } from "react";
import {
  deleteMealFeedback,
  setMealFeedback,
  subscribeWeekMealFeedback,
} from "@data/mealFeedback.repository";
import type { DayKey } from "@app-types/meal";
import type { MealFeedback, WeekMealFeedback } from "@app-types/mealFeedback";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseMealFeedbackResult {
  feedback: Loadable<WeekMealFeedback>;
  setFeedback: (day: DayKey, feedback: MealFeedback) => Promise<void>;
  deleteFeedback: (day: DayKey) => Promise<void>;
}

/**
 * React-binding for én ukes måltidsavvik/feedback — speiler `useMeals`
 * sitt mønster (§data/mealFeedback.repository.ts). `setFeedback`
 * overskriver hele dagens post (siste registrering/korrigering vinner,
 * ingen historikk-logg); `deleteFeedback` nullstiller dagen tilbake til
 * normalregelen «plan = faktisk».
 */
export function useMealFeedback(weekKey: string): UseMealFeedbackResult {
  const familyId = useFamilyId();
  const [feedback, setFeedbackState] = useState<Loadable<WeekMealFeedback>>(notLoaded);

  useEffect(() => {
    setFeedbackState(loading);
    const unsubscribe = subscribeWeekMealFeedback(familyId, weekKey, (data) =>
      setFeedbackState(loaded(data)),
    );
    return unsubscribe;
  }, [familyId, weekKey]);

  const setFeedback = async (day: DayKey, value: MealFeedback) => {
    await setMealFeedback(familyId, weekKey, day, value);
  };

  const deleteFeedback = async (day: DayKey) => {
    await deleteMealFeedback(familyId, weekKey, day);
  };

  return { feedback, setFeedback, deleteFeedback };
}
