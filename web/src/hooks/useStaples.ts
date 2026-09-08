import { useEffect, useState } from "react";
import { markItemAsStaple, subscribeStaples } from "@data/staples.repository";
import type { Staples } from "@app-types/shopping";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseStaplesResult {
  staples: Loadable<Staples>;
  markAsStaple: (name: string) => Promise<void>;
}

/** React-binding for basisvarer — status følger §not_loaded/loading/loaded-kontrakten. */
export function useStaples(): UseStaplesResult {
  const familyId = useFamilyId();
  const [staples, setStaples] = useState<Loadable<Staples>>(notLoaded);

  useEffect(() => {
    setStaples(loading);
    const unsubscribe = subscribeStaples(familyId, (data) => setStaples(loaded(data)));
    return unsubscribe;
  }, [familyId]);

  const markAsStaple = (name: string) => markItemAsStaple(familyId, name);

  return { staples, markAsStaple };
}
