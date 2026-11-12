/**
 * Manuell innlegging i handlelisten med varsel om aktiv vare (Mat #20,
 * ordre 6830803229). Rene funksjoner — ingen React, ingen Firebase, ingen
 * klokke eller tilfeldighet: `opId` lages av kalleren FØR transaksjonen,
 * fordi RTDB kan kjøre updateren flere ganger.
 *
 * Flyten:
 *  1. `finnTreff` finner AKTIVE rader som kan være samme vare som den nye:
 *     samme `itemId` (sterk) eller samme normaliserte navn (kandidat).
 *     Ulike bekreftede `itemId` slås aldri sammen på navn, og fullførte
 *     rader blokkerer aldri en ny rad.
 *  2. Ingen treff → `anvendNyRad` legger til raden på nøkkelen `opId`, men
 *     bare hvis den ferske noden FORTSATT ikke har treff (to klienter som
 *     legger til samme vare samtidig gir én rad og én konflikt).
 *  3. Treff → UI viser raden(e). Helen velger én målrad og «Øk antallet»;
 *     `vurderOkning` sier om mengdene entydig kan summeres, og
 *     `anvendOkning` øker bare hvis målraden er slik Helen så den.
 *
 * Kvittering: samme kontrakt som legacy sin `_legacyForsok` (ADR 0003),
 * i et eget register `_reactForsok/{opId}` som skrives i SAMME atomiske
 * skriving som endringen. Et nytt forsøk etter ukjent utfall sendes med
 * samme `opId` og `gjentak: true` og avgjøres mot kvitteringen: finnes den,
 * er det allerede lagret (ingen dobbel økning eller ny rad); finnes den
 * ikke, er utfallet fortsatt UBEKREFTET og ingenting skrives — en eldre fane
 * kan ha skrevet om noden, og et ubekreftet forsøk kan fortsatt være
 * underveis. Kvitteringene ryddes ikke automatisk.
 */
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import {
  MAKS_SUM_HUNDREDELER,
  type SynligRad,
  formaterHundredeler,
  normaliserNode,
  stabil,
  synlig,
  synligFraRaa,
  tallIHundredeler,
} from "./handlelisteDuplikater";
import { normalizeItemName } from "./handlelisteRules";

type Raa = Record<string, unknown>;

const erObjekt = (v: unknown): v is Raa => typeof v === "object" && v !== null && !Array.isArray(v);
const reservert = (key: string) => key.startsWith("_");

/** Kvitteringsregisteret for React-innlegging (reservert nøkkel — aldri en vare). */
export const KVITTERINGER = "_reactForsok";

// ─── 1. Treff ────────────────────────────────────────────────────────────

/** Den nye varen slik den er kjent FØR noe opprettes i varebasen. */
export interface NyVare {
  name: string;
  /** Bekreftet vare-id (valgt i velgeren eller funnet i varebasen), ellers `null`. */
  itemId: string | null;
}

export interface Treff {
  /** `sterk`: samme vare (`itemId`). `kandidat`: samme navn, ikke bekreftet samme vare. */
  type: "sterk" | "kandidat";
  rad: ShoppingItem;
}

type Kandidatrad = Pick<ShoppingItem, "id" | "name" | "itemId" | "done">;

function klassifiser(r: Kandidatrad, ny: NyVare): Treff["type"] | null {
  if (r.done || typeof r.name !== "string") return null;
  const radVare = r.itemId ?? null;
  if (ny.itemId && radVare === ny.itemId) return "sterk";
  const navn = normalizeItemName(ny.name);
  if (!navn || normalizeItemName(r.name) !== navn) return null;
  // Ulike bekreftede vare-id-er er ulike varer, selv med samme navn.
  if (ny.itemId && radVare && radVare !== ny.itemId) return null;
  return "kandidat";
}

/** Aktive rader som kan være samme vare som `ny`, sterke treff først. */
export function finnTreff(rader: readonly ShoppingItem[], ny: NyVare): Treff[] {
  const treff: Treff[] = [];
  for (const rad of rader) {
    const type = klassifiser(rad, ny);
    if (type) treff.push({ type, rad });
  }
  return [
    ...treff.filter((t) => t.type === "sterk"),
    ...treff.filter((t) => t.type === "kandidat"),
  ];
}

