/**
 * Datalag for Middagsbiblioteket (`families/{familyId}/mealLibrary`) —
 * KUN lesing i denne skiven. Skriving (opprett/slett/rediger, bootstrap)
 * er fortsatt et skjerm-eid ansvar i `index.html` sin `MealLibraryScreen`
 * — Handlelistegeneratoren TRENGER kun å LESE biblioteket, den endrer det
 * aldri. Egen CRUD-migrering av selve Middagsbiblioteket er en egen,
 * senere skive (§PR #3 sin kode-sannhet-avstemming, punkt 2).
 *
 * **Funn, samme klasse som Kokebok/Middagsplan sine tilsvarende funn:**
 * RTDB lagrer aldri `null` tilbake som `null` — et `shoppingBase`-element
 * lagret med `itemId:null` (dagens `endreVareNavnFritekst`, index.html
 * linje ~3130–3134 — skjer hver gang en bruker skriver et fritekst-navn i
 * stedet for å velge en eksisterende vare) kommer tilbake UTEN
 * `itemId`-nøkkelen. Normalisert på lesing under, samme mønster som
 * `parseRecipeFields`/`parseMealValue`.
 */
import { onValue, ref } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { MealLibraryEntry, ShoppingBaseItem } from "@app-types/shopping";

function mealLibraryPath(familyId: FamilyId): string {
  return `families/${familyId}/mealLibrary`;
}

function parseShoppingBaseItem(raw: Record<string, unknown>): ShoppingBaseItem {
  return {
    id: raw.id as string,
    itemId: (raw.itemId as string | null | undefined) ?? null,
    name: raw.name as string,
    amount: (raw.amount as string | undefined) ?? "",
    unit: (raw.unit as string | undefined) ?? "",
    cat: (raw.cat as string | undefined) ?? "",
  };
}

function parseMealLibraryEntry(id: string, raw: Record<string, unknown>): MealLibraryEntry {
  const rawShoppingBase = raw.shoppingBase as Record<string, unknown>[] | undefined;
  return {
    id,
    name: raw.name as string,
    ...(rawShoppingBase ? { shoppingBase: rawShoppingBase.map(parseShoppingBaseItem) } : {}),
  };
}

/** Abonnerer på hele Middagsbiblioteket. Returnerer en avmeldingsfunksjon. */
export function subscribeMealLibrary(
  familyId: FamilyId,
  onChange: (entries: MealLibraryEntry[]) => void,
): () => void {
  const libraryRef = ref(getFirebaseDatabase(), mealLibraryPath(familyId));
  const unsubscribe = onValue(libraryRef, (snapshot) => {
    if (!snapshot.exists()) {
      onChange([]);
      return;
    }
    const value = snapshot.val() as Record<string, Record<string, unknown>>;
    onChange(Object.entries(value).map(([id, fields]) => parseMealLibraryEntry(id, fields)));
  });
  return unsubscribe;
}
