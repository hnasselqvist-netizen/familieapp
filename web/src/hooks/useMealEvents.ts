import { useEffect, useState } from "react";
import {
  createMealEvent,
  removeMealEvent,
  subscribeMealEvents,
  updateMealEvent,
} from "@data/mealEvents.repository";
import type { MealEventOption } from "@app-types/mealEvent";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseMealEventsResult {
  mealEvents: Loadable<MealEventOption[]>;
  addEvent: (event: { name: string; emoji?: string }) => Promise<MealEventOption>;
  updateEvent: (
    id: string,
    patch: Partial<Pick<MealEventOption, "name" | "emoji">>,
  ) => Promise<void>;
  removeEvent: (id: string) => Promise<void>;
}

/** React-binding for den brukerdefinerte hendelseskatalogen (§data/mealEvents.repository.ts). Samme mønster som `useMealLibrary`. */
export function useMealEvents(): UseMealEventsResult {
  const familyId = useFamilyId();
  const [mealEvents, setMealEvents] = useState<Loadable<MealEventOption[]>>(notLoaded);

  useEffect(() => {
    setMealEvents(loading);
    const unsubscribe = subscribeMealEvents(familyId, (data) => setMealEvents(loaded(data)));
    return unsubscribe;
  }, [familyId]);

  const addEvent = (event: { name: string; emoji?: string }) => createMealEvent(familyId, event);
  const updateEvent = (id: string, patch: Partial<Pick<MealEventOption, "name" | "emoji">>) =>
    updateMealEvent(familyId, id, patch);
  const removeEvent = (id: string) => removeMealEvent(familyId, id);

  return { mealEvents, addEvent, updateEvent, removeEvent };
}
