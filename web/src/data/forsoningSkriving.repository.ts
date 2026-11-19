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

/** Avgrenset ventetid for en betinget forsoningsendring og den skrivefrie kontrollen. */
export const FORSONING_FRIST_MS = 15_000;

/** Utfallet av `transactForsoningNodeBetinget`. */
export type BetingetUtfall<U> =
  | { type: "skrevet" }
  | { type: "stopp"; utfall: U }
  | { type: "avvist" }
  | { type: "byttet" }
  | { type: "ikkeLest" }
  | { type: "ukjent" };

/**
 * Én betinget endring i én helnode-transaksjon (#59, ordre 7002365160).
 * Samme skriver som `transactForsoningNode`: fersk serverliste, hele noden i
 * array-form, aldri `node/{id}`. I tillegg:
 *
 * - `beslutt` kan STOPPE uten skriving. Da returneres serververdien uendret
 *   (også `null` ved kald cache, så Firebase sammenligner mot serveren og
 *   kjører på nytt). Ingenting reindekseres ved et stopp.
 * - **Sesjon:** `valg.sesjon` må være den aktive innloggingen ved start
 *   (`byttet` ellers, uten noe sendt), og en ny `currentUser` under en
 *   ny kjøring avbryter transaksjonen.
 * - **Frist:** etter `fristMs` gis `ukjent`, og enhver senere ny kjøring av
 *   beregningen avbrytes. En forespørsel som allerede er sendt, kan likevel
 *   nå frem, men bare mot nøyaktig den listen den ble beregnet fra.
 * - `applyLocally: false`: lyttere ser bare serverbekreftet resultat.
 *
 * Avvisning på tilgang gir `avvist`. En transaksjon Firebase selv gir opp
 * (`maxretry`, eller avbrutt av en `set` før sending) gir `ikkeLest`: ingenting
 * er skrevet. Annen feil gir `ukjent`.
 */
export async function transactForsoningNodeBetinget<T, U>(
  familyId: FamilyId,
  node: ForsoningNode,
  beslutt: (prev: T[]) => { type: "skriv"; liste: T[] } | { type: "stopp"; utfall: U },
  valg: { fristMs?: number; sesjon?: string } = {},
): Promise<BetingetUtfall<U>> {
  const auth = getFirebaseAuth();
  const bruker = auth.currentUser;
  if (!bruker) return { type: "avvist" };
  if (valg.sesjon !== undefined && sesjonFor(bruker) !== valg.sesjon) return { type: "byttet" };

  let stoppet = false;
  let byttet = false;
  let siste: { type: "skriv" } | { type: "stopp"; utfall: U } | null = null;
  const tx = runTransaction(
    ref(getFirebaseDatabase(), forsoningNodePath(familyId, node)),
    (current: unknown) => {
      if (stoppet) return undefined;
      if (auth.currentUser !== bruker) {
        byttet = true;
        return undefined;
      }
      const b = beslutt(nodeListe<T>(current));
      if (b.type === "stopp") {
        siste = b;
        return current;
      }
      siste = { type: "skriv" };
      return JSON.parse(JSON.stringify(b.liste)) as T[];
    },
    { applyLocally: false },
  ).then(
    (res): BetingetUtfall<U> => {
      if (!res.committed) return byttet ? { type: "byttet" } : { type: "ikkeLest" };
      const s = siste as { type: "skriv" } | { type: "stopp"; utfall: U } | null;
      if (!s) return { type: "ukjent" };
      return s.type === "skriv" ? { type: "skrevet" } : s;
    },
    (err: unknown): BetingetUtfall<U> => {
      // Firebase avviser en transaksjon med `new Error(abortReason)`: meldingen
      // ER grunnen (`permission_denied`, `maxretry`, `set`, …).
      const grunn = err instanceof Error ? err.message : "";
      if (grunn === "permission_denied") return { type: "avvist" };
      if (grunn === "maxretry" || grunn === "set") return { type: "ikkeLest" };
      if (!stoppet) console.error("[Forsoning] betinget endring feilet:", err);
      return { type: "ukjent" };
    },
  );
  let tidtaker: ReturnType<typeof setTimeout> | undefined;
  const frist = new Promise<BetingetUtfall<U>>((resolve) => {
    tidtaker = setTimeout(() => {
      stoppet = true;
      resolve({ type: "ukjent" });
    }, valg.fristMs ?? FORSONING_FRIST_MS);
  });
  try {
    return await Promise.race([tx, frist]);
  } finally {
    clearTimeout(tidtaker);
  }
}

/** Utfallet av en skrivefri, fersk lesing av en hel forsoningsnode. */
export type FerskLesing =
  | { type: "lest"; liste: unknown[] }
  | { type: "avvist" }
  | { type: "byttet" }
  | { type: "ikkeLest" };

/**
 * Skrivefri lesing av hele noden RETT FRA SERVEREN (REST GET, aldri SDK-
 * cachen), med tokenet til innloggingen `sesjon` peker på og avgrenset
 * ventetid. Brukes til å kontrollere et uavklart forsøk. Sender aldri noe
 * annet enn GET.
 */
export async function lesForsoningNodeFersk(
  familyId: FamilyId,
  node: ForsoningNode,
  valg: { fristMs?: number; sesjon?: string } = {},
): Promise<FerskLesing> {
  const auth = getFirebaseAuth();
  const bruker = auth.currentUser;
  if (!bruker) return { type: "avvist" };
  if (valg.sesjon !== undefined && sesjonFor(bruker) !== valg.sesjon) return { type: "byttet" };
  const styring = new AbortController();
  const tidtaker = setTimeout(() => styring.abort(), valg.fristMs ?? FORSONING_FRIST_MS);
  try {
    const token = await bruker.getIdToken();
    if (auth.currentUser !== bruker) return { type: "byttet" };
    const url = databaseRestUrl(forsoningNodePath(familyId, node));
    url.searchParams.set("auth", token);
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      credentials: "omit",
      signal: styring.signal,
    });
    if (res.status === 401 || res.status === 403) return { type: "avvist" };
    if (!res.ok) return { type: "ikkeLest" };
    const verdi: unknown = await res.json();
    if (auth.currentUser !== bruker) return { type: "byttet" };
    return { type: "lest", liste: nodeListe<unknown>(verdi) };
  } catch (err) {
    if (!styring.signal.aborted) console.error("[Forsoning] fersk lesing feilet:", err);
    return { type: "ikkeLest" };
  } finally {
    clearTimeout(tidtaker);
  }
}
