/**
 * «Legg til» med målpost valgt ved commit (#20, ordre 6698904630). Rene
 * domenetester av regelen som kjøres inne i samlingstransaksjonen; selve
 * transaksjonen testes mot emulatoren i
 * `src/data/freezer.maalvalg.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { FreezerBatch, FreezerSamling } from "@app-types/freezer";
import { leggTilVedCommit, maalvalgTekst, observertMaal } from "./freezer";

const vare = { id: "v-ny", name: "Kjøttdeig" };
const ny: FreezerBatch = { id: "nb", count: 2, unit: "pk", gramsPerUnit: 400 };
const ukjentFelt = { sted: "kjoleskap", merknad: "fra legacy" };

const grunn = (): FreezerSamling => ({
  leg1: {
    id: "leg1",
    itemId: "v-gammel",
    name: "kjøttdeig",
    batches: [{ id: "b1", count: 1, unit: "pk", gramsPerUnit: 400 }],
    ...ukjentFelt,
  } as never,
  annen: {
    itemId: "v-laks",
    name: "Laks",
    batches: [{ id: "l1", count: 3, unit: "stk", gramsPerUnit: null }],
  },
});

describe("leggTilVedCommit", () => {
  it("ett ferskt treff uten observert mål: bruker den faktiske node-id-en, bevarer ukjente felt og itemId, slår sammen ferskt", () => {
    const før = grunn();
    const r = leggTilVedCommit(før, vare, ny, null, "ny-node");
    expect("samling" in r && r.maalId).toBe("leg1");
    if (!("samling" in r)) return;
    expect(Object.keys(r.samling).sort()).toEqual(["annen", "leg1"]);
    expect(r.samling.leg1).toEqual({
      id: "leg1",
      itemId: "v-gammel", // konkurrerende varebase-id bytter ikke koblingen
      name: "kjøttdeig",
      batches: [{ id: "b1", count: 3, unit: "pk", gramsPerUnit: 400 }],
      ...ukjentFelt,
    });
    expect(r.samling.annen).toBe(før.annen);
    expect(før).toEqual(grunn()); // ingen mutasjon
  });

  it("setter itemId bare når posten mangler den", () => {
    const s: FreezerSamling = { p: { name: "Kjøttdeig", batches: [] } as never };
    const r = leggTilVedCommit(s, vare, ny, null, "x");
    expect("samling" in r && r.samling.p).toEqual({
      name: "Kjøttdeig",
      itemId: "v-ny",
      batches: [ny],
    });
  });

  it("ny batch med annen enhet legges til, uten ny post", () => {
    const r = leggTilVedCommit(
      grunn(),
      vare,
      { ...ny, unit: "boks", gramsPerUnit: null },
      null,
      "x",
    );
    expect("samling" in r && r.samling.leg1?.batches.map((b) => b.unit)).toEqual(["pk", "boks"]);
  });

  it("ingen treff: oppretter én ny node", () => {
    const r = leggTilVedCommit(grunn(), { id: "v-e", name: "Erter" }, ny, null, "ny-node");
    expect(r).toMatchObject({ maalId: "ny-node", ny: true });
    expect("samling" in r && r.samling["ny-node"]).toEqual({
      itemId: "v-e",
      name: "Erter",
      batches: [ny],
    });
  });

  it("tom eller manglende samling: oppretter én ny node", () => {
    const r = leggTilVedCommit(null, vare, ny, null, "n");
    expect("samling" in r && r.samling).toEqual({
      n: { itemId: "v-ny", name: "Kjøttdeig", batches: [ny] },
    });
  });

  it("flere ferske treff: avvisning, ingen ny verdi", () => {
    const s = { ...grunn(), dup: { itemId: "v-ny", name: "KJØTTDEIG", batches: [] } };
    expect(leggTilVedCommit(s, vare, ny, null, "x")).toEqual({
      avvisning: { type: "flere-treff", navn: "Kjøttdeig", antall: 2 },
    });
    expect(leggTilVedCommit(s, vare, ny, "leg1", "x")).toEqual({
      avvisning: { type: "flere-treff", navn: "Kjøttdeig", antall: 2 },
    });
  });

  it("observert mål slettet: konflikt, selv om en annen navnelik post finnes", () => {
    const s = grunn();
    expect(leggTilVedCommit(s, vare, ny, "borte", "x")).toEqual({
      avvisning: { type: "observert-slettet", navn: "Kjøttdeig" },
    });
  });

  it("observert mål omdøpt: konflikt, ikke tillegg under feil vare", () => {
    const s = grunn();
    s.leg1 = { ...s.leg1!, name: "Kyllingdeig" };
    expect(leggTilVedCommit(s, vare, ny, "leg1", "x")).toEqual({
      avvisning: { type: "observert-omdopt", navn: "Kjøttdeig", nyttNavn: "Kyllingdeig" },
    });
  });

  it("observert mål finnes og er eneste treff: brukes", () => {
    expect(leggTilVedCommit(grunn(), vare, ny, "leg1", "x")).toMatchObject({
      maalId: "leg1",
      ny: false,
    });
  });

  it("ny node-id som alt finnes (uten navnetreff): avvisning", () => {
    expect(leggTilVedCommit(grunn(), { id: "v-e", name: "Erter" }, ny, null, "annen")).toEqual({
      avvisning: { type: "id-kollisjon", navn: "Erter" },
    });
  });

  it("navneregelen er dagens: bare case-insensitiv likhet, ingen trimming eller fuzzy", () => {
    const r = leggTilVedCommit(grunn(), { id: "v", name: "Kjøttdeig " }, ny, null, "n");
    expect(r).toMatchObject({ maalId: "n", ny: true });
  });

  it("poster uten navn ignoreres i navnesøket", () => {
    const s: FreezerSamling = { rar: { batches: [] } as never };
    expect(leggTilVedCommit(s, vare, ny, null, "n")).toMatchObject({ maalId: "n", ny: true });
  });
});

describe("observertMaal", () => {
  const items = [
    { id: "a", itemId: "1", name: "Laks", batches: [] },
    { id: "b", itemId: "2", name: "Erter", batches: [] },
    { id: "c", itemId: "3", name: "erter", batches: [] },
  ];
  it("eneste lokale treff er observert mål", () => expect(observertMaal(items, "LAKS")).toBe("a"));
  it("ingen treff gir null", () => expect(observertMaal(items, "Brød")).toBeNull());
  it("flere lokale treff gir null (avgjøres ferskt ved commit)", () =>
    expect(observertMaal(items, "Erter")).toBeNull());
});

describe("maalvalgTekst", () => {
  it("sier alltid at ingenting er lagret", () => {
    for (const a of [
      { type: "flere-treff", navn: "X", antall: 2 },
      { type: "observert-slettet", navn: "X" },
      { type: "observert-omdopt", navn: "X", nyttNavn: "Y" },
      { type: "id-kollisjon", navn: "X" },
    ] as const) {
      expect(maalvalgTekst(a)).toContain("Ingenting er lagret");
    }
  });
});
