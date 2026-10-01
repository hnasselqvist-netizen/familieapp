/**
 * Datalag for den delte varebasen (`families/{familyId}/items`).
 * Eneste sted (utenom freezer.repository.ts sitt eget domene) som
 * leser/skriver denne stien.
 *
 * Skrivemønster: KUN målrettede skrivinger til én vares egen node
 * (`items/{id}`), aldri hele samlingen tilbake (§arkitekturbeslutning,
 * punkt 6 — erstatter dagens `dbSet(FAM/items, heleObjektet)`).
 */
import { get, onValue, ref, set } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { ItemMatchRules, Vare } from "@app-types/vare";

function itemsPath(familyId: FamilyId): string {
  return `families/${familyId}/items`;
}

function itemPath(familyId: FamilyId, id: string): string {
  return `${itemsPath(familyId)}/${id}`;
}

function parseSnapshotValue(value: Record<string, Omit<Vare, "id">> | null): Vare[] {
  if (!value) return [];
  return Object.entries(value).map(([id, fields]) => ({ id, ...fields }));
}

/** Abonnerer på hele varebasen. Returnerer en avmeldingsfunksjon. */
export function subscribeItems(familyId: FamilyId, onChange: (items: Vare[]) => void): () => void {
  const itemsRef = ref(getFirebaseDatabase(), itemsPath(familyId));
  const unsubscribe = onValue(itemsRef, (snapshot) => {
    onChange(parseSnapshotValue(snapshot.exists() ? snapshot.val() : null));
  });
  return unsubscribe;
}

/**
 * Finner en eksisterende vare på navn (case-insensitivt, trimmet) eller
 * oppretter en ny. Speiler dagens `finnEllerOpprettVare` 1:1 i oppførsel;
 * eneste endring er at en NY vare skrives til sin egen node i stedet for
 * at hele varebasen serialiseres på nytt. Navnematch-/nyvare-regelen
 * injiseres som `rules` (§domain/shopping/handlelisteRules.ts — delt med
 * Kontrolltårnets MCP-flate).
 *
 * Race-merknad (videreført fra dagens kode, ikke løst her): to ulike
 * klienter som oppretter samme varenavn samtidig kan i sjeldne tilfeller
 * begge lese "finnes ikke" og opprette to poster. Samme kjente
 * begrensning som i dag — ikke forverret av denne omskrivingen.
 */
export async function findOrCreateItem(
  familyId: FamilyId,
  name: string,
  cat: string,
  rules: ItemMatchRules,
): Promise<Vare | null> {
  const fields = rules.newItemFields(name, cat);
  if (!fields) return null;

  const snapshot = await get(ref(getFirebaseDatabase(), itemsPath(familyId)));
  const existing = rules.findItemByName(
    parseSnapshotValue(snapshot.exists() ? snapshot.val() : null),
    name,
  );
  if (existing) return existing;

  const id = crypto.randomUUID();
  await set(ref(getFirebaseDatabase(), itemPath(familyId, id)), fields);
  return { id, ...fields };
}
