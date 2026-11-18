import { useEffect, useState } from "react";
import {
  createShoppingItem,
  fjernFullfortePoster,
  lesHandlelistestatus,
  settHandlelistefelt,
  settHandlelistemengde,
  settHandlelistestatus,
  type LeseAvslag,
  fjernHandlelistepost,
  type PosterSjekk,
  sjekkHandlelisteposter,
  type PostSjekk,
  sjekkHandlelistepost,
  subscribeShoppingList,
  type InnleggingsSkriveutfall,
  skrivHandlelisteNode,
  skrivHandlelisteVersjonert,
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
import {
  type FjernFullfortePlan,
  type FullforteOppsummering,
  vurderFjernFullforte,
} from "@domain/shopping/handlelisteFjernFullforte";
import { type FjernPlan, vurderFjerning } from "@domain/shopping/handlelisteFjerning";
import {
  type FeltLesing,
  type FeltPlan,
  lesFelt,
  vurderFelt,
} from "@domain/shopping/handlelisteFelt";
import {
  type MengdeLesing,
  type MengdePlan,
  lesMengde,
  vurderMengde,
} from "@domain/shopping/handlelisteMengde";
import {
  type StatusLesing,
  type StatusPlan,
  lesStatus,
  vurderStatus,
} from "@domain/shopping/handlelisteStatus";
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
  /**
   * «Merk som fullført»/«Merk som ikke fullført» (Mat #20, ordre
   * 6908431056): eksplisitt målstatus i én versjonsbetinget operasjon.
   */
  settStatus: (plan: StatusPlan) => Promise<InnleggingsSkriveutfall>;
  /**
   * Manuell mengde (Mat #20, ordre 6914072575): et lokalt utkast bundet til
   * raden og førverdien, lagret i én versjonsbetinget operasjon.
   */
  settMengde: (plan: MengdePlan) => Promise<InnleggingsSkriveutfall>;
  /** Skrivefri, identitetsbundet kontroll etter ukjent utfall: mengden nå. */
  sjekkMengde: (plan: MengdePlan) => Promise<MengdeLesing | LeseAvslag>;
  /**
   * Navn og kategori (Mat #20, ordre 6921967679): bundet til raden og
   * førverdien, lagret i én versjonsbetinget operasjon.
   */
  settFelt: (plan: FeltPlan) => Promise<InnleggingsSkriveutfall>;
  /** Skrivefri, identitetsbundet kontroll etter ukjent utfall: feltet nå. */
  sjekkFelt: (plan: FeltPlan) => Promise<FeltLesing | LeseAvslag>;
  /** Skrivefri kontroll etter ukjent utfall: radens status nå. */
  sjekkStatus: (plan: StatusPlan) => Promise<StatusLesing | LeseAvslag>;
  updateField: (id: string, field: "name" | "amount" | "cat", value: string) => Promise<void>;
  /**
   * «Fjern» på én rad med grunnlagsvern (Mat #20, ordre 6903150917): raden
   * slettes bare hvis den ferske posten er slik Helen så den (`plan.sett`).
   */
  fjernRad: (plan: FjernPlan) => Promise<InnleggingsSkriveutfall>;
  /** Skrivefri oppfølging etter ukjent utfall: finnes raden nå? Sletter aldri. */
  sjekkFjerning: (plan: FjernPlan) => Promise<PostSjekk>;
  /**
   * «Fjern fullførte» (Mat #20, ordre 6905636191): én versjonsbetinget
   * operasjon for de planlagte radene; `detaljer` skiller fjernet, beholdt
   * og allerede borte.
   */
  fjernFullforte: (
    plan: FjernFullfortePlan,
  ) => Promise<InnleggingsSkriveutfall & { detaljer?: FullforteOppsummering }>;
  /** Skrivefri oppfølging etter ukjent utfall: hvilke av radene finnes nå? */
  sjekkFjernFullforte: (plan: FjernFullfortePlan) => Promise<PosterSjekk>;
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
  utfall:
    | "anvendt"
    | "allerede"
    | "konflikt"
    | "ubekreftet"
    | "avvist"
    | "ikkeLest"
    | "byttet"
    | "ukjent";
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
  const settStatus = (plan: StatusPlan) =>
    settHandlelistestatus(
      familyId,
      plan.id,
      plan.maal,
      (raw) => vurderStatus(raw, plan),
      `«${plan.navn}» er ikke lenger på listen. Ingenting er endret.`,
    );
  const settMengde = (plan: MengdePlan) =>
    settHandlelistemengde(
      familyId,
      plan.id,
      plan.ny,
      (raw) => vurderMengde(raw, plan),
      `«${plan.navn}» er ikke lenger på listen. Mengden er ikke lagret.`,
    );
  const sjekkMengde = (plan: MengdePlan) =>
    lesHandlelistestatus(familyId, (raw) => lesMengde(raw, plan));
  const settFelt = (plan: FeltPlan) =>
    settHandlelistefelt(
      familyId,
      plan.id,
      plan.felt,
      plan.ny,
      (raw) => vurderFelt(raw, plan),
      `«${plan.navn}» er ikke lenger på listen. Ingenting er lagret.`,
    );
  const sjekkFelt = (plan: FeltPlan) => lesHandlelistestatus(familyId, (raw) => lesFelt(raw, plan));
  const sjekkStatus = (plan: StatusPlan) =>
    lesHandlelistestatus(familyId, (raw) => lesStatus(raw, plan));
  const updateField = (id: string, field: "name" | "amount" | "cat", value: string) =>
    updateShoppingItemField(familyId, id, field, value);
  const fjernRad = (plan: FjernPlan) =>
    fjernHandlelistepost(familyId, plan.id, plan.grunnlag, (raw, raaLik) =>
      vurderFjerning(raw, plan, raaLik),
    );
  const sjekkFjerning = (plan: FjernPlan) => sjekkHandlelistepost(familyId, plan.id);
  const fjernFullforte = (plan: FjernFullfortePlan) =>
    fjernFullfortePoster(
      familyId,
      Object.fromEntries(plan.rader.map((r) => [r.id, r.grunnlag])),
      (raw, raaLik) => vurderFjernFullforte(raw, plan, raaLik),
    );
  const sjekkFjernFullforte = (plan: FjernFullfortePlan) =>
    sjekkHandlelisteposter(
      familyId,
      plan.rader.map((r) => r.id),
    );
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
    settStatus,
    sjekkStatus,
    settMengde,
    sjekkMengde,
    settFelt,
    sjekkFelt,
    updateField,
    fjernRad,
    sjekkFjerning,
    fjernFullforte,
    sjekkFjernFullforte,
    slaaSammen,
    angreSammenslaing: angre,
    leggTilNyRad,
    okAntall,
    leggTilFraGenerator,
  };
}
