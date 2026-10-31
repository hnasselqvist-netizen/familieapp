import { describe, expect, it } from "vitest";
import type { KontrollRad } from "./kontrollrader";
import {
  TOMT_RESULTAT,
  antallAllerede,
  frysTreff,
  leggTil,
  medBegrensetSamtidighet,
  vurderTreff,
} from "./massekontroll";
import type { Kontrollstatus } from "./kvalitetssikring";

const rad = (id: string, grunnlag: string, status: Kontrollstatus = "ikke_kontrollert") =>
  ({
    id,
    tekst: id.toUpperCase(),
    kontroll: { status, grunnlag, gjeldende: null },
  }) as unknown as KontrollRad;

describe("massekontroll (#59, 6544393790)", () => {
  it("frosset sett er uavhengig av senere endringer i radene", () => {
    const utvalg = [rad("a", "g1"), rad("b", "g2")];
    const frosne = frysTreff(utvalg);
    (utvalg[0]!.kontroll as { grunnlag: string }).grunnlag = "endret";
    utvalg.push(rad("c", "g3"));
    expect(frosne.map((f) => [f.rad.id, f.rad.kontroll.grunnlag])).toEqual([
      ["a", "g1"],
      ["b", "g2"],
    ]);
  });

  it("vurdering mot dagens rad: skriv, allerede, endret (nytt grunnlag eller borte)", () => {
    const [f] = frysTreff([rad("a", "g1")]);
    expect(vurderTreff(f!, rad("a", "g1"))).toBe("skriv");
    expect(vurderTreff(f!, rad("a", "g1", "endret_etter_kontroll"))).toBe("skriv");
    expect(vurderTreff(f!, rad("a", "g1", "kvalitetssikret"))).toBe("allerede");
    expect(vurderTreff(f!, rad("a", "g2"))).toBe("endret");
    expect(vurderTreff(f!, rad("a", "g2", "kvalitetssikret"))).toBe("endret");
    expect(vurderTreff(f!, undefined)).toBe("endret");
  });

  it("teller allerede kvalitetssikrede og samler det som ikke ble kontrollert", () => {
    expect(antallAllerede([rad("a", "g", "kvalitetssikret"), rad("b", "g")])).toBe(1);
    const [a, b, c] = frysTreff([rad("a", "g"), rad("b", "g"), rad("c", "g")]);
    let r = leggTil(TOMT_RESULTAT, a!, "kontrollert");
    r = leggTil(r, b!, "endret");
    r = leggTil(r, c!, "feilet");
    expect(r).toEqual({
      kontrollert: 1,
      allerede: 0,
      endret: 1,
      feilet: 1,
      ikkeKontrollert: [
        { id: "b", tekst: "B", utfall: "endret" },
        { id: "c", tekst: "C", utfall: "feilet" },
      ],
    });
  });

  it("begrenset samtidighet: alle kjøres, aldri flere enn grensen samtidig", async () => {
    let iGang = 0;
    let maks = 0;
    const kjort: number[] = [];
    await medBegrensetSamtidighet([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (n) => {
      iGang++;
      maks = Math.max(maks, iGang);
      await new Promise((r) => setTimeout(r, 1));
      kjort.push(n);
      iGang--;
    });
    expect(kjort.sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(maks).toBe(4);
  });
});
