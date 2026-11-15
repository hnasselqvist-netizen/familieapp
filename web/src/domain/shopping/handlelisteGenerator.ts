/**
 * Handlelistegeneratorens «Legg til N varer» (Middagsplan → handleliste,
 * Mat #20, ordre 6843084184) som ÉN logisk operasjon med stabil `opId`.
 * Rene funksjoner — ingen React, Firebase, klokke eller tilfeldighet.
 *
 * Semantikken er den samme som før (`addBatchToShoppingList`):
 *  - hver ny vare matches mot første IKKE-fullførte rad med samme navn
 *    (`findMergeCandidate`, case-insensitivt, uten trimming) i listen slik
 *    den var — aldri mot andre nye varer i samme innsending;
 *  - er begge mengdene positive tall, summeres de (`mergeShoppingAmount`,
 *    `parseFloat`-semantikk, uendret); ellers står raden urørt, og ingen ny
 *    rad legges til;
 *  - flere nye varer med samme kandidat summeres etter hverandre;
 *  - uten kandidat blir varen en ny rad.
 *
 * **Grunnlaget.** `lagGeneratorPlan` beregner effektene mot listen Helen
 * så i forhåndsvisningen. `anvendGeneratorPlan` beregner dem på nytt mot
 * den FERSKE noden. Avviker de (en kandidat er endret, avhuket, fjernet
 * eller ny), skrives ingenting: konflikt, og Helen må se gjennom på nytt.
 *
 * **Kvittering.** Samme kontrakt som innleggingen (#160): kvitteringen
 * `_reactForsok/{opId}` skrives i samme versjonsbetingede skriving. Samme
 * `opId` igjen (dobbeltklikk, «Send på nytt») gir `allerede` når
 * kvitteringen finnes. Et gjentak («Prøv igjen») uten kvittering er
 * `ubekreftet`, og ingenting skrives.
 */
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import { normaliserNode, stabil, synligFraRaa, type SynligRad } from "./handlelisteDuplikater";
import { KVITTERINGER, type InnleggingsUtfall } from "./handlelisteInnlegging";
import { findMergeCandidate, mergeShoppingAmount } from "./handlelisteRules";

type Raa = Record<string, unknown>;

const erObjekt = (v: unknown): v is Raa => typeof v === "object" && v !== null && !Array.isArray(v);
const reservert = (key: string) => key.startsWith("_");

/** Det forhåndsvisningen viser at operasjonen vil gjøre. */
export interface GeneratorEffekter {
  /** Nye rader, på stabile nøkler `${opId}-${indeks}`. */
  nye: { id: string; rad: ShoppingListEntry }[];
  /** Eksisterende rader som får summert mengde: det Helen så, og ny mengde. */
  endret: Record<string, { sett: SynligRad; til: string }>;
  /** Kandidater som står urørt (mengdene kan ikke summeres) — og slik de så ut. */
  uendret: Record<string, SynligRad>;
}

export interface GeneratorPlan {
  opId: string;
  entries: ShoppingListEntry[];
  effekter: GeneratorEffekter;
}

/** Rader i en node, med samme standarder som `parseShoppingListEntry`. */
function rader(node: Raa): (ShoppingListEntry & { id: string })[] {
  return Object.entries(node)
    .filter(([k, v]) => !reservert(k) && erObjekt(v) && typeof v.name === "string")
    .map(([id, v]) => {
      const r = v as Raa;
      return {
        id,
        itemId: (r.itemId as string | null | undefined) ?? null,
        name: r.name as string,
        amount: (r.amount as string | undefined) ?? "",
        cat: (r.cat as string | undefined) ?? "Diverse",
        done: (r.done as boolean | undefined) ?? false,
      };
    });
}

