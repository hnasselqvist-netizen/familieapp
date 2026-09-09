/**
 * Datalag for Middagsbiblioteket (`families/{familyId}/mealLibrary`).
 *
 * Skrivemønster: målrettede skrivinger til ÉTT biblioteksmåltid sin egen
 * node (`mealLibrary/{id}`) — aldri hele biblioteket tilbake. Dagens
 * `index.html` (`setMealLibrary`, linje ~16543) skriver HELE biblioteket
 * ved enhver endring (opprett/slett måltid, eller enhver `shoppingBase`-
 * rad-mutasjon på ETT måltid) — samme risikoklasse som Fryser/Kokebok/
 * Middagsplan/Handleliste hadde før de ble fikset.
 *
 * `shoppingBase[]` er et NØSTET array inni ett biblioteksmåltid, ikke en
 * egen flat samling — samme situasjon som Middagsplan sin `menu.recipes[]`
 * inni én dagnode. Løsningen er derfor identisk med
 * `meals.repository.ts` sin `transactMealDay`: `transactMealLibraryEntry`
 * kjører én `runTransaction` på HELE måltid-noden (leser ferskeste
 * server-verdi, lar en ren motorfunksjon fra `src/domain/mealLibrary/`
 * beregne neste verdi, skriver tilbake). To samtidige redigeringer av TO
 * ULIKE biblioteksmåltider kolliderer strukturelt ikke lenger (ulike
 * noder); to samtidige redigeringer av SAMME måltid serialiseres atomisk
 * av Firebase selv.
 *
 * **Funn, samme klasse som Kokebok/Middagsplan sine tilsvarende funn:**
 * RTDB lagrer aldri `null` tilbake som `null` — et `shoppingBase`-element
 * lagret med `itemId:null` (dagens `endreVareNavnFritekst`, index.html
 * linje ~3130–3134 — skjer hver gang en bruker skriver et fritekst-navn i
 * stedet for å velge en eksisterende vare) kommer tilbake UTEN
 * `itemId`-nøkkelen. Normalisert på lesing under, samme mønster som
 * `parseRecipeFields`/`parseMealValue`.
 *
 * **Funn under Førsteutkast-skiven:** `parseMealLibraryEntry` og
 * transaksjonens `payload`-bygging hvitlistet opprinnelig KUN `name`/
 * `shoppingBase` — de nye, valgfrie `lettvint`/`variationTags`-feltene
 * ble derfor lest inn som `undefined` og systematisk STRØKET FRA
 * HVER SKRIVING, uansett hva den kallende motorfunksjonen faktisk
 * beregnet. Oppdaget av en E2E-test (`forsteutkast.spec.ts`) sin
 * `.check()`-handling på "🍃 Lettvint middag"-avkrysningsboksen, som
 * aldri klarte å observere at tilstanden faktisk endret seg — begge
 * steder er nå rettet til å inkludere de to feltene når de er satt.
 */
import { onValue, ref, remove, runTransaction, set } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { MealLibraryEntry, MealVariant, ShoppingBaseItem } from "@app-types/shopping";

function mealLibraryPath(familyId: FamilyId): string {
  return `families/${familyId}/mealLibrary`;
}

