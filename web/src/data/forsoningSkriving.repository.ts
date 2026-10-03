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
import { getFirebaseDatabase } from "./firebase";
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
): Promise<T[]> {
  const result = await runTransaction(
    ref(getFirebaseDatabase(), forsoningNodePath(familyId, node)),
    (current: unknown) => {
      const next = updater(nodeListe<T>(current));
      // Array-form som legacy `dbSet(…, next)`; RTDB nekter `undefined`.
      return JSON.parse(JSON.stringify(next)) as T[];
    },
  );
  return nodeListe<T>(result.snapshot.val());
}
