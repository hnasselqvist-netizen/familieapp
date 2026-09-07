/**
 * Datalag for fryseren (`families/{familyId}/freezer`).
 *
 * Skrivemønster: målrettede skrivinger til én fryserposts egen node
 * (`freezer/{id}`) — aldri hele samlingen tilbake (§arkitekturbeslutning,
 * punkt 6 — erstatter dagens `dbSet(FAM/freezer, heleObjektet)`). Lesing
 * skjer fortsatt som ett abonnement på hele samlingen, siden fryseren er
 * liten nok til at det ikke er et problem — det er SKRIVINGEN som
 * tidligere skalerte dårlig, ikke lesingen.
 *
 * Mutasjon av en EKSISTERENDE post går via `transactFreezerItem`
 * (RTDB `runTransaction`), ikke et ubetinget `set()` — se den for
 * hvorfor (§Kontrolltårn-review, Fase 0 runde 2).
 */
import { onValue, ref, remove, runTransaction } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { FreezerItem, FreezerItemFields } from "@app-types/freezer";

function freezerPath(familyId: FamilyId): string {
  return `families/${familyId}/freezer`;
}

function freezerItemPath(familyId: FamilyId, id: string): string {
  return `${freezerPath(familyId)}/${id}`;
}

/** Abonnerer på hele fryseren. Returnerer en avmeldingsfunksjon. */
export function subscribeFreezer(
  familyId: FamilyId,
  onChange: (items: FreezerItem[]) => void,
): () => void {
  const freezerRef = ref(getFirebaseDatabase(), freezerPath(familyId));
  const unsubscribe = onValue(freezerRef, (snapshot) => {
    const value = snapshot.exists() ? (snapshot.val() as Record<string, FreezerItemFields>) : null;
    onChange(value ? Object.entries(value).map(([id, fields]) => ({ id, ...fields })) : []);
  });
  return unsubscribe;
}

/**
 * Muterer én fryserpost-node atomisk. `updater` mottar den FAKTISKE,
 * ferskeste server-verdien for noden — aldri en potensielt utdatert
 * lokal/React-kopi — og returnerer den nye verdien, eller `null` for å
 * fjerne noden. RTDB kjører `updater` på nytt automatisk hvis den
 * oppdager at noen andre skrev til akkurat denne noden i mellomtiden,
 * slik at to raske, konkurrerende operasjoner på SAMME post (to
 * "+"-klikk rett etter hverandre, to batch-endringer på samme vare) ikke
 * kan miste hverandres endring ved at den siste skrivingen overskriver
 * et utdatert øyeblikksbilde (§Kontrolltårn-review, Fase 0 runde 2).
 */
export async function transactFreezerItem(
  familyId: FamilyId,
  itemId: string,
  updater: (current: FreezerItemFields | null) => FreezerItemFields | null,
): Promise<void> {
  await runTransaction(ref(getFirebaseDatabase(), freezerItemPath(familyId, itemId)), (current) =>
    updater(current as FreezerItemFields | null),
  );
}

/** Fjerner én fryserpost i sin helhet. Ingen les-endre-skriv-risiko ved en ubetinget sletting. */
export async function deleteFreezerItem(familyId: FamilyId, itemId: string): Promise<void> {
  await remove(ref(getFirebaseDatabase(), freezerItemPath(familyId, itemId)));
}
