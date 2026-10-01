/**
 * Ren planlegger for `shopping_list_add_items`: gitt ferskt lest
 * handleliste + varebase og de validerte varene, beregn NØYAKTIG hvilke
 * poster/varer som skal skrives og hva utfallet per vare blir. Ingen I/O.
 *
 * Semantikken er appens, via de DELTE reglene i
 * `web/src/domain/shopping/handlelisteRules.ts`:
 *
 *  1. Varebase: `findItemByName` (trimmet, case-insensitivt) — finnes
 *     varen, brukes DENS navn og kategori (oppgitt `cat` ignoreres, som i
 *     Handleliste-skjermens skrivefelt); ellers ny vare via `newItemFields`.
 *  2. Handleliste: `findMergeCandidate` + `mergeShoppingAmount` — samme
 *     dedup som `addBatchToShoppingList`/`mergeIntoShoppingList`: en
 *     ikke-fullført post med samme navn får tallmengden summert, eller
 *     står urørt (`already_on_list`) når mengdene ikke begge er tall.
 *
 * Som `addBatchToShoppingList` matches hver vare kun mot den LESTE listen,
 * aldri mot andre varer i samme kall — duplikater i samme kall avvises
 * derfor i validering (`findDuplicateNames`) i stedet for å gi et
 * rekkefølgeavhengig resultat.
 */
import {
  findItemByName,
  findMergeCandidate,
  mergeShoppingAmount,
  newItemFields,
  normalizeItemName,
} from "@domain/shopping/handlelisteRules";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";
import type { AddItemOutcome, WritePlan } from "../store/types";
import type { AddItemInput } from "./schemas";

export interface PlannedAdd {
  plan: WritePlan;
  results: AddItemOutcome[];
}

/** Navn som forekommer mer enn én gang (etter varebase-normalisering). */
export function findDuplicateNames(items: readonly Pick<AddItemInput, "name">[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const { name } of items) {
    const key = normalizeItemName(name);
    if (seen.has(key)) dupes.add(name.trim());
    seen.add(key);
  }
  return [...dupes];
}

export function planAddItems(
  shopping: readonly ShoppingItem[],
  items: readonly Vare[],
  inputs: readonly AddItemInput[],
  newId: () => string,
): PlannedAdd {
  const plan: WritePlan = { newItems: [], newEntries: [], updatedEntries: [] };
  const results: AddItemOutcome[] = [];
  const knownItems: Vare[] = [...items];

  for (const input of inputs) {
    let vare = findItemByName(knownItems, input.name);
    let newItemCreated = false;
    if (!vare) {
      const fields = newItemFields(input.name, input.cat ?? "");
      if (!fields) throw new Error("Tomt varenavn etter validering");
      vare = { id: newId(), ...fields };
      knownItems.push(vare);
      plan.newItems.push({ id: vare.id, fields });
      newItemCreated = true;
    }

    const entry: ShoppingListEntry = {
      itemId: vare.id,
      name: vare.name,
      amount: input.amount ?? "",
      cat: vare.cat,
      done: false,
    };
    const base = { inputName: input.name, itemId: vare.id, newItemCreated };

    const candidate = findMergeCandidate(shopping, entry);
    if (!candidate) {
      const id = newId();
      plan.newEntries.push({ id, entry });
      results.push({ ...base, outcome: "added", entryId: id, ...view(entry) });
      continue;
    }

    const { id: candidateId, ...current } = candidate;
    const merged = mergeShoppingAmount(current, entry);
    if (merged) {
      plan.updatedEntries.push({ id: candidateId, entry: merged });
      results.push({
        ...base,
        outcome: "merged",
        entryId: candidateId,
        ...view(merged),
        previousAmount: current.amount,
      });
    } else {
      results.push({ ...base, outcome: "already_on_list", entryId: candidateId, ...view(current) });
    }
  }

  return { plan, results };
}

const view = (e: ShoppingListEntry) => ({ name: e.name, amount: e.amount, cat: e.cat });

export const isEmptyPlan = (plan: WritePlan) =>
  plan.newItems.length === 0 && plan.newEntries.length === 0 && plan.updatedEntries.length === 0;
