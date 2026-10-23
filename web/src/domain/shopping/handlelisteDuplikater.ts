/**
 * Trygg sammenslåing av duplikater i handlelisten (Mat #20, forslag
 * 6353412308, review 6353438086). Rene funksjoner — ingen React, ingen
 * Firebase, ingen klokke eller tilfeldighet: `opId` og `tidspunkt` lages
 * av kalleren FØR transaksjonen, fordi RTDB kan kjøre updateren flere
 * ganger.
 *
 * Flyten:
 *  1. `finnDuplikatgrupper` foreslår grupper av AKTIVE rader: samme
 *     `itemId` (sterk) eller bare samme normaliserte navn (kandidat).
 *     Ingenting velges automatisk.
 *  2. Helen velger eksplisitt rader og hvilken som beholdes;
 *     `vurderMengder` sier om mengdene trygt kan summeres.
 *  3. `lagPlan` fanger det Helen så (synlige felt per rad) og valget.
 *  4. `anvendSammenslaing` kjøres som updater mot den FERSKE noden: avviker
 *     noe Helen så, endres ingenting. Den innslåtte radenes fulle, rå
 *     kopier og beholdt rads rå førkopi lagres på beholdt rad, så
 *     `angreSammenslaing` kan gjenopprette eksakt — men bare hvis ingenting
 *     er endret etterpå.
 */
import type { ShoppingItem } from "@app-types/shopping";
import { normalizeItemName } from "./handlelisteRules";

type Raa = Record<string, unknown>;

/** Reserverte metadata-nøkler (`_ops` m.fl.) — aldri en vare, aldri rørt. */
const reservert = (key: string) => key.startsWith("_");

const erObjekt = (v: unknown): v is Raa => typeof v === "object" && v !== null && !Array.isArray(v);

/** null → `{}`; legacy-array → objekt med indeksnøkler (hull hoppes over). */
export function normaliserNode(raw: unknown): Raa | null {
  if (raw === null || raw === undefined) return {};
  if (Array.isArray(raw)) {
    const node: Raa = {};
    raw.forEach((v, i) => {
      if (v !== null && v !== undefined) node[String(i)] = v;
    });
    return node;
  }
  return erObjekt(raw) ? { ...raw } : null;
}

// ─── 1. Grupper ──────────────────────────────────────────────────────────

export interface Duplikatgruppe {
  /** `sterk`: samme vare (`itemId`). `kandidat`: bare samme navn — kanskje ikke samme vare. */
  type: "sterk" | "kandidat";
  nokkel: string;
  rader: ShoppingItem[];
}

/**
 * Grupper av AKTIVE rader (aldri fullførte) som kan være duplikater.
 * Sterke grupper har samme ikke-null `itemId`. En kandidatgruppe har samme
 * normaliserte navn, men minst to ulike eller manglende `itemId` — det er
 * bare et forslag, aldri bevis.
 */
export function finnDuplikatgrupper(rader: readonly ShoppingItem[]): Duplikatgruppe[] {
  const aktive = rader.filter((r) => !r.done);
  const grupper: Duplikatgruppe[] = [];
  const perVare = new Map<string, ShoppingItem[]>();
  for (const r of aktive)
    if (r.itemId) perVare.set(r.itemId, [...(perVare.get(r.itemId) ?? []), r]);
  for (const [itemId, rr] of perVare) {
    if (rr.length > 1) grupper.push({ type: "sterk", nokkel: `vare:${itemId}`, rader: rr });
  }
  const perNavn = new Map<string, ShoppingItem[]>();
  for (const r of aktive) {
    const n = normalizeItemName(r.name ?? "");
    if (n) perNavn.set(n, [...(perNavn.get(n) ?? []), r]);
  }
  for (const [navn, rr] of perNavn) {
    // Kandidat med mindre ALLE har samme ikke-null itemId (det er en sterk
    // gruppe). Rader som alle mangler itemId er også kandidater.
    const vareIder = new Set(rr.map((r) => r.itemId ?? null));
    const alleSammeVare = vareIder.size === 1 && !vareIder.has(null);
    if (rr.length > 1 && !alleSammeVare) {
      grupper.push({ type: "kandidat", nokkel: `navn:${navn}`, rader: rr });
    }
  }
  return grupper;
}

// ─── 2. Mengder ──────────────────────────────────────────────────────────

/** Største heltallsdel som godtas (seks sifre) — holder all regning i trygge heltall. */
const MAKS_HELTALLSSIFRE = 6;
/** Øvre grense for en sum, i hundredeler (999 999,99). */
const MAKS_SUM_HUNDREDELER = 99_999_999;

