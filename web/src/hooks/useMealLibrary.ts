import { useEffect, useState } from "react";
import {
  createMealLibraryEntry,
  removeMealLibraryEntry,
  subscribeMealLibrary,
  transactMealLibraryEntry,
} from "@data/mealLibrary.repository";
import {
  addShoppingBaseItem as addShoppingBaseItemToEntry,
  clearShoppingBaseItemToFreeText as clearShoppingBaseItemToFreeTextOnEntry,
  removeShoppingBaseItem as removeShoppingBaseItemFromEntry,
  replaceShoppingBaseItemFromPicker as replaceShoppingBaseItemFromPickerOnEntry,
  updateEntryFields as updateEntryFieldsOnEntry,
  updateShoppingBaseItemField as updateShoppingBaseItemFieldOnEntry,
} from "@domain/mealLibrary/mealLibrary";
import type { MealLibraryEntry } from "@app-types/shopping";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseMealLibraryResult {
  mealLibrary: Loadable<MealLibraryEntry[]>;
  addEntry: (name: string) => Promise<MealLibraryEntry>;
  removeEntry: (id: string) => Promise<void>;
  addShoppingBaseItem: (
    mealId: string,
    vare: { itemId: string; name: string; cat: string },
  ) => Promise<void>;
  updateShoppingBaseItemField: (
    mealId: string,
    itemId: string,
    field: "amount" | "unit",
    value: string,
  ) => Promise<void>;
  clearShoppingBaseItemToFreeText: (mealId: string, itemId: string, name: string) => Promise<void>;
  replaceShoppingBaseItemFromPicker: (
    mealId: string,
    itemId: string,
    vare: { id: string; name: string; cat: string },
  ) => Promise<void>;
  removeShoppingBaseItem: (mealId: string, itemId: string) => Promise<void>;
  updateEntryFields: (
    mealId: string,
    patch: Partial<Pick<MealLibraryEntry, "lettvint" | "variationTags">>,
  ) => Promise<void>;
}

/**
 * React-binding for Middagsbiblioteket. `shoppingBase`-mutasjonene
 * komponerer `transactMealLibraryEntry` (§data/mealLibrary.repository.ts)
 * med de rene motorfunksjonene (§domain/mealLibrary/mealLibrary.ts) —
 * samme mønster som `useFreezer` allerede bruker for
 * `transactFreezerItem` + domenefunksjonene der.
 *
 * `current===null` på speculativt (kaldt cache-)kall håndteres med
 * `return null` (aldri `undefined`) — se `transactMealLibraryEntry` sin
 * toppkommentar for hvorfor: en harmløs, retriable verdi som overstyres
 * av den ferske server-verdien dersom måltidet faktisk finnes.
 */
export function useMealLibrary(): UseMealLibraryResult {
  const familyId = useFamilyId();
  const [mealLibrary, setMealLibrary] = useState<Loadable<MealLibraryEntry[]>>(notLoaded);

  useEffect(() => {
    setMealLibrary(loading);
    const unsubscribe = subscribeMealLibrary(familyId, (data) => setMealLibrary(loaded(data)));
    return unsubscribe;
  }, [familyId]);

  const addEntry = (name: string) => createMealLibraryEntry(familyId, name);
  const removeEntry = (id: string) => removeMealLibraryEntry(familyId, id);

  const addShoppingBaseItem = async (
    mealId: string,
    vare: { itemId: string; name: string; cat: string },
  ) => {
    const rowId = crypto.randomUUID();
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? addShoppingBaseItemToEntry(current, rowId, vare) : null,
    );
  };

  const updateShoppingBaseItemField = async (
    mealId: string,
    itemId: string,
    field: "amount" | "unit",
    value: string,
  ) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? updateShoppingBaseItemFieldOnEntry(current, itemId, field, value) : null,
    );
  };

  const clearShoppingBaseItemToFreeText = async (mealId: string, itemId: string, name: string) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? clearShoppingBaseItemToFreeTextOnEntry(current, itemId, name) : null,
    );
  };

  const replaceShoppingBaseItemFromPicker = async (
    mealId: string,
    itemId: string,
    vare: { id: string; name: string; cat: string },
  ) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? replaceShoppingBaseItemFromPickerOnEntry(current, itemId, vare) : null,
    );
  };

  const removeShoppingBaseItem = async (mealId: string, itemId: string) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? removeShoppingBaseItemFromEntry(current, itemId) : null,
    );
  };

  const updateEntryFields = async (
    mealId: string,
    patch: Partial<Pick<MealLibraryEntry, "lettvint" | "variationTags">>,
  ) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? updateEntryFieldsOnEntry(current, patch) : null,
    );
  };

  return {
    mealLibrary,
    addEntry,
    removeEntry,
    addShoppingBaseItem,
    updateShoppingBaseItemField,
    clearShoppingBaseItemToFreeText,
    replaceShoppingBaseItemFromPicker,
    removeShoppingBaseItem,
    updateEntryFields,
  };
}
