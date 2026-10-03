/**
 * LESE-ONLY datalag for forsoningsnodene i full form
 * (`families/{familyId}/receipts|hendelser|transaksjoner`), §Issue #34 R2.
 *
 * Ingen skrivefunksjoner: kontrakten er én aktiv skriver per node (ADR
 * 0002), og legacy er fortsatt eneste skriver av disse tre nodene til
 * R3-cutover (skrivingen ligger klar, men stengt, i
 * `forsoningSkriving.repository.ts`). Leser som legacy (`listen(…)` → `Object.values`, `index.html`
 * ~15905–15907), så både array-form (indeksnøkler, også sparsomme) og
 * objekt-form leses likt. `gangen.repository.ts` leser de samme nodene med
 * et smalere felt-utvalg for Gangens signaler.
 *
 * NB: `receipts` kan inneholde base64-bilder (`imageUrl`, fra Bankimports
 * «legg til kvittering») — de lastes ned med noden, som i legacy.
 */
import { onValue, ref } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { HendelseRecord, KvitteringRecord, TransaksjonRecord } from "@app-types/forsoning";

function subscribeNode<T>(
  familyId: FamilyId,
  node: "receipts" | "hendelser" | "transaksjoner",
  onChange: (liste: T[]) => void,
): () => void {
  return onValue(ref(getFirebaseDatabase(), `families/${familyId}/${node}`), (snapshot) => {
    const v = snapshot.val() as Record<string, T> | T[] | null;
    onChange(v && typeof v === "object" ? (Object.values(v) as T[]) : []);
  });
}

export const subscribeKvitteringer = (
  familyId: FamilyId,
  onChange: (kvitteringer: KvitteringRecord[]) => void,
) => subscribeNode(familyId, "receipts", onChange);

export const subscribeHendelser = (
  familyId: FamilyId,
  onChange: (hendelser: HendelseRecord[]) => void,
) => subscribeNode(familyId, "hendelser", onChange);

export const subscribeTransaksjonRecords = (
  familyId: FamilyId,
  onChange: (transaksjoner: TransaksjonRecord[]) => void,
) => subscribeNode(familyId, "transaksjoner", onChange);
