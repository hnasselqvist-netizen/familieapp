/**
 * Middagsbibliotek-motoren — rene funksjoner, ingen React, ingen Firebase.
 *
 * Portert 1:1 fra `MealLibraryScreen` sine `shoppingBase`-rad-mutasjoner
 * (index.html linje ~3114–3146): `leggTilVareFraItemPicker`, `oppdaterVare`,
 * `endreVareNavnFritekst`, `byttVareIShoppingBase`, `slettVare`.
 *
 * ID-generering er kallerens ansvar, aldri motorens (§Fryser-presedens,
 * §domain/freezer/freezer.ts) — `addShoppingBaseItem` tar imot en allerede
 * generert id i stedet for å lage sin egen.
 */
import type { MealLibraryEntry, MealVariant, ShoppingBaseItem } from "@app-types/shopping";

/**
 * Speiler `leggTilVareFraItemPicker` (linje ~3114–3119): ny rad fra
 * ItemPicker/`finnEllerOpprettVare` starter alltid med tomt `amount`/`unit`
 * — disse er kontekstfelt spesifikke for DENNE middagen, ikke hentet fra
 * mastervaren.
 */
export function addShoppingBaseItem(
  entry: MealLibraryEntry,
  id: string,
  vare: { itemId: string; name: string; cat: string },
): MealLibraryEntry {
  const row: ShoppingBaseItem = {
    id,
    itemId: vare.itemId,
    name: vare.name,
    amount: "",
    unit: "",
    cat: vare.cat,
  };
  return { ...entry, shoppingBase: [...(entry.shoppingBase ?? []), row] };
}

/** Speiler `oppdaterVare` (linje ~3121–3125): ubetinget overskriving av ett felt på én rad. */
export function updateShoppingBaseItemField(
  entry: MealLibraryEntry,
  itemId: string,
  field: "amount" | "unit",
  value: string,
): MealLibraryEntry {
  return {
    ...entry,
    shoppingBase: (entry.shoppingBase ?? []).map((v) =>
      v.id !== itemId ? v : { ...v, [field]: value },
    ),
  };
}

/**
 * Speiler `endreVareNavnFritekst` (linje ~3130–3134): fritekst-navn
 * nullstiller `itemId`/`cat` UMIDDELBART, for å hindre at `itemId` blir
 * stående og peke på en annen vare enn det viste navnet.
 */
export function clearShoppingBaseItemToFreeText(
  entry: MealLibraryEntry,
  itemId: string,
  name: string,
): MealLibraryEntry {
  return {
    ...entry,
    shoppingBase: (entry.shoppingBase ?? []).map((v) =>
      v.id !== itemId ? v : { ...v, name, itemId: null, cat: "" },
    ),
  };
}

/**
 * Speiler `byttVareIShoppingBase` (linje ~3138–3142): `itemId`/`name`/`cat`
 * settes SAMLET fra samme mastervare, aldri som separate felt som kan
 * komme ut av synk med hverandre.
 */
export function replaceShoppingBaseItemFromPicker(
  entry: MealLibraryEntry,
  itemId: string,
  vare: { id: string; name: string; cat: string },
): MealLibraryEntry {
  return {
    ...entry,
    shoppingBase: (entry.shoppingBase ?? []).map((v) =>
      v.id !== itemId ? v : { ...v, itemId: vare.id, name: vare.name, cat: vare.cat },
    ),
  };
}

/** Speiler `slettVare` (linje ~3143–3146). */
export function removeShoppingBaseItem(entry: MealLibraryEntry, itemId: string): MealLibraryEntry {
  return { ...entry, shoppingBase: (entry.shoppingBase ?? []).filter((v) => v.id !== itemId) };
}

