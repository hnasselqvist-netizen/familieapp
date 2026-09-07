/**
 * Datalag for basisvarer (`families/{familyId}/staples`) — KUN lesing i
 * denne skiven. Skriving (§`ShoppingGenerator.confirmStaple`,
 * index.html linje ~2830–2836 — "merk som basisvare"-spørsmålet som
 * dukker opp når brukeren fjerner en vare i gjennomgangen) er en
 * skjerm-/gjennomgangsflate-interaksjon, ikke generator-logikk —
 * Handlelistegeneratoren TRENGER kun å LESE staples for å avgjøre om en
 * vare skal foreslås avhuket som standard (§generators/shopping/shopping.ts).
 *
 * Uendret datastruktur: `{varenavn (lowercase): true}` — ikke en
 * id-keyet samling.
 */
import { onValue, ref } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { Staples } from "@app-types/shopping";

function staplesPath(familyId: FamilyId): string {
  return `families/${familyId}/staples`;
}

/** Abonnerer på basisvarer. Returnerer en avmeldingsfunksjon. */
export function subscribeStaples(
  familyId: FamilyId,
  onChange: (staples: Staples) => void,
): () => void {
  const staplesRef = ref(getFirebaseDatabase(), staplesPath(familyId));
  const unsubscribe = onValue(staplesRef, (snapshot) => {
    onChange(snapshot.exists() ? (snapshot.val() as Staples) : {});
  });
  return unsubscribe;
}
