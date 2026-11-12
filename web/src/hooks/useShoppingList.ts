import { useEffect, useState } from "react";
import {
  addBatchToShoppingList,
  clearDoneShoppingItems,
  createShoppingItem,
  removeShoppingItem,
  subscribeShoppingList,
  type InnleggingsSkriveutfall,
  skrivHandlelisteVersjonert,
  toggleShoppingItemDone,
  transactShoppingNode,
  updateShoppingItemField,
} from "@data/shopping.repository";
import {
  type SammenslaingsPlan,
  angreSammenslaing,
  anvendSammenslaing,
} from "@domain/shopping/handlelisteDuplikater";
import {
  KVITTERINGER,
  type NyRadPlan,
  type OkningsPlan,
  anvendNyRad,
  anvendOkning,
} from "@domain/shopping/handlelisteInnlegging";
import { shoppingMergeRules } from "@domain/shopping/handlelisteRules";
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
  /** Slår sammen eksplisitt valgte duplikater (Mat #20), validert mot fersk node. */
  slaaSammen: (plan: SammenslaingsPlan) => Promise<Sammenslaingsutfall>;
  /** Angrer en sammenslåing, bare hvis ingenting er endret etterpå. */
  angreSammenslaing: (beholdId: string, opId: string) => Promise<Sammenslaingsutfall>;
  /**
   * Manuell innlegging uten treff (Mat #20, ordre 6830803229): ny rad på
   * nøkkelen `plan.opId`, bare hvis den ferske listen fortsatt ikke har en
   * aktiv rad med samme vare. `gjentak`: samme forsøk etter ukjent utfall.
   */
  leggTilNyRad: (plan: NyRadPlan, gjentak?: boolean) => Promise<InnleggingsSkriveutfall>;
  /** «Øk antallet» på én eksplisitt valgt målrad, bare hvis den er slik Helen så den. */
  okAntall: (plan: OkningsPlan, gjentak?: boolean) => Promise<InnleggingsSkriveutfall>;
}

export interface Sammenslaingsutfall {
  utfall: "anvendt" | "allerede" | "konflikt";
  grunn?: string;
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
    addBatchToShoppingList(familyId, existing, newEntries, shoppingMergeRules);
  const toggleDone = (id: string) => toggleShoppingItemDone(familyId, id);
  const updateField = (id: string, field: "name" | "amount" | "cat", value: string) =>
    updateShoppingItemField(familyId, id, field, value);
  const removeItem = (id: string) => removeShoppingItem(familyId, id);
  const clearDone = (items: ShoppingItem[]) => clearDoneShoppingItems(familyId, items);
  const slaaSammen = (plan: SammenslaingsPlan) =>
    transactShoppingNode(familyId, (raw) => anvendSammenslaing(raw, plan));
  const angre = (beholdId: string, opId: string) =>
    transactShoppingNode(familyId, (raw) => angreSammenslaing(raw, beholdId, opId));

  const leggTilNyRad = (plan: NyRadPlan, gjentak = false) =>
    skrivHandlelisteVersjonert(familyId, KVITTERINGER, (raw) => anvendNyRad(raw, plan, gjentak));
  const okAntall = (plan: OkningsPlan, gjentak = false) =>
    skrivHandlelisteVersjonert(familyId, KVITTERINGER, (raw) => anvendOkning(raw, plan, gjentak));

  return {
    shopping,
    addItem,
    addBatch,
    toggleDone,
    updateField,
    removeItem,
    clearDone,
    slaaSammen,
    angreSammenslaing: angre,
    leggTilNyRad,
    okAntall,
  };
}
