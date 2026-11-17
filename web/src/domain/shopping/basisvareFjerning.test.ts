import { describe, expect, it } from "vitest";
import { basisvareMaal } from "./basisvare";
import { erFjernbarBasisvare, vurderBasisvareFjerning } from "./basisvareFjerning";

describe("vurderBasisvareFjerning (Mat #20, ordre 6948538722)", () => {
  it("bare eksakt `true` fjernes; manglende er borte; alt annet står", () => {
    expect(vurderBasisvareFjerning(true)).toBe("fjern");
    expect(vurderBasisvareFjerning(null)).toBe("borte");
    expect(vurderBasisvareFjerning(undefined)).toBe("borte");
    for (const v of [false, "true", 1, {}, { x: 1 }, { ".value": true, ".priority": 1 }, [true]]) {
      expect(vurderBasisvareFjerning(v), JSON.stringify(v)).toBe("erstattet");
    }
  });
});

describe("erFjernbarBasisvare og basisvareMaal", () => {
  it("gyldig `true` på én nøkkel er fjernbar; nøkkelen normaliseres aldri", () => {
    expect(erFjernbarBasisvare("melk", true)).toBe(true);
    expect(erFjernbarBasisvare("Crème Fraîche", true)).toBe(true);
    expect(basisvareMaal("Crème Fraîche")).toEqual({ ok: true, nokkel: "Crème Fraîche" });
  });

  it("uventet verdi eller ugyldig nøkkel er ikke fjernbar", () => {
    for (const v of [false, "ja", { x: 1 }, null])
      expect(erFjernbarBasisvare("melk", v)).toBe(false);
    for (const k of ["", " ", "a/b", "a.b", "a\u0007", "x".repeat(769)]) {
      expect(erFjernbarBasisvare(k, true), k).toBe(false);
    }
  });
});
