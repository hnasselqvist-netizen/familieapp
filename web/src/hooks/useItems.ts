import { useCallback, useEffect, useState } from "react";
import { findOrCreateItem, subscribeItems } from "@data/items.repository";
import type { Vare } from "@app-types/vare";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseItemsResult {
  items: Loadable<Vare[]>;
  findOrCreateItem: (name: string, cat: string) => Promise<Vare | null>;
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
    (name: string, cat: string) => findOrCreateItem(familyId, name, cat),
    [familyId],
  );

  return { items, findOrCreateItem: findOrCreate };
}
