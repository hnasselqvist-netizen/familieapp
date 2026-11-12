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
import { databaseRestUrl, getFirebaseAuth, getFirebaseDatabase } from "./firebase";
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

/** Svaret fra `bekreftVareFraServer`. */
export type VareBekreftelse =
  | { type: "finnes"; vare: Vare }
  | { type: "mangler" }
  /** Serveren kunne ikke leses (nett, tilgang): ingenting kan bekreftes. */
  | { type: "ikkeLest" };

/**
 * Bekrefter at varen med EKSAKT denne id-en finnes på serveren nå —
 * skrivefritt, via REST, ikke fra SDK-ets lokale cache eller et abonnement
 * som kan være foreldet (Mat #20, review 5881436508 pkt. 2). Ingen
 * navnefallback: finnes ikke id-en, er svaret `mangler`.
 */
export async function bekreftVareFraServer(
  familyId: FamilyId,
  id: string,
): Promise<VareBekreftelse> {
  if (!id || id.startsWith("_") || /[.#$[\]/]/.test(id)) return { type: "mangler" };
  try {
    const bruker = getFirebaseAuth().currentUser;
    if (!bruker) return { type: "ikkeLest" };
    const url = databaseRestUrl(itemPath(familyId, id));
    url.searchParams.set("auth", await bruker.getIdToken());
    const res = await fetch(url, { method: "GET", cache: "no-store", credentials: "omit" });
    if (!res.ok) return { type: "ikkeLest" };
    const v = (await res.json()) as unknown;
    if (v === null) return { type: "mangler" };
    if (typeof v !== "object" || Array.isArray(v)) return { type: "mangler" };
    const felt = v as Record<string, unknown>;
    if (typeof felt.name !== "string") return { type: "mangler" };
    return {
      type: "finnes",
      vare: { id, name: felt.name, cat: typeof felt.cat === "string" ? felt.cat : "Diverse" },
    };
  } catch (err) {
    console.error("[Varebase] bekreftelse feilet:", err);
    return { type: "ikkeLest" };
  }
}
