/**
 * Mellomværende (#95): gaven mamma la ut (3 299 kr, oktober 2026),
 * motregnet i abonnementene hun vanligvis dekker (467 kr/mnd). Syntetiske
 * data. Faktisk-beregningen er den eksisterende
 * `beregnFaktiskTotalerFraHendelser` — samme funksjon som økonomibildet.
 */
import { describe, expect, it } from "vitest";
import type { HendelseRecord } from "@app-types/forsoning";
import type { Mellomvaerende } from "@app-types/mellomvaerende";
import { beregnFaktiskTotalerFraHendelser } from "@domain/budsjettfamilie/budsjettfamilie";
import {
  angreOppgjor,
  bekreftOppgjor,
  byggMellomvaerende,
  gjenstaendeOppgjor,
  kostnadHendelseId,
  kronerTekst,
  maanedTekst,
  maanederFraTil,
  medKostnadHendelse,
  mellomvaerendeStatus,
  oppgjorHendelseId,
  rettOppgjor,
  sammeAvtale,
  tolkKroner,
  valider,
  type NyttMellomvaerende,
} from "./mellomvaerende";

const NAA = "2026-10-31T12:00:00.000Z";
const AV = "helen-uid";

const NY: NyttMellomvaerende = {
  navn: "Gave fra mamma",
  motpart: "Mamma",
  opprinneligOre: 329900,
  startMaaned: "2026-10",
  kostnad: {
    postId: "gaver",
    postNavn: "Gaver",
    plasseringType: "budget",
    eiere: [{ person: "Felles", prosent: 100 }],
  },
  oppgjor: {
    postId: "abonnementer",
    postNavn: "Abonnementer",
    plasseringType: "budget",
    eiere: [{ person: "Felles", prosent: 100 }],
  },
  standardBelopOre: 46700,
};
const MV: Mellomvaerende = byggMellomvaerende(NY, "mv1", AV, NAA);

/** En vanlig banktransaksjon-hendelse som ikke skal røres. */
const BANK: HendelseRecord = {
  id: "h-bank",
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: "t1",
  receiptId: null,
  fordelinger: [
    {
      plasseringId: "abonnementer",
      plasseringType: "budget",
      plasseringNavn: "Abonnementer",
      belop: 199,
      eiere: [{ person: "Felles", prosent: 100 }],
    },
  ],
  dato: "2026-10-05",
  regelId: null,
  opprettet: NAA,
  oppdatert: NAA,
};

/** Som Forvaltning-forsiden: samme funksjon, `kommentar` er `null`-bar i fullformen. */
const faktisk = (h: HendelseRecord[], maaned: string, gyldige?: Set<string>) =>
  beregnFaktiskTotalerFraHendelser(
    h.map((x) => ({ ...x, kommentar: x.kommentar ?? undefined })),
    maaned,
    gyldige,
  );

const start = () => medKostnadHendelse([BANK], MV, AV, NAA);

/** Bekrefter og forventer at det lagres. */
function bekreft(prev: HendelseRecord[], maaned: string, ore: number) {
  const r = bekreftOppgjor(prev, MV, maaned, ore, AV, NAA);
  expect(r.utfall, maaned).toBe("lagret");
  return r.neste;
}

