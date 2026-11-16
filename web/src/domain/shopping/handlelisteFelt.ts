/**
 * Manuell redigering av navn og kategori på én rad i React-Handlelisten
 * (Mat #20, ordre 6921967679). Rene funksjoner — ingen React, Firebase,
 * klokke eller tilfeldighet.
 *
 * Planen binder endringen til målraden slik Helen så den FØR hun endret
 * feltet — navn og varekobling — og til førverdien for feltet. Beslutningen
 * tas mot den FERSKE posten i samme versjonsbetingede runde som skrivingen
 * (`settHandlelistefelt`):
 * - har feltet allerede den nye verdien, er det en skrivefri no-op;
 * - er posten borte, opprettes den aldri på nytt;
 * - er varekoblingen endret — eller, på en rad uten varekobling, navnet —
 *   er raden ikke lenger den Helen redigerte (`konflikt`);
 * - er feltet endret siden førverdien, står det urørt (`konflikt`);
 * - ellers settes bare feltet.
 *
 * For navn er navnet selv både identitet og førverdi: et navn endret på en
 * annen enhet gir konflikt, aldri en stille overskriving.
 *
 * Dagens semantikk bevares: navn lagres slik det er skrevet; manglende eller
 * `null` kategori vises og sammenlignes som «Diverse». Andre verdier er
 * uleselige og overskrives aldri. Varekoblingen endres aldri her.
 */
import type { ShoppingItem } from "@app-types/shopping";
import { normaliserNode } from "./handlelisteDuplikater";

export type Felt = "name" | "cat";

/** Endringen Helen vil lagre, bundet til raden og feltverdien hun så. */
export interface FeltPlan {
  id: string;
  felt: Felt;
  /** Radens navn da redigeringen begynte (identitet). */
  navn: string;
  itemId: string | null;
  /** Feltets verdi da redigeringen begynte (normalisert). */
  foer: string;
  ny: string;
}

export type FeltBeslutning =
  | { utfall: "sett" }
  | { utfall: "allerede" }
  | { utfall: "borte" }
  | { utfall: "konflikt"; grunn: string };

export type FeltLesing =
  | { utfall: "borte" }
  | { utfall: "lest"; verdi: string }
  | { utfall: "erstattet"; grunn: string }
  | { utfall: "misformet" };

export const FELTNAVN: Record<Felt, string> = { name: "navnet", cat: "kategorien" };
const STANDARD_KATEGORI = "Diverse";

const erObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Feltverdi etter dagens semantikk; `null` = uleselig. */
export function normaliserFelt(felt: Felt, v: unknown): string | null {
  if (felt === "cat" && (v === undefined || v === null)) return STANDARD_KATEGORI;
  return typeof v === "string" ? v : null;
}

/** Feltets verdi slik raden vises nå. */
export const synligFelt = (rad: ShoppingItem, felt: Felt): string =>
  normaliserFelt(felt, felt === "name" ? rad.name : rad.cat) ?? "";

/** Planen for en endring på raden slik den vises. */
export function lagFeltPlan(rad: ShoppingItem, felt: Felt, foer: string, ny: string): FeltPlan {
  return { id: rad.id, felt, navn: rad.name, itemId: rad.itemId ?? null, foer, ny };
}

const vis = (v: string) => `«${v}»`;
const UTKAST = "Ingenting er lagret.";

type Fersk =
  | { type: "borte" }
  | { type: "misformet"; grunn: string }
  | { type: "erstattet"; grunn: string }
  | { type: "rad"; verdi: string };

/** Felles vurdering av målraden for skriving og skrivefri kontroll. */
function vurderFersk(raw: unknown, plan: FeltPlan): Fersk {
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
  if (itemId !== plan.itemId) {
    const hva =
      itemId && plan.itemId
        ? "varekoblingen er byttet"
        : itemId
          ? "varekobling er lagt til"
          : "varekoblingen er fjernet";
    return { type: "erstattet", grunn: `«${plan.navn}» er endret på en annen enhet (${hva}).` };
  }
  // Ved navneendring er navnet feltet selv. For kategori er varekoblingen
  // identiteten når raden har en; uten varekobling er navnet det eneste som
  // skiller varene, så et endret navn kan bety en annen vare.
  if (plan.felt === "cat" && plan.itemId === null && fersk.name !== plan.navn) {
    return {
      type: "erstattet",
      grunn: `«${plan.navn}» er endret på en annen enhet (nå «${fersk.name}»).`,
    };
  }
  const verdi = normaliserFelt(plan.felt, fersk[plan.felt]);
  if (verdi === null) {
    return {
      type: "misformet",
      grunn: `${FELTNAVN[plan.felt]} på «${plan.navn}» har en uventet form. ${UTKAST}`,
    };
  }
  return { type: "rad", verdi };
}

/** Beslutningen mot den ferske `shopping`-noden. */
export function vurderFelt(raw: unknown, plan: FeltPlan): FeltBeslutning {
  const f = vurderFersk(raw, plan);
  switch (f.type) {
    case "borte":
      return { utfall: "borte" };
    case "misformet":
      return { utfall: "konflikt", grunn: f.grunn.replace(/^./, (c) => c.toUpperCase()) };
    case "erstattet":
      return { utfall: "konflikt", grunn: `${f.grunn} ${UTKAST}` };
    case "rad":
      if (f.verdi === plan.ny) return { utfall: "allerede" };
      if (f.verdi !== plan.foer) {
        return {
          utfall: "konflikt",
          grunn: `${FELTNAVN[plan.felt].replace(/^./, (c) => c.toUpperCase())} på «${plan.navn}» er endret på en annen enhet (${vis(plan.foer)} → ${vis(f.verdi)}) mens du redigerte. ${UTKAST}`,
        };
      }
      return { utfall: "sett" };
  }
}

/** Den skrivefrie kontrollen etter ukjent utfall: samme radidentitet. */
export function lesFelt(raw: unknown, plan: FeltPlan): FeltLesing {
  const f = vurderFersk(raw, plan);
  switch (f.type) {
    case "borte":
      return { utfall: "borte" };
    case "misformet":
      return { utfall: "misformet" };
    case "erstattet":
      return { utfall: "erstattet", grunn: f.grunn };
    case "rad":
      return { utfall: "lest", verdi: f.verdi };
  }
}
