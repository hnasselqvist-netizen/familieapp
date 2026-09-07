/**
 * Datalag for varehistorikken (`families/{familyId}/itemHistory`) — KUN
 * lesing i denne skiven. Skriving skjer i dag ved `MatScreen.setShopping`
 * (index.html linje ~16468–16483): en full-collection-overskriving som
 * KUN legger til navn som ikke finnes fra før — den oppdaterer aldri en
 * eksisterende oppførings `cat` (§PR #3 sin kode-sannhet-avstemming,
 * punkt 5: "første treff vinner", ikke "sist brukt vinner"). Denne
 * skriveflyten er skjerm-eid (del av handleliste-lagringen) og migreres
 * ikke her — Handlelistegeneratoren TRENGER kun å LESE historikken for
 * kategori-oppslag (§generators/shopping/shopping.ts sin
 * `lookupCategoryFromHistory`).
 *
 * Uendret datastruktur: en FLAT LISTE (`itemHistory/{index}`,
 * §designbok.md "Datakilder"), ikke en id-keyet samling som
 * recipes/mealLibrary/freezer.
 */
import { onValue, ref } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { ItemHistoryEntry } from "@app-types/shopping";

function itemHistoryPath(familyId: FamilyId): string {
  return `families/${familyId}/itemHistory`;
}

/** Abonnerer på hele varehistorikken. Returnerer en avmeldingsfunksjon. */
export function subscribeItemHistory(
  familyId: FamilyId,
  onChange: (entries: ItemHistoryEntry[]) => void,
): () => void {
  const historyRef = ref(getFirebaseDatabase(), itemHistoryPath(familyId));
  const unsubscribe = onValue(historyRef, (snapshot) => {
    if (!snapshot.exists()) {
      onChange([]);
      return;
    }
    const value = snapshot.val() as ItemHistoryEntry[];
    onChange(value);
  });
  return unsubscribe;
}
