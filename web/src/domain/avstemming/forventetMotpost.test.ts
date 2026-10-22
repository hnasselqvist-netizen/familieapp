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
  avsluttForventetMotpost,
  bekreftForventetMotpostPaaNytt,
  importerteMotposter,
  kobleTilImportertMotpost,
  kildeavtrykk,
  leggTilForventetMotpost,
  vurderAngringForventet,
  vurderAvslutningForventet,
  vurderDublettMerking,
  vurderForventetMotpost,
  vurderKoblingTilImportert,
  vurderNyBekreftelse,
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

/** Slik UI-en bekrefter: mot kilden slik den vises (ferske data). */
const leggTil =
  (id: string, konto: string, dato: string, naa: string) =>
  (prev: TransaksjonRecord[]): TransaksjonRecord[] => {
    const t = prev.find((x) => x.id === id);
    return t ? leggTilForventetMotpost(id, konto, dato, naa, kildeavtrykk(t))(prev) : prev;
  };
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
    const etter = leggTil("r1", "MC", "2026-07-20", NAA)(scenario());
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
    const etter = leggTil("r1", "MC", "2026-07-20", NAA)(foer);
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
    const etter = leggTil("r1", "MC", "2026-07-20", NAA)(l);
    expect(kontoerIAvstemming(etter, [])).toEqual(["MC", "regningskonto"]);
  });

  it("inn på kilden gir ut på motkontoen", () => {
    const l = [tx({ id: "i1", retning: "inn", konto: "felleskonto", status: "ny" })];
    const etter = leggTil("i1", "helen", "2026-07-20", NAA)(l);
    const v = vurderKontoMaaned(etter, [], "helen", "2026-07");
    expect(v.grunnlag.avledede.poster[0]).toMatchObject({ retning: "ut", nettoOre: -2_500_000 });
  });
});

describe("avledet motpost: gyldighet", () => {
  it("nekter egen konto, ukjent konto og dato utenfor 0–5 dager etter kilden", () => {
    const l = scenario();
    expect(leggTil("r1", "regningskonto", "2026-07-20", NAA)(l)).toBe(l);
    expect(leggTil("r1", "?", "2026-07-20", NAA)(l)).toBe(l);
    expect(leggTil("r1", "", "2026-07-20", NAA)(l)).toBe(l);
    expect(leggTil("r1", "MC", "2026-07-19", NAA)(l)).toBe(l);
    expect(leggTil("r1", "MC", "2026-07-26", NAA)(l)).toBe(l);
    expect(leggTil("r1", "MC", "20.07.2026", NAA)(l)).toBe(l);
    expect(leggTil("r1", "MC", "2026-07-25", NAA)(l)).not.toBe(l);
  });

  it("motkontoen må være en kjent kanonisk konto, ikke bare noe annet enn kilden", () => {
    const l = scenario();
    for (const konto of ["sparekonto", "alle", "Regningskonto", " MC", "mc", "dnb", "krav "]) {
      expect(leggTil("r1", konto, "2026-07-20", NAA)(l)).toBe(l);
    }
    for (const konto of ["MC", "felleskonto", "helen", "eivind", "krav"]) {
      const etter = leggTil("r1", konto, "2026-07-20", NAA)(l);
      expect(finn(etter, "r1").forventetMotpost?.konto).toBe(konto);
    }
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
      expect(leggTil("k", "MC", "2026-07-20", NAA)(l)).toBe(l);
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
    const etter = leggTil("r1", "MC", "2026-07-20", NAA)(scenario());
    expect(leggTil("r1", "felleskonto", "2026-07-20", SENERE)(etter)).toBe(etter);
    const v = vurderDublettMerking(finn(etter, "r1"), etter);
    expect(v.kan ? null : v.grunn).toMatch(/avledet motpost\. Angre den først/);
  });
});

