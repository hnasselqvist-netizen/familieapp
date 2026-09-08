import { useEffect, useState } from "react";
import {
  addBatchToShoppingList,
  clearDoneShoppingItems,
  createShoppingItem,
  removeShoppingItem,
  subscribeShoppingList,
  toggleShoppingItemDone,
  updateShoppingItemField,
} from "@data/shopping.repository";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseShoppingListResult {
  shopping: Loadable<ShoppingItem[]>;
  addItem: (fields: ShoppingListEntry) => Promise<ShoppingItem>;
  addBatch: (existing: ShoppingItem[], newEntries: ShoppingListEntry[]) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
  updateField: (id: string, field: "name" | "amount" | "cat", value: string) => Promise<void>;
  removeItem: (id: string) => Promise<void>;
  clearDone: (items: ShoppingItem[]) => Promise<void>;
}

/** React-binding for handlelisten — status følger §not_loaded/loading/loaded-kontrakten. */
export function useShoppingList(): UseShoppingListResult {
  const familyId = useFamilyId();
  const [shopping, setShopping] = useState<Loadable<ShoppingItem[]>>(notLoaded);

  useEffect(() => {
    setShopping(loading);
    const unsubscribe = subscribeShoppingList(familyId, (data) => setShopping(loaded(data)));
    return unsubscribe;
  }, [familyId]);

  const addItem = (fields: ShoppingListEntry) => createShoppingItem(familyId, fields);
  const addBatch = (existing: ShoppingItem[], newEntries: ShoppingListEntry[]) =>
    addBatchToShoppingList(familyId, existing, newEntries);
  const toggleDone = (id: string) => toggleShoppingItemDone(familyId, id);
  const updateField = (id: string, field: "name" | "amount" | "cat", value: string) =>
    updateShoppingItemField(familyId, id, field, value);
  const removeItem = (id: string) => removeShoppingItem(familyId, id);
  const clearDone = (items: ShoppingItem[]) => clearDoneShoppingItems(familyId, items);

  return { shopping, addItem, addBatch, toggleDone, updateField, removeItem, clearDone };
}
