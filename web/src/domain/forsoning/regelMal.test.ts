/**
 * Endre koblet målpost på en regel (#59, 6543518396 / 6643098967).
 * Syntetiske data.
 */
import { describe, expect, it } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { RegelRecord } from "@app-types/forsoning";
import {
  endreRegelMal,
  finnRegelMal,
  malNokkel,
  regelMalNokkel,
  regelMalValg,
  sokRegelMal,
} from "./regelMal";

const NAA = "2026-11-04T22:00:00.000Z";
const post = (id: string, name: string, arkivert = false) => ({
  id,
  name,
  months: Array(12).fill(0),
  ...(arkivert ? { meta: { arkivert: true } } : {}),
});
const gruppe = (id: string, label: string, items: ReturnType<typeof post>[]) =>
  ({ id, label, items }) as unknown as BudsjettGruppe;

const GRUPPER = {
  budgetGroups: [
    gruppe("mat", "Mat og dagligvarer", [post("dagligvarer", "Dagligvarer")]),
    gruppe("fritid", "Fritid", [post("hobby", "Hobby"), post("gammel", "Gammel", true)]),
    gruppe("bolig", "Bolig", [post("vedlikehold-bolig", "Vedlikehold")]),
  ],
  incomeGroups: [gruppe("lonn", "Lønn", [post("lonn-helen", "Lønn")])],
  sparingGroups: [gruppe("generell", "Generell sparing", [post("buffer", "Buffer")])],
};

