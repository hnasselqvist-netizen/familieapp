/**
 * Datamodellen er UENDRET fra dagens `families/familie1/mealLibrary`,
 * `itemHistory` og `staples` (§index.html linje ~2742–2853, ~3927–3974,
 * ~15818–15821, §designbok.md 3.3 Handlelistegenerator) — dette er
 * karakteriseringstyper, ikke et nytt skjema.
 */

/** Én rad i et biblioteksmåltids handlegrunnlag (`mealLibrary/{id}/shoppingBase`). */
export interface ShoppingBaseItem {
  id: string;
  itemId: string | null;
  name: string;
  amount: string;
  unit: string;
  cat: string;
}

/**
 * Én variant av hvordan et biblioteksmåltid løses (§Kontrolltårn-handoff,
 * Issue #2, variantmodell-designet). Nøstet på `MealLibraryEntry` — en
 * variant gir aldri mening løsrevet fra sitt konsept, samme mønster som
 * `shoppingBase`. Eksklusiv kilde: enten en KONKRET Kokebok-oppskrift
 * (`recipeId`) eller eget handlegrunnlag (`shoppingBase`), ALDRI begge —
 * håndheves av `domain/mealLibrary/mealLibrary.ts` sine
 * `addVariant`/`updateVariant`.
 *
 * `recipeId` er bevisst IKKE nullbar her, ulikt `MealValue.recipeId`
 * (§Nattvakt-review, PR #18): på planens `MealValue` betyr `recipeId:null`
 * "bibliotekskonsept valgt, konkret løsning ikke bestemt ennå" — men en
 * variant ER selve løsningen. Å tillate `recipeId:null` også her ville
 * innført en ny, unødvendig "uløst variant"-tilstand oppå den allerede
 * gyldige "konsept uten variant"-tilstanden.
 */
export interface MealVariant {
  id: string;
  /** Kun til visning/valg, f.eks. "Hjemmelaget", "Kjøpepizza". */
  name: string;
  /** Satt når varianten sourcer fra en konkret Kokebok-oppskrift. XOR med `shoppingBase`. */
  recipeId?: string;
  /** Satt når varianten har eget handlegrunnlag i stedet for en oppskrift. XOR med `recipeId`. */
  shoppingBase?: ShoppingBaseItem[];
}

/** Et biblioteksmåltid — `families/{familyId}/mealLibrary/{id}`. `shoppingBase` er valgfritt/kan mangle. */
export interface MealLibraryEntry {
  id: string;
  name: string;
  shoppingBase?: ShoppingBaseItem[];
  /**
   * Varianter for hvordan måltidet løses — valgfritt, additivt (§Kontrolltårn-
   * handoff, Issue #2). Et måltid UTEN `variants` behandles fullt ut som i
   * dag: den flate `shoppingBase` ER handlegrunnlaget, ingen implisitt
   * "variant 1" å konvertere til. Konvertering til varianter skjer KUN
   * eksplisitt, brukerinitiert (Fase 2/UI), aldri automatisk her.
   */
  variants?: MealVariant[];
  /** Speiler `Recipe.lettvint` — samme mønster, samme betydning, delt av Førsteutkast (§domain/meals/forsteutkast.ts). */
  lettvint?: boolean;
  /** Speiler `Recipe.variationTags` — samme mønster, samme betydning, delt av Førsteutkast. */
  variationTags?: string[];
}

/** Én rad i varehistorikken — `families/{familyId}/itemHistory` (array, ikke id-keyet samling). */
export interface ItemHistoryEntry {
  name: string;
  cat: string;
}

/** `families/{familyId}/staples` — `{varenavn (lowercase): true}`. */
export type Staples = Record<string, true>;

/** Ett enkelt ingrediens-funn fra `resolveMealShoppingItems`, før kategori-/basisvare-berikelse. */
export interface ResolvedShoppingIngredient {
  itemId?: string | null;
  name: string;
  amount?: string;
  unit?: string;
  cat?: string;
  fromRecipe: string;
}

/** Ett beriket, men ennå ikke sammenslått, kandidat-element (§buildShoppingItems). */
export interface EnrichedShoppingItem {
  itemId: string | null;
  name: string;
  amount: string;
  unit: string;
  cat: string;
  fromRecipe: string;
  isStaple: boolean;
}

/**
 * Ett sammenslått element etter dedup (§mergeShoppingItems). Uten `id`/`done`
 * — id-tildeling og `done`-initiering er en skjerm-/gjennomgangsflate-
 * bekymring (Fase 2), ikke generatorens jobb, samme prinsipp som
 * Fryserens id-generering flyttet ut til kalleren (§domain/freezer/freezer.ts).
 */
export interface MergedShoppingItem {
  key: string;
  itemId: string | null;
  name: string;
  amount: string;
  unit: string;
  cat: string;
  fromRecipes: string[];
  isStaple: boolean;
}

/** Formen et element faktisk lagres i på handlelisten (`shopping/{id}`) — id tildeles av kalleren. */
export interface ShoppingListEntry {
  itemId: string | null;
  name: string;
  amount: string;
  cat: string;
  done: boolean;
}

/** Ett handlelisteelement slik det faktisk leses tilbake — feltene over pluss id-en (som er stien, ikke et lagret felt). */
export type ShoppingItem = ShoppingListEntry & { id: string };
