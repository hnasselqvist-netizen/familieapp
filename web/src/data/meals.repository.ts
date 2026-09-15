/**
 * Datalag for middagsplanen (`families/{familyId}/meals/{weekKey}`).
 *
 * Skrivemønster: målrettede skrivinger til ÉN DAG sin egen node
 * (`meals/{weekKey}/{day}`) — aldri hele uken tilbake. Dagens `index.html`
 * (linje ~16441–16444, `setWeekMeals`) skriver HELE ukens dag-map ved
 * enhver endring — og bekreftet under pre-implementeringskartleggingen
 * (PR #3): det finnes TO uavhengige UI-inngangspunkter (`PlanScreen` og
 * `AddToPlanCard`) som begge kan treffe samme uke-node nesten samtidig —
 * en risiko verken Fryser eller Kokebok hadde (kun ett skjermbilde skrev
 * til hver av dem). Per-dag-noder + `runTransaction` løser dette
 * strukturelt: to samtidige skrivinger til ULIKE dager i samme uke
 * kolliderer ikke lenger i det hele tatt, og to samtidige skrivinger til
 * SAMME dag blir atomisk serialisert av Firebase selv (§Kontrolltårn-
 * handoff sin testmatrise, dekket i meals.repository.integration.test.ts).
 *
 * **Funn under implementering, samme klasse som Kokebok sin
 * tomme-liste-oppdagelse (PR #3):** Realtime Database lagrer aldri
 * `null` tilbake som `null` — feltet er fraværende ved lesing. Dagens
 * kode skriver bevisst `recipeId:null` svært ofte (enhver gang en dag
 * settes fra Middagsbiblioteket via `pickLibraryMeal`, eller når en
 * biblioteksmiddag inngår i en meny) — uten normalisering på lesing ville
 * `getMealRecipes()` fått `recipeId:undefined` i stedet for `recipeId:null`
 * for enhver bibliotek-middag lest tilbake fra Firebase, i strid med
 * `MealValue`-typen og med dagens faktiske in-memory-oppførsel (der
 * `recipeId:null` er en eksplisitt, meningsfull verdi — se
 * `resolveMealShoppingItems` sin prioritetsregel: konkret `recipeId` vs.
 * eksplisitt `recipeId:null` er to ULIKE, bevisst forskjellige tilfeller).
 * `parseMealValue` normaliserer derfor på LESING (både abonnement og
 * transaksjonens `current`), akkurat som `parseRecipeFields` gjør for
 * Kokebok.
 *
 * **Reelt funn, Helen-preview-test (§Kontrolltårn-review, PR #26, runde
 * 5):** `mealLibraryId` (§types/meal.ts, tilføyd runde 4 for å overleve
 * omdøping av bibliotekmiddager) ble skrevet korrekt av
 * `useMeals`/`useMealsWriter`, men `parseMealRecipeRef` og `parseMealValue`
 * sin `type:"recipe"`-gren hvitlistet den ALDRI ved lesing — feltet ble
 * dermed systematisk borte igjen i det øyeblikket Firebase sitt eget
 * `onValue`-abonnement leverte den ferske verdien tilbake, uavhengig av om
 * planvalget var splitter nytt eller gammelt. Samme klasse funn som
 * `lettvint`/`variationTags` i `mealLibrary.repository.ts` sin
 * toppkommentar — et nytt, valgfritt felt MÅ hvitlistes eksplisitt på
 * BEGGE sider (skriving og lesing), ellers forsvinner det stille på neste
 * synkronisering, uansett hvor riktig skrivesiden er.
 */
import { get, onValue, ref, runTransaction, update } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { DayKey, MealRecipeRef, MealValue, WeekMeals } from "@app-types/meal";

function mealsRootPath(familyId: FamilyId): string {
  return `families/${familyId}/meals`;
}

function weekMealsPath(familyId: FamilyId, weekKey: string): string {
  return `families/${familyId}/meals/${weekKey}`;
}

function mealDayPath(familyId: FamilyId, weekKey: string, day: DayKey): string {
  return `${weekMealsPath(familyId, weekKey)}/${day}`;
}

function parseMealRecipeRef(raw: Record<string, unknown>): MealRecipeRef {
  return {
    name: raw.name as string,
    recipeId: (raw.recipeId as string | null | undefined) ?? null,
    ...(raw.variantId !== undefined ? { variantId: raw.variantId as string } : {}),
    ...(raw.mealLibraryId !== undefined ? { mealLibraryId: raw.mealLibraryId as string } : {}),
  };
}