/**
 * Merger en delvis oppdatering inn i en eksisterende biblioteksmiddag —
 * brukt av `lettvint`/`variationTags`-merkingen (§Kontrolltårn-handoff,
 * Issue #2). Ingen legacy-motstykke (disse feltene fantes ikke i dagens
 * index.html); speiler likevel samme merge-prinsipp som
 * `useRecipes.updateRecipe` for konsistens på tvers av de to modulene
 * som deler disse feltene.
 *
 * **`name` lagt til** (§Helen-tillegg, PR #26: "middagsnavn skal kunne
 * redigeres"): en ren merge PÅ SAMME entry — `id`/`variants`/
 * `shoppingBase` er urørt av dette kallet, det er selve navnefeltet som
 * endres i det eksisterende objektet. Dette er bevisst IKKE et
 * slett+opprett — se `MealLibraryScreen.tsx` sin bruk for hvorfor det
 * matters (varianter/handlegrunnlag ville ellers mistet sin forelder).
 * Kjent, dokumentert konsekvens: dagens plan-/menyreferanser
 * (`MealValue.name`) matcher biblioteket på NAVN, ikke `id`
 * (§domain/meals/meals.ts sin `resolveActiveVariant`, §generators/
 * shopping/shopping.ts sin `resolveLibraryConcept`) — allerede planlagte
 * dager som bruker det GAMLE navnet slutter å resolvere mot dette
 * konseptet etter en omdøping. Denne funksjonen endrer ikke den
 * modellen; den flagges bevisst i PR-rapporten fremfor å løses stille
 * her.
 */
export function updateEntryFields(
  entry: MealLibraryEntry,
  patch: Partial<Pick<MealLibraryEntry, "name" | "lettvint" | "variationTags">>,
): MealLibraryEntry {
  return { ...entry, ...patch };
}

/**
 * Nytt variant-innhold — kallerens ansvar å generere id (§Fryser-presedens,
 * samme som `addShoppingBaseItem`). Kilden er eksklusiv I TYPEN SELV, en
 * diskriminert union på `source` (§designforslaget, Issue #2-kommentar
 * 5602458317, presisert av to runder Nattvakt-review på PR #18): enten en
 * KONKRET `recipeId` (`string`, ikke nullbar — en variant ER selve
 * løsningen, ulikt `MealValue.recipeId:null` som betyr "konsept valgt,
 * ikke bestemt ennå" på planleggingsnivå) eller eget `shoppingBase`,
 * aldri begge. `source` er ALLTID satt eksplisitt av kalleren — ikke
 * utledet fra om `shoppingBase` finnes, som ville vært ustabilt for en
 * fersk variant med `shoppingBase: []` (RTDB dropper tomme arrays, se
 * §types/shopping.ts sin toppkommentar på `MealVariant`).
 */
export type NewMealVariant =
  | { name: string; source: "recipe"; recipeId: string }
  | { name: string; source: "shoppingBase"; shoppingBase: ShoppingBaseItem[] };

/** Samme eksklusivitetskontrakt som `NewMealVariant`, men alt valgfritt for delvis oppdatering. */
export type MealVariantPatch =
  | { name?: string }
  | { name?: string; source: "recipe"; recipeId: string }
  | { name?: string; source: "shoppingBase"; shoppingBase: ShoppingBaseItem[] };

/** Legger til en ny variant bak eksisterende varianter, uten å røre `shoppingBase`-arrayet på måltidet selv. */
export function addVariant(
  entry: MealLibraryEntry,
  id: string,
  variant: NewMealVariant,
): MealLibraryEntry {
  const next: MealVariant = { id, ...variant };
  return { ...entry, variants: [...(entry.variants ?? []), next] };
}

/**
 * Oppdaterer én variant. Et `source`-felt i `patch` ERSTATTER hele kilden
 * (fjerner den andre) for å bevare eksklusivitetskontrakten — ren objekt-
 * spredning ville latt begge stå samtidig dersom varianten byttet kilde.
 * Et rent navne-patch (`{ name }`) endrer kun navnet og beholder
 * eksisterende kilde urørt.
 */
export function updateVariant(
  entry: MealLibraryEntry,
  variantId: string,
  patch: MealVariantPatch,
): MealLibraryEntry {
  return {
    ...entry,
    variants: (entry.variants ?? []).map((v) => {
      if (v.id !== variantId) return v;
      if (!("source" in patch)) return { ...v, name: patch.name ?? v.name };
      if (patch.source === "recipe") {
        return { id: v.id, name: patch.name ?? v.name, source: "recipe", recipeId: patch.recipeId };
      }
      return {
        id: v.id,
        name: patch.name ?? v.name,
        source: "shoppingBase",
        shoppingBase: patch.shoppingBase,
      };
    }),
  };
}

/**
 * Hvorfor en endring av varer i en variant ikke ble skrevet (#20 6754247077,
 * review 5834974250):
 * - `middagMangler` / `variantMangler`: målet finnes ikke lenger;
 * - `kildeByttet`: varianten bruker ikke lenger eget handlegrunnlag;
 * - `tvetydigVariant` / `tvetydigRad`: flere varianter eller rader har
 *   samme id, så endringen kunne truffet feil objekt;
 * - `radMangler`: raden som skulle fjernes, finnes ikke lenger (allerede
 *   fjernet — ikke en feil for brukeren).
 */
