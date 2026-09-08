import { useEffect, useState } from "react";
import { subscribeItemHistory } from "@data/itemHistory.repository";
import type { ItemHistoryEntry } from "@app-types/shopping";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseItemHistoryResult {
  itemHistory: Loadable<ItemHistoryEntry[]>;
}

/** React-binding for varehistorikken — kun lesing (§data/itemHistory.repository.ts sin toppkommentar). */
export function useItemHistory(): UseItemHistoryResult {
  const familyId = useFamilyId();
  const [itemHistory, setItemHistory] = useState<Loadable<ItemHistoryEntry[]>>(notLoaded);

  useEffect(() => {
    setItemHistory(loading);
    const unsubscribe = subscribeItemHistory(familyId, (data) => setItemHistory(loaded(data)));
    return unsubscribe;
  }, [familyId]);

  return { itemHistory };
}