/** Rader i en rå node (uten reserverte nøkler og poster uten streng-navn). */
function raderFraNode(node: Raa): Kandidatrad[] {
  return Object.entries(node)
    .filter(([k, v]) => !reservert(k) && erObjekt(v) && typeof v.name === "string")
    .map(([id, v]) => {
      const r = v as Raa;
      return {
        id,
        name: r.name as string,
        itemId: (r.itemId as string | null | undefined) ?? null,
        done: (r.done as boolean | undefined) ?? false,
      };
    });
}

// ─── 2. Mengde ───────────────────────────────────────────────────────────

export type OkningsVurdering = { type: "sum"; resultat: string } | { type: "uklar"; grunn: string };

/**
 * Om `tillegg` entydig kan legges til `eksisterende`. Begge må være
 * entydige tall (`tallIHundredeler`): ingen gjetting av tom mengde, ingen
 * summering av enheter eller fritekst.
 */
export function vurderOkning(eksisterende: string, tillegg: string): OkningsVurdering {
  const a = (eksisterende ?? "").trim();
  const b = (tillegg ?? "").trim();
  if (!b) {
    return { type: "uklar", grunn: "Skriv hvor mye du vil legge til, så vises det nye antallet." };
  }
  if (!a) {
    return {
      type: "uklar",
      grunn:
        "Raden på listen har ingen mengde, så det er uklart hva den skal økes fra. Rediger raden i stedet.",
    };
  }
  const ha = tallIHundredeler(a);
  const hb = tallIHundredeler(b);
  if (ha === null || hb === null) {
    return {
      type: "uklar",
      grunn:
        "Mengdene har enheter eller fritekst og kan ikke legges sammen trygt. Rediger raden i stedet.",
    };
  }
  const sum = ha + hb;
  if (!Number.isSafeInteger(sum) || sum > MAKS_SUM_HUNDREDELER) {
    return { type: "uklar", grunn: "Summen blir for stor til å legges sammen trygt." };
  }
  return { type: "sum", resultat: formaterHundredeler(sum, a.includes(",") || b.includes(",")) };
}

// ─── 3. Planer ───────────────────────────────────────────────────────────

export interface NyRadPlan {
  opId: string;
  rad: ShoppingListEntry;
}

export interface OkningsPlan {
  opId: string;
  radId: string;
  /** Målraden slik Helen så den da varselet ble vist. */
  sett: SynligRad;
  tillegg: string;
  resultat: string;
}

export type OkningsPlanResultat = { kan: true; plan: OkningsPlan } | { kan: false; grunn: string };

/** Planen for «Øk antallet» på én eksplisitt valgt, aktiv målrad. */
export function lagOkningsPlan(
  rad: ShoppingItem,
  tillegg: string,
  opId: string,
): OkningsPlanResultat {
  if (rad.done) return { kan: false, grunn: "Raden er fullført og økes ikke." };
  const v = vurderOkning(rad.amount ?? "", tillegg);
  if (v.type === "uklar") return { kan: false, grunn: v.grunn };
  return {
    kan: true,
    plan: { opId, radId: rad.id, sett: synlig(rad), tillegg: tillegg.trim(), resultat: v.resultat },
  };
}

// ─── 4. Beslutt ──────────────────────────────────────────────────────────

/**
 * En beslutning mot den FERSKE noden. Bare `anvendt` skal føre til en
 * skriving, og da bare av `endringer` (hele poster, nøklet på postnøkkel)
 * og én ny kvittering. Alt annet i noden — urørte poster, reserverte
 * metadata, prioriteter — er datalagets ansvar å la stå byte-likt.
 * `allerede`, `konflikt` og `ubekreftet` skal aldri skrive noe.
 */
export type InnleggingsUtfall =
  | {
      utfall: "anvendt";
      endringer: Record<string, Raa>;
      kvittering: { opId: string; verdi: Raa };
    }
  | { utfall: "allerede" }
  /** `treff`: en aktiv rad med samme vare finnes nå — vis varselet på nytt. */
  | { utfall: "konflikt"; grunn: string; treff?: true }
  | { utfall: "ubekreftet"; grunn: string };

const kvitteringNyRad = (p: NyRadPlan) => ({
  lagt: { [p.opId]: { name: p.rad.name, cat: p.rad.cat || "Diverse" } },
});
const kvitteringOkning = (p: OkningsPlan) => ({
  okt: { [p.radId]: { fra: p.sett.amount, til: p.resultat } },
});

const UBEKREFTET =
  "Fant ingen kvittering for det forrige forsøket, men det kan likevel være lagret. Ingenting er endret — sjekk handlelisten før du sender på nytt.";
const UVENTET = "Handlelisten har en uventet form. Ingenting er lagret.";

