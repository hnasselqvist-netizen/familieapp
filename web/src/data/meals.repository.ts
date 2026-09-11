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
 */
import { onValue, ref, runTransaction } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import type { FamilyId } from "@app-types/family";
import type { DayKey, MealRecipeRef, MealValue, WeekMeals } from "@app-types/meal";

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
