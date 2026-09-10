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
 * en DISKRIMINERT union på `source`, håndhevet av TypeScript selv (ikke
 * kun av `domain/mealLibrary/mealLibrary.ts` sine `addVariant`/
 * `updateVariant`).
 *
 * `recipeId` er bevisst IKKE nullbar her, ulikt `MealValue.recipeId`
 * (§Nattvakt-review, PR #18): på planens `MealValue` betyr `recipeId:null`
 * "bibliotekskonsept valgt, konkret løsning ikke bestemt ennå" — men en
 * variant ER selve løsningen. Å tillate `recipeId:null` også her ville
 * innført en ny, unødvendig "uløst variant"-tilstand oppå den allerede
 * gyldige "konsept uten variant"-tilstanden.
 *
 * `source` er en eksplisitt, alltid-satt diskriminator — IKKE utledet fra
 * om `shoppingBase` finnes (§Nattvakt-review, PR #18, andre runde): RTDB
 * dropper tomme arrays ved skriving (samme kjente oppførsel som flat
 * `MealLibraryEntry.shoppingBase`), så en NY handlegrunnlag-kildet variant
 * (`shoppingBase: []`, ingen varer lagt til ennå) ville ellers rundtrippet
 * som en (ugyldig) oppskrift-variant med `recipeId: undefined`.
 */
export type MealVariant =
  | {
      id: string;
      /** Kun til visning/valg, f.eks. "Hjemmelaget", "Kjøpepizza". */
      name: string;
      source: "recipe";
      recipeId: string;
    }
  | {
      id: string;
      name: string;
      source: "shoppingBase";
      shoppingBase: ShoppingBaseItem[];
    };

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

/**
 * Utfallet av å forsøke å resolve ÉN oppskrift-referanse sitt handlegrunnlag
 * (§generators/shopping/shopping.ts sin `resolveMealShoppingStatuses`) —
 * en ren, diskriminert status ved siden av det eksisterende, uendrede
 * `ResolvedShoppingIngredient[]`-outputet, slik at en senere UI kan skille
 * "uløst variantvalg" fra "resolvert, men faktisk tomt handlegrunnlag"
 * uten å måtte tolke fraværet av varer (§Kontrolltårn-handoff, Issue #2,
 * variantmodell skive 2, kommentar 5609739877). Ingen UI bygges rundt
 * denne i denne skiven — kun statusen selv, som et rent datapunkt.
 *
 * - `resolved`: deterministisk resolvert — dekker konkret `recipeId`,
 *   legacy fritekst-navnematch, et bibliotekskonsept UTEN `variants`
 *   (flat `shoppingBase`, uendret), og et bibliotekskonsept med NØYAKTIG
 *   ÉN variant (auto-resolvert uten brukerbeslutning). En manglende/slettet
 *   oppskrift-referanse degraderes til 0 varer her, IKKE en egen status —
 *   samme etablerte presedens som konkret `recipeId` uten treff.
 * - `unresolved`: bibliotekskonseptet har 2+ varianter og ingen er valgt
 *   ennå (`MealValue.variantId` finnes ikke i denne skiven) — ekte
 *   tvetydighet, ikke en feil.
 * - `not-found`: referansen peker på et bibliotekskonsept-navn som ikke
 *   finnes i Middagsbiblioteket i det hele tatt (f.eks. omdøpt/slettet).
 */
export type MealShoppingResolutionStatus =
  | { status: "resolved" }
  | {
      status: "unresolved";
      libraryEntryId: string;
      libraryEntryName: string;
      variantCount: number;
    }
  | { status: "not-found"; name: string };

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
