import { describe, expect, it } from "vitest";
import { kontoNokkel, parseSaldokontroller, saldokontrollPath } from "./saldokontroller.repository";

describe("saldokontroller.repository (ren form)", () => {
  it("lager trygge nøkler og deterministiske stier", () => {
    expect(kontoNokkel("felleskonto")).toBe("felleskonto");
    expect(kontoNokkel("1234.56.78901")).toBe("1234_56_78901");
    expect(kontoNokkel("a/b#c$d[e]")).toBe("a_b_c_d_e_");
    expect(saldokontrollPath("familie1", "MC", "2026-09")).toBe(
      "families/familie1/saldokontroller/MC/2026-09",
    );
  });

  it("flater ut noden, beholder original konto og hopper over ugyldige poster", () => {
    expect(
      parseSaldokontroller({
        "1234_56_78901": {
          "2026-09": { konto: "1234.56.78901", maaned: "2026-09", faktiskSaldo: 10 },
        },
        felleskonto: {
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