/**
 * Normaliserer én dagverdi slik den faktisk kommer tilbake fra Firebase
 * — se filens toppkommentar. Eksportert for gjenbruk av
 * `mealFeedback.repository.ts` sin `actual`-felt (samme `MealValue`-form,
 * samme Firebase-normaliseringsbehov — ikke en ny, uavhengig parser).
 */
export function parseMealValue(raw: unknown): MealValue | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw;

  const obj = raw as Record<string, unknown>;
  if (obj.type === "menu") {
    const rawRecipes = (obj.recipes as Record<string, unknown>[] | undefined) ?? [];
    return {
      type: "menu",
      name: obj.name as string,
      recipes: rawRecipes.map(parseMealRecipeRef),
    };
  }
  if (obj.type === "recipe") {
    return {
      type: "recipe",
      name: obj.name as string,
      recipeId: (obj.recipeId as string | null | undefined) ?? null,
      ...(obj.variantId !== undefined ? { variantId: obj.variantId as string } : {}),
      ...(obj.mealLibraryId !== undefined ? { mealLibraryId: obj.mealLibraryId as string } : {}),
    };
  }
  if (obj.type === "event") {
    return {
      type: "event",
      name: obj.name as string,
      ...(obj.emoji !== undefined ? { emoji: obj.emoji as string } : {}),
    };
  }
  return null;
}

/** Abonnerer på én ukes middagsplan. Dager uten planlagt middag er fraværende nøkler. Returnerer en avmeldingsfunksjon. */
export function subscribeWeekMeals(
  familyId: FamilyId,
  weekKey: string,
  onChange: (meals: WeekMeals) => void,
): () => void {
  const weekRef = ref(getFirebaseDatabase(), weekMealsPath(familyId, weekKey));
  const unsubscribe = onValue(weekRef, (snapshot) => {
    if (!snapshot.exists()) {
      onChange({});
      return;
    }
    const value = snapshot.val() as Record<string, unknown>;
    const meals: WeekMeals = {};
    for (const [day, rawValue] of Object.entries(value)) {
      const parsed = parseMealValue(rawValue);
      if (parsed !== null) meals[day as DayKey] = parsed;
    }
    onChange(meals);
  });
  return unsubscribe;
}

/**
 * Muterer én dag atomisk. `updater` mottar den FAKTISKE, ferskeste
 * server-verdien for dagen (aldri en potensielt utdatert lokal/React-
 * kopi) og returnerer:
 *  - en ny `MealValue` — skrives som den er,
 *  - `""` (eller enhver annen falsy `MealValue`) — tolkes som "ingen
 *    middag" og fjerner dagens node (samme betydning som dagens
 *    `clearDay`, uttrykt som nodesletting i stedet for en lagret tom
 *    streng — se `removeRecipeFromMeal` i domenet for hvorfor dette
 *    skillet finnes),
 *  - `undefined` — AVBRYTER transaksjonen uten å skrive noe (speiler at
 *    dagens `addRecToMenu` ikke gjør noe skrivekall ved et duplikat-
 *    forsøk — se `addRecipeToMeal` i domenet).
 */
export async function transactMealDay(
  familyId: FamilyId,
  weekKey: string,
  day: DayKey,
  updater: (current: MealValue | null) => MealValue | null | undefined,
): Promise<void> {
  await runTransaction(
    ref(getFirebaseDatabase(), mealDayPath(familyId, weekKey, day)),
    (current) => {
      const next = updater(parseMealValue(current));
      if (next === undefined) return undefined;
      if (next === null || next === "") return null;
      return next;
    },
  );
}

/**
 * Kobler ÉN dagverdi til `libraryId` når den (eller en av dens
 * oppskrift-referanser, for en meny) er en LEGACY oppskrift-konsept-
 * referanse som fortsatt kun matcher på navn — selve reparasjonslogikken
 * bak `backfillMealLibraryIdAcrossWeeks` under (§Kontrolltårn-review,
 * PR #26, runde 5 — Helens reelle preview-test: en omdøping brøt
 * koblingen for akkurat denne klassen eksisterende data, selv etter at
 * runde 4s additive `mealLibraryId`-felt var på plass). Bevisst plassert
 * her i datalaget, ikke i `domain/meals/meals.ts` — modulgrensen
 * (§eslint.config.js) tillater ikke at datalaget importerer domenet, og
 * denne funksjonen er uansett tett koblet til akkurat denne bulk-
 * reparasjonsmekanikken, ikke en generell motorfunksjon.
 *
 * Rører KUN referanser som:
 * - har `recipeId:null` (en bibliotekskonsept-referanse, ikke en konkret
 *   Kokebok-oppskrift — en konkret `recipeId` er allerede stabilt koblet
 *   og skal aldri overstyres av et navnematch),
 * - IKKE allerede har `mealLibraryId` (allerede koblet — rør aldri en
 *   eksisterende kobling, selv om navnet skulle matche noe annet nå), og
 * - har `name` (case-insensitive) lik `oldNameLower` — kallerens ansvar
 *   å kun sende inn `oldNameLower` når den var ENTYDIG for konseptet som
 *   omdøpes (§useMealLibrary.ts sin uniqueness-sjekk før kall).
 *
 * En legacy RAA STRENG som matcher oppgraderes til et eksplisitt
 * `type:"recipe"`-objekt (samme mønster som `domain/meals/meals.ts` sin
 * `setVariantOnMeal` allerede gjør når `variantId` settes på en streng —
 * strengen har ingen plass å lagre et nytt felt på, så formen må
 * normaliseres idet feltet faktisk skal settes). `changed:false`
 * signaliserer "ingen skriving nødvendig" til kalleren, som da hopper
 * over denne dagen i den samlede multi-path-oppdateringen.
 */
