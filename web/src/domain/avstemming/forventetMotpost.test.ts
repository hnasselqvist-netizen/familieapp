import { describe, expect, it } from "vitest";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { TransaksjonRecord } from "@app-types/forsoning";
import { bekreftInternOverforing } from "@domain/forsoning/internOverforing";
import {
  avstemmingsoversikt,
  kontoerIAvstemming,
  maanedskontroll,
  muligeKilderForMotpost,
  sisteDagIMaaned,
  vurderKontoMaaned,
} from "./saldoavstemming";
import {
  aktivForventetMotpost,
  angreForventetMotpost,
  importerteMotposter,
  kobleTilImportertMotpost,
  leggTilForventetMotpost,
  vurderAngringForventet,
  vurderDublettMerking,
  vurderForventetMotpost,
  vurderKoblingTilImportert,
} from "./saldokorrigering";

/**
 * Intern overføring der motposten mangler (#59, 6097180478 / 6097196546).
 * Låser Helens juli-funn: 20.07 «DNB BANK ASA» ut 25 000 fra Regningskonto
 * til MC var feilmerket som dublett, og MC-motposten ble aldri importert.
 * Regningskonto skal avstemmes uavhengig av MC; MC skal få en tydelig
 * avledet motpost som aldri gir et bankverifisert «avstemt».
 */
const NAA = "2026-10-10T12:00:00.000Z";
const SENERE = "2026-10-10T13:00:00.000Z";

function tx(o: Partial<TransaksjonRecord> & { id: string }): TransaksjonRecord {
  return {
    dato: "2026-07-20",
    tekst: "DNB BANK ASA",
    belop: 25000,
    retning: "ut",
    konto: "regningskonto",
    status: "ny",
    ...o,
  };
}

const kontroll = (konto: string, maaned: string, faktiskSaldo: number): SaldoKontroll => ({
  konto,
  maaned,
  dato: sisteDagIMaaned(maaned),
  faktiskSaldo,
  registrert: NAA,
  oppdatert: NAA,
});

/** Regningskonto 30.06: 60 000 → 31.07: 34 000. MC skyldig 30.06: 40 000 → 31.07: 15 000. */
const KONTROLLER = [
  kontroll("regningskonto", "2026-06", 60000),
  kontroll("regningskonto", "2026-07", 34000),
  kontroll("MC", "2026-06", -40000),
  kontroll("MC", "2026-07", -15000),
];

function scenario(): TransaksjonRecord[] {
  return [
    tx({ id: "r1", status: "ignorert", ignorertSom: "dublett" }),
    tx({ id: "r2", dato: "2026-07-05", tekst: "Strøm", belop: 1000 }),
    tx({ id: "m1", dato: "2026-07-12", tekst: "REMA 1000", belop: 0, konto: "MC" }),
  ];
}

const finn = (l: TransaksjonRecord[], id: string) => l.find((t) => t.id === id)!;
const vurder = (l: TransaksjonRecord[], konto: string, maaned = "2026-07") =>
  vurderKontoMaaned(l, KONTROLLER, konto, maaned);

