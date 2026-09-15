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
import type { MealLibraryEntry } from "@app-types/shopping";

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
  if (val.type === "recipe") {
    return [
      {
        name: val.name,
        recipeId: val.recipeId,
        ...(val.variantId ? { variantId: val.variantId } : {}),
        ...(val.mealLibraryId ? { mealLibraryId: val.mealLibraryId } : {}),
      },
    ];
  }
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
    return {
      type: "recipe",
      name: only.name,
      recipeId: only.recipeId,
      ...(only.variantId ? { variantId: only.variantId } : {}),
      ...(only.mealLibraryId ? { mealLibraryId: only.mealLibraryId } : {}),
    };
  }
  return { type: "menu", name: recs.map((r) => r.name).join(" · "), recipes: recs };
}

/**
 * Setter `variantId` (§types/meal.ts sin `MealRecipeRef`/`MealRecipeValue`,
 * Middagsplan v1) på oppskrift-referansen ved `recipeIndex` — 0 for en
 * enkeltoppskrift, en indeks inn i `recipes[]` for en meny. Returnerer
 * `undefined` (avbryter transaksjonen, samme signal som `addRecipeToMeal`
 * ved duplikat) for enhver kombinasjon som ikke gir mening: tom dag,
 * hendelse, eller en indeks utenfor menyens faktiske lengde.
 *
 * En legacy raa streng oppgraderes til et eksplisitt `type:"recipe"`-
 * objekt idet et variantvalg faktisk gjøres — dette er det ENE stedet en
 * streng-verdi konverteres til objektform utenfor selve UI-flyten
 * (`setDayToText`), fordi `variantId` ikke har noe sted å bo på en rå
 * streng. Navnet er uendret; kun formen normaliseres.
 */
export function setVariantOnMeal(
  current: MealValue | null | undefined,
  recipeIndex: number,
  variantId: string,
): MealValue | undefined {
  if (!current) return undefined;
  if (typeof current === "string") {
    if (recipeIndex !== 0) return undefined;
    return { type: "recipe", name: current, recipeId: null, variantId };
  }
  if (current.type === "recipe") {
    if (recipeIndex !== 0) return undefined;
    return { ...current, variantId };
  }
  if (current.type === "menu") {
    if (recipeIndex < 0 || recipeIndex >= current.recipes.length) return undefined;
    return {
      ...current,
      recipes: current.recipes.map((r, i) => (i === recipeIndex ? { ...r, variantId } : r)),
    };
  }
  return undefined;
}

/** Resultatet av å resolvere hvilken variant (om noen) som er aktiv for én oppskrift-referanse. Se `resolveActiveVariant`. */
export type ActiveVariantResolution =
  | { kind: "none" }
  | { kind: "unresolved" }
  | { kind: "resolved"; name: string; recipeId: string | null };

/**
 * Resolverer hvilken variant (om noen) som er konkret aktiv for ÉN
 * oppskrift-referanse (`MealRecipeRef`) — brukt av `PlanScreen.tsx` sin
 * dagrad, både for bok-ikon-snarveien og for variantnavnet som
 * sekundærtekst (§Helen-test med reelle data, PR #26, §4, og
 * tilleggskommentaren om variantnavn på dagraden).
 *
 * **Speiler samme prioritetsrekkefølge som handlelistegeneratorens
 * `resolveLibraryConcept`** (§generators/shopping/shopping.ts), men
 * returnerer en visningsklar diskriminert union i stedet for
 * ingredienser/handleliste-status — de to funksjonene løser beslektede,
 * men ulike behov, og deler derfor ikke kode direkte (`domain/` kan
 * uansett ikke importere fra `generators/`, §eslint.config.js sin
 * `import/no-restricted-paths`):
 *
 * - `{kind:"none"}`: konseptet finnes ikke i biblioteket, eller har ingen
 *   `variants` — "middag uten varianter beholder dagens enkle visning".
 * - NØYAKTIG 1 variant → auto-resolveres til `{kind:"resolved",...}` uten
 *   eksplisitt `variantId`, samme "systemet gjør førsteutkastet"-prinsipp
 *   som `resolveLibraryConcept`.
 * - 2+ varianter og INGEN (eller et slettet) `variantId` →
 *   `{kind:"unresolved"}` — "konkretisering gjenstår", ALDRI et stille
 *   fall tilbake til en annen variant.
 * - 2+ varianter og et gyldig eksplisitt `variantId` →
 *   `{kind:"resolved",...}` med akkurat DEN varianten.
 *
 * `recipeId` i et `resolved`-resultat er kun satt for en
 * `source:"recipe"`-variant — en `source:"shoppingBase"`-variant har
 * ingen oppskrift å åpne direkte.
 *
 * **ID først, navn som legacy-fallback** (§Kontrolltårn-review, PR #26,
 * runde 4): når `ref.mealLibraryId` er satt, slår oppslaget opp på den
 * stabile `MealLibraryEntry.id` i stedet for `ref.name` — en omdøping av
 * selve bibliotekmiddagen endrer da IKKE hvilket konsept referansen
 * resolverer til. En referanse UTEN `mealLibraryId` (all eksisterende
 * plandata før denne skiven) fortsetter å matche på navn, uendret.
 */
