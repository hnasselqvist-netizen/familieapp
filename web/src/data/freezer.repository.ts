/**
 * Datalag for fryseren (`families/{familyId}/freezer`).
 *
 * Skrivemønster: målrettede skrivinger til én fryserposts egen node
 * (`freezer/{id}`) — aldri hele samlingen tilbake (§arkitekturbeslutning,
 * punkt 6 — erstatter dagens `dbSet(FAM/freezer, heleObjektet)`). Lesing
 * skjer fortsatt som ett abonnement på hele samlingen, siden fryseren er
 * liten nok til at det ikke er et problem — det er SKRIVINGEN som
 * tidligere skalerte dårlig, ikke lesingen.
 */
import { onValue, ref, remove, set } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FreezerItem } from "@app-types/freezer";
import type { FamilyId } from "@app-types/family";

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
    const value = snapshot.exists()
      ? (snapshot.val() as Record<string, Omit<FreezerItem, "id">>)
      : null;
    onChange(value ? Object.entries(value).map(([id, fields]) => ({ id, ...fields })) : []);
  });
  return unsubscribe;
}

/** Skriver (oppretter eller erstatter) én fryserpost — kun sin egen node. */
export async function writeFreezerItem(familyId: FamilyId, item: FreezerItem): Promise<void> {
  const { id, ...fields } = item;
  await set(ref(getFirebaseDatabase(), freezerItemPath(familyId, id)), fields);
}

/** Fjerner én fryserpost i sin helhet. */
export async function deleteFreezerItem(familyId: FamilyId, itemId: string): Promise<void> {
  await remove(ref(getFirebaseDatabase(), freezerItemPath(familyId, itemId)));
}