const REGEL: RegelRecord = {
  id: "r1",
  pattern: "OpenAI",
  normalizedPattern: "openai",
  matchType: "starter_med",
  kontoVilkar: "MC",
  eiere: [{ person: "Helen", prosent: 100 }],
  targetType: "budget",
  targetId: "dagligvarer",
  targetName: "Dagligvarer",
  targetGruppe: "Mat og dagligvarer",
  mode: "review",
  confidence: 80,
  multiUse: true,
  active: false,
  timesUsed: 7,
  lastMatched: "2026-10-01T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const ANNEN: RegelRecord = { ...REGEL, id: "r2", pattern: "REMA", normalizedPattern: "rema" };
const FRA = { type: "budget" as const, id: "dagligvarer" };

describe("målvalg fra dagens struktur", () => {
  it("aktive poster i kostnad, inntekt og sparing; arkiverte er ikke valg", () => {
    expect(regelMalValg(GRUPPER).map(malNokkel)).toEqual([
      "budget:dagligvarer",
      "budget:hobby",
      "budget:vedlikehold-bolig",
      "income:lonn-helen",
      "sparing:buffer",
    ]);
  });

  it("like navn på ulike steder skilles med type + id", () => {
    const g = {
      ...GRUPPER,
      sparingGroups: [gruppe("hus", "Bolig", [post("vedlikehold-spar", "Vedlikehold")])],
    };
    const vedlikehold = regelMalValg(g).filter((m) => m.navn === "Vedlikehold");
    expect(vedlikehold.map(malNokkel)).toEqual([
      "budget:vedlikehold-bolig",
      "sparing:vedlikehold-spar",
    ]);
    expect(finnRegelMal(g, { type: "budget", id: "vedlikehold-spar" })).toBeNull();
  });

  it("søk i post, livsområde og type", () => {
    const valg = regelMalValg(GRUPPER);
    expect(sokRegelMal(valg, "fritid").map((m) => m.id)).toEqual(["hobby"]);
    expect(sokRegelMal(valg, "inntekt").map((m) => m.id)).toEqual(["lonn-helen"]);
    expect(sokRegelMal(valg, "SPARING").map((m) => m.id)).toEqual(["buffer"]);
    expect(sokRegelMal(valg, "  ")).toHaveLength(5);
  });

  it("eldre regel uten targetType regnes som kostnad", () => {
    expect(regelMalNokkel({ targetId: "x" } as RegelRecord)).toBe("budget:x");
  });
});

describe("endreRegelMal", () => {
  it("én sammenhengende endring; alle andre felt og andre regler er urørt", () => {
    const { regler, utfall } = endreRegelMal(
      [REGEL, ANNEN],
      "r1",
      FRA,
      { type: "budget", id: "hobby" },
      GRUPPER,
      NAA,
    );
    expect(utfall).toEqual({
      status: "lagret",
      mal: { type: "budget", id: "hobby", navn: "Hobby", gruppe: "Fritid" },
    });
    expect(regler[0]).toEqual({
      ...REGEL,
      targetType: "budget",
      targetId: "hobby",
      targetName: "Hobby",
      targetGruppe: "Fritid",
      updatedAt: NAA,
    });
    expect(regler[1]).toBe(ANNEN);
  });

  it("inntekt og sparing: type, navn og livsområde fra strukturen", () => {
    for (const [til, forventet] of [
      [
        { type: "income", id: "lonn-helen" },
        { targetName: "Lønn", targetGruppe: "Lønn" },
      ],
      [
        { type: "sparing", id: "buffer" },
        { targetName: "Buffer", targetGruppe: "Generell sparing" },
      ],
    ] as const) {
      const { regler, utfall } = endreRegelMal([REGEL], "r1", FRA, til, GRUPPER, NAA);
      expect(utfall.status).toBe("lagret");
      expect(regler[0]).toMatchObject({ targetType: til.type, targetId: til.id, ...forventet });
    }
  });

  it("gruppebytte etterlater aldri et foreldet livsområde", () => {
    const utenEtikett = {
      ...GRUPPER,
      incomeGroups: [gruppe("x", "", [post("annen-inntekt", "Annen inntekt")])],
    };
    const { regler } = endreRegelMal(
      [REGEL],
      "r1",
      FRA,
      { type: "income", id: "annen-inntekt" },
      utenEtikett,
      NAA,
    );
    expect(regler[0]).not.toHaveProperty("targetGruppe");
    expect(regler[0]).toMatchObject({ targetType: "income", targetName: "Annen inntekt" });
  });

  it("slettet regel: ingen gjenoppretting, tydelig utfall", () => {
    const { regler, utfall } = endreRegelMal(
      [ANNEN],
      "r1",
      FRA,
      { type: "budget", id: "hobby" },
      GRUPPER,
      NAA,
    );
    expect(utfall).toEqual({ status: "regel_slettet" });
    expect(regler).toEqual([ANNEN]);
  });

  it("ugyldig mål: slettet, arkivert eller feil type gir feil og ingen endring", () => {
    for (const til of [
      { type: "budget", id: "finnes-ikke" },
      { type: "budget", id: "gammel" },
      { type: "income", id: "hobby" },
    ] as const) {
      const { regler, utfall } = endreRegelMal([REGEL], "r1", FRA, til, GRUPPER, NAA);
      expect(utfall).toEqual({ status: "mal_ugyldig" });
      expect(regler).toEqual([REGEL]);
    }
  });

  it("samtidig endring av målet hos en annen skriver: ingenting skrives", () => {
    const endretAvAndre = { ...REGEL, targetId: "vedlikehold-bolig", targetName: "Vedlikehold" };
    const { regler, utfall } = endreRegelMal(
      [endretAvAndre],
      "r1",
      FRA,
      { type: "budget", id: "hobby" },
      GRUPPER,
      NAA,
    );
    expect(utfall).toEqual({
      status: "endret_samtidig",
      naa: { targetType: "budget", targetId: "vedlikehold-bolig", targetName: "Vedlikehold" },
    });
    expect(regler).toEqual([endretAvAndre]);
  });

  it("samtidige endringer av andre felt bevares (beregnes mot fersk liste)", () => {
    const fersk = { ...REGEL, confidence: 55, eiere: [{ person: "Eivind", prosent: 100 }] };
    const { regler } = endreRegelMal(
      [fersk],
      "r1",
      FRA,
      { type: "budget", id: "hobby" },
      GRUPPER,
      NAA,
    );
    expect(regler[0]).toMatchObject({
      confidence: 55,
      eiere: [{ person: "Eivind", prosent: 100 }],
      targetId: "hobby",
    });
  });

  describe("samme type, id og navn, men annet livsområde (review 5776966235)", () => {
    const flyttet = {
      ...GRUPPER,
      budgetGroups: [gruppe("ny", "Ny gruppe", [post("dagligvarer", "Dagligvarer")])],
    };
    const utenEtikett = {
      ...GRUPPER,
      budgetGroups: [gruppe("x", "", [post("dagligvarer", "Dagligvarer")])],
    };

    it("flyttet eller omdøpt livsområde lagres; ingenting annet endres", () => {
      const { regler, utfall } = endreRegelMal([REGEL], "r1", FRA, FRA, flyttet, NAA);
      expect(utfall).toMatchObject({ status: "lagret", mal: { gruppe: "Ny gruppe" } });
      expect(regler[0]).toEqual({ ...REGEL, targetGruppe: "Ny gruppe", updatedAt: NAA });
    });

    it("fjernet livsområde fjerner gruppefeltet", () => {
      const { regler, utfall } = endreRegelMal([REGEL], "r1", FRA, FRA, utenEtikett, NAA);
      expect(utfall.status).toBe("lagret");
      const forventet: RegelRecord = { ...REGEL };
      delete forventet.targetGruppe;
      expect(regler[0]).toEqual({ ...forventet, updatedAt: NAA });
      expect(regler[0]).not.toHaveProperty("targetGruppe");
      // Når alt stemmer etterpå, er det genuint uendret.
      expect(endreRegelMal(regler, "r1", FRA, FRA, utenEtikett, NAA).utfall).toEqual({
        status: "uendret",
      });
    });

    it("tomt gruppefelt på regelen med tom struktur-etikett fjernes også", () => {
      const tomt = { ...REGEL, targetGruppe: "" };
      const { regler, utfall } = endreRegelMal([tomt], "r1", FRA, FRA, utenEtikett, NAA);
      expect(utfall.status).toBe("lagret");
      expect(regler[0]).not.toHaveProperty("targetGruppe");
    });

    it("omdøpt post (samme id) lagres med nytt navn", () => {
      const omdopt = {
        ...GRUPPER,
        budgetGroups: [gruppe("mat", "Mat og dagligvarer", [post("dagligvarer", "Mat")])],
      };
      const { regler } = endreRegelMal([REGEL], "r1", FRA, FRA, omdopt, NAA);
      expect(regler[0]).toMatchObject({ targetName: "Mat", targetGruppe: "Mat og dagligvarer" });
    });
  });

  it("samme mål og samme navn: uendret, ingen skriving", () => {
    const { regler, utfall } = endreRegelMal([REGEL], "r1", FRA, FRA, GRUPPER, NAA);
    expect(utfall).toEqual({ status: "uendret" });
    expect(regler).toEqual([REGEL]);
  });

  it("gjentatt lagring av samme endring er idempotent (ny lagring gir «uendret»)", () => {
    const til = { type: "budget" as const, id: "hobby" };
    const forste = endreRegelMal([REGEL], "r1", FRA, til, GRUPPER, NAA);
    const andre = endreRegelMal(forste.regler, "r1", FRA, til, GRUPPER, "2026-11-05T00:00:00Z");
    expect(andre.utfall).toEqual({ status: "uendret" });
    expect(andre.regler).toEqual(forste.regler);
  });
});