describe("avledet motpost: Helens juli-scenario", () => {
  it("før: Regningskonto og MC har begge avvik", () => {
    const l = scenario();
    expect(vurder(l, "regningskonto").status).toBe("avvik");
    expect(vurder(l, "regningskonto").differanseOre).toBe(-2_500_000);
    expect(vurder(l, "MC").status).toBe("avvik");
  });

  it("etter: kilden teller på Regningskonto, MC stemmer bare med avledet motpost", () => {
    const etter = leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA)(scenario());
    const r = vurder(etter, "regningskonto");
    expect(r.status).toBe("avstemt");
    expect(r.grunnlag.avledede.antall).toBe(0);
    const mc = vurder(etter, "MC");
    // MC-fortegn: utbetaling fra Regningskonto er innbetaling på MC, gjelden går ned.
    expect(mc.grunnlag.avledede.nettoOre).toBe(2_500_000);
    expect(mc.grunnlag.nettoOre).toBe(0);
    expect(mc.beregnetOre).toBe(-1_500_000);
    expect(mc.differanseOre).toBe(0);
    expect(mc.status).toBe("avstemt_avledet");
    const o = avstemmingsoversikt(etter, KONTROLLER, new Date(2026, 7, 15), { fra: "2026-07" });
    expect(maanedskontroll(o, "2026-07")).toMatchObject({ avstemte: 1, avledet: 1, totalt: 2 });
  });

  it("kilden blir intern overføring uten motpost; tidligere tilstand og logg er sporbar", () => {
    const foer = scenario();
    const etter = leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA)(foer);
    const r1 = finn(etter, "r1");
    expect(r1).toMatchObject({
      status: "behandlet",
      behandlingstype: "intern_overforing",
      forventetMotpost: { konto: "MC", dato: "2026-07-20", bekreftet: NAA },
    });
    expect(r1.ignorertSom).toBeUndefined();
    expect(r1.motpartTransaksjonId).toBeUndefined();
    expect(r1.hendelseId).toBeUndefined();
    expect(r1.saldoKorrigering).toMatchObject({
      type: "forventet_motpost",
      tidligere: { status: "ignorert", ignorertSom: "dublett", behandlingstype: null },
    });
    expect(r1.korrigeringslogg).toEqual([
      expect.objectContaining({ handling: "motpost_avledet", tidspunkt: NAA }),
    ]);
    // Ingen syntetisk transaksjon, og ingen andre endret.
    expect(etter).toHaveLength(foer.length);
    expect(finn(etter, "r2")).toBe(finn(foer, "r2"));
    expect(finn(etter, "m1")).toBe(finn(foer, "m1"));
    expect(JSON.stringify(etter)).not.toContain("undefined");
  });

  it("MC vises i avstemmingen også uten egne bevegelser", () => {
    const l = [tx({ id: "r1", status: "ignorert", ignorertSom: "bankbevegelse" })];
    expect(kontoerIAvstemming(l, [])).toEqual(["regningskonto"]);
    const etter = leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA)(l);
    expect(kontoerIAvstemming(etter, [])).toEqual(["MC", "regningskonto"]);
  });

  it("inn på kilden gir ut på motkontoen", () => {
    const l = [tx({ id: "i1", retning: "inn", konto: "felleskonto", status: "ny" })];
    const etter = leggTilForventetMotpost("i1", "helen", "2026-07-20", NAA)(l);
    const v = vurderKontoMaaned(etter, [], "helen", "2026-07");
    expect(v.grunnlag.avledede.poster[0]).toMatchObject({ retning: "ut", nettoOre: -2_500_000 });
  });
});

describe("avledet motpost: gyldighet", () => {
  it("nekter egen konto, ukjent konto og dato utenfor 0–5 dager etter kilden", () => {
    const l = scenario();
    expect(leggTilForventetMotpost("r1", "regningskonto", "2026-07-20", NAA)(l)).toBe(l);
    expect(leggTilForventetMotpost("r1", "?", "2026-07-20", NAA)(l)).toBe(l);
    expect(leggTilForventetMotpost("r1", "", "2026-07-20", NAA)(l)).toBe(l);
    expect(leggTilForventetMotpost("r1", "MC", "2026-07-19", NAA)(l)).toBe(l);
    expect(leggTilForventetMotpost("r1", "MC", "2026-07-26", NAA)(l)).toBe(l);
    expect(leggTilForventetMotpost("r1", "MC", "20.07.2026", NAA)(l)).toBe(l);
    expect(leggTilForventetMotpost("r1", "MC", "2026-07-25", NAA)(l)).not.toBe(l);
  });

  it("nekter plassert, kvitteringsmatchet, allerede koblet og ukjent konto", () => {
    const grunn = (o: Partial<TransaksjonRecord>) => {
      const v = vurderForventetMotpost(tx({ id: "k", ...o }));
      return v.kan ? null : v.grunn;
    };
    expect(grunn({ hendelseId: "h1" })).toMatch(/plassert i budsjettet/);
    expect(grunn({ matchetMot: "kv1" })).toMatch(/kvittering/);
    expect(grunn({ motpartTransaksjonId: "x" })).toMatch(/allerede koblet/);
    expect(grunn({ konto: null })).toMatch(/ingen kjent konto/);
    for (const o of [{ hendelseId: "h1" }, { matchetMot: "kv1" }, { motpartTransaksjonId: "x" }]) {
      const l = [tx({ id: "k", ...o })];
      expect(leggTilForventetMotpost("k", "MC", "2026-07-20", NAA)(l)).toBe(l);
    }
  });

  it("stables ikke: aktiv dublett-merking eller avledet motpost må angres først", () => {
    const merket = tx({
      id: "d",
      status: "ignorert",
      ignorertSom: "dublett",
      saldoKorrigering: {
        type: "dublett",
        tidligere: {
          status: "ny",
          behandlingstype: null,
          motpartTransaksjonId: null,
          ignorertSom: null,
        },
        etter: {
          status: "ignorert",
          behandlingstype: null,
          motpartTransaksjonId: null,
          ignorertSom: "dublett",
          hendelseId: null,
          matchetMot: null,
        },
        arsakId: null,
        tidspunkt: NAA,
      },
    });
    expect(vurderForventetMotpost(merket)).toMatchObject({ kan: false });
    const etter = leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA)(scenario());
    expect(leggTilForventetMotpost("r1", "felleskonto", "2026-07-20", SENERE)(etter)).toBe(etter);
    const v = vurderDublettMerking(finn(etter, "r1"), etter);
    expect(v.kan ? null : v.grunn).toMatch(/avledet motpost\. Angre den først/);
  });
});

