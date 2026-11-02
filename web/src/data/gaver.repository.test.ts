import { describe, expect, it } from "vitest";
import { flett, parseGaver, parsePersoner, skrivIdFor } from "./gaver.repository";

describe("gaver.repository (uten emulator)", () => {
  it("flett bevarer ukjente felt, setter stier og sletter med undefined", () => {
    const raa = {
      navn: "A",
      ukjent: { x: 1 },
      unntak: { bursdag: { aktiv: false }, jul: { aktiv: true } },
    };
    expect(flett(raa, { navn: "B", "unntak/jul": undefined, notat: "n" })).toEqual({
      navn: "B",
      ukjent: { x: 1 },
      unntak: { bursdag: { aktiv: false } },
      notat: "n",
    });
    expect(raa.unntak.jul).toEqual({ aktiv: true });
  });

  it("flett avviser null", () => {
    expect(() => flett({}, { notat: null })).toThrow(/null/);
  });

  it("skrivId er stabil for samme endring og grunnlag, ulik ellers", () => {
    const a = skrivIdFor("gaver", "g1", "1", { status: "kjopt", planlagtOre: 0 });
    expect(skrivIdFor("gaver", "g1", "1", { planlagtOre: 0, status: "kjopt" })).toBe(a);
    expect(skrivIdFor("gaver", "g1", "2", { status: "kjopt", planlagtOre: 0 })).not.toBe(a);
    expect(skrivIdFor("gaver", "g1", "1", { status: "gitt", planlagtOre: 0 })).not.toBe(a);
    expect(skrivIdFor("gaver", "g1", "1", { status: "kjopt", planlagtOre: undefined })).not.toBe(a);
  });

  it("parsing hopper over ugyldige poster og godtar ikke ukjent gruppe eller negativt beløp", () => {
    expect(
      parsePersoner({
        a: { navn: "A", gruppe: "naer" },
        b: { navn: "", gruppe: "naer" },
        c: { navn: "C", gruppe: "x" },
      }).map((p) => p.id),
    ).toEqual(["a"]);
    const [g] = parseGaver({ g: { personId: "p", tekst: "t", status: "rart", planlagtOre: -5 } });
    expect(g).toMatchObject({ status: "ide" });
    expect(g!.planlagtOre).toBeUndefined();
  });
});