export type VariantvareUtfall =
  | "middagMangler"
  | "variantMangler"
  | "kildeByttet"
  | "tvetydigVariant"
  | "tvetydigRad"
  | "radMangler";

/** Resultatet av en varianttendring: posten som skal skrives, eller hvorfor ingenting skrives. */
export type VariantvareEndring =
  { type: "skriv"; entry: MealLibraryEntry } | { type: "stopp"; utfall: VariantvareUtfall };

/** Kastes av `useMealLibrary` når en endring av varer i en variant stoppes uten å skrive. */
export class VariantvareIkkeLagret extends Error {
  readonly utfall: VariantvareUtfall;
  constructor(utfall: VariantvareUtfall) {
    super(`Varen ble ikke lagret (${utfall}).`);
    this.name = "VariantvareIkkeLagret";
    this.utfall = utfall;
  }
}

/**
 * Legger én varelinje til i en handlegrunnlag-variant, beregnet fra den
 * FERSKE varianten i transaksjonen (#20 6754247077). Tidligere bygde skjermen
 * hele listen fra sin egen, mulig utdaterte variant og sendte den som
 * erstatning via `updateVariant`, så en samtidig endret linje kunne gå tapt.
 *
 * Mangler varianten, er kilden byttet, eller er variant-id-en ikke entydig,
 * gis `stopp`: ingenting skrives, og en utdatert handling gjenoppretter ikke
 * varianten eller kilden. Ny linje starter med tomt `amount`/`unit`, som
 * `addShoppingBaseItem`.
 */
export function addVariantShoppingBaseItem(
  entry: MealLibraryEntry,
  variantId: string,
  rowId: string,
  vare: { itemId: string; name: string; cat: string },
): VariantvareEndring {
  const row: ShoppingBaseItem = {
    id: rowId,
    itemId: vare.itemId,
    name: vare.name,
    amount: "",
    unit: "",
    cat: vare.cat,
  };
  return endreVariantensVarer(entry, variantId, (rader) => [...rader, row]);
}

/**
 * Fjerner én varelinje (per rad-id) fra en handlegrunnlag-variant, fra den
 * ferske varianten. Samme vern som `addVariantShoppingBaseItem`, og i tillegg
 * `stopp` når rad-id-en finnes flere ganger (`tvetydigRad`) eller ikke finnes
 * lenger (`radMangler`).
 */
export function removeVariantShoppingBaseItem(
  entry: MealLibraryEntry,
  variantId: string,
  rowId: string,
): VariantvareEndring {
  return endreVariantensVarer(entry, variantId, (rader) => {
    const treff = rader.filter((r) => r.id === rowId).length;
    if (treff === 0) return "radMangler";
    if (treff > 1) return "tvetydigRad";
    return rader.filter((r) => r.id !== rowId);
  });
}

function endreVariantensVarer(
  entry: MealLibraryEntry,
  variantId: string,
  endre: (rader: ShoppingBaseItem[]) => ShoppingBaseItem[] | VariantvareUtfall,
): VariantvareEndring {
  const treff = (entry.variants ?? []).filter((v) => v.id === variantId);
  if (treff.length === 0) return { type: "stopp", utfall: "variantMangler" };
  if (treff.length > 1) return { type: "stopp", utfall: "tvetydigVariant" };
  const variant = treff[0];
  if (variant?.source !== "shoppingBase") return { type: "stopp", utfall: "kildeByttet" };
  const rader = endre(variant.shoppingBase);
  if (typeof rader === "string") return { type: "stopp", utfall: rader };
  return {
    type: "skriv",
    entry: {
      ...entry,
      variants: (entry.variants ?? []).map((v) =>
        v.id === variantId ? { ...variant, shoppingBase: rader } : v,
      ),
    },
  };
}

/** Fjerner én variant. Gir en tom liste (ikke `undefined`) når siste variant fjernes, samme mønster som `removeShoppingBaseItem`. */
export function removeVariant(entry: MealLibraryEntry, variantId: string): MealLibraryEntry {
  return { ...entry, variants: (entry.variants ?? []).filter((v) => v.id !== variantId) };
}