function mealLibraryEntryPath(familyId: FamilyId, id: string): string {
  return `${mealLibraryPath(familyId)}/${id}`;
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

/**
 * Kilden er eksklusiv i `MealVariant` (§domain/mealLibrary/mealLibrary.ts
 * sin `NewMealVariant`): `shoppingBase`-nøkkelens tilstedeværelse avgjør
 * hvilken gren dette er. `recipeId` er ALLTID konkret her (ikke nullbar,
 * §Nattvakt-review, PR #18) — ingen normalisering nødvendig, ulikt
 * `ShoppingBaseItem.itemId`.
 */
function parseMealVariant(raw: Record<string, unknown>): MealVariant {
  const rawShoppingBase = raw.shoppingBase as Record<string, unknown>[] | undefined;
  if (rawShoppingBase) {
    return {
      id: raw.id as string,
      name: raw.name as string,
      shoppingBase: rawShoppingBase.map(parseShoppingBaseItem),
    };
  }
  return {
    id: raw.id as string,
    name: raw.name as string,
    recipeId: raw.recipeId as string,
  };
}

function parseMealLibraryEntry(id: string, raw: Record<string, unknown>): MealLibraryEntry {
  const rawShoppingBase = raw.shoppingBase as Record<string, unknown>[] | undefined;
  const rawVariants = raw.variants as Record<string, unknown>[] | undefined;
  return {
    id,
    name: raw.name as string,
    ...(rawShoppingBase ? { shoppingBase: rawShoppingBase.map(parseShoppingBaseItem) } : {}),
    ...(rawVariants ? { variants: rawVariants.map(parseMealVariant) } : {}),
    ...(raw.lettvint !== undefined ? { lettvint: raw.lettvint as boolean } : {}),
    ...(raw.variationTags !== undefined ? { variationTags: raw.variationTags as string[] } : {}),
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

/** Oppretter et nytt biblioteksmåltid. Speiler `leggTil` (linje ~3099–3104) — ALDRI en `shoppingBase`-nøkkel ved oppretting. */
export async function createMealLibraryEntry(
  familyId: FamilyId,
  name: string,
): Promise<MealLibraryEntry> {
  const id = crypto.randomUUID();
  await set(ref(getFirebaseDatabase(), mealLibraryEntryPath(familyId, id)), { name });
  return { id, name };
}

/** Fjerner ett biblioteksmåltid. Speiler `slett` (linje ~3105–3108). */
export async function removeMealLibraryEntry(familyId: FamilyId, id: string): Promise<void> {
  await remove(ref(getFirebaseDatabase(), mealLibraryEntryPath(familyId, id)));
}

/**
 * Muterer ett biblioteksmåltid atomisk. `updater` mottar den FAKTISKE,
 * ferskeste server-verdien (aldri en potensielt utdatert lokal kopi) og
 * returnerer:
 *  - en ny `MealLibraryEntry` — skrives som den er (uten `id`-feltet, som
 *    aldri lagres — det er stien, ikke et lagret felt, akkurat som
 *    dagens `flat[id] = resten`),
 *  - `null` — fjerner måltidets node,
 *  - `undefined` — AVBRYTER transaksjonen uten å skrive noe.
 *
 * Selve mutasjonslogikken (legg til/oppdater/fjern en `shoppingBase`-rad)
 * er kallerens ansvar — se `src/domain/mealLibrary/mealLibrary.ts` for de
 * rene funksjonene som speiler `MealLibraryScreen` sine håndterere.
 *
 * **Funn under implementering, samme felle som `toggleShoppingItemDone`
 * (§shopping.repository.ts):** `current===null` her er IKKE pålitelig
 * "måltidet finnes ikke" — `runTransaction` kjører `updater` spekulativt
 * mot en muligens kald lokal cache FØR den bekrefter mot serveren, og
 * kaller den PÅ NYTT med riktig verdi hvis den første gjetningen var feil
 * — MEN kun dersom `updater` returnerte en KONKRET verdi (`null` eller en
 * `MealLibraryEntry`) forrige runde. En kaller som gjør
 * `if(!current) return undefined` for "måltidet ser tomt ut" avbryter
 * derfor PERMANENT, uten noen ny forsøk, selv om måltidet faktisk finnes
 * på serveren — reprodusert i praksis av denne funksjonens egen
 * integrasjonstest mot et måltid opprettet i SAMME test, uten et aktivt
 * `onValue`-abonnement fra før (kald cache). Riktig mønster: la `updater`
 * returnere `null` (ikke `undefined`) når `current` ser tomt ut men det er
 * usikkert om det er reelt — en harmløs, retriable verdi som blir
 * overstyrt av den ferske server-verdien dersom gjetningen var feil.
 */
export async function transactMealLibraryEntry(
  familyId: FamilyId,
  id: string,
  updater: (current: MealLibraryEntry | null) => MealLibraryEntry | null | undefined,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), mealLibraryEntryPath(familyId, id)),
    (current) => {
      const parsed = current ? parseMealLibraryEntry(id, current as Record<string, unknown>) : null;
      const next = updater(parsed);
      if (next === undefined) return undefined;
      if (next === null) return null;
      const payload: Record<string, unknown> = { name: next.name };
      if (next.shoppingBase !== undefined) payload.shoppingBase = next.shoppingBase;
      if (next.variants !== undefined) payload.variants = next.variants;
      if (next.lettvint !== undefined) payload.lettvint = next.lettvint;
      if (next.variationTags !== undefined) payload.variationTags = next.variationTags;
      return payload;
    },
  );
}
