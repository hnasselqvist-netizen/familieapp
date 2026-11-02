import { describe, expect, it } from "vitest";
import type { Anledning, Person } from "@app-types/gaver";
import {
  budsjettEndring,
  fjernMottakerEndring,
  gaveEndring,
  gruppeStandardEndring,
  leggTilMottakerEndring,
  mottakerBudsjettEndring,
  personEndring,
  tilVerdi,
} from "./endringer";

const T = "2026-11-02T10:00:00.000Z";
const person: Person = {
  id: "p1",
  navn: "A",
  gruppe: "naer",
  unntak: {},
  versjon: 1,
  opprettet: T,
  oppdatert: T,
};

describe("endringer — bare feltene skjemaet eier", () => {
  it("budsjett: arv sletter bare kjente felt; 0 og ikke satt er eksplisitte", () => {
    expect(budsjettEndring("b", { type: "arv" })).toEqual({
      "b/type": undefined,
      "b/belopOre": undefined,
    });
    expect(budsjettEndring("b", undefined)).toEqual({
      "b/type": undefined,
      "b/belopOre": undefined,
    });
    expect(budsjettEndring("b", { type: "ikke_satt" })).toEqual({
      "b/type": "ikke_satt",
      "b/belopOre": undefined,
    });
    expect(budsjettEndring("b", { type: "belop", belopOre: 0 })).toEqual({
      "b/type": "belop",
      "b/belopOre": 0,
    });
  });

  it("person: patcher unntak/jul feltvis, aldri hele objektet", () => {
    const e = personEndring({
      navn: " A ",
      gruppe: "venner",
      jul: { aktiv: false, budsjett: { type: "belop", belopOre: 0 } },
    });
    expect(e).toEqual({
      navn: "A",
      gruppe: "venner",
      fodselsdato: undefined,
      notat: undefined,
      "unntak/jul/aktiv": false,
      "unntak/jul/budsjett/type": "belop",
      "unntak/jul/budsjett/belopOre": 0,
    });
    expect(Object.keys(e)).not.toContain("unntak/jul");
    expect(Object.keys(e)).not.toContain("unntak");
  });

  it("gruppestandard og mottakerbudsjett er feltvise", () => {
    expect(gruppeStandardEndring({ aktiv: true, budsjett: { type: "ikke_satt" } })).toEqual({
      "standard/jul/aktiv": true,
      "standard/jul/budsjett/type": "ikke_satt",
      "standard/jul/budsjett/belopOre": undefined,
    });
    expect(mottakerBudsjettEndring("p1", { type: "belop", belopOre: 500 })).toEqual({
      "mottakere/p1/budsjett/type": "belop",
      "mottakere/p1/budsjett/belopOre": 500,
    });
    expect(fjernMottakerEndring("p1", T)).toEqual({ "mottakere/p1/fjernet": T });
  });

  it("mottaker: tilbake sletter bare «fjernet»; ny får arvet budsjett", () => {
    const anl: Anledning = {
      id: "jul-2026",
      type: "jul",
      aar: 2026,
      mottakere: { p1: { budsjett: { type: "belop", belopOre: 100 }, fjernet: T } },
      versjon: 1,
      opprettet: T,
      oppdatert: T,
    };
    expect(leggTilMottakerEndring(anl, person, {})).toEqual({ "mottakere/p1/fjernet": undefined });
    expect(leggTilMottakerEndring({ ...anl, mottakere: {} }, person, {})).toEqual({
      "mottakere/p1/budsjett/type": "ikke_satt",
      "mottakere/p1/budsjett/belopOre": undefined,
    });
  });

  it("gave: valgt bare for idé; løpende idé uten anledning", () => {
    expect(
      gaveEndring({ personId: "p1", tekst: "Bok", status: "kjopt", valgt: true }),
    ).toMatchObject({
      valgt: undefined,
      anledningId: undefined,
    });
    expect(gaveEndring({ personId: "p1", tekst: "Bok", status: "ide", valgt: true }).valgt).toBe(
      true,
    );
  });

  it("tilVerdi bygger objekter av stier og utelater sletting", () => {
    expect(
      tilVerdi({
        navn: "A",
        notat: undefined,
        "unntak/jul/aktiv": false,
        "unntak/jul/budsjett/type": "belop",
        "unntak/jul/budsjett/belopOre": 0,
      }),
    ).toEqual({
      navn: "A",
      unntak: { jul: { aktiv: false, budsjett: { type: "belop", belopOre: 0 } } },
    });
  });
});
