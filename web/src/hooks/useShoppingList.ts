import { useEffect, useState } from "react";
import {
  clearDoneShoppingItems,
  createShoppingItem,
  fjernHandlelistepost,
  subscribeShoppingList,
  type InnleggingsSkriveutfall,
  skrivHandlelisteNode,
  skrivHandlelisteVersjonert,
  toggleShoppingItemDone,
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
import { type FjernPlan, vurderFjerning } from "@domain/shopping/handlelisteFjerning";
import { type GeneratorPlan, anvendGeneratorPlan } from "@domain/shopping/handlelisteGenerator";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseShoppingListResult {
  shopping: Loadable<ShoppingItem[]>;
  addItem: (fields: ShoppingListEntry) => Promise<ShoppingItem>;
  /**
   * Handlelistegeneratorens «Legg til N varer» (Mat #20, ordre 6843084184):
   * én versjonsbetinget operasjon med stabil `plan.opId`, bare hvis den
   * ferske listen gir samme effekter som forhåndsvisningen. `gjentak`: samme
   * forsøk etter ukjent utfall — avgjøres bare mot kvitteringen, skrivefritt.
   */
  leggTilFraGenerator: (plan: GeneratorPlan, gjentak?: boolean) => Promise<InnleggingsSkriveutfall>;
  toggleDone: (id: string) => Promise<void>;
  updateField: (id: string, field: "name" | "amount" | "cat", value: string) => Promise<void>;
  /**
   * «Fjern» på én rad med grunnlagsvern (Mat #20, ordre 6903150917): raden
   * slettes bare hvis den ferske posten er slik Helen så den (`plan.sett`).
   */
  fjernRad: (plan: FjernPlan) => Promise<InnleggingsSkriveutfall>;
  clearDone: (items: ShoppingItem[]) => Promise<void>;
  /** Slår sammen eksplisitt valgte duplikater (Mat #20), validert mot fersk node. */
  /** `gjentak`: samme plan etter ukjent utfall — avgjøres bare mot historikken. */
  slaaSammen: (plan: SammenslaingsPlan, gjentak?: boolean) => Promise<Sammenslaingsutfall>;
  /** Angrer en sammenslåing, bare hvis ingenting er endret etterpå. */
  angreSammenslaing: (
    beholdId: string,
    opId: string,
    gjentak?: boolean,
  ) => Promise<Sammenslaingsutfall>;
  /**
   * Manuell innlegging uten treff (Mat #20, ordre 6830803229): ny rad på
   * nøkkelen `plan.opId`, bare hvis den ferske listen fortsatt ikke har en
   * aktiv rad med samme vare. `gjentak`: samme forsøk etter ukjent utfall.
   */
  leggTilNyRad: (plan: NyRadPlan, gjentak?: boolean) => Promise<InnleggingsSkriveutfall>;
  /** «Øk antallet» på én eksplisitt valgt målrad, bare hvis den er slik Helen så den. */
  okAntall: (plan: OkningsPlan, gjentak?: boolean) => Promise<InnleggingsSkriveutfall>;
}

/**
 * Utfall av sammenslåing/angring (versjonsbetinget, Mat #20 ordre
 * 6837116507). Bare `anvendt` har endret noe; `ukjent` betyr at svaret på
 * selve skrivingen uteble — samme operasjon (samme `opId`) kan sendes igjen.
 */
export interface Sammenslaingsutfall {
  utfall: "anvendt" | "allerede" | "konflikt" | "ubekreftet" | "avvist" | "ikkeLest" | "ukjent";
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
  const toggleDone = (id: string) => toggleShoppingItemDone(familyId, id);
  const updateField = (id: string, field: "name" | "amount" | "cat", value: string) =>
    updateShoppingItemField(familyId, id, field, value);
  const fjernRad = (plan: FjernPlan) =>
    fjernHandlelistepost(familyId, plan.id, (raw) => vurderFjerning(raw, plan));
  const clearDone = (items: ShoppingItem[]) => clearDoneShoppingItems(familyId, items);
  const slaaSammen = (plan: SammenslaingsPlan, gjentak = false) =>
    skrivHandlelisteNode(familyId, (raw) => anvendSammenslaing(raw, plan, gjentak));
  const angre = (beholdId: string, opId: string, gjentak = false) =>
    skrivHandlelisteNode(familyId, (raw) => angreSammenslaing(raw, beholdId, opId, gjentak));

  const leggTilNyRad = (plan: NyRadPlan, gjentak = false) =>
    skrivHandlelisteVersjonert(familyId, KVITTERINGER, (raw) => anvendNyRad(raw, plan, gjentak));
  const okAntall = (plan: OkningsPlan, gjentak = false) =>
    skrivHandlelisteVersjonert(familyId, KVITTERINGER, (raw) => anvendOkning(raw, plan, gjentak));
  const leggTilFraGenerator = (plan: GeneratorPlan, gjentak = false) =>
    skrivHandlelisteVersjonert(familyId, KVITTERINGER, (raw) =>
      anvendGeneratorPlan(raw, plan, gjentak),
    );

  return {
    shopping,
    addItem,
    toggleDone,
    updateField,
    fjernRad,
    clearDone,
    slaaSammen,
    angreSammenslaing: angre,
    leggTilNyRad,
    okAntall,
    leggTilFraGenerator,
  };
}