export function upgradeLegacyRefToLibraryId(
  val: MealValue | null | undefined,
  oldNameLower: string,
  libraryId: string,
): { changed: boolean; value: MealValue | null | undefined } {
  if (!val) return { changed: false, value: val };
  if (typeof val === "string") {
    if (val.toLowerCase() !== oldNameLower) return { changed: false, value: val };
    return {
      changed: true,
      value: { type: "recipe", name: val, recipeId: null, mealLibraryId: libraryId },
    };
  }
  if (val.type === "recipe") {
    if (val.recipeId || val.mealLibraryId || val.name.toLowerCase() !== oldNameLower) {
      return { changed: false, value: val };
    }
    return { changed: true, value: { ...val, mealLibraryId: libraryId } };
  }
  if (val.type === "menu") {
    let anyChanged = false;
    const recipes = val.recipes.map((r) => {
      if (r.recipeId || r.mealLibraryId || r.name.toLowerCase() !== oldNameLower) return r;
      anyChanged = true;
      return { ...r, mealLibraryId: libraryId };
    });
    if (!anyChanged) return { changed: false, value: val };
    return { changed: true, value: { ...val, recipes } };
  }
  return { changed: false, value: val };
}

/**
 * Reparerer allerede planlagte dager på TVERS AV ALLE UKER som fortsatt
 * peker på en bibliotekmiddag kun via navn (`oldName`) — kalt ÉN GANG, av
 * `useMealLibrary.ts` sin `updateEntryFields`, idet en bibliotekmiddag
 * omdøpes og det gamle navnet var entydig for akkurat dette konseptet
 * (§Kontrolltårn-review, PR #26, runde 5, "Produktkrav": "planlagte
 * forekomster skal fortsatt være koblet til samme bibliotekmiddag etter
 * omdøping, også når planen ble laget før `mealLibraryId`-feltet fantes").
 *
 * Ikke-destruktiv: leser HELE `meals`-treet for familien én gang, beregner
 * hvilke dager som faktisk trenger en oppdatering via
 * `upgradeLegacyRefToLibraryId`, og skriver KUN de endrede dagene tilbake
 * i én samlet multi-path `update()` — dager uten treff er fullstendig
 * urørt. Et treff på en `type:"menu"`-dag oppdaterer kun den/de aktuelle
 * oppskrift-referansen(e) i menyen, resten av menyen er uendret.
 *
 * Antall uker en familie har brukt appen er lite (uker, ikke rader) —
 * én full lesing ved en sjelden, eksplisitt brukerhandling (omdøping) er
 * en helt annen kostnadsklasse enn en hot-path-operasjon, og krever derfor
 * ingen paginering/indeksering her.
 */
export async function backfillMealLibraryIdAcrossWeeks(
  familyId: FamilyId,
  oldName: string,
  libraryId: string,
): Promise<void> {
  const oldNameLower = oldName.toLowerCase();
  const rootRef = ref(getFirebaseDatabase(), mealsRootPath(familyId));
  const snapshot = await get(rootRef);
  if (!snapshot.exists()) return;

  const allWeeks = snapshot.val() as Record<string, Record<string, unknown>>;
  const updates: Record<string, MealValue> = {};
  for (const [weekKey, days] of Object.entries(allWeeks)) {
    for (const [day, rawValue] of Object.entries(days)) {
      const parsed = parseMealValue(rawValue);
      const { changed, value } = upgradeLegacyRefToLibraryId(parsed, oldNameLower, libraryId);
      if (changed && value) {
        updates[`${weekKey}/${day}`] = value;
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await update(rootRef, updates);
  }
}
