/**
 * «Fjern» på én rad i React-Handlelisten (Mat #20, ordre 6903150917) med
 * grunnlagsvern. Rene funksjoner — ingen React, Firebase, klokke eller
 * tilfeldighet.
 *
 * Planen er raden slik Helen så den da hun trykket «Fjern». Beslutningen tas
 * mot den FERSKE posten i samme versjonsbetingede runde som slettingen
 * (`fjernHandlelistepost`, ETag/if-match): er raden uendret, slettes den; er
 * den endret (mengde, varekobling, fullførtstatus, navn eller kategori),
 * står den, og grunnen viser hva som er endret, så Helen kan se den
 * oppdaterte raden før et nytt valg. En post som allerede er borte gir et
 * eget, entydig utfall.
 *
 * Ingen kvittering trengs: slettingen er versjonsbetinget og idempotent på
 * samme grunnlag. Et gjentak etter ukjent svar avgjøres på nytt mot fersk
 * tilstand — borte gir `borte`, uendret slettes, endret står.
 */
import type { ShoppingItem } from "@app-types/shopping";
import {
  normaliserNode,
  stabil,
  synlig,
  synligFraRaa,
  type SynligRad,
} from "./handlelisteDuplikater";

/** Det Helen så av raden hun valgte å fjerne. */
export interface FjernPlan {
  id: string;
  sett: SynligRad;
}

export type FjernBeslutning =
  { utfall: "fjern" } | { utfall: "borte" } | { utfall: "konflikt"; grunn: string };

const erObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Planen for «Fjern» på raden slik den vises. */
export function lagFjernPlan(rad: ShoppingItem): FjernPlan {
  return { id: rad.id, sett: synlig(rad) };
}

const FELT: { felt: keyof SynligRad; navn: string; vis: (v: SynligRad) => string }[] = [
  { felt: "name", navn: "navn", vis: (r) => `«${r.name}»` },
  { felt: "amount", navn: "mengde", vis: (r) => (r.amount ? r.amount : "ingen") },
  { felt: "itemId", navn: "varekobling", vis: (r) => (r.itemId ? "koblet" : "ingen") },
  { felt: "done", navn: "status", vis: (r) => (r.done ? "fullført" : "ikke fullført") },
  { felt: "cat", navn: "kategori", vis: (r) => r.cat },
];

/** Lesbar oppsummering av hva som er endret siden Helen så raden. */
export function beskrivEndring(sett: SynligRad, naa: SynligRad): string {
  return FELT.filter(({ felt }) => sett[felt] !== naa[felt])
    .map(({ felt, navn, vis }) =>
      felt === "itemId" && sett.itemId && naa.itemId
        ? "varekobling er byttet"
        : `${navn} ${vis(sett)} → ${vis(naa)}`,
    )
    .join(", ");
}

/** Beslutningen mot den ferske `shopping`-noden. */
export function vurderFjerning(raw: unknown, plan: FjernPlan): FjernBeslutning {
  if (!plan.id || plan.id.startsWith("_")) {
    return { utfall: "konflikt", grunn: "Ugyldig rad. Ingenting er fjernet." };
  }
  const node = normaliserNode(raw);
  if (!node)
    return { utfall: "konflikt", grunn: "Handlelisten har en uventet form. Ingenting er fjernet." };
  const fersk = node[plan.id];
  if (fersk === undefined || fersk === null) return { utfall: "borte" };
  if (!erObjekt(fersk) || typeof fersk.name !== "string") {
    return { utfall: "konflikt", grunn: "Raden har en uventet form. Ingenting er fjernet." };
  }
  const naa = synligFraRaa(fersk);
  if (stabil(naa) === stabil(plan.sett)) return { utfall: "fjern" };
  return {
    utfall: "konflikt",
    grunn: `«${plan.sett.name}» er endret på en annen enhet siden du så den (${beskrivEndring(plan.sett, naa)}). Den er ikke fjernet — se den oppdaterte raden og trykk «Fjern» igjen hvis den fortsatt skal bort.`,
  };
}
