import { useEffect, useState } from "react";
import {
  type BasisvareFjerningUtfall,
  fjernBasisvareVersjonert,
  markItemAsStaple,
  subscribeStaples,
} from "@data/staples.repository";
import { UgyldigBasisvarenavn, basisvareMaal, basisvareNokkel } from "@domain/shopping/basisvare";
import { erFjernbarBasisvare, vurderBasisvareFjerning } from "@domain/shopping/basisvareFjerning";
import type { Staples } from "@app-types/shopping";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export type BasisvareFjerningResultat = BasisvareFjerningUtfall | { utfall: "ugyldig" };

export interface UseStaplesResult {
  staples: Loadable<Staples>;
  /**
   * Nøklene Matlager kan tilby «Fjern» for: samme beslutning som fjerningen,
   * tatt på abonnementets eksportform (review 5939383134). Usortert.
   */
  fjernbareBasisvarer: readonly string[];
  markAsStaple: (name: string) => Promise<void>;
  /**
   * Fjerner en basisvaremarkering på EKSAKT lagret nøkkel, bare hvis verdien
   * fortsatt er `true` (Mat #20, ordre 6948538722). Nøkkelen normaliseres
   * aldri; en nøkkel som ikke er én gyldig RTDB-nøkkel gir `ugyldig` uten
   * skriving.
   */
  fjernBasisvare: (nokkel: string) => Promise<BasisvareFjerningResultat>;
}

/** React-binding for basisvarer — status følger §not_loaded/loading/loaded-kontrakten. */
export function useStaples(): UseStaplesResult {
  const familyId = useFamilyId();
  const [staples, setStaples] = useState<Loadable<Staples>>(notLoaded);
  const [eksport, setEksport] = useState<Readonly<Record<string, unknown>>>({});

  useEffect(() => {
    setStaples(loading);
    const unsubscribe = subscribeStaples(familyId, (data, eks) => {
      setStaples(loaded(data));
      setEksport(eks);
    });
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
  const fjernBasisvare = async (nokkel: string): Promise<BasisvareFjerningResultat> => {
    if (!basisvareMaal(nokkel).ok) return { utfall: "ugyldig" };
    return fjernBasisvareVersjonert(familyId, nokkel, vurderBasisvareFjerning);
  };

  const fjernbareBasisvarer = Object.keys(eksport).filter((k) =>
    erFjernbarBasisvare(k, eksport[k]),
  );

  return { staples, fjernbareBasisvarer, markAsStaple, fjernBasisvare };
}