/**
 * En mengde som ENTYDIG er et ikke-negativt tall, i HELE HUNDREDELER
 * (eksakt heltallsregning, ingen flyttall), ellers `null`. Godtar høyst seks
 * sifre før og høyst to etter desimaltegnet, som kan være komma ELLER
 * punktum («1,5», «2.25», «999999,99»). Avvist: tre sifre etter
 * skilletegnet («1.000», «1,250» — kan være tusenskille eller vekt), flere
 * enn seks heltallssifre, enheter, fritekst og ledende-tall-tolkning
 * (ulikt `parseFloat`, som gjør «2 stk» til 2).
 */
export function tallIHundredeler(mengde: string): number | null {
  const m = new RegExp(`^(\\d{1,${MAKS_HELTALLSSIFRE}})(?:[.,](\\d{1,2}))?$`).exec(mengde.trim());
  if (!m) return null;
  const desimaler = (m[2] ?? "").padEnd(2, "0");
  return Number(m[1]) * 100 + Number(desimaler);
}

/** `tallIHundredeler` som tall (for visning og tester), ellers `null`. */
export function entydigTall(mengde: string): number | null {
  const h = tallIHundredeler(mengde);
  return h === null ? null : h / 100;
}

/** Hundredeler som tekst: «3», «3,5», «0,05»; komma når en av mengdene brukte komma. */
function formaterHundredeler(h: number, medKomma: boolean): string {
  const heltall = Math.floor(h / 100);
  const rest = h % 100;
  if (rest === 0) return String(heltall);
  const desimaler = String(rest).padStart(2, "0").replace(/0$/, "");
  return `${heltall}${medKomma ? "," : "."}${desimaler}`;
}

export type MengdeVurdering =
  /** Alle ikke-tomme mengder er entydige tall: Helen velger «legg sammen» eller «behold». */
  | { type: "tall"; sum: string; behold: string }
  /** Ingen mengder i det hele tatt: sammenslåing endrer ikke mengden. */
  | { type: "ingen"; behold: string }
  /** Enheter eller fritekst: sammenslåing er blokkert. */
  | { type: "blokkert"; grunn: string };

/**
 * Om mengdene på `rader` trygt kan slås sammen. `beholdId` er raden som
 * beholdes; «behold» betyr dens egen mengde. Summering tilbys bare når
 * ALLE ikke-tomme mengder er entydige tall.
 */
export function vurderMengder(rader: readonly ShoppingItem[], beholdId: string): MengdeVurdering {
  const behold = rader.find((r) => r.id === beholdId)?.amount ?? "";
  const ikkeTomme = rader.map((r) => (r.amount ?? "").trim()).filter((m) => m !== "");
  if (ikkeTomme.length === 0) return { type: "ingen", behold };
  const hundredeler = ikkeTomme.map(tallIHundredeler);
  if (hundredeler.some((h) => h === null)) {
    return {
      type: "blokkert",
      grunn:
        "Mengdene har enheter, fritekst eller for store tall og kan ikke slås sammen trygt. Rediger mengden, eller fjern den konkrete raden.",
    };
  }
  const sum = (hundredeler as number[]).reduce((s, h) => s + h, 0);
  if (!Number.isSafeInteger(sum) || sum > MAKS_SUM_HUNDREDELER) {
    return { type: "blokkert", grunn: "Summen blir for stor til å slås sammen trygt." };
  }
  return {
    type: "tall",
    sum: formaterHundredeler(
      sum,
      ikkeTomme.some((m) => m.includes(",")),
    ),
    behold,
  };
}

// ─── 3. Plan ─────────────────────────────────────────────────────────────

/** Det Helen så av én rad i forhåndsvisningen — feltene beslutningen bygger på. */
export interface SynligRad {
  name: string;
  amount: string;
  cat: string;
  itemId: string | null;
  done: boolean;
}

export interface SammenslaingsPlan {
  opId: string;
  tidspunkt: string;
  beholdId: string;
  kildeIds: string[];
  /** Mengden beholdt rad får. */
  resultatMengde: string;
  /** Hva Helen så per involvert rad (beholdt + kilder). */
  sett: Record<string, SynligRad>;
}

/** Feltene Helen ser av en rad — grunnlaget for forhåndsvisning og bekreftelse. */
export const synlig = (
  r: Pick<ShoppingItem, "name" | "amount" | "cat" | "itemId" | "done">,
): SynligRad => ({
  name: r.name,
  amount: r.amount ?? "",
  cat: r.cat ?? "Diverse",
  itemId: r.itemId ?? null,
  done: r.done ?? false,
});

