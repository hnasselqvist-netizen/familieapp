/**
 * Datalag for basisvarer (`families/{familyId}/staples`).
 *
 * Uendret datastruktur: `{varenavn (lowercase): true}` — ikke en
 * id-keyet samling. Opprinnelig eneste skriving var
 * `ShoppingGenerator.confirmStaple` (index.html linje ~2830–2836 —
 * "merk som basisvare"-spørsmålet som dukker opp når brukeren fjerner en
 * vare i gjennomgangen): et ubetinget `set(true)` på varens egen nøkkel,
 * allerede målrettet og uten samtidighetsrisiko (ingen les-før-skriv).
 *
 * **Kjøkken v1 — `removeStaple`** (§Kontrolltårn-handoff, Issue #20,
 * "Matlager... kan bære både frysevarer og basisvarer/beholdning"):
 * basisvarer hadde tidligere INGEN "fjern"-motstykke noe sted i koden
 * (verken her eller i produksjons-`index.html`) — en vare markert som
 * basisvare kunne aldri umerkes igjen uten direkte databaseredigering.
 * `remove()` på varens egen nøkkel, samme målrettede, samtidighetstrygge
 * mønster som skrivingen.
 */
import { onValue, ref, remove, set } from "firebase/database";
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

/** Fjerner en vare som basisvare — nytt i Kjøkken v1, se filens toppkommentar. */
export async function removeStaple(familyId: FamilyId, name: string): Promise<void> {
  await remove(ref(getFirebaseDatabase(), `${staplesPath(familyId)}/${name.toLowerCase()}`));
}
