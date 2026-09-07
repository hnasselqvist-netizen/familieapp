/**
 * Datalag for handlelisten (`families/{familyId}/shopping`).
 *
 * Skrivemønster: målrettede skrivinger til ÉN VARE sin egen node
 * (`shopping/{id}`) — aldri hele listen tilbake. Dagens `index.html`
 * (`ShoppingScreen`, linje ~4902–4933, og `setShopping`, linje ~16468)
 * leser/skriver HELE listen ved enhver endring (opprett/fjern/kryss av/
 * rediger/tøm fullførte) — samme risikoklasse som Fryser/Kokebok/
 * Middagsplan hadde før de ble fikset.
 *
 * **To ulike "legg til"-flyter i dagens kode, bevisst IKKE slått sammen
 * her:**
 *  - `ShoppingScreen.add()` (linje ~4926–4933) — det raske skrivefeltet.
 *    ALDRI dedup-sjekk, oppretter alltid en ny post. Dette er
 *    `createShoppingItem` under.
 *  - `MatScreen.onAddToList()` — når generatoren (PR #5) legger til flere
 *    varer samtidig. DEDUP-sjekker mot eksisterende, ikke-fullførte poster
 *    (samme navn). Den rene logikken for dette (`mergeIntoShoppingList`,
 *    §generators/shopping/shopping.ts) er allerede portert i PR #5, men
 *    selve Firebase-skrivingen for DENNE flyten er bevisst IKKE bygget
 *    her — den krever en flerpost-batch-skriving (les gjeldende liste,
 *    regn ut hvilke poster som er nye vs. skal få oppdatert mengde,
 *    skriv kun de faktisk endrede/nye node-stiene), en reell
 *    designbeslutning om batch-strategi, ikke bare karakterisering.
 *    Overlatt til skjermmigreringen (Fase 2) eller en egen, senere skive.
 *
 * **Funn, samme klasse som Kokebok/Middagsplan/Handlelistegenerator sine
 * tilsvarende funn:** RTDB dropper `itemId:null` ved skriving. Dagens
 * `ShoppingScreen.add()` skriver alltid en ekte `itemId` (fra
 * `finnEllerOpprettVare`), men `ShoppingListEntry`-typen (og en fremtidig
 * `mergeIntoShoppingList`-skriving) tillater `itemId:null` — normalisert
 * på lesing under for å være korrekt uansett skrivevei.
 */
import { onValue, ref, remove, runTransaction, set, update } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";

function shoppingPath(familyId: FamilyId): string {
  return `families/${familyId}/shopping`;
}

function shoppingItemPath(familyId: FamilyId, id: string): string {
  return `${shoppingPath(familyId)}/${id}`;
}

function parseShoppingListEntry(raw: Record<string, unknown>): ShoppingListEntry {
  return {
    itemId: (raw.itemId as string | null | undefined) ?? null,
    name: raw.name as string,
    amount: (raw.amount as string | undefined) ?? "",
    cat: (raw.cat as string | undefined) ?? "Diverse",
    done: (raw.done as boolean | undefined) ?? false,
  };
}

/** Abonnerer på hele handlelisten. Returnerer en avmeldingsfunksjon. */
export function subscribeShoppingList(
  familyId: FamilyId,
  onChange: (items: ShoppingItem[]) => void,
): () => void {
  const listRef = ref(getFirebaseDatabase(), shoppingPath(familyId));
  const unsubscribe = onValue(listRef, (snapshot) => {
    if (!snapshot.exists()) {
      onChange([]);
      return;
    }
    const value = snapshot.val() as Record<string, Record<string, unknown>>;
    onChange(
      Object.entries(value).map(([id, fields]) => ({ id, ...parseShoppingListEntry(fields) })),
    );
  });
  return unsubscribe;
}

/**
 * Oppretter en ny handlelistepost på sin egen node. Speiler
 * `ShoppingScreen.add()` 1:1 — ALDRI en dedup-sjekk mot eksisterende
 * poster (det er kun `mergeIntoShoppingList`-flyten som gjør det, se
 * filens toppkommentar).
 */
export async function createShoppingItem(
  familyId: FamilyId,
  fields: ShoppingListEntry,
): Promise<ShoppingItem> {
  const id = crypto.randomUUID();
  await set(ref(getFirebaseDatabase(), shoppingItemPath(familyId, id)), fields);
  return { id, ...fields };
}

