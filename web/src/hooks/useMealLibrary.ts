import { useEffect, useState } from "react";
import {
  createMealLibraryEntry,
  removeMealLibraryEntry,
  subscribeMealLibrary,
  transactMealLibraryEntry,
} from "@data/mealLibrary.repository";
import {
  addShoppingBaseItem as addShoppingBaseItemToEntry,
  addVariant as addVariantOnEntry,
  clearShoppingBaseItemToFreeText as clearShoppingBaseItemToFreeTextOnEntry,
  removeShoppingBaseItem as removeShoppingBaseItemFromEntry,
  removeVariant as removeVariantOnEntry,
  replaceShoppingBaseItemFromPicker as replaceShoppingBaseItemFromPickerOnEntry,
  updateEntryFields as updateEntryFieldsOnEntry,
  updateShoppingBaseItemField as updateShoppingBaseItemFieldOnEntry,
  updateVariant as updateVariantOnEntry,
} from "@domain/mealLibrary/mealLibrary";
import type { MealVariantPatch, NewMealVariant } from "@domain/mealLibrary/mealLibrary";
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
    patch: Partial<Pick<MealLibraryEntry, "name" | "lettvint" | "variationTags">>,
  ) => Promise<void>;
  addVariant: (mealId: string, variant: NewMealVariant) => Promise<void>;
  updateVariant: (mealId: string, variantId: string, patch: MealVariantPatch) => Promise<void>;
  removeVariant: (mealId: string, variantId: string) => Promise<void>;
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
 *
 * **Varianter eksponert som brukerfunksjon** (§Helen-review, PR #26,
 * design-review runde 3, §13): `addVariant`/`updateVariant`/
 * `removeVariant` komponerer nå de rene motorfunksjonene
 * (§domain/mealLibrary/mealLibrary.ts) med samme
 * `transactMealLibraryEntry`-mønster som `shoppingBase`-mutasjonene over
 * — motoren fantes allerede fra variantmodell-skivene (PR #18/#19), men
 * manglet frem til nå den nødvendige brukerinngangen. `addVariant`
 * genererer variant-id-en selv (`crypto.randomUUID()`), samme
 * ID-genereringsprinsipp som `addShoppingBaseItem`.
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
    patch: Partial<Pick<MealLibraryEntry, "name" | "lettvint" | "variationTags">>,
  ) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? updateEntryFieldsOnEntry(current, patch) : null,
    );
  };

  const addVariant = async (mealId: string, variant: NewMealVariant) => {
    const variantId = crypto.randomUUID();
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? addVariantOnEntry(current, variantId, variant) : null,
    );
  };

  const updateVariant = async (mealId: string, variantId: string, patch: MealVariantPatch) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? updateVariantOnEntry(current, variantId, patch) : null,
    );
  };

  const removeVariant = async (mealId: string, variantId: string) => {
    await transactMealLibraryEntry(familyId, mealId, (current) =>
      current ? removeVariantOnEntry(current, variantId) : null,
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
    addVariant,
    updateVariant,
    removeVariant,
  };
}
