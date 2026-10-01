import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "@app-types/shopping";
import { findDuplicateNames, isEmptyPlan, planAddItems } from "./plan";

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

const melkRow: ShoppingItem = {
  id: "a",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};

describe("planAddItems — utfall per vare", () => {
  it("ny vare: oppretter vare + post, `added`, newItemCreated", () => {
    const { plan, results } = planAddItems([], [], [{ name: "Kanel", cat: "Tørrvarer" }], ids());
    expect(plan.newItems).toEqual([{ id: "id-1", fields: { name: "Kanel", cat: "Tørrvarer" } }]);
    expect(plan.newEntries).toEqual([
      {
        id: "id-2",
        entry: { itemId: "id-1", name: "Kanel", amount: "", cat: "Tørrvarer", done: false },
      },
    ]);
    expect(results).toEqual([
      {
        inputName: "Kanel",
        outcome: "added",
        entryId: "id-2",
        itemId: "id-1",
        name: "Kanel",
        amount: "",
        cat: "Tørrvarer",
        newItemCreated: true,
      },
    ]);
  });

  it("ny vare uten kategori får «Diverse»", () => {
    const { plan } = planAddItems([], [], [{ name: "Kanel" }], ids());
    expect(plan.newItems[0]?.fields.cat).toBe("Diverse");
  });

  it("kjent vare: varebasens navn og kategori vinner over oppgitt kategori", () => {
    const { plan, results } = planAddItems(
      [],
      [{ id: "v-melk", name: "Melk", cat: "Ost og meieri" }],
      [{ name: "melk", cat: "Drikke" }],
      ids(),
    );
    expect(plan.newItems).toEqual([]);
    expect(plan.newEntries[0]?.entry).toMatchObject({ name: "Melk", cat: "Ost og meieri" });
    expect(results[0]).toMatchObject({ inputName: "melk", newItemCreated: false });
  });

  it("`merged` beskriver før/etter-mengde og skriver hele posten", () => {
    const { plan, results } = planAddItems(
      [melkRow],
      [{ id: "v-melk", name: "Melk", cat: "Ost og meieri" }],
      [{ name: "Melk", amount: "3" }],
      ids(),
    );
    expect(plan.updatedEntries).toEqual([
      {
        id: "a",
        entry: { itemId: "v-melk", name: "Melk", amount: "5", cat: "Ost og meieri", done: false },
      },
    ]);
    expect(results[0]).toMatchObject({
      outcome: "merged",
      entryId: "a",
      amount: "5",
      previousAmount: "2",
    });
  });

  it("`already_on_list` skriver ingenting", () => {
    const { plan, results } = planAddItems(
      [{ ...melkRow, amount: "" }],
      [{ id: "v-melk", name: "Melk", cat: "Ost og meieri" }],
      [{ name: "Melk", amount: "1" }],
      ids(),
    );
    expect(isEmptyPlan(plan)).toBe(true);
    expect(results[0]).toMatchObject({ outcome: "already_on_list", entryId: "a", amount: "" });
  });
});

describe("findDuplicateNames", () => {
  it("finner duplikater etter varebase-normalisering", () => {
    expect(findDuplicateNames([{ name: "Melk" }, { name: " melk " }, { name: "Egg" }])).toEqual([
      "melk",
    ]);
    expect(findDuplicateNames([{ name: "Melk" }, { name: "Egg" }])).toEqual([]);
  });
});
