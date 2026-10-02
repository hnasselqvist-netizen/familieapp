/**
 * Lesevisninger: handlelisten sortert som i appen (kategori i
 * `SHOP_CATS`-rekkefølge, ukjente kategorier sist) og varesøk.
 */
import { SHOP_CATS } from "@domain/shared/constants";
import { normalizeItemName } from "@domain/shopping/handlelisteRules";
import type { ShoppingItem } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";

const collator = new Intl.Collator("nb");
const catOrder = (cat: string) => {
  const i = (SHOP_CATS as readonly string[]).indexOf(cat);
  return i === -1 ? SHOP_CATS.length : i;
};

export function shoppingListView(list: readonly ShoppingItem[], includeDone: boolean) {
  const sorted = [...list].sort(
    (a, b) => catOrder(a.cat) - catOrder(b.cat) || collator.compare(a.name, b.name),
  );
  return {
    items: sorted
      .filter((e) => includeDone || !e.done)
      .map(({ id, name, amount, cat, done }) => ({ id, name, amount, cat, done })),
    pendingCount: list.filter((e) => !e.done).length,
    doneCount: list.filter((e) => e.done).length,
  };
}

/**
 * Varesøk i varebasen: eksakt treff først, så prefiks, så ordstart, så
 * delstreng — innenfor samme rang alfabetisk (nb).
 */
export function searchItems(items: readonly Vare[], query: string, limit: number) {
  const q = normalizeItemName(query);
  const rank = (name: string): number => {
    const n = normalizeItemName(name);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.split(/\s+/).some((w) => w.startsWith(q))) return 2;
    if (n.includes(q)) return 3;
    return -1;
  };
  return {
    items: items
      .map((v) => ({ v, r: rank(v.name) }))
      .filter(({ r }) => r >= 0)
      .sort((a, b) => a.r - b.r || collator.compare(a.v.name, b.v.name))
      .slice(0, limit)
      .map(({ v }) => ({ id: v.id, name: v.name.trim(), cat: v.cat })),
  };
}
