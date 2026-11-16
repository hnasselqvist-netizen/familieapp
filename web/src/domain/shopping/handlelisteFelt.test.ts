import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "@app-types/shopping";
import { lagFeltPlan, lesFelt, normaliserFelt, synligFelt, vurderFelt } from "./handlelisteFelt";

const MELK: ShoppingItem = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};
const node = (m: Record<string, unknown> | null = { ...MELK }) => ({ m, _ops: { r: 1 } });
const navn = (ny: string, rad: ShoppingItem = MELK) => lagFeltPlan(rad, "name", rad.name, ny);
const kat = (ny: string, rad: ShoppingItem = MELK) =>
  lagFeltPlan(rad, "cat", synligFelt(rad, "cat"), ny);

describe("normaliserFelt / synligFelt", () => {
  it("dagens semantikk: manglende/null kategori er «Diverse»; navn må være tekst", () => {
    expect(normaliserFelt("cat", undefined)).toBe("Diverse");
    expect(normaliserFelt("cat", null)).toBe("Diverse");
    expect(normaliserFelt("cat", "Snacks")).toBe("Snacks");
    expect(normaliserFelt("cat", 3)).toBeNull();
    expect(normaliserFelt("name", "")).toBe("");
    expect(normaliserFelt("name", undefined)).toBeNull();
    expect(synligFelt({ ...MELK, cat: undefined as unknown as string }, "cat")).toBe("Diverse");
  });
});

describe("vurderFelt", () => {
  it("uendret grunnlag: sett; allerede lagret verdi: skrivefri `allerede`", () => {
    expect(vurderFelt(node(), navn("Helmelk"))).toEqual({ utfall: "sett" });
    expect(vurderFelt(node({ ...MELK, name: "Helmelk" }), navn("Helmelk"))).toEqual({
      utfall: "allerede",
    });
    expect(vurderFelt(node(), kat("Drikke"))).toEqual({ utfall: "sett" });
    expect(vurderFelt(node(), kat("Ost og meieri"))).toEqual({ utfall: "allerede" });
  });

  it("samme felt endret: konflikt som viser endringen", () => {
    expect(vurderFelt(node({ ...MELK, name: "Lettmelk" }), navn("Helmelk"))).toEqual({
      utfall: "konflikt",
      grunn:
        "Navnet på «Melk» er endret på en annen enhet («Melk» → «Lettmelk») mens du redigerte. Ingenting er lagret.",
    });
    expect(vurderFelt(node({ ...MELK, cat: "Drikke" }), kat("Diverse"))).toMatchObject({
      utfall: "konflikt",
      grunn: expect.stringMatching(/«Ost og meieri» → «Drikke»/),
    });
  });

  it("urelaterte felt, historikk og ukjente felt hindrer ikke", () => {
    const annet = { ...MELK, amount: "9", done: true, sammenslaing: { opId: "x" }, ukjent: 1 };
    expect(vurderFelt(node(annet), navn("Helmelk"))).toEqual({ utfall: "sett" });
    expect(vurderFelt(node({ ...annet, cat: "Ost og meieri" }), kat("Drikke"))).toEqual({
      utfall: "sett",
    });
  });

  it("kategori på rad med varekobling: nytt navn er samme vare; uten varekobling er det konflikt", () => {
    expect(vurderFelt(node({ ...MELK, name: "Lettmelk" }), kat("Drikke"))).toEqual({
      utfall: "sett",
    });
    const uten = { ...MELK, itemId: null };
    expect(vurderFelt(node({ ...uten, name: "Egg" }), kat("Drikke", uten))).toMatchObject({
      utfall: "konflikt",
      grunn: expect.stringMatching(/nå «Egg»/),
    });
  });

  it("erstattet vare, borte rad og uleselige verdier: aldri sett", () => {
    expect(vurderFelt(node({ ...MELK, itemId: "v-egg" }), navn("Helmelk"))).toMatchObject({
      utfall: "konflikt",
      grunn: expect.stringMatching(/varekoblingen er byttet/),
    });
    expect(vurderFelt(node(null), kat("Drikke"))).toEqual({ utfall: "borte" });
    expect(vurderFelt(node({ ...MELK, cat: 5 }), kat("Drikke")).utfall).toBe("konflikt");
    expect(vurderFelt(node(), { ...kat("Drikke"), id: "_ops" }).utfall).toBe("konflikt");
    expect(vurderFelt("tekst", kat("Drikke")).utfall).toBe("konflikt");
  });
});

describe("lesFelt (skrivefri, identitetsbundet kontroll)", () => {
  it("feltet nå; erstattet, uleselig og borte skilles", () => {
    expect(lesFelt(node({ ...MELK, name: "Helmelk" }), navn("Helmelk"))).toEqual({
      utfall: "lest",
      verdi: "Helmelk",
    });
    expect(lesFelt(node({ ...MELK, itemId: "v-egg", cat: "Drikke" }), kat("Drikke"))).toEqual({
      utfall: "erstattet",
      grunn: "«Melk» er endret på en annen enhet (varekoblingen er byttet).",
    });
    expect(lesFelt(node({ ...MELK, cat: [1] }), kat("Drikke"))).toEqual({ utfall: "misformet" });
    expect(lesFelt(node(null), navn("Helmelk"))).toEqual({ utfall: "borte" });
  });
});