/**
 * Felles start: nodeform, gyldig nøkkel og kvittering. Kvittering for
 * `opId` avgjør et gjentatt forsøk; uten kvittering er et gjentak
 * ubekreftet. `null` = gå videre til selve beslutningen.
 */
function forsjekk(
  node: Raa | null,
  nokkel: string,
  opId: string,
  forventet: unknown,
  gjentak: boolean,
): InnleggingsUtfall | null {
  if (!node) return { utfall: "konflikt", grunn: UVENTET };
  const register = node[KVITTERINGER];
  if (register !== undefined && register !== null && !erObjekt(register)) {
    return { utfall: "konflikt", grunn: UVENTET };
  }
  if (reservert(nokkel) || reservert(opId)) return { utfall: "konflikt", grunn: "Ugyldig rad." };
  const kv = erObjekt(register) ? register[opId] : undefined;
  if (kv !== undefined && kv !== null) {
    return stabil(kv) === stabil(forventet)
      ? { utfall: "allerede" }
      : { utfall: "konflikt", grunn: "Samme operasjon med annet innhold." };
  }
  return gjentak ? { utfall: "ubekreftet", grunn: UBEKREFTET } : null;
}

/**
 * Legger til en ny rad på nøkkelen `opId`, mot den FERSKE noden. Har noden
 * nå en aktiv rad som er samme vare (samme regel som `finnTreff`), skrives
 * ingenting: konflikt med `treff`, så UI viser varselet i stedet.
 */
export function anvendNyRad(raw: unknown, plan: NyRadPlan, gjentak = false): InnleggingsUtfall {
  const node = normaliserNode(raw);
  const forhand = forsjekk(node, plan.opId, plan.opId, kvitteringNyRad(plan), gjentak);
  if (forhand) return forhand;
  const n = node as Raa;
  if (n[plan.opId] !== undefined && n[plan.opId] !== null) {
    return { utfall: "konflikt", grunn: "Id-kollisjon. Ingenting er lagret." };
  }
  const ny = { name: plan.rad.name, itemId: plan.rad.itemId ?? null };
  if (raderFraNode(n).some((r) => klassifiser(r, ny))) {
    return {
      utfall: "konflikt",
      grunn: "Varen står allerede på listen (lagt til i mellomtiden). Ingenting er lagret.",
      treff: true,
    };
  }
  return {
    utfall: "anvendt",
    endringer: { [plan.opId]: { ...plan.rad, done: false, id: plan.opId } },
    kvittering: { opId: plan.opId, verdi: kvitteringNyRad(plan) },
  };
}

/**
 * Øker mengden på målraden, mot den FERSKE noden, bare hvis raden fortsatt
 * er nøyaktig slik Helen så den (navn, mengde, kategori, vare, fullført).
 * Alle andre felt — også reserverte metadata og sammenslåingshistorikk —
 * bevares urørt; bare `amount` endres.
 */
export function anvendOkning(raw: unknown, plan: OkningsPlan, gjentak = false): InnleggingsUtfall {
  const node = normaliserNode(raw);
  const forhand = forsjekk(node, plan.radId, plan.opId, kvitteringOkning(plan), gjentak);
  if (forhand) return forhand;
  const r = (node as Raa)[plan.radId];
  if (!erObjekt(r) || typeof r.name !== "string") {
    return {
      utfall: "konflikt",
      grunn: "Raden er fjernet siden varselet ble vist. Ingenting er lagret.",
    };
  }
  if (stabil(synligFraRaa(r)) !== stabil(plan.sett)) {
    return {
      utfall: "konflikt",
      grunn:
        "Raden er endret, huket av eller flyttet siden varselet ble vist. Ingenting er lagret.",
    };
  }
  return {
    utfall: "anvendt",
    endringer: { [plan.radId]: { ...r, amount: plan.resultat } },
    kvittering: { opId: plan.opId, verdi: kvitteringOkning(plan) },
  };
}

/**
 * Vanlig (val-form) node etter en `anvendt` beslutning — for tester og
 * kontroller. Datalaget skriver selv i eksportform og bevarer prioriteter.
 */
export function medEndringer(
  raw: unknown,
  u: Extract<InnleggingsUtfall, { utfall: "anvendt" }>,
): Raa {
  const node = normaliserNode(raw) ?? {};
  const register = erObjekt(node[KVITTERINGER]) ? (node[KVITTERINGER] as Raa) : {};
  return {
    ...node,
    ...u.endringer,
    [KVITTERINGER]: { ...register, [u.kvittering.opId]: u.kvittering.verdi },
  };
}
