/**
 * Datalag for basisvarer (`families/{familyId}/staples`).
 *
 * Uendret datastruktur: `{varenavn (lowercase): true}` — ikke en
 * id-keyet samling. Eneste skriving i hele dagens kode er
 * `ShoppingGenerator.confirmStaple` (index.html linje ~2830–2836 —
 * "merk som basisvare"-spørsmålet som dukker opp når brukeren fjerner en
 * vare i gjennomgangen): et ubetinget `set(true)` på varens egen nøkkel,
 * allerede målrettet og uten samtidighetsrisiko (ingen les-før-skriv, ingen
 * "fjern basisvare"-moteykke finnes noe sted i dagens kode).
 */
import { onValue, ref, set } from "firebase/database";
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

/** Markerer en vare som basisvare. Speiler `confirmStaple` (index.html linje ~2830–2836) 1:1 — navnet lowercases før skriving, akkurat som i dag. */
export async function markItemAsStaple(familyId: FamilyId, name: string): Promise<void> {
  await set(ref(getFirebaseDatabase(), `${staplesPath(familyId)}/${name.toLowerCase()}`), true);
}