describe("avledet motpost: datosemantikk", () => {
  it("en overføring 31.07 kan dateres 02.08 på MC og telles da i august", () => {
    const l = [tx({ id: "r1", dato: "2026-07-31", belop: 7412.91 })];
    const etter = leggTil("r1", "MC", "2026-08-02", NAA)(l);
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
  const medAvledet = () => leggTil("r1", "MC", "2026-07-20", NAA)(scenario());
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

  it("kobles paret i Transaksjoner i stedet, slutter den avledede å telle, men låser til den avsluttes", () => {
    const l = bekreftInternOverforing([...medAvledet(), ekte], "mc25", "r1", SENERE);
    expect(vurder(l, "MC").grunnlag.avledede.antall).toBe(0);
    expect(vurder(l, "MC").grunnlag.avledetMedKandidat).toHaveLength(0);
    expect(vurderAngringForventet(finn(l, "r1"))).toMatchObject({ kan: false });
    const v = vurderDublettMerking(finn(l, "r1"), l);
    expect(v.kan ? null : v.grunn).toMatch(/endret siden\. Avslutt den først/);
    const avsluttet = avsluttForventetMotpost("r1", SENERE)(l);
    expect(finn(avsluttet, "r1").motpartTransaksjonId).toBe("mc25");
    expect(vurderDublettMerking(finn(avsluttet, "r1"), avsluttet)).toMatchObject({ kan: true });
  });

  it("kobling til importert motpost bevarer korrigeringen den erstatter i loggen", () => {
    const l = [...medAvledet(), ekte];
    const korrigering = finn(l, "r1").saldoKorrigering;
    const koblet = kobleTilImportertMotpost("r1", "mc25", SENERE)(l);
    const siste = finn(koblet, "r1").korrigeringslogg!.at(-1)!;
    expect(siste.handling).toBe("motpost_erstattet");
    expect(siste.avsluttetKorrigering).toEqual(korrigering);
  });
});

describe("avledet motpost: angring og integritet", () => {
  it("angring gjenoppretter nøyaktig forrige tilstand og fjerner den avledede", () => {
    const foer = scenario();
    const etter = leggTil("r1", "MC", "2026-07-20", NAA)(foer);
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
    const etter = leggTil("r1", "MC", "2026-07-20", NAA)(scenario());
    const endret = etter.map((t) => (t.id === "r1" ? { ...t, hendelseId: "h1" } : t));
    expect(vurderAngringForventet(finn(endret, "r1"))).toMatchObject({ kan: false });
    expect(angreForventetMotpost("r1", SENERE)(endret)).toEqual(endret);
  });

  it("slettet kilde fjerner den avledede", () => {
    const etter = leggTil("r1", "MC", "2026-07-20", NAA)(scenario());
    const slettet = etter.filter((t) => t.id !== "r1");
    expect(vurder(slettet, "MC").grunnlag.avledede.antall).toBe(0);
    expect(vurder(slettet, "MC").grunnlag.avledetKildeEndret).toHaveLength(0);
  });

  it("den avledede teller ikke hvis kilden ikke lenger er en intern overføring", () => {
    const etter = leggTil("r1", "MC", "2026-07-20", NAA)(scenario());
    const ignorert = etter.map((t) =>
      t.id === "r1" ? { ...t, status: "ignorert", behandlingstype: undefined } : t,
    );
    expect(vurder(ignorert, "MC").grunnlag.avledede.antall).toBe(0);
  });
});

describe("avledet motpost endret i Transaksjoner, deretter nytt korrigeringsforsøk", () => {
  // Kontrolltårn-review av #75: en aktiv korrigering skal aldri overskrives
  // eller stables, heller ikke når den er endret utenfra.
  const avledet = () => leggTil("r1", "MC", "2026-07-20", NAA)(scenario());
  /** Transaksjoner gjør r1 til en vanlig, ubehandlet transaksjon igjen. */
  const endretITransaksjoner = () =>
    avledet().map((t) =>
      t.id === "r1" ? { ...t, status: "ny", behandlingstype: undefined, updatedAt: SENERE } : t,
    );

  it("nytt forsøk nektes, og den aktive korrigeringen står urørt", () => {
    const l = endretITransaksjoner();
    const foer = finn(l, "r1").saldoKorrigering;
    expect(leggTil("r1", "felleskonto", "2026-07-20", SENERE)(l)).toBe(l);
    const v = vurderDublettMerking(finn(l, "r1"), l);
    expect(v.kan ? null : v.grunn).toMatch(/endret siden\. Avslutt den først/);
    expect(vurderForventetMotpost(finn(l, "r1"))).toMatchObject({ kan: false });
    expect(finn(l, "r1").saldoKorrigering).toEqual(foer);
  });

  it("angring nektes; eksplisitt avslutning er eneste vei, og bare når den er endret", () => {
    expect(vurderAvslutningForventet(finn(avledet(), "r1"))).toMatchObject({ kan: false });
    expect(avsluttForventetMotpost("r1", SENERE)(avledet())).toEqual(avledet());
    const l = endretITransaksjoner();
    expect(vurderAngringForventet(finn(l, "r1"))).toMatchObject({ kan: false });
    expect(vurderAvslutningForventet(finn(l, "r1"))).toEqual({ kan: true });
    expect(vurderAvslutningForventet(finn(scenario(), "r1"))).toMatchObject({ kan: false });
  });

  it("avslutning bevarer all historikk og rører ikke tilstanden fra Transaksjoner", () => {
    const l = endretITransaksjoner();
    const foer = finn(l, "r1");
    const etter = finn(avsluttForventetMotpost("r1", "2026-10-10T14:00:00.000Z")(l), "r1");
    expect(etter.saldoKorrigering).toBeUndefined();
    expect(etter.status).toBe("ny");
    expect(etter.behandlingstype).toBeUndefined();
    expect(etter.forventetMotpost).toEqual({
      ...foer.forventetMotpost,
      avsluttet: "2026-10-10T14:00:00.000Z",
    });
    const logg = etter.korrigeringslogg!;
    expect(logg.map((k) => k.handling)).toEqual(["motpost_avledet", "motpost_avledet_avsluttet"]);
    expect(logg[1]!.avsluttetKorrigering).toEqual(foer.saldoKorrigering);
    expect(logg[1]!.detalj).toMatch(/før avledning: dublett; nå: status «ny»/);
  });

  it("etter avslutning kan en ny korrigering legges på, og forrige tilstand er riktig", () => {
    const avsluttet = avsluttForventetMotpost("r1", SENERE)(endretITransaksjoner());
    const ny = leggTil("r1", "felleskonto", "2026-07-21", SENERE)(avsluttet);
    const r1 = finn(ny, "r1");
    expect(r1.forventetMotpost).toMatchObject({ konto: "felleskonto", dato: "2026-07-21" });
    expect(r1.forventetMotpost?.avsluttet).toBeUndefined();
    expect(r1.saldoKorrigering?.tidligere).toMatchObject({ status: "ny", behandlingstype: null });
    expect(r1.korrigeringslogg?.map((k) => k.handling)).toEqual([
      "motpost_avledet",
      "motpost_avledet_avsluttet",
      "motpost_avledet",
    ]);
    const angret = finn(angreForventetMotpost("r1", SENERE)(ny), "r1");
    expect(angret.status).toBe("ny");
    expect(angret.behandlingstype).toBeUndefined();
  });

  it("en avsluttet avledet motpost teller ikke, selv om kilden fortsatt er en intern overføring", () => {
    const l = avledet().map((t) => (t.id === "r1" ? { ...t, matchetMot: "kv1" } : t));
    expect(vurder(l, "MC").grunnlag.avledede.antall).toBe(1);
    const avsluttet = avsluttForventetMotpost("r1", SENERE)(l);
    expect(aktivForventetMotpost(finn(avsluttet, "r1"))).toBeNull();
    expect(vurder(avsluttet, "MC").grunnlag.avledede.antall).toBe(0);
  });
});

describe("kilden endret etter bekreftelse (#75, Kontrolltårn-review 6348698518)", () => {
  // Bekreftelsen gjelder kilden slik Helen så den. Endres beløp, retning,
  // konto eller dato senere, skal den avledede IKKE stille få ny effekt:
  // den teller ikke, måneden blir usikker, og ny eksplisitt bekreftelse kreves.
  const bekreftet = () => leggTil("r1", "MC", "2026-07-20", NAA)(scenario());
  const endre = (o: Partial<TransaksjonRecord>) =>
    bekreftet().map((t) => (t.id === "r1" ? { ...t, ...o } : t));
  const bekreftPaaNytt = (
    l: TransaksjonRecord[],
    konto = "MC",
    dato = "2026-07-20",
    sett = kildeavtrykk(finn(l, "r1")),
  ) => bekreftForventetMotpostPaaNytt("r1", konto, dato, SENERE, sett)(l);

  it("bekreftelsen lagrer avtrykk av kilden: beløp i øre, retning, kanonisk konto og dato", () => {
    expect(finn(bekreftet(), "r1").forventetMotpost).toEqual({
      konto: "MC",
      dato: "2026-07-20",
      bekreftet: NAA,
      kilde: { belopOre: 2_500_000, retning: "ut", konto: "regningskonto", dato: "2026-07-20" },
    });
    expect(vurder(bekreftet(), "MC").status).toBe("avstemt_avledet");
  });

  const tilfeller: [string, Partial<TransaksjonRecord>, RegExp][] = [
    ["beløp", { belop: 25500 }, /beløp/],
    ["retning", { retning: "inn" }, /retning/],
    ["konto", { konto: "felleskonto" }, /konto/],
    ["dato innen måneden", { dato: "2026-07-19" }, /dato/],
  ];
  for (const [navn, endring, grunn] of tilfeller) {
    it(`${navn}: ingen stille ny saldoeffekt, MC er usikker, aldri avstemt`, () => {
      const l = endre(endring);
      const r1 = finn(l, "r1");
      expect(aktivForventetMotpost(r1)).toBeNull();
      const mc = vurder(l, "MC");
      expect(mc.grunnlag.avledede).toMatchObject({ antall: 0, nettoOre: 0 });
      expect(mc.grunnlag.avledetKildeEndret).toHaveLength(1);
      expect(mc.grunnlag.avledetKildeEndret[0]!.kildeEndret).toMatch(grunn);
      expect(mc.beregnetOre).toBe(-4_000_000);
      expect(mc.status).toBe("usikker");
      expect(vurderNyBekreftelse(r1)).toEqual({ kan: true });
    });
  }

  it("dato over månedsskiftet: kilden flyttet fra 31.07 til 01.08 gjør august usikker", () => {
    const l = leggTil("r1", "MC", "2026-08-02", NAA)([tx({ id: "r1", dato: "2026-07-31" })]);
    expect(vurderKontoMaaned(l, [], "MC", "2026-08").grunnlag.avledede.antall).toBe(1);
    const flyttet = l.map((t) => ({ ...t, dato: "2026-08-01" }));
    const aug = vurderKontoMaaned(flyttet, [], "MC", "2026-08").grunnlag;
    expect(aug.avledede.antall).toBe(0);
    expect(aug.avledetKildeEndret[0]!.kildeEndret).toMatch(/dato/);
    // Ny bekreftelse må ha en dato som er gyldig for kilden slik den er nå.
    const ok = bekreftPaaNytt(flyttet, "MC", "2026-08-02");
    expect(vurderKontoMaaned(ok, [], "MC", "2026-08").grunnlag.avledede.antall).toBe(1);
  });

  it("dato over månedsskiftet bakover: gammel motpostdato utenfor 0–5 dager nektes ved ny bekreftelse", () => {
    const flyttet = endre({ dato: "2026-06-30" });
    expect(vurder(flyttet, "MC").status).toBe("usikker");
    expect(bekreftPaaNytt(flyttet, "MC", "2026-07-20")).toBe(flyttet);
    const ny = bekreftPaaNytt(flyttet, "MC", "2026-07-01");
    expect(finn(ny, "r1").forventetMotpost).toMatchObject({ dato: "2026-07-01" });
    expect(vurder(ny, "MC").grunnlag.avledede.antall).toBe(1);
  });

  it("kildekonto som blir lik motkontoen eller ukjent gir aldri gyldig effekt uten ny, gyldig bekreftelse", () => {
    for (const konto of ["MC", "sparekonto", null]) {
      const l = endre({ konto });
      expect(aktivForventetMotpost(finn(l, "r1"))).toBeNull();
      expect(vurder(l, "MC").grunnlag.avledede.antall).toBe(0);
      expect(bekreftPaaNytt(l, "MC")).toBe(l);
    }
    // Ukjent kildekonto kan ikke bekreftes mot noe.
    for (const konto of ["sparekonto", null]) {
      const l = endre({ konto });
      expect(vurderNyBekreftelse(finn(l, "r1"))).toMatchObject({ kan: false });
      expect(bekreftPaaNytt(l, "felleskonto")).toBe(l);
    }
    // Kilden flyttet til MC: bare en eksplisitt ny bekreftelse mot en ANNEN konto gir effekt.
    const tilMc = endre({ konto: "MC" });
    const ny = bekreftPaaNytt(tilMc, "felleskonto");
    expect(finn(ny, "r1").forventetMotpost).toMatchObject({ konto: "felleskonto" });
    expect(vurder(ny, "MC").grunnlag.avledede.antall).toBe(0);
    expect(vurder(ny, "felleskonto").grunnlag.avledede.antall).toBe(1);
  });

  it("eldre data uten avtrykk regnes konservativt som ubekreftet", () => {
    const l = bekreftet().map((t) =>
      t.id === "r1"
        ? { ...t, forventetMotpost: { konto: "MC", dato: "2026-07-20", bekreftet: NAA } }
        : t,
    );
    const mc = vurder(l, "MC");
    expect(mc.grunnlag.avledede.antall).toBe(0);
    expect(mc.grunnlag.avledetKildeEndret[0]!.kildeEndret).toMatch(/mangler avtrykk/);
    expect(mc.status).toBe("usikker");
    expect(vurder(bekreftPaaNytt(l), "MC").status).toBe("avstemt_avledet");
  });

  it("ny bekreftelse: teller mot ny kilde, forrige bekreftelse og korrigering bevart i loggen", () => {
    const l = endre({ belop: 25500 });
    const foer = finn(l, "r1");
    const ny = finn(bekreftPaaNytt(l), "r1");
    expect(ny.forventetMotpost).toEqual({
      konto: "MC",
      dato: "2026-07-20",
      bekreftet: SENERE,
      kilde: { belopOre: 2_550_000, retning: "ut", konto: "regningskonto", dato: "2026-07-20" },
    });
    expect(ny.saldoKorrigering).toEqual(foer.saldoKorrigering);
    const siste = ny.korrigeringslogg!.at(-1)!;
    expect(siste.handling).toBe("motpost_avledet_bekreftet_paa_nytt");
    expect(siste.tidligereForventetMotpost).toEqual(foer.forventetMotpost);
    expect(siste.detalj).toMatch(/beløp/);
    expect(vurder([...l.filter((t) => t.id !== "r1"), ny], "MC").grunnlag.avledede.nettoOre).toBe(
      2_550_000,
    );
  });

  it("ny bekreftelse skjer bare mot ferske data, med gyldig konto, og bare når kilden faktisk er endret", () => {
    const l = endre({ belop: 25500 });
    const gammelVisning = kildeavtrykk(finn(bekreftet(), "r1"));
    expect(bekreftPaaNytt(l, "MC", "2026-07-20", gammelVisning)).toBe(l);
    expect(bekreftPaaNytt(l, "sparekonto")).toBe(l);
    expect(bekreftPaaNytt(l, "regningskonto")).toBe(l);
    expect(bekreftPaaNytt(bekreftet())).toEqual(bekreftet());
    expect(vurderNyBekreftelse(finn(bekreftet(), "r1"))).toMatchObject({ kan: false });
  });

  it("angring etter endret kilde gjenoppretter forrige tilstand og bevarer historikken", () => {
    const l = endre({ belop: 25500 });
    const r1 = finn(angreForventetMotpost("r1", SENERE)(l), "r1");
    expect(r1.forventetMotpost).toBeUndefined();
    expect(r1.saldoKorrigering).toBeUndefined();
    expect(r1).toMatchObject({ status: "ignorert", ignorertSom: "dublett", belop: 25500 });
    expect(r1.korrigeringslogg?.map((k) => k.handling)).toEqual([
      "motpost_avledet",
      "motpost_avledet_angret",
    ]);
    expect(vurder([r1], "MC").grunnlag.avledetKildeEndret).toHaveLength(0);
  });

  it("endret både kilde og tilstand: bare avslutning, med full historikk", () => {
    const l = endre({ belop: 25500, hendelseId: "h1" });
    const r1 = finn(l, "r1");
    expect(vurderNyBekreftelse(r1)).toMatchObject({ kan: false });
    expect(vurderAngringForventet(r1)).toMatchObject({ kan: false });
    const avsluttet = finn(avsluttForventetMotpost("r1", SENERE)(l), "r1");
    expect(avsluttet.forventetMotpost).toMatchObject({
      avsluttet: SENERE,
      kilde: r1.forventetMotpost!.kilde,
    });
    expect(avsluttet.korrigeringslogg!.at(-1)!.avsluttetKorrigering).toEqual(r1.saldoKorrigering);
  });

  it("legg til: skrivingen nekter når kilden er endret siden Helen så den", () => {
    const l = scenario();
    const sett = kildeavtrykk(finn(l, "r1"));
    const endret = l.map((t) => (t.id === "r1" ? { ...t, belop: 25500 } : t));
    expect(leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA, sett)(endret)).toBe(endret);
    expect(leggTilForventetMotpost("r1", "MC", "2026-07-20", NAA, sett)(l)).not.toBe(l);
  });
});

describe("to likebeløpskandidater ved senere import", () => {
  const medAvledet = () => leggTil("r1", "MC", "2026-07-20", NAA)(scenario());
  const kandidat = (id: string, dato: string) =>
    tx({ id, dato, tekst: "Innbetaling", retning: "inn", konto: "MC" });
  const a = kandidat("mcA", "2026-07-21");
  const b = kandidat("mcB", "2026-07-22");

  it("ingen automatisk valg og ingen dobbelttelling: begge vises, den avledede teller ikke, MC usikker", () => {
    const l = [...medAvledet(), a, b];
    const mc = vurder(l, "MC");
    expect(mc.grunnlag.avledetMedKandidat).toHaveLength(1);
    expect(mc.grunnlag.avledetMedKandidat[0]!.kandidater.map((t) => t.id)).toEqual(["mcA", "mcB"]);
    expect(mc.grunnlag.avledede.antall).toBe(0);
    // Bare de to ekte importene teller; den avledede kommer ikke i tillegg.
    expect(mc.grunnlag.nettoOre).toBe(5_000_000);
    expect(mc.beregnetOre).toBe(-4_000_000 + 5_000_000);
    expect(mc.status).toBe("usikker");
    expect(finn(l, "mcA")).toEqual(a);
    expect(finn(l, "mcB")).toEqual(b);
  });

  it("eksplisitt kobling av valgt kandidat; den uvalgte står urørt", () => {
    const l = [...medAvledet(), a, b];
    const koblet = kobleTilImportertMotpost("r1", "mcB", SENERE)(l);
    expect(finn(koblet, "r1")).toMatchObject({ motpartTransaksjonId: "mcB" });
    expect(finn(koblet, "r1").forventetMotpost).toMatchObject({ erstattetAv: "mcB" });
    expect(finn(koblet, "mcB")).toMatchObject({
      motpartTransaksjonId: "r1",
      behandlingstype: "intern_overforing",
    });
    expect(finn(koblet, "mcA")).toEqual(a);
    const mc = vurder(koblet, "MC");
    expect(mc.grunnlag.avledetMedKandidat).toHaveLength(0);
    expect(mc.grunnlag.avledede.antall).toBe(0);
    // Kan ikke kobles en gang til; ingen ny kandidatliste for r1.
    expect(kobleTilImportertMotpost("r1", "mcA", SENERE)(koblet)).toBe(koblet);
  });

  it("kobling nektes når kilden er endret etter bekreftelsen", () => {
    const l = [...medAvledet(), a].map((t) => (t.id === "r1" ? { ...t, belop: 25500 } : t));
    expect(kobleTilImportertMotpost("r1", "mcA", SENERE)(l)).toBe(l);
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
    const etter = leggTil("r1", "MC", "2026-07-20", NAA)(l);
    expect(muligeKilderForMotpost(etter, "MC", "2026-07").map((t) => t.id)).toEqual(["o1"]);
  });
});
