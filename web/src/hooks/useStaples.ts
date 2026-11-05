import { useEffect, useState } from "react";
import { markItemAsStaple, removeStaple, subscribeStaples } from "@data/staples.repository";
import { UgyldigBasisvarenavn, basisvareNokkel } from "@domain/shopping/basisvare";
import type { Staples } from "@app-types/shopping";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseStaplesResult {
  staples: Loadable<Staples>;
  markAsStaple: (name: string) => Promise<void>;
  /** Nytt i Kjøkken v1 — se `data/staples.repository.ts` sin `removeStaple`. */
  unmarkStaple: (name: string) => Promise<void>;
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

  // Nøkkelen kontrolleres før skriving (#20, ordre 6651329875): et navn som
  // ikke kan være én RTDB-nøkkel skrives aldri, så det kan ikke lage
  // undernoder eller treffe en bredere sti. Gyldige navn skrives som før
  // (`navn.toLowerCase()` i adapteren). Gjelder alle skrivere via hooken.
  const markAsStaple = async (name: string) => {
    const n = basisvareNokkel(name);
    if (!n.ok) throw new UgyldigBasisvarenavn(n.grunn);
    await markItemAsStaple(familyId, name);
  };
  const unmarkStaple = (name: string) => removeStaple(familyId, name);

  return { staples, markAsStaple, unmarkStaple };
}
