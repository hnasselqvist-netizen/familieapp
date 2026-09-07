/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * FreezerScreen i dagens index.html (linje ~5077–5121) slik den er
 * lest og verifisert manuelt mot koden, FØR noe ble flyttet. Ved
 * uenighet om "riktig" oppførsel senere: dette er fasiten, ikke en
 * idealisert versjon.
 */
import { describe, expect, it } from "vitest";
import { addBatch, adjustBatchCount, batchLabel, removeFreezerItem, totalGrams } from "./freezer";
import type { FreezerBatch, FreezerItem } from "@app-types/freezer";

describe("batchLabel", () => {
  it("viser gramPerUnit når satt, uansett enhet", () => {
    const batch: FreezerBatch = { id: "b1", count: 2, unit: "pk", gramsPerUnit: 500 };
    expect(batchLabel(batch)).toBe("2 pk à 500 g");
  });

  it("viser 'stk' som suffiks når enheten er stk uten gramsPerUnit", () => {
    const batch: FreezerBatch = { id: "b1", count: 3, unit: "stk", gramsPerUnit: null };
    expect(batchLabel(batch)).toBe("3 stk");
  });

  it("viser enheten direkte for andre enheter uten gramsPerUnit", () => {
    const batch: FreezerBatch = { id: "b1", count: 1, unit: "l", gramsPerUnit: null };
    expect(batchLabel(batch)).toBe("1 l");
  });
});

describe("totalGrams", () => {
  it("summerer kun batcher som har gramsPerUnit satt", () => {
    const item: FreezerItem = {
      id: "i1",
      itemId: "v1",
      name: "Karbonadedeig",
      batches: [
        { id: "b1", count: 2, unit: "pk", gramsPerUnit: 500 },
        { id: "b2", count: 1, unit: "stk", gramsPerUnit: null },
      ],
    };
    expect(totalGrams(item)).toBe(1000);
  });

  it("returnerer null når ingen batch har gramsPerUnit, ikke 0", () => {
    const item: FreezerItem = {
      id: "i1",
      itemId: "v1",
      name: "Brød",
      batches: [{ id: "b1", count: 2, unit: "stk", gramsPerUnit: null }],
    };
    expect(totalGrams(item)).toBeNull();
  });
});

describe("addBatch", () => {
  it("oppretter en helt ny fryserpost når varen ikke finnes fra før", () => {
    const result = addBatch(
      [],
      { id: "v1", name: "Karbonadedeig" },
      { id: "b1", count: 2, unit: "pk", gramsPerUnit: 500 },
      "i1",
    );
    expect(result).toEqual([
      {
        id: "i1",
        itemId: "v1",
        name: "Karbonadedeig",
        batches: [{ id: "b1", count: 2, unit: "pk", gramsPerUnit: 500 }],
      },
    ]);
  });

  it("øker antallet på eksisterende batch ved samme enhet + gramsPerUnit", () => {
    const existing: FreezerItem[] = [
      {
        id: "i1",
        itemId: "v1",
        name: "Karbonadedeig",
        batches: [{ id: "b1", count: 2, unit: "pk", gramsPerUnit: 500 }],
      },
    ];
    const result = addBatch(
      existing,
      { id: "v1", name: "Karbonadedeig" },
      { id: "b-ny", count: 1, unit: "pk", gramsPerUnit: 500 },
      "i-ny",
    );
    expect(result).toEqual([
      {
        id: "i1",
        itemId: "v1",
        name: "Karbonadedeig",
        batches: [{ id: "b1", count: 3, unit: "pk", gramsPerUnit: 500 }],
      },
    ]);
  });

  it("legger til en NY batch når pakkestørrelsen (enhet+gramsPerUnit) er ulik", () => {
    const existing: FreezerItem[] = [
      {
        id: "i1",
        itemId: "v1",
        name: "Karbonadedeig",
        batches: [{ id: "b1", count: 2, unit: "pk", gramsPerUnit: 500 }],
      },
    ];
    const result = addBatch(
      existing,
      { id: "v1", name: "Karbonadedeig" },
      { id: "b2", count: 1, unit: "pk", gramsPerUnit: 250 },
      "i-ny",
    );
    expect(result[0]?.batches).toHaveLength(2);
  });

  it("matcher eksisterende vare case-insensitivt på navn", () => {
    const existing: FreezerItem[] = [
      {
        id: "i1",
        itemId: "v1",
        name: "karbonadedeig",
        batches: [{ id: "b1", count: 1, unit: "stk", gramsPerUnit: null }],
      },
    ];
    const result = addBatch(
      existing,
      { id: "v1", name: "Karbonadedeig" },
      { id: "b2", count: 1, unit: "stk", gramsPerUnit: null },
      "i-ny",
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.batches[0]?.count).toBe(2);
  });
});

describe("adjustBatchCount", () => {
  const items: FreezerItem[] = [
    {
      id: "i1",
      itemId: "v1",
      name: "Karbonadedeig",
      batches: [{ id: "b1", count: 2, unit: "pk", gramsPerUnit: 500 }],
    },
  ];

  it("øker antallet med positiv delta", () => {
    const result = adjustBatchCount(items, "i1", "b1", 1);
    expect(result[0]?.batches[0]?.count).toBe(3);
  });

  it("fjerner kun batchen (ikke hele posten) når en av flere når 0", () => {
    const itemsWithTwoBatches: FreezerItem[] = [
      {
        id: "i1",
        itemId: "v1",
        name: "Karbonadedeig",
        batches: [
          { id: "b1", count: 2, unit: "pk", gramsPerUnit: 500 },
          { id: "b2", count: 1, unit: "stk", gramsPerUnit: null },
        ],
      },
    ];
    const result = adjustBatchCount(itemsWithTwoBatches, "i1", "b1", -2);
    expect(result[0]?.batches).toEqual([{ id: "b2", count: 1, unit: "stk", gramsPerUnit: null }]);
  });

  it("fjerner hele fryserposten når siste batch fjernes", () => {
    const result = adjustBatchCount(items, "i1", "b1", -2);
    expect(result).toHaveLength(0);
  });

  it("lar aldri antallet gå under 0", () => {
    const result = adjustBatchCount(items, "i1", "b1", -100);
    expect(result).toHaveLength(0);
  });
});

describe("removeFreezerItem", () => {
  it("fjerner posten med gitt id, lar andre stå", () => {
    const items: FreezerItem[] = [
      { id: "i1", itemId: "v1", name: "A", batches: [] },
      { id: "i2", itemId: "v2", name: "B", batches: [] },
    ];
    expect(removeFreezerItem(items, "i1")).toEqual([items[1]]);
  });
});
