/**
 * Handlelistens rene sammenslåings- og varebase-regler — ingen React,
 * ingen Firebase. ÉN kilde til sannhet for reglene som tidligere lå
 * duplisert inline i tre skriveveier:
 *
 *  - `mergeIntoShoppingList` (§generators/shopping/shopping.ts) — den rene
 *    fold-over-listen-versjonen (dagens `MatScreen.onAddToList`).
 *  - `addBatchToShoppingList` (§data/shopping.repository.ts) — skrivesiden,
 *    som nå får reglene inn som parameter fra hooken (datalaget får ikke
 *    importere `domain/`, §eslint.config.js — samme injeksjonsmønster som
 *    `transactFreezerItem`/`updateAnnualPlanSliceTransactional`).
 *  - `findOrCreateItem` (§data/items.repository.ts) — navnematch mot
 *    varebasen.
 *
 * Kontrolltårnets MCP-flate (`mcp-server/`, Issue #27) importerer de SAMME
 * funksjonene, slik at "legg melk på handlelisten" fra ChatGPT følger
 * nøyaktig samme regel som appen — ikke en parallell kopi som kan drive.
 *
 * Oppførselen er portert 1:1 fra de tre inline-kopiene, inkludert de
 * kjente, dokumenterte særegenhetene (se hver funksjon) — dette er en
 * ren flytting, ingen produktendring.
 */
import type { ShoppingItem, ShoppingListEntry, ShoppingMergeRules } from "@app-types/shopping";
import type { ItemMatchRules, Vare } from "@app-types/vare";

/** Kategori en NY vare får når kalleren ikke oppgir noen (§findOrCreateItem). */
export const DEFAULT_ITEM_CATEGORY = "Diverse";

/**
 * Normaliserer et varenavn for varebase-oppslag: trimmet og lowercased.
 * Brukes KUN mot varebasen (`items`) — handlelistens dedup-match trimmer
 * bevisst IKKE (se `isSameShoppingName`), akkurat som dagens kode.
 */
export function normalizeItemName(name: string): string {
  return name.trim().toLowerCase();
}

/** Finner en vare i varebasen på navn (trimmet, case-insensitivt). Speiler `finnEllerOpprettVare`. */
export function findItemByName(items: readonly Vare[], name: string): Vare | undefined {
  const normalized = normalizeItemName(name);
  if (!normalized) return undefined;
  return items.find((i) => normalizeItemName(i.name) === normalized);
}

/**
 * Feltene en NY vare får — trimmet navn, `cat || "Diverse"`. `null` når
 * navnet er tomt etter trimming (dagens kode oppretter da ingenting).
 */
export function newItemFields(name: string, cat: string): Omit<Vare, "id"> | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  return { name: trimmed, cat: cat || DEFAULT_ITEM_CATEGORY };
}

/**
 * Handlelistens navnelikhet: case-insensitivt, UTEN trimming — speiler
 * dagens `e.name.toLowerCase() === entry.name.toLowerCase()` 1:1.
 */
export function isSameShoppingName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Finner dedup-kandidaten for en ny post: første IKKE-fullførte post med
 * samme navn. En fullført post med samme navn blokkerer aldri en ny rad.
 */
export function findMergeCandidate<T extends ShoppingListEntry>(
  existing: readonly T[],
  entry: Pick<ShoppingListEntry, "name">,
): T | undefined {
  return existing.find((e) => isSameShoppingName(e.name, entry.name) && !e.done);
}

/**
 * Slår en ny posts mengde inn i en eksisterende post. Returnerer den
 * oppdaterte posten, eller `null` når posten skal stå URØRT:
 *
 *  - posten er fullført, eller navnet matcher ikke lenger (ikke en
 *    kandidat — relevant når regelen kjøres på nytt mot ferskere
 *    servertilstand inne i en transaksjon);
 *  - mengdene er ikke BEGGE positive tall — da er varen allerede "der",
 *    og ingen ny rad legges til.
 *
 * Kjent, uendret særegenhet: `parseFloat` leser det ledende tallet, så
 * `"2 stk"` + `"3"` blir `"5"` (enheten faller bort). Videreført 1:1.
 */
export function mergeShoppingAmount<T extends ShoppingListEntry>(
  current: T,
  entry: Pick<ShoppingListEntry, "name" | "amount">,
): T | null {
  if (current.done || !isSameShoppingName(current.name, entry.name)) return null;
  const a = parseFloat(current.amount) || 0;
  const b = parseFloat(entry.amount) || 0;
  if (!(a > 0 && b > 0)) return null;
  return { ...current, amount: String(Math.round((a + b) * 100) / 100) };
}

/** Reglene samlet i formen datalaget tar inn (§data/shopping.repository.ts). */
export const shoppingMergeRules: ShoppingMergeRules = {
  findMergeCandidate: (existing: readonly ShoppingItem[], entry: ShoppingListEntry) =>
    findMergeCandidate(existing, entry),
  mergeShoppingAmount: (current: ShoppingListEntry, entry: ShoppingListEntry) =>
    mergeShoppingAmount(current, entry),
};

/** Reglene samlet i formen datalaget tar inn (§data/items.repository.ts). */
export const itemMatchRules: ItemMatchRules = {
  findItemByName,
  newItemFields,
};
