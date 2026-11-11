/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * FreezerScreen i dagens index.html (linje ~5077–5121) slik den er
 * lest og verifisert manuelt mot koden, FØR noe ble flyttet. Ved
 * uenighet om "riktig" oppførsel senere: dette er fasiten, ikke en
 * idealisert versjon.
 */
import { describe, expect, it } from "vitest";
import {
  addBatch,
  adjustBatchCount,
  batchLabel,
  freezerLabel,
  removeFreezerItem,
  beholdningsledd,
  beholdningstekst,
  totalGrams,
} from "./freezer";
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

/**
 * §Kontrolltårn-handoff, Issue #20, "Kjøkken v1": flyttet hit fra en
 * lokal, ueksportert funksjon i `RecipeIngredients.tsx` for gjenbruk av
 * `ShoppingGeneratorModal.tsx` sitt gjennomgangs-steg — samme
 * "du har dette i Matlager"-informasjon, to bruksteder.
 */
describe("freezerLabel", () => {
  it("returnerer null når varen ikke finnes i fryseren", () => {
    expect(freezerLabel("Kylling", [])).toBeNull();
  });

  it("matcher navn case-insensitivt", () => {
    const freezer: FreezerItem[] = [
      {
        id: "i1",
        itemId: "v1",
        name: "Kylling",
        batches: [{ id: "b1", count: 1, unit: "stk", gramsPerUnit: 500 }],
      },
    ];
    expect(freezerLabel("kylling", freezer)).toBe("❄️ 500 g i Matlager");
  });

  it("viser summert gramvekt når batchene har gramsPerUnit", () => {
    const freezer: FreezerItem[] = [
      {
        id: "i1",
        itemId: "v1",
        name: "Kylling",
        batches: [
          { id: "b1", count: 2, unit: "pk", gramsPerUnit: 500 },
          { id: "b2", count: 1, unit: "pk", gramsPerUnit: 300 },
        ],
      },
    ];
    expect(freezerLabel("Kylling", freezer)).toBe("❄️ 1300 g i Matlager");
  });

  it("faller tilbake til summert antall når ingen batch har gramsPerUnit", () => {
    const freezer: FreezerItem[] = [
      {
        id: "i1",
        itemId: "v1",
        name: "Fiskepinner",
        batches: [{ id: "b1", count: 3, unit: "pk", gramsPerUnit: null }],
      },
    ];
    expect(freezerLabel("Fiskepinner", freezer)).toBe("❄️ 3 pk i Matlager");
  });

  it('faller tilbake til "har i Matlager" når summert antall er 0', () => {
    const freezer: FreezerItem[] = [{ id: "i1", itemId: "v1", name: "Kylling", batches: [] }];
    expect(freezerLabel("Kylling", freezer)).toBe("❄️ har i Matlager");
  });
});

/**
 * Mengdevisning (#20, ordre 6693886984): direkte masse/volum, dokumentert
 * pakningsvekt og antall uten vekt holdes atskilt. Gamle tvetydige verdier
 * vises som lagret og summeres ikke. Ren og skrivefri.
 */
describe("beholdningsledd / beholdningstekst", () => {
  const b = (
    count: number,
    unit: string,
    gramsPerUnit: number | null = null,
    id = `${count}${unit}${gramsPerUnit ?? ""}`,
  ): FreezerBatch => ({ id, count, unit, gramsPerUnit });

  it.each([
    ["1 kg + 500 g → 1500 g", [b(1, "kg"), b(500, "g")], "1500 g"],
    ["2 pk à 400 g + 500 g → 1300 g", [b(2, "pk", 400), b(500, "g")], "1300 g"],
    ["2 boks uten vekt + 300 g → to ledd", [b(2, "boks"), b(300, "g")], "300 g · 2 boks"],
    ["2 pk + 3 stk blir ikke 5 pk", [b(2, "pk"), b(3, "stk")], "2 pk · 3 stk"],
    ["samme enhet uten vekt summeres", [b(2, "pk", null, "a"), b(1, "pk", null, "b")], "3 pk"],
    ["1 l + 5 dl → 1,5 l", [b(1, "l"), b(5, "dl")], "1,5 l"],
    ["3 dl + 100 ml → 4 dl", [b(3, "dl"), b(100, "ml")], "4 dl"],
    ["250 ml", [b(250, "ml")], "250 ml"],
    ["masse og volum regnes aldri om", [b(500, "g"), b(5, "dl")], "500 g · 5 dl"],
    ["desimaler: 0,5 kg + 0,25 kg", [b(0.5, "kg"), b(0.25, "kg")], "750 g"],
    ["desimaler: 0,1 l + 0,2 l", [b(0.1, "l"), b(0.2, "l")], "3 dl"],
    ["desimalantall", [b(1.5, "pk")], "1,5 pk"],
    [
      "kjent og ukjent vekt: restmengden skjules ikke",
      [b(2, "pk", 400), b(1, "stk")],
      "800 g · 1 stk",
    ],
    ["gammel tvetydig verdi vises som lagret", [b(2, "kg", 500)], "2 kg à 500 g"],
    [
      "tvetydig verdi bidrar ikke til summen",
      [b(1, "kg"), b(2, "kg", 500), b(1, "dl", 100)],
      "1000 g · 2 kg à 500 g · 1 dl à 100 g",
    ],
    ["store tall uten tusenskilletegn", [b(12, "kg")], "12000 g"],
  ])("%s", (_navn, batches, forventet) => {
    expect(beholdningstekst(batches)).toBe(forventet);
  });

  it("tom beholdning og batcher på 0 gir ingen tekst", () => {
    expect(beholdningstekst([])).toBeNull();
    expect(beholdningsledd([b(0, "pk")])).toEqual([]);
  });

  it("muterer ikke kildeobjektene og er deterministisk", () => {
    const batches = [b(2, "pk", 400), b(500, "g"), b(2, "kg", 500), b(3, "stk")];
    const kopi = structuredClone(batches);
    const t1 = beholdningstekst(batches);
    expect(beholdningstekst(batches)).toBe(t1);
    expect(batches).toEqual(kopi);
  });

  it("totalGrams teller direkte masse og pakningsvekt, ikke tvetydige verdier", () => {
    const item = (batches: FreezerBatch[]): FreezerItem => ({
      id: "i",
      itemId: "v",
      name: "X",
      batches,
    });
    expect(totalGrams(item([b(1, "kg"), b(500, "g")]))).toBe(1500);
    expect(totalGrams(item([b(2, "pk", 400), b(500, "g")]))).toBe(1300);
    expect(totalGrams(item([b(2, "kg", 500)]))).toBeNull();
    expect(totalGrams(item([b(3, "stk")]))).toBeNull();
  });

  it("freezerLabel bruker samme ledd, og første navnetreff vinner fortsatt", () => {
    const freezer: FreezerItem[] = [
      { id: "i1", itemId: "v1", name: "Mel", batches: [b(1, "kg"), b(500, "g")] },
      { id: "i2", itemId: "v2", name: "Bønner", batches: [b(2, "boks"), b(300, "g")] },
      { id: "i3", itemId: "v3", name: "mel", batches: [b(9, "kg")] },
    ];
    expect(freezerLabel("Mel", freezer)).toBe("❄️ 1500 g i Matlager");
    expect(freezerLabel("bønner", freezer)).toBe("❄️ 300 g · 2 boks i Matlager");
  });
});
