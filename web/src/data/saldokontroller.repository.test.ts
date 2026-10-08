import { describe, expect, it } from "vitest";
import {
  kontoFraNokkel,
  kontoNokkel,
  parseSaldokontroller,
  saldokontrollPath,
} from "./saldokontroller.repository";

describe("saldokontroller.repository (ren form)", () => {
  it("nøkkelkodingen er injektiv: ulike kontoer gir aldri samme sti (6062856860)", () => {
    const kontoer = ["A.B", "A_B", "A-B", "A/B", "A#B", "A$B", "A[B]", "MC", "mc", "æøå", "", "_"];
    const nokler = kontoer.map(kontoNokkel);
    expect(new Set(nokler).size).toBe(kontoer.length);
    for (const n of nokler) expect(n).toMatch(/^k_[A-Za-z0-9_-]*$/);
    expect(kontoNokkel("A.B")).not.toBe(kontoNokkel("A_B"));
  });

  it("kodingen er tapsfri og deterministisk", () => {
    for (const k of ["felleskonto", "1234.56.78901", "Helen brukskonto", "æøå", "MC"]) {
      expect(kontoFraNokkel(kontoNokkel(k))).toBe(k);
      expect(kontoNokkel(k)).toBe(kontoNokkel(k));
    }
    expect(kontoFraNokkel("felleskonto")).toBeNull();
    expect(saldokontrollPath("familie1", "MC", "2026-09")).toBe(
      "families/familie1/saldokontroller/k_TUM/2026-09",
    );
  });

  it("flater ut noden, beholder original konto og hopper over ugyldige poster", () => {
    expect(
      parseSaldokontroller({
        [kontoNokkel("1234.56.78901")]: {
          "2026-09": { konto: "1234.56.78901", maaned: "2026-09", faktiskSaldo: 10 },
        },
        [kontoNokkel("felleskonto")]: {
          "2026-08": { faktiskSaldo: -5, dato: "2026-08-31", grunnlag: { antall: 2, nettoOre: 7 } },
          "2026-07": { dato: "mangler saldo" },
        },
      }),
    ).toEqual([
      {
        konto: "1234.56.78901",
        maaned: "2026-09",
        dato: "",
        faktiskSaldo: 10,
        registrert: "",
        oppdatert: "",
      },
      {
        konto: "felleskonto",
        maaned: "2026-08",
        dato: "2026-08-31",
        faktiskSaldo: -5,
        registrert: "",
        oppdatert: "",
        grunnlag: { antall: 2, nettoOre: 7 },
      },
    ]);
    expect(parseSaldokontroller(null)).toEqual([]);
  });
});