describe("oktober: kostnad 3 299, oppgjør 467, rest 2 832", () => {
  it("kostnaden er faktisk på Gaver i oktober uten bank; oppgjøret reduserer Abonnementer", () => {
    let h = start();
    expect(faktisk(h, "2026-10")).toEqual({
      abonnementer: 199,
      gaver: 3299,
    });
    h = bekreft(h, "2026-10", 46700);
    expect(faktisk(h, "2026-10")).toEqual({
      abonnementer: 199 - 467,
      gaver: 3299,
    });
    // Med gyldighetsfilteret (bare kjente observasjoner) teller de manuelle like fullt.
    expect(faktisk(h, "2026-10", new Set(["t1"]))).toEqual({
      abonnementer: 199 - 467,
      gaver: 3299,
    });
    const s = mellomvaerendeStatus(MV, h, "2026-10");
    expect(s).toMatchObject({
      kostnadFort: true,
      oppgjortOre: 46700,
      restOre: 283200,
      avsluttet: false,
      forfalte: [],
      forslagOre: 46700,
    });
    // Ingen hendelse er koblet til en bankobservasjon; bankhendelsen er urørt.
    expect(h.filter((x) => x.mellomvaerende).every((x) => x.transaksjonId === null)).toBe(true);
    expect(h[0]).toBe(BANK);
  });

  it("kostnaden legges bare til én gang (retry av registrering)", () => {
    const h = medKostnadHendelse(start(), MV, AV, NAA);
    expect(h.filter((x) => x.id === kostnadHendelseId("mv1"))).toHaveLength(1);
  });
});

describe("hele løpet: sju fulle oppgjør og 30 kr, oktober 2026 – mai 2027", () => {
  it("over årsskiftet, og siste oppgjør begrenses til resten", () => {
    let h = start();
    const maaneder = maanederFraTil("2026-10", "2027-05");
    expect(maaneder).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
    ]);
    for (const m of maaneder.slice(0, 7)) {
      const s = mellomvaerendeStatus(MV, h, m);
      expect(s.forfalte, m).toEqual([m]);
      h = bekreft(h, m, s.forslagOre);
    }
    const mai = mellomvaerendeStatus(MV, h, "2027-05");
    expect(mai.restOre).toBe(3000);
    expect(mai.forslagOre).toBe(3000);
    expect(gjenstaendeOppgjor(mai)).toEqual({ fulle: 1, sisteOre: 0 });
    expect(bekreftOppgjor(h, MV, "2027-05", 46700, AV, NAA).utfall).toBe("over_rest");
    h = bekreft(h, "2027-05", 3000);
    const slutt = mellomvaerendeStatus(MV, h, "2027-08");
    expect(slutt).toMatchObject({ restOre: 0, avsluttet: true, forfalte: [] });
    expect(bekreftOppgjor(h, MV, "2027-06", 100, AV, NAA).utfall).toBe("over_rest");
    // Årets faktisk: januar 2027 har −467 på Abonnementer.
    expect(faktisk(h, "2027-01")).toEqual({ abonnementer: -467 });
  });

  it("oversikten regner ut gjenstående oppgjør fra oktober", () => {
    const s = mellomvaerendeStatus(MV, bekreft(start(), "2026-10", 46700), "2026-10");
    expect(gjenstaendeOppgjor(s)).toEqual({ fulle: 6, sisteOre: 3000 });
  });
});

describe("prisendring, hoppet måned og idempotens", () => {
  it("justert beløp foreslås videre; historiske oppgjør endres ikke", () => {
    let h = bekreft(start(), "2026-10", 46700);
    h = bekreft(h, "2026-11", 49900);
    const s = mellomvaerendeStatus(MV, h, "2026-12");
    expect(s.forslagOre).toBe(49900);
    expect(s.oppgjor.map((o) => [o.maaned, o.belopOre])).toEqual([
      ["2026-10", 46700],
      ["2026-11", 49900],
    ]);
  });

  it("en glemt måned blir stående som forfalt, eldst først, også når nyere måneder er oppgjort", () => {
    let h = bekreft(start(), "2026-10", 46700);
    h = bekreft(h, "2026-12", 46700);
    expect(mellomvaerendeStatus(MV, h, "2027-01").forfalte).toEqual(["2026-11", "2027-01"]);
  });

  it("dobbeltklikk/retry: samme måned får aldri to oppgjør", () => {
    const h = bekreft(start(), "2026-10", 46700);
    const igjen = bekreftOppgjor(h, MV, "2026-10", 46700, AV, NAA);
    expect(igjen.utfall).toBe("allerede_oppgjort");
    expect(igjen.neste).toEqual(h);
    expect(h.filter((x) => x.id === oppgjorHendelseId("mv1", "2026-10"))).toHaveLength(1);
  });

  it("ugyldige beløp og måneder avvises uten endring", () => {
    const h = start();
    for (const [m, ore] of [
      ["2026-09", 46700],
      ["2026-13", 46700],
      ["2026-10", 0],
      ["2026-10", -467],
      ["2026-10", 467.5],
    ] as const) {
      const r = bekreftOppgjor(h, MV, m, ore, AV, NAA);
      expect(r.utfall, `${m} ${ore}`).toBe("ugyldig");
      expect(r.neste).toEqual(h);
    }
  });
});