export function resolveActiveVariant(
  ref: MealRecipeRef,
  mealLibrary: MealLibraryEntry[],
): ActiveVariantResolution {
  const libMeal = ref.mealLibraryId
    ? mealLibrary.find((m) => m.id === ref.mealLibraryId)
    : mealLibrary.find((m) => m.name.toLowerCase() === ref.name.toLowerCase());
  const variants = libMeal?.variants;
  if (!variants || variants.length === 0) return { kind: "none" };

  const variant = ref.variantId
    ? variants.find((v) => v.id === ref.variantId)
    : variants.length === 1
      ? variants[0]
      : undefined;

  if (!variant) return { kind: "unresolved" };
  return {
    kind: "resolved",
    name: variant.name,
    recipeId: variant.source === "recipe" ? variant.recipeId : null,
  };
}

/**
 * Finner recipeId-en dagraden faktisk skal åpne direkte til Kokebok med,
 * for ÉN oppskrift-referanse — tynn bekvemmelighetsfunksjon over
 * `resolveActiveVariant` for kallesteder som kun trenger recipeId-en, ikke
 * hele resolusjonen (§Helen-test med reelle data, PR #26, §4). Et direkte
 * satt `ref.recipeId` (konkret Kokebok-oppskrift uten variant-omvei) går
 * foran ethvert biblioteksoppslag, uendret fra dagens oppførsel.
 */
export function resolveActiveRecipeId(
  ref: MealRecipeRef,
  mealLibrary: MealLibraryEntry[],
): string | null {
  if (ref.recipeId) return ref.recipeId;
  const resolved = resolveActiveVariant(ref, mealLibrary);
  return resolved.kind === "resolved" ? resolved.recipeId : null;
}

/**
 * Visningsnavnet for ÉN oppskrift-referanse — følger bibliotekets
 * GJELDENDE navn via `ref.mealLibraryId` når referansen har en, i stedet
 * for det navnet som opprinnelig ble lagret på referansen (§Kontrolltårn-
 * review, PR #26, runde 4: "vurder hvordan allerede planlagte rader med
 * ID skal vise det oppdaterte biblioteknavnet; source of truth bør være
 * bibliotekkonseptet når koblingen er entydig"). En referanse uten
 * `mealLibraryId`, eller en `mealLibraryId` som ikke lenger finnes i
 * biblioteket (slettet konsept), faller tilbake til det lagrede navnet —
 * ALDRI en tom visning.
 */
export function resolveRefDisplayName(ref: MealRecipeRef, mealLibrary: MealLibraryEntry[]): string {
  if (!ref.mealLibraryId) return ref.name;
  const libMeal = mealLibrary.find((m) => m.id === ref.mealLibraryId);
  return libMeal ? libMeal.name : ref.name;
}

/**
 * Visningsklart middagsnavn for en HEL dagverdi — speiler `getMealName`
 * sin formhåndtering (streng/meny/oppskrift/hendelse), men løser hver
 * oppskrift-referanse via `resolveRefDisplayName` i stedet for å lese det
 * lagrede navnet direkte, slik at en omdøping av bibliotekmiddagen vises
 * på allerede planlagte dager uten at brukeren må gjøre et nytt valg.
 * Brukt av `PlanScreen`s dagrad og `ActiveMealCard`s sammendrag.
 *
 * `getMealName` selv er UENDRET og fortsatt riktig å bruke der koden
 * trenger det faktisk LAGREDE navnet — navnebasert biblioteks-/historikk-
 * oppslag (§forsteutkast.ts, §mealFeedback.ts) skal fortsatt sammenligne
 * mot det lagrede navnet, ikke et bibliotek-navn som kan ha endret seg.
 */
export function resolveMealDisplayName(
  val: MealValue | null | undefined,
  mealLibrary: MealLibraryEntry[],
): string {
  if (!val || typeof val === "string") return getMealName(val);
  if (val.type === "menu") {
    return val.recipes.map((r) => resolveRefDisplayName(r, mealLibrary)).join(" · ");
  }
  if (val.type === "recipe") return resolveRefDisplayName(val, mealLibrary);
  return getMealName(val);
}