/** Effektene av `entries` mot en node — samme regler som før, i én fold. */
export function beregnEffekter(
  raw: unknown,
  entries: readonly ShoppingListEntry[],
  opId: string,
): GeneratorEffekter | null {
  const node = normaliserNode(raw);
  if (!node) return null;
  const liste = rader(node);
  const mengde = new Map(liste.map((r) => [r.id, r.amount]));
  const effekter: GeneratorEffekter = { nye: [], endret: {}, uendret: {} };
  entries.forEach((entry, i) => {
    const naa = liste.map((r) => ({ ...r, amount: mengde.get(r.id) ?? r.amount }));
    const kandidat = findMergeCandidate(naa, entry);
    if (!kandidat) {
      effekter.nye.push({ id: `${opId}-${i}`, rad: { ...entry, done: false } });
      return;
    }
    const sett = synligFraRaa(node[kandidat.id] as Raa);
    const sammen = mergeShoppingAmount(kandidat, entry);
    if (sammen) {
      mengde.set(kandidat.id, sammen.amount);
      effekter.endret[kandidat.id] = { sett, til: sammen.amount };
      delete effekter.uendret[kandidat.id];
    } else if (!effekter.endret[kandidat.id]) {
      effekter.uendret[kandidat.id] = sett;
    }
  });
  return effekter;
}

/** Planen for den bekreftede gjennomgangen, mot listen slik Helen så den. */
export function lagGeneratorPlan(
  liste: readonly ShoppingItem[],
  entries: readonly ShoppingListEntry[],
  opId: string,
): GeneratorPlan {
  const node = Object.fromEntries(liste.map((r) => [r.id, r]));
  return {
    opId,
    entries: [...entries],
    effekter: beregnEffekter(node, entries, opId) ?? { nye: [], endret: {}, uendret: {} },
  };
}

const kvittering = (p: GeneratorPlan) => ({
  generator: {
    nye: p.effekter.nye.map((n) => n.id),
    endret: Object.fromEntries(
      Object.entries(p.effekter.endret).map(([id, e]) => [id, { fra: e.sett.amount, til: e.til }]),
    ),
  },
});

const UBEKREFTET =
  "Fant ingen kvittering for det forrige forsøket, men det kan likevel være lagret. Ingenting er endret i dette forsøket — se handlelisten før du sender på nytt.";
const ENDRET =
  "Handlelisten er endret siden forhåndsvisningen. Se gjennom varene på nytt før du legger dem til.";

/**
 * Beslutningen mot den FERSKE noden: anvendt (nye rader + summerte
 * mengder + kvittering), allerede (kvittering finnes), ubekreftet (gjentak
 * uten kvittering) eller konflikt (grunnlaget avviker). Endrede rader
 * beholder alle sine felt; bare `amount` endres.
 */
export function anvendGeneratorPlan(
  raw: unknown,
  plan: GeneratorPlan,
  gjentak = false,
): InnleggingsUtfall {
  const node = normaliserNode(raw);
  if (!node) return { utfall: "konflikt", grunn: "Handlelisten har en uventet form." };
  if (reservert(plan.opId)) return { utfall: "konflikt", grunn: "Ugyldig operasjon." };
  const register = node[KVITTERINGER];
  if (register !== undefined && register !== null && !erObjekt(register)) {
    return { utfall: "konflikt", grunn: "Handlelisten har en uventet form." };
  }
  const kv = erObjekt(register) ? register[plan.opId] : undefined;
  if (kv !== undefined && kv !== null) {
    return stabil(kv) === stabil(kvittering(plan))
      ? { utfall: "allerede" }
      : { utfall: "konflikt", grunn: "Samme operasjon med annet innhold." };
  }
  if (gjentak) return { utfall: "ubekreftet", grunn: UBEKREFTET };

  const fersk = beregnEffekter(node, plan.entries, plan.opId);
  if (!fersk || stabil(fersk) !== stabil(plan.effekter)) {
    return { utfall: "konflikt", grunn: ENDRET };
  }
  const endringer: Record<string, Raa> = {};
  for (const { id, rad } of fersk.nye) {
    if (node[id] !== undefined && node[id] !== null) {
      return { utfall: "konflikt", grunn: "Id-kollisjon. Ingenting er lagret." };
    }
    endringer[id] = { ...rad, done: false, id };
  }
  for (const [id, e] of Object.entries(fersk.endret)) {
    endringer[id] = { ...(node[id] as Raa), amount: e.til };
  }
  if (Object.keys(endringer).length === 0) {
    // Ingen effekt (alle kandidater står urørt): ingenting å skrive, heller ikke kvittering.
    return { utfall: "allerede" };
  }
  return {
    utfall: "anvendt",
    endringer,
    kvittering: { opId: plan.opId, verdi: kvittering(plan) },
  };
}
