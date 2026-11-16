/**
 * Eksplisitt målstatus for én rad i React-Handlelisten (Mat #20, ordre
 * 6908431056): «Merk som fullført» og «Merk som ikke fullført». Rene
 * funksjoner — ingen React, Firebase, klokke eller tilfeldighet.
 *
 * Planen er raden Helen trykket på og den boolske statusen hun valgte, ikke
 * en invertering. Beslutningen tas mot den FERSKE posten i samme
 * versjonsbetingede runde som skrivingen (`settHandlelistestatus`):
 * - har posten allerede målstatusen, er det en skrivefri no-op (`allerede`);
 * - er posten borte, opprettes den aldri på nytt (`borte`);
 * - radidentiteten er varegrunnlaget Helen så — navn og varekobling. Er
 *   posten byttet ut med en annen vare under samme nøkkel, står den urørt
 *   (`konflikt`), så status aldri havner på en vare hun ikke valgte;
 * - ellers settes bare `done`. Mengde, kategori og andre samtidige
 *   feltendringer, prioritet og sammenslåingshistorikk går uendret gjennom.
 */
import type { ShoppingItem } from "@app-types/shopping";
import { normaliserNode } from "./handlelisteDuplikater";

/** Raden Helen valgte og statusen hun valgte for den. */
export interface StatusPlan {
  id: string;
  navn: string;
  itemId: string | null;
  maal: boolean;
}

export type StatusBeslutning =
  | { utfall: "sett" }
  | { utfall: "allerede" }
  | { utfall: "borte" }
  | { utfall: "konflikt"; grunn: string };

const erObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const statusNavn = (maal: boolean) => (maal ? "fullført" : "ikke fullført");

/** Planen for den eksplisitte handlingen på raden slik den vises. */
export function lagStatusPlan(rad: ShoppingItem, maal: boolean): StatusPlan {
  return { id: rad.id, navn: rad.name, itemId: rad.itemId ?? null, maal };
}

/** Beslutningen mot den ferske `shopping`-noden. */
export function vurderStatus(raw: unknown, plan: StatusPlan): StatusBeslutning {
  if (!plan.id || plan.id.startsWith("_")) {
    return { utfall: "konflikt", grunn: "Ugyldig rad. Status er ikke endret." };
  }
  const node = normaliserNode(raw ?? {});
  if (!node) {
    return {
      utfall: "konflikt",
      grunn: "Handlelisten har en uventet form. Status er ikke endret.",
    };
  }
  const fersk = node[plan.id];
  if (fersk === undefined || fersk === null) return { utfall: "borte" };
  if (!erObjekt(fersk) || typeof fersk.name !== "string") {
    return { utfall: "konflikt", grunn: "Raden har en uventet form. Status er ikke endret." };
  }
  const itemId = typeof fersk.itemId === "string" ? fersk.itemId : null;
  if (fersk.name !== plan.navn || itemId !== plan.itemId) {
    const hva =
      fersk.name !== plan.navn
        ? `nå «${fersk.name}»`
        : itemId && plan.itemId
          ? "varekoblingen er byttet"
          : itemId
            ? "varekobling er lagt til"
            : "varekoblingen er fjernet";
    return {
      utfall: "konflikt",
      grunn: `«${plan.navn}» er endret på en annen enhet (${hva}). Status er ikke endret — se raden og velg på nytt.`,
    };
  }
  const done = typeof fersk.done === "boolean" ? fersk.done : false;
  return done === plan.maal ? { utfall: "allerede" } : { utfall: "sett" };
}
