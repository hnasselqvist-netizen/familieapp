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
import type { FreezerItem, FreezerItemFields, FreezerSamling } from "@app-types/freezer";

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

export type SamlingsUtfall<A> =
  { type: "lagret" } | { type: "konflikt"; avvisning: A } | { type: "avvist" } | { type: "ukjent" };

/**
 * Én RTDB-transaksjon på HELE `freezer`-samlingen. Brukes av «Legg til»
 * med målpost valgt ved commit (#20, ordre 6698904630): `velg` får fersk
 * serververdi og returnerer ny samling eller en avvisning (regelen ligger
 * i domenet, `leggTilVedCommit`).
 *
 * - Avvisning returnerer gjeldende verdi uendret i stedet for å avbryte:
 *   da verifiseres den mot serveren (hash) før den rapporteres, i stedet
 *   for å bygge på en mulig utdatert lokal cache.
 * - `applyLocally: false`: ingen optimistisk visning før serveren har
 *   bekreftet.
 * - `permission_denied` er terminal (`avvist`); annen feil eller manglende
 *   commit er `ukjent`. Ingen automatisk nytt forsøk.
 * - Kostnad: hvert forsøk sender hele samlingen. Målt i syntetisk
 *   emulator-probe (docs/arkitektur/matlager-kjoleskap-torrvarer.md §5).
 *   Øvrige skriveveier (+/−, fjern) er fortsatt per post.
 */
export async function transactFreezerSamling<A>(
  familyId: FamilyId,
  velg: (current: FreezerSamling | null) => { samling: FreezerSamling } | { avvisning: A },
): Promise<SamlingsUtfall<A>> {
  let avvisning: { verdi: A } | null = null;
  try {
    const res = await runTransaction(
      ref(getFirebaseDatabase(), freezerPath(familyId)),
      (current) => {
        const r = velg(current as FreezerSamling | null);
        if ("avvisning" in r) {
          avvisning = { verdi: r.avvisning };
          return current;
        }
        avvisning = null;
        return r.samling;
      },
      { applyLocally: false },
    );
    const a = avvisning as { verdi: A } | null;
    if (a) return { type: "konflikt", avvisning: a.verdi };
    return res.committed ? { type: "lagret" } : { type: "ukjent" };
  } catch (err) {
    const e = err as { code?: unknown; message?: unknown } | null;
    if (/permission[_ ]denied/i.test(String(e?.code ?? e?.message ?? "")))
      return { type: "avvist" };
    return { type: "ukjent" };
  }
}
