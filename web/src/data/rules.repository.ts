/**
 * Datalag for Regelmotorens regler (`families/{familyId}/rules`), §Issue
 * #34 R1.
 *
 * ## Sameksistenskontrakt (Kontrolltårn-beslutning 5952884278)
 *
 * `rules` er i dag en **helnode-array**: legacy `setRules` (`index.html`
 * ~16654) skriver HELE listen med `dbSet(…/rules, next)` — RTDB-nøklene er
 * array-indekser (`"0"`, `"1"`, …) og `id` ligger inne i elementet — og
 * leser den tilbake med `Object.values` (~15949). Kontrakten er:
 *
 *  - **Én aktiv skriver per node.** React skriver `rules` først når ALLE
 *    legacy-skrivere av noden sperres i samme cutover — for `rules` betyr
 *    det R3b (Bankimport-læring og korrigering skriver også `rules`).
 *    Fram til da er skrivingen stengt i hook-laget
 *    (`hooks/regelsenterAktivering.ts`).
 *  - **Dagens array-form beholdes.** `transactRules` skriver hele listen
 *    som array i ÉN transaksjon på hele noden — aldri `rules/{id}`.
 *    Legacy kan da leses tilbake som rollback uten datamigrering, og
 *    målrettede id-skrivinger (som gir duplikater etter en legacy-
 *    reindeksering, emulatorscenario 4b i designnoten 5952769652) finnes ikke.
 *  - **Ingen nøkkelmigrering** fra indeks til id før legacy er pensjonert
 *    for noden (egen beslutning).
 *
 * Transaksjonen gir compare-and-set mot andre skrivere (React og legacy)
 * for React sin EGEN skriving. Den kan ikke beskytte mot en senere blind
 * legacy-`dbSet` — derfor én-skriver-regelen over.
 */
import { onValue, ref } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import { nodeListe, transactForsoningNode } from "./forsoningSkriving.repository";
import type { FamilyId } from "@app-types/family";
import type { RegelRecord } from "@app-types/forsoning";

export function rulesPath(familyId: FamilyId): string {
  return `families/${familyId}/rules`;
}

/** Legacy-lesingen: `v ? Object.values(v) : []` — tåler array, sparsom array og objekt. */
const regelListe = (raw: unknown) => nodeListe<RegelRecord>(raw);

/** Abonnerer på hele regellisten. Returnerer en avmeldingsfunksjon. */
export function subscribeRules(
  familyId: FamilyId,
  onChange: (regler: RegelRecord[]) => void,
): () => void {
  return onValue(ref(getFirebaseDatabase(), rulesPath(familyId)), (snapshot) => {
    onChange(regelListe(snapshot.val()));
  });
}

/** En ren updater over HELE regellisten, som legacy sin `setRules(prev => …)`. */
export type RegelUpdater = (prev: RegelRecord[]) => RegelRecord[];

/**
 * Kjører `updater` mot den FERSKE serverlisten i én transaksjon på hele
 * `rules`-noden og skriver resultatet tilbake i dagens array-form — den
 * felles forsoningsskriveren (`forsoningSkriving.repository.ts`). Firebase
 * kjører updateren på nytt hvis noden endret seg underveis, så en endring
 * beregnet fra et utdatert øyeblikksbilde blir aldri skrevet.
 *
 * Returnerer listen slik den ligger etter transaksjonen.
 */
export function transactRules(familyId: FamilyId, updater: RegelUpdater): Promise<RegelRecord[]> {
  return transactForsoningNode<RegelRecord>(familyId, "rules", updater);
}
