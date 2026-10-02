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
 *
 * To steg, fordi de skrives til ulike noder: `resolveItems` (varebasen,
 * skrives FØR handleliste-transaksjonen) og `planShoppingAdds` (kjøres
 * INNE i transaksjonen mot ferskeste liste, §shoppingNode.ts).
 * `planAddItems` er de to satt sammen — brukt av paritetstesten.
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
import type { AddItemOutcome } from "../store/types";
import type { AddItemInput } from "./schemas";

/** En validert vare, koblet til sin vare i varebasen (eksisterende eller ny). */
export interface ResolvedInput {
  input: AddItemInput;
  vare: Vare;
  newItemCreated: boolean;
}

export interface ShoppingAdds {
  newEntries: { id: string; entry: ShoppingListEntry }[];
  /** Hele poster (aldri et `{amount}`-fragment) — skrives over den rå noden. */
  updatedEntries: { id: string; entry: ShoppingListEntry }[];
  results: AddItemOutcome[];
}

export interface WritePlan {
  newItems: { id: string; fields: Omit<Vare, "id"> }[];
  newEntries: ShoppingAdds["newEntries"];
  updatedEntries: ShoppingAdds["updatedEntries"];
}

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

/**
 * Steg 1 — varebasen: `findItemByName` (trimmet, case-insensitivt). Finnes
 * varen, brukes DENS navn og kategori (oppgitt `cat` ignoreres, som i
 * Handleliste-skjermens skrivefelt); ellers en ny vare via `newItemFields`
 * med id fra `newItemId(navn)`.
 */
export function resolveItems(
  items: readonly Vare[],
  inputs: readonly AddItemInput[],
  newItemId: (name: string) => string,
): { resolved: ResolvedInput[]; newItems: WritePlan["newItems"] } {
  const knownItems: Vare[] = [...items];
  const resolved: ResolvedInput[] = [];
  const newItems: WritePlan["newItems"] = [];
  for (const input of inputs) {
    const found = findItemByName(knownItems, input.name);
    if (found) {
      resolved.push({ input, vare: found, newItemCreated: false });
      continue;
    }
    const fields = newItemFields(input.name, input.cat ?? "");
    if (!fields) throw new Error("Tomt varenavn etter validering");
    const vare = { id: newItemId(input.name), ...fields };
    knownItems.push(vare);
    newItems.push({ id: vare.id, fields });
    resolved.push({ input, vare, newItemCreated: true });
  }
  return { resolved, newItems };
}

/**
 * Steg 2 — handlelisten: `findMergeCandidate` + `mergeShoppingAmount` —
 * samme dedup som `addBatchToShoppingList`/`mergeIntoShoppingList`: en
 * ikke-fullført post med samme navn får tallmengden summert, eller står
 * urørt (`already_on_list`) når mengdene ikke begge er tall.
 */
export function planShoppingAdds(
  shopping: readonly ShoppingItem[],
  resolved: readonly ResolvedInput[],
  newId: () => string,
): ShoppingAdds {
  const adds: ShoppingAdds = { newEntries: [], updatedEntries: [], results: [] };
  for (const { input, vare, newItemCreated } of resolved) {
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
      adds.newEntries.push({ id, entry });
      adds.results.push({ ...base, outcome: "added", entryId: id, ...view(entry) });
      continue;
    }

    const { id: candidateId, ...current } = candidate;
    const merged = mergeShoppingAmount(current, entry);
    if (merged) {
      adds.updatedEntries.push({ id: candidateId, entry: merged });
      adds.results.push({
        ...base,
        outcome: "merged",
        entryId: candidateId,
        ...view(merged),
        previousAmount: current.amount,
      });
    } else {
      adds.results.push({
        ...base,
        outcome: "already_on_list",
        entryId: candidateId,
        ...view(current),
      });
    }
  }
  return adds;
}

/** Begge stegene mot ett øyeblikksbilde — samme semantikk, uten I/O. */
export function planAddItems(
  shopping: readonly ShoppingItem[],
  items: readonly Vare[],
  inputs: readonly AddItemInput[],
  newId: () => string,
): PlannedAdd {
  const { resolved, newItems } = resolveItems(items, inputs, () => newId());
  const { newEntries, updatedEntries, results } = planShoppingAdds(shopping, resolved, newId);
  return { plan: { newItems, newEntries, updatedEntries }, results };
}

const view = (e: ShoppingListEntry) => ({ name: e.name, amount: e.amount, cat: e.cat });

export const isEmptyPlan = (plan: Omit<WritePlan, "newItems">) =>
  plan.newEntries.length === 0 && plan.updatedEntries.length === 0;