/** Synlige felt fra en rå node-verdi, med samme standarder som `parseShoppingListEntry`. */
function synligFraRaa(raw: Raa): SynligRad {
  return synlig({
    name: raw.name as string,
    amount: (raw.amount as string | undefined) ?? "",
    cat: (raw.cat as string | undefined) ?? "Diverse",
    itemId: (raw.itemId as string | null | undefined) ?? null,
    done: (raw.done as boolean | undefined) ?? false,
  });
}

export type PlanResultat = { kan: true; plan: SammenslaingsPlan } | { kan: false; grunn: string };

/**
 * Lager planen for Helens eksplisitte valg. `mengdeValg` må stemme med
 * `vurderMengder`: «sum» bare for tall, «behold» for tall eller ingen.
 */
export function lagPlan(
  valgte: readonly ShoppingItem[],
  beholdId: string,
  mengdeValg: "sum" | "behold",
  opId: string,
  tidspunkt: string,
): PlanResultat {
  if (new Set(valgte.map((r) => r.id)).size !== valgte.length) {
    return { kan: false, grunn: "Samme rad er valgt flere ganger." };
  }
  if (valgte.length < 2) return { kan: false, grunn: "Velg minst to rader." };
  if (!valgte.some((r) => r.id === beholdId)) {
    return { kan: false, grunn: "Velg hvilken rad som skal beholdes." };
  }
  if (valgte.some((r) => r.done)) return { kan: false, grunn: "Fullførte rader slås ikke sammen." };
  if (valgte.some((r) => r.sammenslaing)) {
    return {
      kan: false,
      grunn: "En av radene er allerede resultat av en sammenslåing. Angre den først.",
    };
  }
  const v = vurderMengder(valgte, beholdId);
  if (v.type === "blokkert") return { kan: false, grunn: v.grunn };
  if (mengdeValg === "sum" && v.type !== "tall") {
    return { kan: false, grunn: "Mengdene kan ikke legges sammen." };
  }
  return {
    kan: true,
    plan: {
      opId,
      tidspunkt,
      beholdId,
      kildeIds: valgte.filter((r) => r.id !== beholdId).map((r) => r.id),
      resultatMengde: mengdeValg === "sum" && v.type === "tall" ? v.sum : v.behold,
      sett: Object.fromEntries(valgte.map((r) => [r.id, synlig(r)])),
    },
  };
}

