/**
 * Manuell redigering av mengde på én rad i React-Handlelisten (Mat #20,
 * ordre 6914072575). Rene funksjoner — ingen React, Firebase, klokke eller
 * tilfeldighet.
 *
 * Utkastet holdes lokalt til Helen lagrer. Planen binder det til målraden
 * slik hun så den (navn og varekobling) og til førverdien for mengden.
 * Beslutningen tas mot den FERSKE posten i samme versjonsbetingede runde
 * som skrivingen (`settHandlelistemengde`):
 * - er mengden allerede utkastet, er det en skrivefri no-op (`allerede`);
 * - er posten borte, opprettes den aldri på nytt (`borte`);
 * - er posten byttet ut med en annen vare, eller er mengden endret siden
 *   førverdien, står den urørt (`konflikt`) og utkastet beholdes;
 * - ellers settes bare `amount`.
 *
 * Mengde følger dagens semantikk: manglende eller `null` mengde vises og
 * sammenlignes som tom (`""`), og tom mengde er gyldig å lagre. Tall (eldre
 * data) sammenlignes som tekst. Alle andre verdier er uleselige og
 * overskrives aldri.
 */
import type { ShoppingItem } from "@app-types/shopping";
import { normaliserNode } from "./handlelisteDuplikater";

/** Utkastet Helen vil lagre, bundet til raden og mengden hun så. */
export interface MengdePlan {
  id: string;
  navn: string;
  itemId: string | null;
  /** Mengden slik den var da Helen begynte å redigere (normalisert). */
  foer: string;
  /** Utkastet. */
  ny: string;
}

export type MengdeBeslutning =
  | { utfall: "sett" }
  | { utfall: "allerede" }
  | { utfall: "borte" }
  | { utfall: "konflikt"; grunn: string };

export type MengdeLesing =
  | { utfall: "borte" }
  | { utfall: "lest"; mengde: string }
  | { utfall: "erstattet"; grunn: string }
  | { utfall: "misformet" };

const erObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Mengde etter dagens semantikk; `null` = uleselig. */
export function normaliserMengde(v: unknown): string | null {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

/** Planen for et utkast på raden slik den vises. */
export function lagMengdePlan(rad: ShoppingItem, foer: string, ny: string): MengdePlan {
  return { id: rad.id, navn: rad.name, itemId: rad.itemId ?? null, foer, ny };
}

/** Førverdien for et nytt utkast: mengden slik raden vises nå. */
export const synligMengde = (rad: ShoppingItem): string => normaliserMengde(rad.amount) ?? "";

type Fersk =
  | { type: "borte" }
  | { type: "misformet"; grunn: string }
  | { type: "erstattet"; grunn: string }
  | { type: "rad"; mengde: string };

const UTKAST = "Mengden er ikke lagret — utkastet ditt står.";

/** Felles vurdering av målraden for skriving og skrivefri kontroll. */
function vurderFersk(raw: unknown, plan: MengdePlan): Fersk {
  if (!plan.id || plan.id.startsWith("_")) {
    return { type: "misformet", grunn: `Ugyldig rad. ${UTKAST}` };
  }
  const node = normaliserNode(raw ?? {});
  if (!node) return { type: "misformet", grunn: `Handlelisten har en uventet form. ${UTKAST}` };
  const fersk = node[plan.id];
  if (fersk === undefined || fersk === null) return { type: "borte" };
  if (!erObjekt(fersk) || typeof fersk.name !== "string") {
    return { type: "misformet", grunn: `Raden har en uventet form. ${UTKAST}` };
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
    return { type: "erstattet", grunn: `«${plan.navn}» er endret på en annen enhet (${hva}).` };
  }
  const mengde = normaliserMengde(fersk.amount);
  if (mengde === null) {
    return { type: "misformet", grunn: `Mengden på «${plan.navn}» har en uventet form. ${UTKAST}` };
  }
  return { type: "rad", mengde };
}

const vis = (m: string) => (m === "" ? "ingen" : `«${m}»`);

/** Beslutningen mot den ferske `shopping`-noden. */
export function vurderMengde(raw: unknown, plan: MengdePlan): MengdeBeslutning {
  const f = vurderFersk(raw, plan);
  switch (f.type) {
    case "borte":
      return { utfall: "borte" };
    case "misformet":
      return { utfall: "konflikt", grunn: f.grunn };
    case "erstattet":
      return { utfall: "konflikt", grunn: `${f.grunn} ${UTKAST}` };
    case "rad":
      if (f.mengde === plan.ny) return { utfall: "allerede" };
      if (f.mengde !== plan.foer) {
        return {
          utfall: "konflikt",
          grunn: `Mengden på «${plan.navn}» er endret på en annen enhet (${vis(plan.foer)} → ${vis(f.mengde)}) mens du redigerte. ${UTKAST}`,
        };
      }
      return { utfall: "sett" };
  }
}

/** Den skrivefrie kontrollen etter ukjent utfall: samme radidentitet. */
export function lesMengde(raw: unknown, plan: MengdePlan): MengdeLesing {
  const f = vurderFersk(raw, plan);
  switch (f.type) {
    case "borte":
      return { utfall: "borte" };
    case "misformet":
      return { utfall: "misformet" };
    case "erstattet":
      return { utfall: "erstattet", grunn: f.grunn };
    case "rad":
      return { utfall: "lest", mengde: f.mengde };
  }
}
