/**
 * Middagsplan-motoren — rene funksjoner, ingen React, ingen Firebase.
 *
 * Portert 1:1 fra oppførselen til dagens index.html:
 *  - `getMealName`/`getMealType`/`getMealRecipes`/`isEvent`/`isMenu` —
 *    linje ~380–400.
 *  - `addRecipeToMeal`/`removeRecipeFromMeal` — ett-dag-varianter av
 *    dagens `addRecToMenu`/`removeRecFromMenu` (linje ~3327–3343), som
 *    opererer på hele uke-objektet. Samme grunnregel og samme
 *    kanttilfeller, bevisst uendret (§Kontrolltårn-handoff: "menu"/flere
 *    retter er en gyldig modell og skal karakteriseres FULLT ut — ikke
 *    fikses eller innsnevres i denne skiven).
 *
 * Bevisst UTENFOR denne skiven (skjerm-/generator-lim, Fase 2 eller
 * senere Handlelistegenerator-skive): `beregnAktivPlanperiode`,
 * `genererForsteutkast`, `sorterBibliotekEtterHistorikk`, bytteflyten
 * (`settDraftValg` m.fl.), og selve "Bekreft middag"-handlingen. Per
 * §Kontrolltårn-handoff er dagens eksplisitte bekreft-handling IKKE låst
 * produktfasit (ny retning: normaltilfellet skal helst ikke kreve
 * handling) — denne motoren tar derfor ingen avhengighet til
 * bekreft-flyten og legger ingen bekreft-spesifikk antakelse inn i
 * `MealValue`-formen.
 */
import type { MealRecipeRef, MealValue } from "@app-types/meal";

/**
 * `val.planned`-fallback (siste ledd) er dødt i praksis i dagens data —
 * ingen skrivende kode setter feltet ennå (§designbok.md 3.2, "Plan vs
 * faktisk middag": datamodellen er klar, UI ikke bygget) — men er
 * bevisst portert som et virkelig, om enn ubrukt, fallback-ledd i
 * dagens kode, ikke fjernet. `planned` er derfor ikke en del av
 * `MealValue`-unionen (ingen skrivende kode produserer den ennå), kun
 * lest defensivt her, akkurat som i dag.
 */
export function getMealName(val: MealValue | null | undefined): string {
  if (!val) return "";
  if (typeof val === "string") return val;
  if (val.type === "menu") return val.recipes.map((r) => r.name).join(" · ");
  return val.name || (val as { planned?: string }).planned || "";
}

export function getMealType(val: MealValue | null | undefined): string | null {
  if (!val) return null;
  if (typeof val === "string") return "recipe";
  return val.type || "recipe";
}

export function isEvent(val: MealValue | null | undefined): boolean {
  return getMealType(val) === "event";
}

export function isMenu(val: MealValue | null | undefined): boolean {
  return getMealType(val) === "menu";
}

/** Eneste inngangen til handlelistegeneratoren (§designbok.md 3.2, låst beslutning) — les aldri dagverdien direkte. */
export function getMealRecipes(val: MealValue | null | undefined): MealRecipeRef[] {
  if (!val) return [];
  if (typeof val === "string") return [{ name: val, recipeId: null }];
  if (val.type === "menu") return val.recipes;
  if (val.type === "recipe") return [{ name: val.name, recipeId: val.recipeId }];
  return [];
}

/**
 * Legger en oppskrift til dagens meny. Speiler `addRecToMenu` 1:1,
 * inkludert kanttilfellet at et kall mot en TOM dag produserer en
 * `type:"menu"` med kun ÉN oppskrift (aldri kollapset til
 * `type:"recipe"`) — dette skjer aldri i dagens UI (knappen som kaller
 * denne vises kun når dagen allerede har noe), men funksjonen selv har
 * ingen slik vakt, og skal ikke få en her heller (§Kontrolltårn-handoff:
 * full, uendret karakterisering).
 *
 * Returnerer `undefined` (ikke en uendret verdi) når oppskriften
 * allerede finnes på dagen — speiler at dagens `addRecToMenu` i dette
 * tilfellet ikke gjør noe skrivekall i det hele tatt. `undefined` er et
 * bevisst signal til kalleren (§data/meals.repository.ts sin
 * `transactMealDay`) om å AVBRYTE transaksjonen uten skriving, ikke om å
 * skrive tilbake samme verdi.
 */
export function addRecipeToMeal(
  current: MealValue | null | undefined,
  recipe: { name: string; id: string },
): MealValue | undefined {
  const existing = getMealRecipes(current);
  const alreadyPresent = existing.some((e) => e.recipeId === recipe.id || e.name === recipe.name);
  if (alreadyPresent) return undefined;

  const newRecipes: MealRecipeRef[] = [...existing, { name: recipe.name, recipeId: recipe.id }];
  const menuName = newRecipes.map((r) => r.name).join(" · ");
  return { type: "menu", name: menuName, recipes: newRecipes };
}

/**
 * Fjerner oppskriften ved `idx` fra dagens meny. Speiler
 * `removeRecFromMenu` 1:1: kollapser til `type:"recipe"` når kun én
 * oppskrift gjenstår, til `""` (tom streng — "ingen middag", samme
 * verdi som dagens `clearDay` skriver) når ingen gjenstår.
 *
 * `""` her betyr "fjern dagen", IKKE "skriv en tom streng til Firebase"
 * — det er `transactMealDay` (§data/meals.repository.ts) sitt ansvar å
 * oversette en falsy returverdi til en `null` (nodesletting), akkurat
 * som `applyBatchAdjustmentToItemFields` gjør for Fryseren. Denne
 * funksjonen bevarer kun dagens EKSAKTE verdi-kontrakt.
 */
export function removeRecipeFromMeal(
  current: MealValue | null | undefined,
  idx: number,
): MealValue {
  const recs = getMealRecipes(current).filter((_, i) => i !== idx);
  if (recs.length === 0) return "";
  if (recs.length === 1) {
    const only = recs[0];
    if (!only) return "";
    return { type: "recipe", name: only.name, recipeId: only.recipeId };
  }
  return { type: "menu", name: recs.map((r) => r.name).join(" · "), recipes: recs };
}
