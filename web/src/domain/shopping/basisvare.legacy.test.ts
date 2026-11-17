/**
 * #20 (ordre 6939332384): legacy-generatorens «Ja, basisvare» bruker samme
 * én-nøkkel-kontrakt som React. Legacy `basisvareNokkel` (ordrett fra
 * `index.html`) og `basisvareNokkel` i `basisvare.ts` kjøres side om side på
 * samme navn; et avvik feiler testen. Syntetiske navn.
 */
import { describe, expect, it } from "vitest";
import { loadLegacy } from "../../test/legacy";
import { type BasisvareNokkel, basisvareNokkel } from "./basisvare";
import { vurderBasisvareMerking } from "./basisvareMerking";

const legacy = loadLegacy<{
  basisvareNokkel: (navn: unknown) => BasisvareNokkel;
  basisvareUgyldigTekst: (grunn: string) => string;
  vurderBasisvareMerking: (eksport: unknown) => string;
}>({ functions: ["basisvareNokkel", "basisvareUgyldigTekst", "vurderBasisvareMerking"] });

const NAVN = [
  "Melk",
  "Rømme",
  "ÆØÅ-mel",
  "Lettmelk 1 %",
  "Ost (norvegia)",
  "  Mel  ",
  "İnfo",
  "Egg 🥚",
  "Melk/Lett",
  "/",
  "Ca. 2 dl fløte",
  "#1",
  "$",
  "[a]",
  "Salt\u0007",
  "Tab\tinni",
  "Linje\nskift",
  "Slett\u007f",
  "",
  "   ",
  "a".repeat(768),
  "a".repeat(769),
  "ø".repeat(384),
  "ø".repeat(385),
  " ",
];

describe("legacy basisvareNokkel = React basisvareNokkel", () => {
  it.each(NAVN.map((n) => [JSON.stringify(n).slice(0, 40), n]))("%s", (_, navn) => {
    expect(legacy.basisvareNokkel(navn)).toEqual(basisvareNokkel(navn));
  });

  it("gyldige navn gir samme nøkkel som før (navnet med små bokstaver)", () => {
    for (const navn of ["Melk", "Rømme", "Ost (norvegia)", "  Mel  "]) {
      expect(legacy.basisvareNokkel(navn)).toEqual({ ok: true, nokkel: navn.toLowerCase() });
    }
  });

  it("skråstrek, punktum, kontrolltegn, blankt og for langt avvises", () => {
    expect(legacy.basisvareNokkel("Melk/Lett")).toEqual({ ok: false, grunn: "ugyldige_tegn" });
    expect(legacy.basisvareNokkel("Ca. 2 dl")).toEqual({ ok: false, grunn: "ugyldige_tegn" });
    expect(legacy.basisvareNokkel("Salt\u0007")).toEqual({ ok: false, grunn: "ugyldige_tegn" });
    expect(legacy.basisvareNokkel(" ")).toEqual({ ok: false, grunn: "tomt" });
    expect(legacy.basisvareNokkel("a".repeat(769))).toEqual({ ok: false, grunn: "for_langt" });
  });

  it("manglende navn (ikke tekst) avvises som tomt i legacy", () => {
    expect(legacy.basisvareNokkel(undefined)).toEqual({ ok: false, grunn: "tomt" });
  });

  it("beskjeden sier at ingenting er lagret og at varen fortsatt er utelatt", () => {
    for (const grunn of ["tomt", "ugyldige_tegn", "for_langt"]) {
      const tekst = legacy.basisvareUgyldigTekst(grunn);
      expect(tekst).toContain("kan ikke lagres som basisvare");
      expect(tekst).toContain("Ingenting er lagret.");
      expect(tekst).toContain("fortsatt utelatt fra denne handlelisten");
    }
  });
});

describe("legacy vurderBasisvareMerking = React vurderBasisvareMerking (ordre 6958807274)", () => {
  it.each(
    [
      null,
      undefined,
      true,
      false,
      "true",
      1,
      {},
      { ukjent: "råfelt" },
      { ".value": true, ".priority": 3 },
      { ".value": true, ".priority": 1, x: 1 },
      { ".value": false, ".priority": 1 },
      [true],
    ].map((v) => [JSON.stringify(v) ?? "undefined", v]),
  )("%s", (_, v) => {
    expect(legacy.vurderBasisvareMerking(v)).toBe(vurderBasisvareMerking(v));
  });
});
