/**
 * LESE-ONLY datalag for Gangens tre Bankimport/Kvittering-signaler
 * (`families/{familyId}/transaksjoner`, `.../hendelser`, `.../receipts`)
 * — §types/gangen.ts for hvorfor kun et fåtall felt er modellert.
 * Ingen skrivefunksjoner her: Gangen endrer aldri disse dataene selv,
 * kun Bankimport/Kvitteringsinnboks gjør det (fortsatt i `index.html`,
 * utenfor denne skiven). Speiler produksjonens `listen("transaksjoner",
 * ...)`/`listen("receipts", ...)`/`listen("hendelser", ...)`
 * (§index.html linje 15905-15907) — samme tre paths, `Object.values`
 * på et flatt, id-nøkkelet objekt.
 */
import { onValue, ref } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { BankHendelse, BankTransaksjon, Kvittering } from "@app-types/gangen";

function subscribeRaw<T>(
  familyId: FamilyId,
  collectionName: string,
  onChange: (items: T[]) => void,
): () => void {
  const collectionRef = ref(getFirebaseDatabase(), `families/${familyId}/${collectionName}`);
  return onValue(collectionRef, (snapshot) => {
    if (!snapshot.exists()) {
      onChange([]);
      return;
    }
    const value = snapshot.val() as Record<string, T>;
    onChange(Object.values(value));
  });
}

export function subscribeTransaksjoner(
  familyId: FamilyId,
  onChange: (transaksjoner: BankTransaksjon[]) => void,
): () => void {
  return subscribeRaw(familyId, "transaksjoner", onChange);
}

export function subscribeBankHendelser(
  familyId: FamilyId,
  onChange: (hendelser: BankHendelse[]) => void,
): () => void {
  return subscribeRaw(familyId, "hendelser", onChange);
}

export function subscribeReceipts(
  familyId: FamilyId,
  onChange: (receipts: Kvittering[]) => void,
): () => void {
  return subscribeRaw(familyId, "receipts", onChange);
}