/** Stabil serialisering (sorterte nøkler) — for likhet uavhengig av nøkkelrekkefølge. */
export function stabil(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stabil).join(",")}]`;
  if (erObjekt(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stabil(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** Planens innhold uten `tidspunkt` — samme `opId` med annet innhold er en konflikt. */
export function planAvtrykk(p: SammenslaingsPlan): string {
  return stabil({ ...p, tidspunkt: null });
}

// ─── 4. Anvend ───────────────────────────────────────────────────────────

/** Lagres på beholdt rad: alt som trengs for eksakt angring. */
export interface SammenslaingsHistorikk {
  opId: string;
  tidspunkt: string;
  planAvtrykk: string;
  resultatMengde: string;
  /** Beholdt rad slik den var rett før — rå, med ukjente felt. */
  foer: Raa;
  /** Innslåtte rader, rå og komplette, nøklet på sin opprinnelige id. */
  kilder: Record<string, Raa>;
}

export type Utfall =
  | { utfall: "anvendt"; node: Raa }
  | { utfall: "allerede"; node: unknown }
  | { utfall: "konflikt"; grunn: string; node: unknown };

const HISTORIKK = "sammenslaing";
const ANGREDE = "sammenslaingAngret";

function kopi<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * Updater-logikken for sammenslåing mot den FERSKE noden. Returnerer alltid
 * en konkret node: den nye ved `anvendt`, ellers den uendrede (aldri
 * `undefined`, som ville avbrutt en spekulativ kjøring mot kald cache).
 */
export function anvendSammenslaing(raw: unknown, plan: SammenslaingsPlan): Utfall {
  const node = normaliserNode(raw);
  if (!node) return { utfall: "konflikt", grunn: "Handlelisten har en uventet form.", node: raw };
  const avtrykk = planAvtrykk(plan);
  const beholdRaa = node[plan.beholdId];

  if (erObjekt(beholdRaa)) {
    const h = beholdRaa[HISTORIKK];
    if (erObjekt(h) && h.opId === plan.opId) {
      return h.planAvtrykk === avtrykk
        ? { utfall: "allerede", node: raw }
        : { utfall: "konflikt", grunn: "Samme operasjon med annet innhold.", node: raw };
    }
    const angrede = beholdRaa[ANGREDE];
    if (erObjekt(angrede) && plan.opId in angrede) {
      return { utfall: "konflikt", grunn: "Denne sammenslåingen er allerede angret.", node: raw };
    }
  }

  for (const id of [plan.beholdId, ...plan.kildeIds]) {
    if (reservert(id)) return { utfall: "konflikt", grunn: "Ugyldig rad.", node: raw };
    const r = node[id];
    if (!erObjekt(r) || typeof r.name !== "string") {
      return {
        utfall: "konflikt",
        grunn: "En av radene er fjernet siden forhåndsvisningen.",
        node: raw,
      };
    }
    if (stabil(synligFraRaa(r)) !== stabil(plan.sett[id])) {
      return {
        utfall: "konflikt",
        grunn: "En av radene er endret, huket av eller flyttet siden forhåndsvisningen.",
        node: raw,
      };
    }
    if (erObjekt(r[HISTORIKK])) {
      return {
        utfall: "konflikt",
        grunn: "En av radene har en sammenslåing som ikke er avklart. Angre den først.",
        node: raw,
      };
    }
  }

  const foer = kopi(node[plan.beholdId] as Raa);
  const kilder = Object.fromEntries(plan.kildeIds.map((id) => [id, kopi(node[id] as Raa)]));
  const historikk: SammenslaingsHistorikk = {
    opId: plan.opId,
    tidspunkt: plan.tidspunkt,
    planAvtrykk: avtrykk,
    resultatMengde: plan.resultatMengde,
    foer,
    kilder,
  };
  const ny: Raa = { ...node };
  for (const id of plan.kildeIds) delete ny[id];
  ny[plan.beholdId] = { ...foer, amount: plan.resultatMengde, [HISTORIKK]: historikk };
  return { utfall: "anvendt", node: ny };
}

// ─── 5. Angre ────────────────────────────────────────────────────────────

/** Beholdt rad uten historikkfeltet — det som må være uendret for trygg angring. */
function utenHistorikk(r: Raa): Raa {
  const resten = { ...r };
  delete resten[HISTORIKK];
  return resten;
}

/**
 * Angrer sammenslåingen `opId` på beholdt rad `beholdId`, bare når beholdt
 * rad er nøyaktig slik sammenslåingen etterlot den og ingen av de
 * innslåtte radenes id-er finnes igjen. Da gjenopprettes beholdt rad og
 * kildene eksakt (rå), og `opId` merkes som angret så en forsinket
 * gjentakelse av sammenslåingen aldri slår inn igjen.
 */
export function angreSammenslaing(raw: unknown, beholdId: string, opId: string): Utfall {
  const node = normaliserNode(raw);
  if (!node) return { utfall: "konflikt", grunn: "Handlelisten har en uventet form.", node: raw };
  const r = node[beholdId];
  if (!erObjekt(r)) {
    return { utfall: "konflikt", grunn: "Raden finnes ikke lenger.", node: raw };
  }
  const h = r[HISTORIKK];
  if (!erObjekt(h) || h.opId !== opId) {
    const angrede = r[ANGREDE];
    return erObjekt(angrede) && opId in angrede
      ? { utfall: "allerede", node: raw }
      : { utfall: "konflikt", grunn: "Fant ikke sammenslåingen på raden.", node: raw };
  }
  const historikk = h as unknown as SammenslaingsHistorikk;
  const forventet = { ...historikk.foer, amount: historikk.resultatMengde };
  if (stabil(utenHistorikk(r)) !== stabil(forventet)) {
    return {
      utfall: "konflikt",
      grunn: "Raden er endret etter sammenslåingen, så den angres ikke. Ingenting er overskrevet.",
      node: raw,
    };
  }
  const kildeIds = Object.keys(historikk.kilder ?? {});
  if (kildeIds.some((id) => id in node)) {
    return {
      utfall: "konflikt",
      grunn: "En av de innslåtte radene finnes allerede igjen, så angring kunne gitt dobbelt.",
      node: raw,
    };
  }
  const ny: Raa = { ...node };
  const angrede = erObjekt(historikk.foer[ANGREDE]) ? historikk.foer[ANGREDE] : {};
  ny[beholdId] = { ...kopi(historikk.foer), [ANGREDE]: { ...angrede, [opId]: true } };
  for (const id of kildeIds) ny[id] = kopi(historikk.kilder[id]!);
  return { utfall: "anvendt", node: ny };
}