describe("avledet motpost: datosemantikk", () => {
  it("en overføring 31.07 kan dateres 02.08 på MC og telles da i august", () => {
    const l = [tx({ id: "r1", dato: "2026-07-31", belop: 7412.91 })];
    const etter = leggTilForventetMotpost("r1", "MC", "2026-08-02", NAA)(l);
    expect(vurderKontoMaaned(etter, [], "MC", "2026-07").grunnlag.avledede.antall).toBe(0);
    expect(vurderKontoMaaned(etter, [], "MC", "2026-08").grunnlag.avledede).toMatchObject({
      antall: 1,
      nettoOre: 741_291,
    });
    // Kildens dato flyttes aldri: utbetalingen hører til juli på Regningskonto.
    expect(vurderKontoMaaned(etter, [], "regningskonto", "2026-07").grunnlag.utOre).toBe(741_291);
  });
});

describe("avledet motpost: senere import av den ekte motposten", () => {
  const medAvledet = () => leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA)(scenario());
  const ekte = tx({
    id: "mc25",
    dato: "2026-07-21",
    tekst: "Innbetaling",
    retning: "inn",
    konto: "MC",
  });

  it("en importert kandidat gjør MC usikker, og ingenting telles to ganger", () => {
    const l = [...medAvledet(), ekte];
    const mc = vurder(l, "MC");
    expect(mc.grunnlag.nettoOre).toBe(2_500_000);
    expect(mc.grunnlag.avledede.antall).toBe(0);
    expect(mc.grunnlag.avledetMedKandidat).toHaveLength(1);
    expect(mc.grunnlag.avledetMedKandidat[0]!.kandidater.map((t) => t.id)).toEqual(["mc25"]);
    expect(mc.beregnetOre).toBe(-1_500_000);
    expect(mc.status).toBe("usikker");
  });

  it("kandidaten må være ukoblet, på MC, motsatt retning, likt beløp og innen 2 dager", () => {
    const kilde = finn(medAvledet(), "r1");
    const ikke = [
      { ...ekte, id: "a", retning: "ut" as const },
      { ...ekte, id: "b", belop: 25000.01 },
      { ...ekte, id: "c", konto: "felleskonto" },
      { ...ekte, id: "d", dato: "2026-07-25" },
      { ...ekte, id: "e", motpartTransaksjonId: "z" },
      { ...ekte, id: "f", status: "ignorert", ignorertSom: "dublett" as const },
    ];
    expect(importerteMotposter(kilde, [kilde, ...ikke])).toEqual([]);
    expect(importerteMotposter(kilde, [kilde, ekte]).map((t) => t.id)).toEqual(["mc25"]);
  });

  it("kobling gir et vanlig, gjensidig par; den avledede blir historikk og MC er avstemt", () => {
    const l = [...medAvledet(), ekte];
    const koblet = kobleTilImportertMotpost("r1", "mc25", SENERE)(l);
    const r1 = finn(koblet, "r1");
    const m = finn(koblet, "mc25");
    expect(r1.motpartTransaksjonId).toBe("mc25");
    expect(m).toMatchObject({
      status: "behandlet",
      behandlingstype: "intern_overforing",
      motpartTransaksjonId: "r1",
    });
    expect(r1.forventetMotpost).toMatchObject({ konto: "MC", erstattetAv: "mc25" });
    expect(r1.saldoKorrigering).toBeUndefined();
    expect(aktivForventetMotpost(r1)).toBeNull();
    expect(r1.korrigeringslogg?.map((k) => k.handling)).toEqual([
      "motpost_avledet",
      "motpost_erstattet",
    ]);
    expect(vurder(koblet, "MC").status).toBe("avstemt");
    expect(vurder(koblet, "regningskonto").status).toBe("avstemt");
  });

  it("nekter å koble en kandidat som er plassert i budsjettet", () => {
    const plassert = { ...ekte, hendelseId: "h9" };
    const l = [...medAvledet(), plassert];
    const v = vurderKoblingTilImportert(finn(l, "r1"), plassert, l);
    expect(v.kan ? null : v.grunn).toMatch(/plassert i budsjettet/);
    expect(kobleTilImportertMotpost("r1", "mc25", SENERE)(l)).toBe(l);
  });

  it("kobles paret i Transaksjoner i stedet, slutter den avledede å telle og låser ikke", () => {
    const l = bekreftInternOverforing([...medAvledet(), ekte], "mc25", "r1", SENERE);
    expect(vurder(l, "MC").grunnlag.avledede.antall).toBe(0);
    expect(vurder(l, "MC").grunnlag.avledetMedKandidat).toHaveLength(0);
    expect(vurderAngringForventet(finn(l, "r1"))).toMatchObject({ kan: false });
    expect(vurderDublettMerking(finn(l, "r1"), l)).toMatchObject({ kan: true });
  });
});

