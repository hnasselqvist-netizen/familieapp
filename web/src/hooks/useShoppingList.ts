import { useEffect, useState } from "react";
import {
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
  const toggleDone = (id: string) => toggleShoppingItemDone(familyId, id);
  const updateField = (id: string, field: "name" | "amount" | "cat", value: string) =>
    updateShoppingItemField(familyId, id, field, value);
  const removeItem = (id: string) => removeShoppingItem(familyId, id);
  const clearDone = (items: ShoppingItem[]) => clearDoneShoppingItems(familyId, items);

  return { shopping, addItem, toggleDone, updateField, removeItem, clearDone };
}