describe("retting og angring med spor", () => {
  it("retting endrer beløpet og effekten, med spor", () => {
    let h = bekreft(start(), "2026-10", 46700);
    const r = rettOppgjor(h, MV, "2026-10", 50000, 1, "eivind-uid", "2026-11-02T08:00:00Z");
    expect(r.utfall).toBe("lagret");
    h = r.neste;
    expect(faktisk(h, "2026-10").abonnementer).toBe(199 - 500);
    const o = mellomvaerendeStatus(MV, h, "2026-10").oppgjor[0]!;
    expect(o.spor.map((s) => [s.handling, s.belopOre, s.av])).toEqual([
      ["bekreftet", 46700, AV],
      ["rettet", 50000, "eivind-uid"],
    ]);
    expect(rettOppgjor(h, MV, "2026-11", 100, 0, AV, NAA).utfall).toBe("ikke_oppgjort");
    expect(rettOppgjor(h, MV, "2026-10", 329901, 2, AV, NAA).utfall).toBe("over_rest");
  });

  it("angring fjerner effekten, beholder sporet, og måneden kan bekreftes på nytt", () => {
    let h = bekreft(start(), "2026-10", 46700);
    const a = angreOppgjor(h, MV, "2026-10", 1, AV, NAA);
    expect(a.utfall).toBe("lagret");
    h = a.neste;
    expect(faktisk(h, "2026-10")).toEqual({
      abonnementer: 199,
      gaver: 3299,
    });
    let s = mellomvaerendeStatus(MV, h, "2026-10");
    expect(s).toMatchObject({ restOre: 329900, forfalte: ["2026-10"] });
    expect(s.oppgjor[0]).toMatchObject({ aktiv: false, belopOre: 0 });
    expect(angreOppgjor(h, MV, "2026-10", 2, AV, NAA).utfall).toBe("ikke_oppgjort");

    h = bekreft(h, "2026-10", 46700);
    s = mellomvaerendeStatus(MV, h, "2026-10");
    expect(s.restOre).toBe(283200);
    expect(s.oppgjor[0]!.spor.map((x) => x.handling)).toEqual(["bekreftet", "angret", "bekreftet"]);
    expect(h.filter((x) => x.id === oppgjorHendelseId("mv1", "2026-10"))).toHaveLength(1);
  });
});

