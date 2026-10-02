/**
 * PARITET mot appen: for samme utgangsliste og samme nye varer skal
 * resultatet av å anvende `planAddItems` sin skriveplan være NØYAKTIG det
 * appens rene referanse `mergeIntoShoppingList`
 * (`web/src/generators/shopping/shopping.ts` — karakterisert mot dagens
 * `MatScreen.onAddToList`) gir. Testen importerer appens egen funksjon,
 * ikke en kopi.
 */
import { describe, expect, it } from "vitest";
import { mergeIntoShoppingList } from "@generators/shopping/shopping";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";
import { planAddItems, type WritePlan } from "./plan";
import type { AddItemInput } from "./schemas";

function applyPlan(list: readonly ShoppingItem[], plan: WritePlan): ShoppingItem[] {
  const byId = new Map(list.map((e) => [e.id, e]));
  for (const { id, entry } of [...plan.updatedEntries, ...plan.newEntries]) {
    byId.set(id, { id, ...entry });
  }
  return [...byId.values()];
}

const sortById = (l: ShoppingItem[]) => [...l].sort((a, b) => a.id.localeCompare(b.id));

/** Kjører begge veier med deterministiske id-er og sammenligner sluttilstanden. */
function expectParity(existing: ShoppingItem[], items: Vare[], inputs: AddItemInput[]) {
  let n = 0;
  const { plan } = planAddItems(existing, items, inputs, () => `id-${++n}`);
  const viaMcp = applyPlan(existing, plan);

  // Appens referanse får de SAMME nye postene (samme id, vare-oppslag og
  // feltvalg som Handleliste-skjermens skrivefelt), slik at kun dedup-/
  // sammenslåingsregelen er det som sammenlignes.
  const allItems = [...items, ...plan.newItems.map(({ id, fields }) => ({ id, ...fields }))];
  const candidates: ShoppingItem[] = inputs.map((input, i) => {
    const vare = allItems.find(
      (v) => v.name.trim().toLowerCase() === input.name.trim().toLowerCase(),
    )!;
    const planned = plan.newEntries.find((e) => e.entry.itemId === vare.id);
    const entry: ShoppingListEntry = {
      itemId: vare.id,
      name: vare.name,
      amount: input.amount ?? "",
      cat: vare.cat,
      done: false,
    };
    return { id: planned?.id ?? `unused-${i}`, ...entry };
  });
  const viaApp = mergeIntoShoppingList(existing, candidates);

  expect(sortById(viaMcp)).toEqual(sortById(viaApp));
}

const item = (id: string, name: string, cat = "Diverse"): Vare => ({ id, name, cat });
const row = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
  ...o,
});

describe("paritet: planAddItems ≡ mergeIntoShoppingList", () => {
  const varebase = [
    item("v-melk", "Melk", "Ost og meieri"),
    item("v-brod", "  Brød ", "Brød og bakst"),
    item("v-egg", "Egg", "Ost og meieri"),
  ];

  it.each<[string, ShoppingItem[], AddItemInput[]]>([
    ["tom liste, ny vare", [], [{ name: "Kanel", cat: "Tørrvarer" }]],
    ["tom liste, kjent vare", [], [{ name: "melk", amount: "1" }]],
    ["tallmengder summeres", [row("a")], [{ name: "MELK", amount: "3" }]],
    ["desimaler avrundes", [row("a", { amount: "0.335" })], [{ name: "Melk", amount: "1" }]],
    ["ikke-tall blir stående", [row("a", { amount: "1 kartong" })], [{ name: "Melk" }]],
    ["ny mengde tom", [row("a")], [{ name: "Melk", amount: "" }]],
    [
      "ledende tall leses (kjent særegenhet)",
      [row("a", { amount: "2 stk" })],
      [{ name: "Melk", amount: "3" }],
    ],
    ["fullført post blokkerer ikke", [row("a", { done: true })], [{ name: "Melk", amount: "1" }]],
    [
      "første ikke-fullførte kandidat vinner",
      [row("a", { done: true }), row("b"), row("c", { amount: "7" })],
      [{ name: "Melk", amount: "1" }],
    ],
    ["varebasenavn med mellomrom", [], [{ name: "brød" }]],
    [
      "blandet batch",
      [row("a"), row("b", { itemId: "v-egg", name: "Egg", amount: "6", done: true })],
      [
        { name: "Melk", amount: "1" },
        { name: "Egg", amount: "12" },
        { name: "Kaffe", amount: "1 pk", cat: "Drikke" },
      ],
    ],
  ])("%s", (_label, existing, inputs) => {
    expectParity(existing, varebase, inputs);
  });
});