describe("avledet motpost: angring og integritet", () => {
  it("angring gjenoppretter nøyaktig forrige tilstand og fjerner den avledede", () => {
    const foer = scenario();
    const etter = leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA)(foer);
    const angret = angreForventetMotpost("r1", SENERE)(etter);
    const r1 = finn(angret, "r1");
    const { korrigeringslogg, updatedAt, ...resten } = r1;
    expect(resten).toEqual(finn(foer, "r1"));
    expect(updatedAt).toBe(SENERE);
    expect(korrigeringslogg?.map((k) => k.handling)).toEqual([
      "motpost_avledet",
      "motpost_avledet_angret",
    ]);
    expect(vurder(angret, "MC").status).toBe("avvik");
    expect(vurder(angret, "regningskonto").status).toBe("avvik");
  });

  it("angring nektes når kilden er endret siden (plassert)", () => {
    const etter = leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA)(scenario());
    const endret = etter.map((t) => (t.id === "r1" ? { ...t, hendelseId: "h1" } : t));
    expect(vurderAngringForventet(finn(endret, "r1"))).toMatchObject({ kan: false });
    expect(angreForventetMotpost("r1", SENERE)(endret)).toEqual(endret);
  });

  it("den avledede følger kilden: endret beløp følger med, slettet kilde fjerner den", () => {
    const etter = leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA)(scenario());
    const endret = etter.map((t) => (t.id === "r1" ? { ...t, belop: 25500 } : t));
    expect(vurder(endret, "MC").grunnlag.avledede.nettoOre).toBe(2_550_000);
    const slettet = etter.filter((t) => t.id !== "r1");
    expect(vurder(slettet, "MC").grunnlag.avledede.antall).toBe(0);
  });

  it("den avledede teller ikke hvis kilden ikke lenger er en intern overføring", () => {
    const etter = leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA)(scenario());
    const ignorert = etter.map((t) =>
      t.id === "r1" ? { ...t, status: "ignorert", behandlingstype: undefined } : t,
    );
    expect(vurder(ignorert, "MC").grunnlag.avledede.antall).toBe(0);
  });
});

describe("mulige kilder for en manglende motpost", () => {
  it("foreslår interne overføringer uten motpost og ignorerte på andre kontoer", () => {
    const l = [
      ...scenario(),
      tx({
        id: "o1",
        dato: "2026-07-31",
        belop: 7412.91,
        status: "behandlet",
        behandlingstype: "intern_overforing",
      }),
      tx({
        id: "p1",
        status: "behandlet",
        behandlingstype: "intern_overforing",
        motpartTransaksjonId: "p2",
      }),
      tx({
        id: "p2",
        konto: "felleskonto",
        retning: "inn",
        status: "behandlet",
        behandlingstype: "intern_overforing",
        motpartTransaksjonId: "p1",
      }),
      tx({ id: "aug", dato: "2026-08-01", status: "ignorert" }),
      tx({ id: "egen", konto: "MC", status: "ignorert" }),
    ];
    expect(muligeKilderForMotpost(l, "MC", "2026-07").map((t) => t.id)).toEqual(["r1", "o1"]);
    const etter = leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA)(l);
    expect(muligeKilderForMotpost(etter, "MC", "2026-07").map((t) => t.id)).toEqual(["o1"]);
  });
});
