import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "@app-types/shopping";
import { lagFjernPlan, vurderFjerning } from "./handlelisteFjerning";

const MELK: ShoppingItem = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};
const node = (m: Record<string, unknown> | null = { ...MELK }) => ({
  m,
  b: { id: "b", name: "Brød", amount: "1", cat: "Brød og bakst", done: false },
  _ops: { r1: { tool: "x" } },
});

describe("vurderFjerning", () => {
  it("uendret rad: fjern — også med ukjente felt og historikk på raden", () => {
    expect(vurderFjerning(node(), lagFjernPlan(MELK))).toEqual({ utfall: "fjern" });
    expect(
      vurderFjerning(node({ ...MELK, ukjent: 1, sammenslaing: { opId: "x" } }), lagFjernPlan(MELK)),
    ).toEqual({ utfall: "fjern" });
  });

  it("fullført rad som fortsatt er fullført: fjern", () => {
    const ferdig = { ...MELK, done: true };
    expect(vurderFjerning(node(ferdig), lagFjernPlan(ferdig))).toEqual({ utfall: "fjern" });
  });

  it("posten er allerede borte: entydig `borte`", () => {
    expect(vurderFjerning(node(null), lagFjernPlan(MELK))).toEqual({ utfall: "borte" });
    expect(vurderFjerning({}, lagFjernPlan(MELK))).toEqual({ utfall: "borte" });
    expect(vurderFjerning(null, lagFjernPlan(MELK))).toEqual({ utfall: "borte" });
  });

  it.each([
    ["mengde", { amount: "3" }, /mengde 2 → 3/],
    ["varekobling", { itemId: "v-melk-2" }, /varekobling er byttet/],
    ["varekobling fjernet", { itemId: null }, /varekobling koblet → ingen/],
    ["fullførtstatus", { done: true }, /status ikke fullført → fullført/],
    ["navn", { name: "Lettmelk" }, /navn «Melk» → «Lettmelk»/],
    ["kategori", { cat: "Diverse" }, /kategori Ost og meieri → Diverse/],
  ])("endret %s: konflikt som viser endringen, ingenting fjernes", (_n, endring, tekst) => {
    const u = vurderFjerning(node({ ...MELK, ...endring }), lagFjernPlan(MELK));
    expect(u.utfall).toBe("konflikt");
    expect((u as { grunn: string }).grunn).toMatch(tekst);
    expect((u as { grunn: string }).grunn).toMatch(/Den er ikke fjernet/);
  });

  it("reservert nøkkel, uventet form på raden eller noden: konflikt", () => {
    expect(vurderFjerning(node(), { id: "_ops", sett: lagFjernPlan(MELK).sett }).utfall).toBe(
      "konflikt",
    );
    expect(vurderFjerning({ m: "tekst" }, lagFjernPlan(MELK)).utfall).toBe("konflikt");
    expect(vurderFjerning("tekst", lagFjernPlan(MELK)).utfall).toBe("konflikt");
  });
});
