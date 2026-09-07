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
import type { MealLibraryEntry, ShoppingBaseItem } from "@app-types/shopping";

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
