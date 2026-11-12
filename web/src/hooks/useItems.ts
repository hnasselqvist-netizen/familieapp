import { useCallback, useEffect, useState } from "react";
import {
  type VareBekreftelse,
  bekreftVareFraServer,
  findOrCreateItem,
  subscribeItems,
} from "@data/items.repository";
import { itemMatchRules } from "@domain/shopping/handlelisteRules";
import type { Vare } from "@app-types/vare";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseItemsResult {
  items: Loadable<Vare[]>;
  findOrCreateItem: (name: string, cat: string) => Promise<Vare | null>;
  /** Bekrefter skrivefritt mot serveren at varen med denne id-en finnes nå. */
  bekreftVare: (id: string) => Promise<VareBekreftelse>;
}

/** React-binding for den delte varebasen — status følger §not_loaded/loading/loaded-kontrakten. */
export function useItems(): UseItemsResult {
  const familyId = useFamilyId();
  const [items, setItems] = useState<Loadable<Vare[]>>(notLoaded);

  useEffect(() => {
    setItems(loading);
    const unsubscribe = subscribeItems(familyId, (data) => setItems(loaded(data)));
    return unsubscribe;
  }, [familyId]);

  const findOrCreate = useCallback(
    (name: string, cat: string) => findOrCreateItem(familyId, name, cat, itemMatchRules),
    [familyId],
  );

  const bekreftVare = useCallback((id: string) => bekreftVareFraServer(familyId, id), [familyId]);

  return { items, findOrCreateItem: findOrCreate, bekreftVare };
}
