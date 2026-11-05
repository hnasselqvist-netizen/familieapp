/** Basisvarenøkkel (#20, ordre 6651329875). Syntetiske navn. */
import { describe, expect, it } from "vitest";
import { basisvareNokkel, erBasisvare } from "./basisvare";

describe("basisvareNokkel", () => {
  it("samme normalisering som generatoren: bare små bokstaver, ingen ny koding", () => {
    expect(basisvareNokkel("Melk")).toEqual({ ok: true, nokkel: "melk" });
    expect(basisvareNokkel("MELK")).toEqual({ ok: true, nokkel: "melk" });
    expect(basisvareNokkel("Rømme 18 %")).toEqual({ ok: true, nokkel: "rømme 18 %" });
    expect(basisvareNokkel("Smør, usaltet")).toEqual({ ok: true, nokkel: "smør, usaltet" });
  });

  it("tomme navn og navn bare med mellomrom avvises", () => {
    expect(basisvareNokkel("")).toEqual({ ok: false, grunn: "tomt" });
    expect(basisvareNokkel("   ")).toEqual({ ok: false, grunn: "tomt" });
  });

  it("RTDB-forbudte tegn, skråstrek og kontrolltegn avvises — aldri undernoder", () => {
    for (const navn of [
      "salt/pepper",
      "/",
      "a.b",
      "#1",
      "$pris",
      "[x]",
      "olje]",
      "linje\nskift",
      "tab\t",
      "slett\u007f",
    ]) {
      expect(basisvareNokkel(navn), navn).toEqual({ ok: false, grunn: "ugyldige_tegn" });
    }
  });

  it("over 768 byte avvises (UTF-8, ikke tegn)", () => {
    expect(basisvareNokkel("a".repeat(768)).ok).toBe(true);
    expect(basisvareNokkel("a".repeat(769))).toEqual({ ok: false, grunn: "for_langt" });
    expect(basisvareNokkel("ø".repeat(385))).toEqual({ ok: false, grunn: "for_langt" });
  });
});

describe("erBasisvare", () => {
  it("leser eksisterende nøkkel uavhengig av store/små bokstaver", () => {
    expect(erBasisvare("Melk", { melk: true })).toBe(true);
    expect(erBasisvare("melk", { Melk: true } as Record<string, true>)).toBe(false);
    expect(erBasisvare("salt/pepper", { salt: true })).toBe(false);
  });
});
