/**
 * Kokebok-motoren — rene funksjoner, ingen React, ingen Firebase.
 *
 * Portert 1:1 fra oppførselen til dagens index.html:
 *  - `getIngredients` — linje ~3892–3897 (`getIngredients`)
 *  - `scaleIngredientAmount` — linje ~4702–4708 (`RecipeIngredients.scaleAmt`)
 *  - `markRecipeCooked` — linje ~3828–3831 (`BekreftMiddag.onConfirm`)
 *
 * Bevisst UTENFOR denne skiven: `normalise()` (linje ~4779–4790) og
 * skjemaets rad-parsing (`rowsToIngs`/`ingToRow`, RecipeForm/AddRecipeModal)
 * er UI-lim tett koblet til lagre-knappen i dagens skjema, ikke motor-logikk
 * i designbok.md sin forstand — de bygges naturlig om når selve skjermen
 * flyttes i Fase 2, og porteres ikke her for å unngå falsk presisjon på
 * kode som uansett skrives om.
 */
import type { Ingredient, Recipe, RecipeFields } from "@app-types/recipe";

/**
 * Flater alltid ut `ingredientGroups` når den finnes og ikke er tom;
 * ellers de flate `ingredients`. Låst beslutning (§designbok.md 3.1):
 * dette er den ENESTE inngangen andre moduler (handlelistegenerator,
 * fryservisning) skal bruke for å lese en oppskrifts ingredienser.
 */
export function getIngredients(recipe: Recipe | RecipeFields | null | undefined): Ingredient[] {
  if (!recipe) return [];
  if (recipe.ingredientGroups && recipe.ingredientGroups.length > 0) {
    return recipe.ingredientGroups.flatMap((g) => g.ingredients || []);
  }
  return recipe.ingredients || [];
}

/**
 * Ren visningslogikk (§designbok.md 3.1, "Skalering er ren
 * visningslogikk — lagret data endres ikke"): skalerer KUN det ledende
 * tallet i en mengdestreng ("500 g" → "1000 g" ved dobling), og lar
 * resten av strengen (enhetssuffikset) stå urørt. En mengde uten
 * lesbart ledende tall (f.eks. "etter behov") returneres uendret —
 * akkurat som dagens `scaleAmt`.
 */
export function scaleIngredientAmount(
  amount: string,
  baseServings: number,
  targetServings: number,
): string {
  if (!amount || baseServings === 0) return amount || "";
  const num = parseFloat(amount);
  if (isNaN(num)) return amount;
  const scaled = Math.round(num * (targetServings / baseServings) * 100) / 100;
  return amount.replace(/^[\d.,]+/, String(scaled));
}

/**
 * Ett-post-variant av "bekreft middag lagd": oppdaterer statistikken på
 * ÉN oppskrift-node ("sist laget" + "antall ganger"). Designet for å
 * kalles inne i `transactRecipe` (§data/recipes.repository.ts), der
 * Firebase garanterer at `current` er den ferskeste server-verdien —
 * samme mønster og samme begrunnelse som Fryserens
 * `applyBatchAdjustmentToItemFields` (§Kontrolltårn-review, Fase 0
 * runde 2): en bekreftelse og en samtidig redigering av samme oppskrift
 * skal ikke kunne overskrive hverandre.
 */
export function markRecipeCooked(current: RecipeFields, now: number): RecipeFields {
  return { ...current, lastCooked: now, timesCooked: (current.timesCooked || 0) + 1 };
}