describe("versjonsvakt for retting og angring (review 5723280487)", () => {
  const okt = () => bekreft(start(), "2026-10", 46700);
  const versjon = (h: HendelseRecord[]) =>
    mellomvaerendeStatus(MV, h, "2026-10").oppgjor.find((o) => o.maaned === "2026-10")!.versjon;

  it("rett/rett: A og B ser versjon 1; B retter først, As retting avvises uten endring", () => {
    const h0 = okt();
    expect(versjon(h0)).toBe(1);
    const b = rettOppgjor(h0, MV, "2026-10", 49900, 1, "B", NAA);
    expect(b.utfall).toBe("lagret");
    const a = rettOppgjor(b.neste, MV, "2026-10", 50000, 1, "A", NAA);
    expect(a.utfall).toBe("endret_annet_sted");
    expect(a.neste).toEqual(b.neste);
    expect(mellomvaerendeStatus(MV, a.neste, "2026-10").oppgjor[0]!.belopOre).toBe(49900);
  });

  it("rett/angre: en foreldet angring angrer aldri et nyere oppgjør", () => {
    const b = rettOppgjor(okt(), MV, "2026-10", 49900, 1, "B", NAA);
    const a = angreOppgjor(b.neste, MV, "2026-10", 1, "A", NAA);
    expect(a.utfall).toBe("endret_annet_sted");
    expect(mellomvaerendeStatus(MV, a.neste, "2026-10").restOre).toBe(329900 - 49900);
  });

  it("angre/rebekreft/foreldet retry: gammel angring avvises; ny handling etter reload virker", () => {
    const angret = angreOppgjor(okt(), MV, "2026-10", 1, "A", NAA).neste;
    const rebekreftet = bekreft(angret, "2026-10", 46700);
    expect(versjon(rebekreftet)).toBe(3);
    // A trykker «Angre» på nytt fra en foreldet visning (versjon 1).
    expect(angreOppgjor(rebekreftet, MV, "2026-10", 1, "A", NAA).utfall).toBe("endret_annet_sted");
    expect(rettOppgjor(rebekreftet, MV, "2026-10", 100, 2, "A", NAA).utfall).toBe(
      "endret_annet_sted",
    );
    // Etter reload (versjon 3) virker både retting og angring.
    expect(rettOppgjor(rebekreftet, MV, "2026-10", 50000, 3, "A", NAA).utfall).toBe("lagret");
    expect(angreOppgjor(rebekreftet, MV, "2026-10", 3, "A", NAA).utfall).toBe("lagret");
  });
});

describe("samme avtale ved retry (review 5723280487)", () => {
  it("sammenligner alt som avgjør økonomien, ikke tidspunkt/hvem", () => {
    const igjen = byggMellomvaerende(NY, "mv1", "Eivind", "2026-11-01T00:00:00Z");
    expect(sammeAvtale(MV, igjen)).toBe(true);
    for (const endring of [
      { opprinneligOre: 400000 },
      { startMaaned: "2026-11" },
      { standardBelopOre: 50000 },
      { kostnad: { ...NY.kostnad, postId: "annet" } },
      { oppgjor: { ...NY.oppgjor, eiere: [{ person: "Helen", prosent: 100 }] } },
    ]) {
      expect(sammeAvtale(MV, byggMellomvaerende({ ...NY, ...endring }, "mv1", AV, NAA))).toBe(
        false,
      );
    }
  });
});

describe("registrering og tekst", () => {
  it("validerer påkrevde felt og eierskap", () => {
    expect(valider(NY)).toEqual([]);
    const feil = valider({
      ...NY,
      navn: " ",
      opprinneligOre: 0,
      startMaaned: "2026-13",
      oppgjor: { ...NY.oppgjor, eiere: [{ person: "Helen", prosent: 60 }] },
      standardBelopOre: 0,
    });
    expect(feil).toEqual([
      "Gi mellomværendet et navn.",
      "Oppgi utlegget som et beløp over 0.",
      "Velg startmåned.",
      "Velg hvem som eier oppgjørene (til sammen 100 %).",
      "Oppgi månedlig oppgjør som et beløp over 0.",
    ]);
    expect(valider({ ...NY, standardBelopOre: 400000 })).toEqual([
      "Månedlig oppgjør kan ikke være større enn utlegget.",
    ]);
  });

  it("tolker og viser kronebeløp", () => {
    expect(tolkKroner("467")).toBe(46700);
    expect(tolkKroner("3 299")).toBe(329900);
    expect(tolkKroner("30,5")).toBe(3050);
    expect(tolkKroner("0")).toBeNull();
    expect(tolkKroner("-4")).toBeNull();
    expect(tolkKroner("abc")).toBeNull();
    expect(kronerTekst(329900)).toBe("3 299 kr");
    expect(kronerTekst(3050)).toBe("30,50 kr");
    expect(maanedTekst("2027-01")).toBe("januar 2027");
  });
});
