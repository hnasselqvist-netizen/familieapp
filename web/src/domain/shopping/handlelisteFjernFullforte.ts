/**
 * «Fjern fullførte» i React-Handlelisten (Mat #20, ordre 6905636191) med
 * grunnlagsvern. Rene funksjoner — ingen React, Firebase, klokke eller
 * tilfeldighet.
 *
 * Planen er de fullførte radene slik Helen så dem da hun trykket, hver med
 * rågrunnlaget fra abonnementet (#163: alle felt, historikk og prioritet).
 * Beslutningen tas samlet mot den FERSKE noden i én versjonsbetinget runde
 * (`fjernFullfortePoster`, ETag/if-match): rader som er uendret, fjernes
 * samlet; endrede og tilbakekryssede rader står; rader som allerede er borte,
 * telles for seg. Rader som ikke var med i planen (også nytilkomne fullførte),
 * røres aldri.
 */
import type { ShoppingItem } from "@app-types/shopping";
import { normaliserNode, stabil, synligFraRaa } from "./handlelisteDuplikater";
import {
  type FjernPlan,
  beskrivEndring,
  lagFjernPlan,
  vurderFjerning,
} from "./handlelisteFjerning";

/** De fullførte radene Helen så da hun trykket «Fjern fullførte». */
export interface FjernFullfortePlan {
  rader: FjernPlan[];
}

/** En planlagt rad som står igjen, med kort grunn. */
export interface BeholdtRad {
  id: string;
  navn: string;
  grunn: string;
}

/** Samlet utfall av vurderingen mot fersk tilstand. */
export interface FullforteOppsummering {
  fjernet: { id: string; navn: string }[];
  beholdt: BeholdtRad[];
  borte: { id: string; navn: string }[];
}

export type FullforteVurdering =
  | { utfall: "konflikt"; grunn: string }
  | { utfall: "vurdert"; fjern: string[]; detaljer: FullforteOppsummering };

const erObjekt = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Planen fra listen slik den vises: bare radene som er fullført nå. */
export function lagFjernFullfortePlan(liste: readonly ShoppingItem[]): FjernFullfortePlan {
  return { rader: liste.filter((r) => r.done).map(lagFjernPlan) };
}

/** Kort grunn for en planlagt rad som står igjen. */
function kortGrunn(fersk: unknown, plan: FjernPlan): string {
  if (!erObjekt(fersk) || typeof fersk.name !== "string") return "uventet form";
  const naa = synligFraRaa(fersk);
  if (stabil(naa) !== stabil(plan.sett)) return beskrivEndring(plan.sett, naa);
  return "endret på en annen enhet, for eksempel slått sammen";
}

/**
 * Beslutningen mot den ferske `shopping`-noden. `raaLik(id)`: om raden er
 * byte for byte slik abonnementet så den (avgjøres av datalaget fra
 * eksportformen).
 */
export function vurderFjernFullforte(
  raw: unknown,
  plan: FjernFullfortePlan,
  raaLik: (id: string) => boolean,
): FullforteVurdering {
  const node = normaliserNode(raw ?? {});
  if (!node) {
    return { utfall: "konflikt", grunn: "Handlelisten har en uventet form. Ingenting er fjernet." };
  }
  const ider = plan.rader.map((r) => r.id);
  if (new Set(ider).size !== ider.length) {
    return { utfall: "konflikt", grunn: "Samme rad er med flere ganger. Ingenting er fjernet." };
  }
  const detaljer: FullforteOppsummering = { fjernet: [], beholdt: [], borte: [] };
  for (const rad of plan.rader) {
    const navn = rad.sett.name;
    const b = vurderFjerning(node, rad, raaLik(rad.id));
    if (b.utfall === "fjern") detaljer.fjernet.push({ id: rad.id, navn });
    else if (b.utfall === "borte") detaljer.borte.push({ id: rad.id, navn });
    else detaljer.beholdt.push({ id: rad.id, navn, grunn: kortGrunn(node[rad.id], rad) });
  }
  return { utfall: "vurdert", fjern: detaljer.fjernet.map((r) => r.id), detaljer };
}
