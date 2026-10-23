import { describe, expect, it } from "vitest";
import {
  findItemByName,
  findMergeCandidate,
  mergeShoppingAmount,
  newItemFields,
  normalizeItemName,
} from "./handlelisteRules";
import type { ShoppingItem } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";

const entry = (overrides: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id: "s1",
  itemId: "v1",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
  ...overrides,
});

describe("varebase-match (speiler finnEllerOpprettVare)", () => {
  const items: Vare[] = [
    { id: "v1", name: "Melk", cat: "Ost og meieri" },
    { id: "v2", name: "  Brød ", cat: "Brød og bakst" },
  ];

  it("matcher trimmet og case-insensitivt — på begge sider", () => {
    expect(findItemByName(items, "  mELK ")?.id).toBe("v1");
    expect(findItemByName(items, "brød")?.id).toBe("v2");
  });

  it("gir ingen match for tomt/blankt navn", () => {
    expect(findItemByName(items, "   ")).toBeUndefined();
  });

  it("ny vare får trimmet navn og «Diverse» når kategori mangler", () => {
    expect(newItemFields("  Kanel ", "")).toEqual({ name: "Kanel", cat: "Diverse" });
    expect(newItemFields("Kanel", "Tørrvarer")).toEqual({ name: "Kanel", cat: "Tørrvarer" });
    expect(newItemFields("   ", "Tørrvarer")).toBeNull();
  });

  it("normalizeItemName trimmer og lowercaser", () => {
    expect(normalizeItemName("  MeLk ")).toBe("melk");
  });
});

describe("handlelistens dedup-kandidat (speiler mergeIntoShoppingList/addBatchToShoppingList)", () => {
  it("velger første ikke-fullførte post med samme navn, case-insensitivt", () => {
    const list = [entry({ id: "a", done: true }), entry({ id: "b", name: "MELK" })];
    expect(findMergeCandidate(list, { name: "melk" })?.id).toBe("b");
  });

  it("en fullført post blokkerer ikke en ny rad", () => {
    expect(findMergeCandidate([entry({ done: true })], { name: "Melk" })).toBeUndefined();
  });

  it("trimmer bevisst IKKE (uendret fra dagens kode)", () => {
    expect(findMergeCandidate([entry()], { name: "Melk " })).toBeUndefined();
  });

  it("hopper over poster uten streng-name (f.eks. «undefined» med _ops-form) uten å endre dem", () => {
    const opsUnderUndefined = {
      id: "undefined",
      r0: { tool: "shopping_list_add_items", at: 1 },
    } as unknown as ReturnType<typeof entry>;
    const utenNavn = entry({ id: "x", name: undefined as unknown as string });
    const list = [opsUnderUndefined, utenNavn, entry({ id: "melk" })];
    const foer = JSON.stringify(list);
    expect(findMergeCandidate(list, { name: "Melk" })?.id).toBe("melk");
    expect(findMergeCandidate([opsUnderUndefined, utenNavn], { name: "Melk" })).toBeUndefined();
    expect(JSON.stringify(list)).toBe(foer);
  });
});

describe("mergeShoppingAmount", () => {
  it("lar en post uten streng-name stå urørt (aldri en kandidat)", () => {
    const utenNavn = entry({ name: undefined as unknown as string, amount: "2" });
    expect(mergeShoppingAmount(utenNavn, { name: "Melk", amount: "3" })).toBeNull();
  });

  it("summerer to positive tallmengder, avrundet til to desimaler", () => {
    expect(mergeShoppingAmount(entry({ amount: "1.115" }), { name: "Melk", amount: "2" })).toEqual(
      entry({ amount: "3.12" }),
    );
  });

  it("lar posten stå urørt når én av mengdene ikke er et positivt tall", () => {
    expect(mergeShoppingAmount(entry({ amount: "" }), { name: "Melk", amount: "2" })).toBeNull();
    expect(mergeShoppingAmount(entry({ amount: "2" }), { name: "Melk", amount: "" })).toBeNull();
    expect(
      mergeShoppingAmount(entry({ amount: "litt" }), { name: "Melk", amount: "2" }),
    ).toBeNull();
  });

  it("kjent særegenhet videreført: ledende tall leses, enheten faller bort", () => {
    expect(
      mergeShoppingAmount(entry({ amount: "2 stk" }), { name: "Melk", amount: "3" })?.amount,
    ).toBe("5");
  });

  it("lar posten stå urørt når den ikke lenger er kandidat (fullført / annet navn)", () => {
    expect(mergeShoppingAmount(entry({ done: true }), { name: "Melk", amount: "1" })).toBeNull();
    expect(mergeShoppingAmount(entry({ name: "Fløte" }), { name: "Melk", amount: "1" })).toBeNull();
  });
});
