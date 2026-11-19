/**
 * Skrivelag for forsoningsnodene (`families/{familyId}/transaksjoner|
 * hendelser|receipts|rules`), §Issue #34 R3b, ADR 0002.
 *
 * Alle fire nodene er **helnode-arrays**: legacy skriver hele listen med
 * `dbSet(node, next)` (RTDB-nøklene er array-indekser, `id` ligger inne i
 * elementet) og leser med `Object.values`. React skriver derfor:
 *
 *  - **hele noden i ÉN transaksjon** — Firebase kjører updateren på nytt
 *    mot fersk serververdi hvis noden endret seg underveis, så en endring
 *    beregnet fra et utdatert øyeblikksbilde blir aldri skrevet;
 *  - **i dagens array-form** — legacy kan leses tilbake som rollback uten
 *    datamigrering;
 *  - **aldri `node/{id}`** — målrettede id-skrivinger gir duplikater etter
 *    en legacy-reindeksering.
 *
 * Transaksjonen beskytter React sin EGEN skriving, ikke mot en senere
 * blind legacy-`dbSet`. Derfor er all bruk av denne modulen stengt i
 * hook-laget (`hooks/forsoningAktivering.ts`) til R3b-cutover, der legacy-
 * setterne sperres i samme release.
 */
import { ref, runTransaction } from "firebase/database";
import { sesjonFor } from "./auth.repository";
import { databaseRestUrl, getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";

export type ForsoningNode = "transaksjoner" | "hendelser" | "receipts" | "rules";

export function forsoningNodePath(familyId: FamilyId, node: ForsoningNode): string {
  return `families/${familyId}/${node}`;
}

/** Legacy-lesingen: `v ? Object.values(v) : []` — tåler array, sparsom array og objekt. */
export function nodeListe<T>(raw: unknown): T[] {
  return raw && typeof raw === "object" ? (Object.values(raw) as T[]) : [];
}

/**
 * Kjører `updater` mot den FERSKE serverlisten i én transaksjon på hele
 * noden og skriver resultatet tilbake i array-form.
 *
 * Updateren returnerer alltid en KONKRET liste (aldri `undefined`): et
 * spekulativt første kall mot kald cache (`current === null`) sammenlignes
 * da mot — og kjøres om nødvendig på nytt mot — serververdien, i stedet
 * for å avbryte permanent. Updateren kan altså kjøres flere ganger; bare
 * resultatet av SISTE kall blir skrevet.
 *
 * Returnerer listen slik den ligger etter transaksjonen.
 */
export async function transactForsoningNode<T>(
  familyId: FamilyId,
  node: ForsoningNode,
  updater: (prev: T[]) => T[],
  valg: {
    /**
     * `false`: lyttere ser bare SERVERBEKREFTET resultat, ikke den lokale,
     * spekulative verdien før ack (#95, review 5723280487). Standard `true`
     * som før, så øvrige skriveveier er uendret.
     */
    applyLocally?: boolean;
  } = {},
): Promise<T[]> {
  const result = await runTransaction(
    ref(getFirebaseDatabase(), forsoningNodePath(familyId, node)),
    (current: unknown) => {
      const next = updater(nodeListe<T>(current));
      // Array-form som legacy `dbSet(…, next)`; RTDB nekter `undefined`.
      return JSON.parse(JSON.stringify(next)) as T[];
    },
    { applyLocally: valg.applyLocally ?? true },
  );
  return nodeListe<T>(result.snapshot.val());
}

/** Avgrenset ventetid for en versjonert forsoningsendring og den skrivefrie kontrollen. */
export const FORSONING_FRIST_MS = 15_000;
const MAKS_RUNDER = 5;

/** Utfallet av `kjorNodeVersjonert`. */
export type NodeUtfall<U> =
  | { type: "lagret" }
  | { type: "stopp"; utfall: U }
  | { type: "avvist" }
  | { type: "byttet" }
  | { type: "ikkeLest" }
  | { type: "ukjent" };

export type NodeBeslutning<U> = { type: "skriv"; eksport: unknown } | { type: "stopp"; utfall: U };

class Stoppet extends Error {}
class SesjonByttet extends Error {}
type Innlogget = NonNullable<ReturnType<typeof getFirebaseAuth>["currentUser"]>;
interface Vakt {
  bruker: Innlogget;
  stoppet: boolean;
  sendt: boolean;
  signal: AbortSignal;
}

/**
 * Versjonert endring av én hel forsoningsnode over REST (#59, ordre
 * 7002365160, review 5971652993). Samme mønster som notatet på
 * bibliotekmiddag (#185):
 *
 * 1. Fersk lesing rett fra serveren i EKSPORTFORM (`format=export`, med
 *    prioriteter) med ETag. Aldri SDK-cachen.
 * 2. `beslutt` avgjør på den verifiserte lesingen. Et stopp sender
 *    ingenting: ingen skriving, ingen reindeksering, ingen tapt prioritet.
 * 3. Ellers PUT av noden i eksportform med `if-match`. En samtidig endring
 *    gir 412 og en ny runde mot fersk lesing (høyst fem).
 *
 * Forsøket er bundet til innloggingen som startet det (og til `valg.sesjon`
 * når den er gitt): samme bruker for alle kall, og sesjonen kontrolleres
 * etter hver tokenhenting og hver lesing. Hele forsøket, også tokenhenting og
 * JSON-lesing, har én frist. Etter fristen sendes ingenting mer, og utfallet
 * er `ikkeLest` hvis ingen PUT var sendt, ellers `ukjent`.
 */
export async function kjorNodeVersjonert<U>(
  familyId: FamilyId,
  node: ForsoningNode,
  beslutt: (eksport: unknown) => NodeBeslutning<U>,
  valg: { fristMs?: number; sesjon?: string } = {},
): Promise<NodeUtfall<U>> {
  const auth = getFirebaseAuth();
  const bruker = auth.currentUser;
  if (!bruker) return { type: "avvist" };
  if (valg.sesjon !== undefined && sesjonFor(bruker) !== valg.sesjon) return { type: "byttet" };
  const styring = new AbortController();
  const vakt: Vakt = { bruker, stoppet: false, sendt: false, signal: styring.signal };
  let tidtaker: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<NodeUtfall<U>>((resolve) => {
    tidtaker = setTimeout(() => {
      vakt.stoppet = true;
      resolve({ type: vakt.sendt ? "ukjent" : "ikkeLest" });
      styring.abort();
    }, valg.fristMs ?? FORSONING_FRIST_MS);
  });
  try {
    return await Promise.race([nodeRunder(familyId, node, beslutt, vakt), frist]);
  } finally {
    clearTimeout(tidtaker);
  }
}

async function nodeRest(
  familyId: FamilyId,
  node: ForsoningNode,
  vakt: Vakt,
  endring?: { etag: string; eksport: unknown },
): Promise<Response> {
  const token = await vakt.bruker.getIdToken();
  // Et token som kommer etter fristen, starter aldri en forespørsel.
  if (vakt.stoppet) throw new Stoppet();
  if (getFirebaseAuth().currentUser !== vakt.bruker) throw new SesjonByttet();
  const url = databaseRestUrl(forsoningNodePath(familyId, node));
  url.searchParams.set("auth", token);
  if (!endring) {
    url.searchParams.set("format", "export");
    return fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      headers: { "X-Firebase-ETag": "true" },
      signal: vakt.signal,
    });
  }
  vakt.sendt = true;
  return fetch(url, {
    method: "PUT",
    cache: "no-store",
    credentials: "omit",
    headers: { "if-match": endring.etag, "Content-Type": "application/json" },
    body: JSON.stringify(endring.eksport),
    signal: vakt.signal,
  });
}

