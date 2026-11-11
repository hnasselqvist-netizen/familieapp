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
 * sin `NewMealVariant`) — grenen avgjøres av det eksplisitte `source`-
 * feltet, ALDRI av om `shoppingBase`-nøkkelen finnes (§Nattvakt-review,
 * PR #18, andre runde): RTDB dropper tomme arrays ved skriving, så en
 * fersk handlegrunnlag-kildet variant (`shoppingBase: []`, ingen varer
 * lagt til ennå) ville ellers blitt feilaktig lest som en oppskrift-
 * variant med `recipeId: undefined`. `shoppingBase` normaliseres til `[]`
 * når nøkkelen mangler av nøyaktig denne grunnen. `recipeId` er ALLTID
 * konkret her (ikke nullbar, §Nattvakt-review, første runde) — ingen
 * `null`-normalisering nødvendig, ulikt `ShoppingBaseItem.itemId`.
 */
function parseMealVariant(raw: Record<string, unknown>): MealVariant {
  const id = raw.id as string;
  const name = raw.name as string;
  if (raw.source === "shoppingBase") {
    const rawShoppingBase = (raw.shoppingBase as Record<string, unknown>[] | undefined) ?? [];
    return {
      id,
      name,
      source: "shoppingBase",
      shoppingBase: rawShoppingBase.map(parseShoppingBaseItem),
    };
  }
  return { id, name, source: "recipe", recipeId: raw.recipeId as string };
}

export function parseMealLibraryEntry(id: string, raw: Record<string, unknown>): MealLibraryEntry {
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
 * Det som skrives, flettes med den rå posten (`medBevartePostfelt`), så felt
 * appen ikke kjenner, bevares på posten, på uendrede varelinjer og på
 * varianter. Kan det ikke gjøres entydig, avbrytes transaksjonen og
 * `TvetydigIdentitet` kastes.
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
  // Siste kjøring av updateren avgjør. Typen er satt eksplisitt så TS ikke
  // snevrer den til `null` (verdien settes inne i tilbakekallet).
  let stopp = null as TvetydigIdentitet | null;
  await runTransaction(
    ref(getFirebaseDatabase(), mealLibraryEntryPath(familyId, id)),
    (current) => {
      stopp = null;
      const raa = current ? (current as Raa) : null;
      const parsed = raa ? parseMealLibraryEntry(id, raa) : null;
      const next = updater(parsed);
      if (next === undefined) return undefined;
      if (next === null) return null;
      try {
        return medBevartePostfelt(erObjekt(raa) ? raa : {}, next);
      } catch (feil) {
        if (!(feil instanceof TvetydigIdentitet)) throw feil;
        stopp = feil;
        return undefined;
      }
    },
  );
  if (stopp) throw stopp;
}

/**
 * Som `transactMealLibraryEntry`, men `beregn` kan stoppe endringen med et
 * utfall (#20 6754247077, review 5834974250). Ved stopp avbrytes
 * transaksjonen uten å skrive, og utfallet returneres. Finnes ikke posten på
 * serveren, returneres `mangler`. `null` betyr at endringen ble skrevet.
 *
 * Utfallet hører til siste kjøring av `beregn`: en første kjøring mot en
 * kald eller utdatert lokal kopi overstyres når transaksjonen kjøres på nytt
 * mot serverens verdi (en konkret verdi, også `null`, gir nytt forsøk).
 */
export async function transactMealLibraryEntryMedUtfall<U>(
  familyId: FamilyId,
  id: string,
  beregn: (
    current: MealLibraryEntry,
  ) => { type: "skriv"; entry: MealLibraryEntry } | { type: "stopp"; utfall: U },
  mangler: U,
): Promise<U | null> {
  let utfall = null as { u: U } | null;
  await transactMealLibraryEntry(familyId, id, (current) => {
    utfall = null;
    if (!current) {
      utfall = { u: mangler };
      return null;
    }
    const r = beregn(current);
    if (r.type === "stopp") {
      utfall = { u: r.utfall };
      return undefined;
    }
    return r.entry;
  });
  return utfall ? utfall.u : null;
}

type Raa = Record<string, unknown>;
/** Alle nøkler i hver gren av en union (`keyof` alene gir bare de felles). */
type AlleNokler<T> = T extends unknown ? keyof T : never;

/**
 * Feltene appen kjenner på hvert nivå. `Record<…, true>` gjør at et nytt felt
 * i typen gir kompileringsfeil her til det er lagt til. Postens `id` er
 * stien, ikke et lagret felt, og er derfor ikke med på postnivå.
 */
const KJENTE_POSTFELT: Readonly<Record<Exclude<keyof MealLibraryEntry, "id">, true>> = {
  name: true,
  shoppingBase: true,
  variants: true,
  lettvint: true,
  variationTags: true,
};
const KJENTE_RADFELT: Readonly<Record<keyof ShoppingBaseItem, true>> = {
  id: true,
  itemId: true,
  name: true,
  amount: true,
  unit: true,
  cat: true,
};
const KJENTE_VARIANTFELT: Readonly<Record<AlleNokler<MealVariant>, true>> = {
  id: true,
  name: true,
  source: true,
  recipeId: true,
  shoppingBase: true,
};

/**
 * Stopper en skriving fordi ukjente rå felt ellers ville gått tapt eller
 * havnet på feil element (#20 6749312086): en samling som faktisk endres, har
 * et element med ukjente felt uten entydig `id`. Transaksjonen avbrytes uten
 * å skrive noe.
 */
export class TvetydigIdentitet extends Error {
  readonly samling: string;
  constructor(samling: string) {
    super(
      `Endringen er stoppet: «${samling}» har et element med felt appen ikke kjenner, ` +
        "uten entydig id. Ingenting er lagret.",
    );
    this.name = "TvetydigIdentitet";
    this.samling = samling;
  }
}

function erObjekt(v: unknown): v is Raa {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function ukjente(raa: Raa, kjente: object): [string, unknown][] {
  return Object.entries(raa).filter(([k]) => !Object.hasOwn(kjente, k));
}

/** Kjente felt fra appens verdi; `undefined` betyr «finnes ikke» og sendes aldri til RTDB. */
function definerte(verdi: object): [string, unknown][] {
  return Object.entries(verdi).filter(([, v]) => v !== undefined);
}

function lik(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((x, i) => lik(x, b[i]))
    );
  }
  if (!erObjekt(a) || !erObjekt(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && lik(a[k], b[k]));
}

function radHarUkjente(raa: unknown): boolean {
  return erObjekt(raa) && ukjente(raa, KJENTE_RADFELT).length > 0;
}

function variantHarUkjente(raa: unknown): boolean {
  if (!erObjekt(raa)) return false;
  const rader = Array.isArray(raa.shoppingBase) ? raa.shoppingBase : [];
  return ukjente(raa, KJENTE_VARIANTFELT).length > 0 || rader.some(radHarUkjente);
}

/**
 * Flettet samling (varelinjer eller varianter) slik den skal skrives.
 *
 * - **Uendret samling** (lik det appen leste): den rå samlingen skrives
 *   tilbake ordrett. Ingen identitet trengs, så også duplikate eller
 *   manglende `id`-er bevares uendret.
 * - **Endret samling:** hvert element i appens verdi får ukjente felt fra det
 *   rå elementet med samme `id`. Et rått element som ikke finnes i appens
 *   verdi, er tilsiktet fjernet. Nye elementer får ingen rå felt.
 * - **Tvetydig identitet:** har et rått element ukjente felt, men `id`-en
 *   mangler, er duplisert i den rå samlingen, eller finnes flere ganger i
 *   appens verdi, kastes `TvetydigIdentitet`.
 */
function medBevarteElementer<T extends { id: string }>(
  samling: string,
  raaListe: unknown,
  nesteListe: T[] | undefined,
  lestListe: T[] | undefined,
  harUkjente: (raa: unknown) => boolean,
  flett: (raa: Raa | null, neste: T) => Raa,
): unknown[] | undefined {
  if (nesteListe === undefined) return undefined;
  const raa = Array.isArray(raaListe) ? raaListe : [];
  if (lestListe !== undefined && raa.length > 0 && lik(nesteListe, lestListe)) return raa;

  const antall = (ids: unknown[]) => {
    const m = new Map<unknown, number>();
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const raaIder = antall(raa.map((r) => (erObjekt(r) ? r.id : undefined)));
  const nesteIder = antall(nesteListe.map((n) => n.id));
  for (const r of raa) {
    if (!harUkjente(r)) continue;
    const id = (r as Raa).id;
    if (typeof id !== "string" || raaIder.get(id) !== 1 || (nesteIder.get(id) ?? 0) > 1) {
      throw new TvetydigIdentitet(samling);
    }
  }
  return nesteListe.map((n) => {
    const treff =
      raaIder.get(n.id) === 1 ? raa.find((r) => erObjekt(r) && r.id === n.id) : undefined;
    return flett(erObjekt(treff) ? treff : null, n);
  });
}

function flettRad(raa: Raa | null, neste: ShoppingBaseItem): Raa {
  return Object.fromEntries([...(raa ? ukjente(raa, KJENTE_RADFELT) : []), ...definerte(neste)]);
}

function flettVariant(raa: Raa | null, neste: MealVariant): Raa {
  const { shoppingBase: _sb, ...uten } = neste as MealVariant & { shoppingBase?: unknown };
  void _sb;
  const ut = Object.fromEntries([
    ...(raa ? ukjente(raa, KJENTE_VARIANTFELT) : []),
    ...definerte(uten),
  ]);
  if (neste.source === "shoppingBase") {
    const lest = raa?.source === "shoppingBase" ? parseMealVariant(raa) : null;
    ut.shoppingBase = medBevarteElementer(
      "variantens handlegrunnlag",
      raa?.source === "shoppingBase" ? raa.shoppingBase : undefined,
      neste.shoppingBase,
      lest?.source === "shoppingBase" ? lest.shoppingBase : undefined,
      radHarUkjente,
      flettRad,
    );
  }
  return ut;
}

/**
 * Posten slik `transactMealLibraryEntry` skriver den (#20 6749312086). Uten
 * dette bygget transaksjonen posten fra en fast feltliste, og parserne for
 * varelinjer og varianter slapp ukjente felt. Et felt skrevet utenfor appen
 * (f.eks. via MCP `data_skriv`) forsvant derfor ved neste ordinære endring,
 * som «Lettvint» (§docs/drift/bibliotek-notat.md, #137).
 *
 * - **Ukjente rå felt på posten** bevares uendret.
 * - **Kjente felt** skrives fra appens verdi, så tilsiktet tømming og
 *   erstatning virker som før: `[]` lagres ikke av RTDB, og et kjent felt
 *   appens verdi utelater, forsvinner.
 * - **Varelinjer og varianter** flettes per stabil `id`, se
 *   `medBevarteElementer`. Det samme gjelder varelinjene inne i en variant.
 * - Kaster `TvetydigIdentitet` når felt ellers kan gå tapt eller havne på
 *   feil element.
 */
export function medBevartePostfelt(raa: Raa, neste: MealLibraryEntry): Raa {
  const lest = Object.keys(raa).length > 0 ? parseMealLibraryEntry(neste.id, raa) : null;
  const { id: _id, shoppingBase, variants, ...kjente } = neste;
  void _id;
  const ut = Object.fromEntries([...ukjente(raa, KJENTE_POSTFELT), ...definerte(kjente)]);
  const rader = medBevarteElementer(
    "handlegrunnlaget",
    raa.shoppingBase,
    shoppingBase,
    lest?.shoppingBase,
    radHarUkjente,
    flettRad,
  );
  if (rader !== undefined) ut.shoppingBase = rader;
  const varianter = medBevarteElementer(
    "variantene",
    raa.variants,
    variants,
    lest?.variants,
    variantHarUkjente,
    flettVariant,
  );
  if (varianter !== undefined) ut.variants = varianter;
  return ut;
}