/**
 * Snur `done` på én post. Speiler `ShoppingScreen.toggle()` (linje ~4913).
 * Transaksjon fordi den nye verdien er beregnet FRA den gjeldende (`!done`)
 * — samme begrunnelse som Fryserens batch-justering.
 *
 * **Funn under implementering:** `current===null` her betyr IKKE
 * pålitelig "posten finnes ikke" — RTDB sin `runTransaction` kjører
 * updateren spekulativt mot en lokalt bufret (potensielt kald/tom) verdi
 * FØR den har bekreftet mot serveren, og kaller den PÅ NYTT med riktig
 * verdi hvis den første gjetningen var feil — MEN kun dersom updateren
 * returnerer en KONKRET verdi (som Firebase kan sammenligne mot
 * server-verdien). Returneres `undefined`, tolkes det som et bevisst
 * "avbryt hele transaksjonen NÅ" (samme signal som `addRecipeToMeal` sitt
 * ekte duplikat-tilfelle i Middagsplan-motoren) — den kjøres ALDRI på
 * nytt, selv om posten faktisk fantes på serveren. En tidlig versjon som
 * returnerte `undefined` her feilet derfor i praksis alltid mot en post
 * uten et aktivt `onValue`-abonnement fra før (kald cache) — oppdaget av
 * denne funksjonens egen integrasjonstest. Riktig mønster (som
 * Fryser/Middagsplan sine tilsvarende "kanskje finnes ikke"-tilfeller):
 * returner `null` — en gyldig, konkret verdi som deltar normalt i
 * sammenlign-og-skriv-protokollen, og som er en harmløs no-op dersom
 * posten faktisk er borte.
 */
export async function toggleShoppingItemDone(familyId: FamilyId, id: string): Promise<void> {
  await runTransaction(ref(getFirebaseDatabase(), shoppingItemPath(familyId, id)), (current) => {
    if (!current) return null;
    const parsed = parseShoppingListEntry(current as Record<string, unknown>);
    return { ...parsed, done: !parsed.done };
  });
}

/**
 * Oppdaterer ett felt (f.eks. `amount`/`cat`/`name`) på én post. Speiler
 * `ShoppingScreen.updateItem()` (linje ~4916) — en ubetinget overskriving
 * av ETT felt, ikke beregnet fra gjeldende verdi, så et målrettet
 * flerfelt-`update()` (ikke en transaksjon) er riktig verktøy: to
 * samtidige redigeringer av TO ULIKE felt på samme post skal begge
 * overleve, ikke bare den siste.
 */
export async function updateShoppingItemField(
  familyId: FamilyId,
  id: string,
  field: "name" | "amount" | "cat",
  value: string,
): Promise<void> {
  await update(ref(getFirebaseDatabase(), shoppingItemPath(familyId, id)), { [field]: value });
}

/** Fjerner én handlelistepost. Speiler `ShoppingScreen.remove()` (linje ~4914). */
export async function removeShoppingItem(familyId: FamilyId, id: string): Promise<void> {
  await remove(ref(getFirebaseDatabase(), shoppingItemPath(familyId, id)));
}

/**
 * Fjerner alle fullførte poster. Speiler `ShoppingScreen.clearDone()`
 * (linje ~4915) — bruker `items` (en allerede lest liste) kun til å velge
 * HVILKE id-er som er slette-KANDIDATER, aldri til å avgjøre om de faktisk
 * skal slettes.
 *
 * **Funn under Kontrolltårn-review:** en tidligere versjon skrev
 * kandidatenes stier direkte til `null` i ett flerpost-`update()`-kall
 * basert på DEN LESTE listens `done`-flagg. Det er en stale-read-race: en
 * bruker som rekker å krysse en av disse postene TILBAKE til
 * `done:false` mellom lesingen og skrivingen, ville likevel fått den
 * slettet — funksjonen sjekket aldri serverens FAKTISKE verdi på
 * slettetidspunktet, kun det øyeblikksbildet den fikk oppgitt. Rettet
 * ved å slette hver kandidat gjennom sin egen transaksjon, som verifiserer
 * `done===true` på den FERSKESTE server-verdien før noden settes til
 * `null` — er den ikke lenger `done` (eller allerede borte), avbrytes
 * transaksjonen (`undefined`) og posten overlever, urørt.
 */
export async function clearDoneShoppingItems(
  familyId: FamilyId,
  items: ShoppingItem[],
): Promise<void> {
  const doneIds = items.filter((i) => i.done).map((i) => i.id);
  await Promise.all(
    doneIds.map((id) =>
      runTransaction(ref(getFirebaseDatabase(), shoppingItemPath(familyId, id)), (current) => {
        if (!current) return null;
        const parsed = parseShoppingListEntry(current as Record<string, unknown>);
        return parsed.done ? null : undefined;
      }),
    ),
  );
}
