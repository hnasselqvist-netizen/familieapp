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

/**
 * Utfallet av en redigering i Kokeboken (#20 6781074174). `endret` og
 * `mangler` er serververifisert, og ingenting er skrevet. `avvist` er
 * `permission_denied`, og ingenting er skrevet. `ukjent` betyr at vi ikke vet
 * om skrivingen nådde serveren.
 */
export type RedigeringsUtfall = "lagret" | "endret" | "mangler" | "avvist" | "ukjent";

function stabilJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, (x as Record<string, unknown>)[k]]),
        )
      : x,
  );
}

function utvalg(felt: RecipeFields, nokler: readonly string[]): string {
  const kilde = felt as unknown as Record<string, unknown>;
  return stabilJson(Object.fromEntries(nokler.map((k) => [k, kilde[k]])));
}

/**
 * Feltene Kokebokens redigeringsskjema viser (`RecipeFormModal`). Alle er
 * grunnlag for en redigering, også de skjemaet ikke skriver fordi de er
 * uendret, som porsjoner (#20 6784919488).
 */
export const SKJEMAFELT = [
  "name",
  "time",
  "servings",
  "cat",
  "tags",
  "imageUrl",
  "url",
  "lettvint",
  "variationTags",
  "instructions",
  "ingredients",
  "ingredientGroups",
] as const satisfies readonly (keyof RecipeFields)[];

/**
 * Redigering med observert grunnlag (#20 6781074174). Skal kjøres inne i
 * `transactRecipeMedUtfall`, der `current` er den ferskeste server-verdien.
 *
 * Grunnlaget er `grunnlag` (standard: nøklene i `patch`), slik skjemaet viste
 * dem da det ble åpnet (`observert`). Har ett av dem endret seg siden,
 * stoppes hele lagringen med `endret`, og ingenting skrives. Det er ingen
 * feltvis sammenslåing. Bare `patch` skrives. Andre felt tas fra den ferske
 * verdien: felt utenfor grunnlaget, som `lastCooked`/`timesCooked` fra
 * «Bekreft middag», og felt i grunnlaget skjemaet ikke skriver, som uendrede
 * porsjoner. De siste er bekreftet uendret siden åpning (#20 6784919488).
 *
 * Begge sider er lest gjennom samme normalisering (`parseRecipeFields`), så
 * fravær av felt sammenlignes likt.
 */
export function redigerHvisUendret(
  current: RecipeFields,
  observert: RecipeFields,
  patch: Partial<RecipeFields>,
  grunnlag: readonly string[] = Object.keys(patch),
): { type: "skriv"; fields: RecipeFields } | { type: "stopp"; utfall: "endret" } {
  const nokler = [...new Set([...grunnlag, ...Object.keys(patch)])];
  if (utvalg(current, nokler) !== utvalg(observert, nokler)) {
    return { type: "stopp", utfall: "endret" };
  }
  return { type: "skriv", fields: { ...current, ...patch } };
}

/**
 * Vises når vi ikke vet om endringen ble lagret (review 5851280024). Et nytt
 * forsøk fra samme skjema overskriver ikke nyere data: ble den første
 * lagringen gjennomført, er grunnlaget endret, og forsøket stoppes.
 */
export const UKJENT_LAGRING =
  "Vi vet ikke om endringen ble lagret. Utkastet ditt står her. Lukk og åpne oppskriften " +
  "for å se hva som er lagret. Et nytt forsøk herfra stoppes hvis oppskriften er endret i mellomtiden.";

/** Brukertekst for en redigering som ikke er bekreftet lagret. Utkastet står i skjemaet. */
export function redigeringTekst(
  utfall: Exclude<RedigeringsUtfall, "lagret">,
  navn: string,
): string {
  switch (utfall) {
    case "endret":
      return (
        `«${navn}» er endret på en annen enhet siden du åpnet skjemaet. Ingenting er lagret. ` +
        "Utkastet ditt står her. Lukk og åpne oppskriften på nytt for å se endringene før du prøver igjen."
      );
    case "mangler":
      return (
        `«${navn}» er slettet på en annen enhet. Ingenting er lagret, og oppskriften er ikke ` +
        "gjenopprettet. Utkastet ditt står her til du lukker skjemaet."
      );
    case "avvist":
      return "Du har ikke tilgang til å lagre endringen. Ingenting er lagret. Utkastet ditt står her.";
    case "ukjent":
      return UKJENT_LAGRING;
  }
}
