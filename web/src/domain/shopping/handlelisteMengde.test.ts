import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "@app-types/shopping";
import {
  lagMengdePlan,
  lesMengde,
  normaliserMengde,
  synligMengde,
  vurderMengde,
} from "./handlelisteMengde";

const MELK: ShoppingItem = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};
const node = (m: Record<string, unknown> | null = { ...MELK }) => ({ m, _ops: { r: 1 } });
const plan = (ny: string, foer = "2") => lagMengdePlan(MELK, foer, ny);

describe("normaliserMengde / synligMengde", () => {
  it("dagens semantikk: manglende og null er tom, tall som tekst, annet er uleselig", () => {
    expect(normaliserMengde(undefined)).toBe("");
    expect(normaliserMengde(null)).toBe("");
    expect(normaliserMengde("")).toBe("");
    expect(normaliserMengde(" 2 l")).toBe(" 2 l");
    expect(normaliserMengde(3)).toBe("3");
    expect(normaliserMengde({ x: 1 })).toBeNull();
    expect(normaliserMengde(true)).toBeNull();
    expect(synligMengde({ ...MELK, amount: 4 as unknown as string })).toBe("4");
  });
});

describe("vurderMengde", () => {
  it("uendret førverdi: sett; allerede utkastet: skrivefri `allerede`", () => {
    expect(vurderMengde(node(), plan("25"))).toEqual({ utfall: "sett" });
    expect(vurderMengde(node({ ...MELK, amount: "25" }), plan("25"))).toEqual({
      utfall: "allerede",
    });
  });

  it("endret mengde siden førverdien: konflikt som viser endringen, utkastet står", () => {
    const u = vurderMengde(node({ ...MELK, amount: "3" }), plan("25"));
    expect(u).toEqual({
      utfall: "konflikt",
      grunn:
        "Mengden på «Melk» er endret på en annen enhet («2» → «3») mens du redigerte. Mengden er ikke lagret — utkastet ditt står.",
    });
    expect(vurderMengde(node({ ...MELK, amount: "" }), plan("25"))).toMatchObject({
      grunn: expect.stringMatching(/«2» → ingen/),
    });
  });

  it("urelaterte felt, historikk og ukjente felt hindrer ikke", () => {
    expect(
      vurderMengde(
        node({ ...MELK, cat: "Diverse", done: true, sammenslaing: { opId: "x" }, ukjent: 1 }),
        plan("25"),
      ),
    ).toEqual({ utfall: "sett" });
  });

  it("manglende og tom mengde er samme verdi; tom mengde er gyldig å lagre", () => {
    const uten: Record<string, unknown> = { ...MELK };
    delete uten.amount;
    expect(vurderMengde(node(uten), plan("1", ""))).toEqual({ utfall: "sett" });
    expect(vurderMengde(node(uten), plan("", ""))).toEqual({ utfall: "allerede" });
    expect(vurderMengde(node(), plan(""))).toEqual({ utfall: "sett" });
  });

  it("borte, erstattet og uleselig mengde: aldri sett", () => {
    expect(vurderMengde(node(null), plan("25"))).toEqual({ utfall: "borte" });
    expect(vurderMengde(node({ ...MELK, name: "Egg" }), plan("25"))).toMatchObject({
      utfall: "konflikt",
      grunn: expect.stringMatching(/nå «Egg».*utkastet ditt står/),
    });
    expect(vurderMengde(node({ ...MELK, itemId: "v-annen" }), plan("25")).utfall).toBe("konflikt");
    expect(vurderMengde(node({ ...MELK, amount: { x: 1 } }), plan("25")).utfall).toBe("konflikt");
    expect(vurderMengde(node(), { ...plan("25"), id: "_ops" }).utfall).toBe("konflikt");
    expect(vurderMengde("tekst", plan("25")).utfall).toBe("konflikt");
  });
});

describe("lesMengde (skrivefri, identitetsbundet kontroll)", () => {
  it("samme rad: mengden nå; erstattet, uleselig og borte skilles", () => {
    expect(lesMengde(node({ ...MELK, amount: "25" }), plan("25"))).toEqual({
      utfall: "lest",
      mengde: "25",
    });
    expect(lesMengde(node({ ...MELK, name: "Egg", amount: "25" }), plan("25"))).toEqual({
      utfall: "erstattet",
      grunn: "«Melk» er endret på en annen enhet (nå «Egg»).",
    });
    expect(lesMengde(node({ ...MELK, amount: [1] }), plan("25"))).toEqual({
      utfall: "misformet",
    });
    expect(lesMengde(node(null), plan("25"))).toEqual({ utfall: "borte" });
  });
});
