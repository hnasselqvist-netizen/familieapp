import { describe, expect, it } from "vitest";
import {
  flett,
  flettEksport,
  fraEksport,
  parseGaver,
  parsePersoner,
  skrivIdFor,
} from "./gaver.repository";

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

  it("flett avviser null, også nestet og i arrays, med sti", () => {
    expect(() => flett({}, { notat: null })).toThrow("notat");
    expect(() => flett({}, { "unntak/jul": { budsjett: null } })).toThrow("unntak/jul/budsjett");
    expect(() => flett({}, { liste: [1, { a: null }] })).toThrow("liste/1/a");
    expect(() => flett({}, { x: { y: undefined } })).toThrow("x/y");
    expect(() => flett({}, { tall: Number.NaN })).toThrow("tall");
    // Eksplisitt undefined som hele verdien på en endringssti er sletting.
    expect(flett({ a: 1, b: 2 }, { a: undefined })).toEqual({ b: 2 });
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

  it("parseGaver: kjøpsdato leses bare som «YYYY-MM-DD» (helårsoversikten)", () => {
    const gaver = parseGaver({
      a: { personId: "p", tekst: "t", status: "gitt", kjopsdato: "2025-12-28" },
      b: { personId: "p", tekst: "t", status: "gitt", kjopsdato: "28.12.2025" },
      c: { personId: "p", tekst: "t", status: "gitt", kjopsdato: 20251228 },
    });
    expect(gaver.find((g) => g.id === "a")!.kjopsdato).toBe("2025-12-28");
    expect(gaver.find((g) => g.id === "b")!.kjopsdato).toBeUndefined();
    expect(gaver.find((g) => g.id === "c")!.kjopsdato).toBeUndefined();
  });
});

describe("parseGaver og status (#20, ordre 7005959850)", () => {
  const raa = (status: unknown) => ({ g1: { personId: "p", tekst: "x", status, versjon: 2 } });
  it("«pakket» og alle eldre kjente statuser leses tilbake uendret", () => {
    for (const s of ["ide", "kjopt", "pakket", "gitt"]) {
      expect(parseGaver(raa(s))[0]!.status).toBe(s);
    }
  });
  it("en ukjent status vises som idé i denne versjonen (ikke tapsfritt: se vakt på skriving)", () => {
    expect(parseGaver(raa("levert"))[0]!.status).toBe("ide");
    expect(parseGaver(raa(undefined))[0]!.status).toBe("ide");
  });
});

describe("eksportform for endrePost (#20, ordre 7013713991)", () => {
  const POST = {
    ".priority": "rot",
    tekst: { ".value": "Bok", ".priority": 3 },
    status: "kjopt",
    fremtidig: {
      ".priority": 9,
      a: 1,
      b: { ".priority": "nb", c: { ".value": 2, ".priority": 7 } },
    },
    mottakere: { pA: { ".priority": 5, budsjett: { ".priority": 6, type: "belop", belopOre: 1 } } },
    liste: [{ ".value": "x", ".priority": 1 }, "y"],
  };

  it("fraEksport gir verdiformen: uten prioriteter, innpakkede verdier pakket ut", () => {
    expect(fraEksport(POST)).toEqual({
      tekst: "Bok",
      status: "kjopt",
      fremtidig: { a: 1, b: { c: 2 } },
      mottakere: { pA: { budsjett: { type: "belop", belopOre: 1 } } },
      liste: ["x", "y"],
    });
    expect(fraEksport(null)).toBeNull();
    expect(fraEksport({ ".value": 4, ".priority": 1 })).toBe(4);
  });

  it("flettEksport berører bare stiene i endringen; alle andre prioriteter står", () => {
    const ut = flettEksport(POST, { status: "gitt", versjon: 2 });
    expect(ut).toEqual({ ...POST, status: "gitt", versjon: 2 });
  });

  it("et erstattet blad eller objekt beholder sin prioritet og underfeltenes som består", () => {
    expect(flettEksport(POST, { tekst: "Ny" }).tekst).toEqual({ ".value": "Ny", ".priority": 3 });
    expect(flettEksport(POST, { "fremtidig/b/c": 5 }).fremtidig).toEqual({
      ".priority": 9,
      a: 1,
      b: { ".priority": "nb", c: { ".value": 5, ".priority": 7 } },
    });
    expect(
      flettEksport(POST, { "mottakere/pA/budsjett": { type: "ikke_satt" } }).mottakere,
    ).toEqual({ pA: { ".priority": 5, budsjett: { ".priority": 6, type: "ikke_satt" } } });
  });

  it("sletting fjerner feltet; en node uten barn fjernes som i RTDB; manglende sti er en no-op", () => {
    expect(flettEksport(POST, { tekst: undefined })).not.toHaveProperty("tekst");
    expect(flettEksport(POST, { "fremtidig/b/c": undefined }).fremtidig).toEqual({
      ".priority": 9,
      a: 1,
    });
    expect(flettEksport(POST, { "finnes/ikke": undefined })).toEqual(POST);
  });

  it("ny nøstet sti under et blad med prioritet: objekt med bladets prioritet", () => {
    expect(flettEksport(POST, { "tekst/del": "x" }).tekst).toEqual({ ".priority": 3, del: "x" });
  });

  it("validerer endringen og muterer ikke inndata", () => {
    const kopi = JSON.parse(JSON.stringify(POST));
    expect(() => flettEksport(POST, { status: null as unknown as string })).toThrow(/null/);
    flettEksport(POST, { status: "gitt", "fremtidig/b/c": 1 });
    expect(POST).toEqual(kopi);
  });
});