async function nodeRunder<U>(
  familyId: FamilyId,
  node: ForsoningNode,
  beslutt: (eksport: unknown) => NodeBeslutning<U>,
  vakt: Vakt,
): Promise<NodeUtfall<U>> {
  for (let runde = 0; runde < MAKS_RUNDER; runde++) {
    let etag: string | null;
    let eksport: unknown;
    if (vakt.stoppet) return { type: "ikkeLest" };
    try {
      const res = await nodeRest(familyId, node, vakt);
      if (res.status === 401 || res.status === 403) return { type: "avvist" };
      if (!res.ok) return { type: "ikkeLest" };
      etag = res.headers.get("ETag");
      if (!etag) return { type: "ikkeLest" };
      eksport = await res.json();
    } catch (err) {
      if (err instanceof SesjonByttet) return { type: "byttet" };
      if (!vakt.stoppet && !(err instanceof Stoppet)) {
        console.error("[Forsoning] lesing feilet:", err);
      }
      return { type: "ikkeLest" };
    }
    if (vakt.stoppet) return { type: "ikkeLest" };
    if (getFirebaseAuth().currentUser !== vakt.bruker) return { type: "byttet" };
    const b = beslutt(eksport ?? null);
    if (b.type === "stopp") return b;

    let res: Response;
    try {
      res = await nodeRest(familyId, node, vakt, { etag, eksport: b.eksport });
    } catch (err) {
      if (err instanceof Stoppet) return { type: "ikkeLest" };
      if (err instanceof SesjonByttet) return { type: "byttet" };
      if (!vakt.stoppet) console.error("[Forsoning] svar på skriving uteble:", err);
      return { type: vakt.sendt ? "ukjent" : "ikkeLest" };
    }
    if (res.status === 412) {
      // Avvist på ETag: sikkert ikke skrevet; ny runde mot fersk tilstand.
      vakt.sendt = false;
      continue;
    }
    if (res.status === 401 || res.status === 403) return { type: "avvist" };
    return res.ok ? { type: "lagret" } : { type: "ukjent" };
  }
  return { type: "ikkeLest" };
}

/** Utfallet av en skrivefri, fersk lesing av en hel forsoningsnode i eksportform. */
export type FerskLesing =
  | { type: "lest"; eksport: unknown }
  | { type: "avvist" }
  | { type: "byttet" }
  | { type: "ikkeLest" };

/**
 * Skrivefri lesing av hele noden i eksportform rett fra serveren, med samme
 * frist (for hele operasjonen), stoppvakt og sesjonsbinding som skrivingen.
 * Sender aldri noe annet enn GET.
 */
export async function lesForsoningNodeFersk(
  familyId: FamilyId,
  node: ForsoningNode,
  valg: { fristMs?: number; sesjon?: string } = {},
): Promise<FerskLesing> {
  let lest: unknown = null;
  const r = await kjorNodeVersjonert<"lest">(
    familyId,
    node,
    (eksport) => {
      lest = eksport;
      return { type: "stopp", utfall: "lest" };
    },
    valg,
  );
  if (r.type === "stopp") return { type: "lest", eksport: lest };
  if (r.type === "avvist" || r.type === "byttet") return { type: r.type };
  return { type: "ikkeLest" };
}
