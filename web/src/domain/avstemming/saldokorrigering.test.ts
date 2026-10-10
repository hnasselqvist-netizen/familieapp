import { describe, expect, it } from "vitest";
import type { TransaksjonRecord } from "@app-types/forsoning";
import { maanedsgrunnlag } from "./saldoavstemming";
import {
  angreDublett,
  uendretSidenKorrigering,
  koblingsMotpart,
  merkSomDublett,
  omklassifiserIgnorert,
  vurderAngring,
  vurderDublettMerking,
} from "./saldokorrigering";

/**
 * Korrigeringer fra avvikshjelpen (#59, 6097079190 / 6097180478). Låser
 * scenariet Helen fant: to +26 000 innbetalinger 7. september på
 * Regningskonto, begge koblet som interne overføringer, der én er en dublett.
 */
const NAA = "2026-10-10T12:00:00.000Z";
const SENERE = "2026-10-10T13:00:00.000Z";

function tx(o: Partial<TransaksjonRecord> & { id: string }): TransaksjonRecord {
  return {
    dato: "2026-09-07",
    tekst: "Overføring",
    belop: 26000,
    retning: "inn",
    konto: "regningskonto",
    status: "ny",
    ...o,
  };
}

function intern(a: string, b: string, o: Partial<TransaksjonRecord> = {}): TransaksjonRecord {
  return tx({
    id: a,
    status: "behandlet",
    behandlingstype: "intern_overforing",
    motpartTransaksjonId: b,
    ...o,
  });
}

/** Regningskonto: «Avtale» (a1↔f1) og «Til betaling regninger og mat» (a2↔f2). */
function scenario(): TransaksjonRecord[] {
  return [
    intern("a1", "f1", { tekst: "Avtale" }),
    intern("f1", "a1", { tekst: "Avtale", konto: "felleskonto", retning: "ut" }),
    intern("a2", "f2", { tekst: "Til betaling regninger og mat" }),
    intern("f2", "a2", {
      tekst: "Til betaling regninger og mat",
      konto: "felleskonto",
      retning: "ut",
    }),
    tx({ id: "x", dato: "2026-09-10", belop: 100, retning: "ut", status: "ny" }),
  ];
}

const finn = (l: TransaksjonRecord[], id: string) => l.find((t) => t.id === id)!;
const netto = (l: TransaksjonRecord[], konto: string) =>
  maanedsgrunnlag(l, konto, "2026-09").nettoOre;

describe("saldokorrigering: marker som dublett", () => {
  it("+26 000-scenariet: begge er mulige dubletter, og én kan merkes selv om den er intern overføring", () => {
    const l = scenario();
    expect(maanedsgrunnlag(l, "regningskonto", "2026-09").muligeDubletter).toHaveLength(1);
    expect(netto(l, "regningskonto")).toBe(5_200_000 - 10_000);
    const v = vurderDublettMerking(finn(l, "a2"), l);
    expect(v).toEqual({ kan: true, motpart: finn(l, "f2") });
  });

  it("motposten er ekte: koblingen fjernes, motposten teller fortsatt på sin konto", () => {
    const l = merkSomDublett("a2", "frakoble", NAA)(scenario());
    const a2 = finn(l, "a2");
    const f2 = finn(l, "f2");
    expect(a2).toMatchObject({ status: "ignorert", ignorertSom: "dublett" });
    expect(a2.behandlingstype).toBeUndefined();
    expect(a2.motpartTransaksjonId).toBeUndefined();
    expect(a2.saldoKorrigering).toEqual({
      type: "dublett",
      tidligere: {
        status: "behandlet",
        behandlingstype: "intern_overforing",
        motpartTransaksjonId: "f2",
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
    });
    expect(a2.korrigeringslogg).toEqual([
      { handling: "merket_dublett", tidspunkt: NAA, detalj: "intern overføring → dublett" },
    ]);
    // Motposten: fortsatt intern overføring, ingen kobling mot en dublett.
    expect(f2).toMatchObject({ status: "behandlet", behandlingstype: "intern_overforing" });
    expect(f2.motpartTransaksjonId).toBeUndefined();
    expect(f2.saldoKorrigering?.type).toBe("motpart_frakoblet");
    expect(koblingsMotpart(f2, l)).toBeNull();
    // Saldo: dubletten holdes utenfor, motposten teller på felleskonto.
    expect(netto(l, "regningskonto")).toBe(2_600_000 - 10_000);
    expect(netto(l, "felleskonto")).toBe(-5_200_000);
    // Det andre paret og uberørte transaksjoner er byte-like.
    for (const id of ["a1", "f1", "x"]) expect(finn(l, id)).toEqual(finn(scenario(), id));
  });

  it("motposten er også en dublett: begge merkes og holdes utenfor", () => {
    const l = merkSomDublett("a2", "ogsaDublett", NAA)(scenario());
    expect(finn(l, "a2").ignorertSom).toBe("dublett");
    expect(finn(l, "f2")).toMatchObject({ status: "ignorert", ignorertSom: "dublett" });
    expect(finn(l, "f2").saldoKorrigering?.arsakId).toBe("a2");
    expect(netto(l, "felleskonto")).toBe(-2_600_000);
  });

  it("koblet intern overføring uten valg for motposten endrer ingenting", () => {
    const l = scenario();
    expect(merkSomDublett("a2", null, NAA)(l)).toBe(l);
  });

  it("plasserte og kvitteringsmatchede transaksjoner nektes med forklaring", () => {
    const plassert = tx({ id: "p", status: "behandlet", hendelseId: "h1" });
    const matchet = tx({ id: "m", status: "matchet", matchetMot: "r1" });
    const l = [plassert, matchet];
    expect(vurderDublettMerking(plassert, l)).toMatchObject({ kan: false });
    expect(vurderDublettMerking(matchet, l)).toMatchObject({ kan: false });
    expect(merkSomDublett("p", null, NAA)(l)).toBe(l);
  });

  it("ubehandlet transaksjon uten kobling kan merkes direkte", () => {
    const l = merkSomDublett("x", null, NAA)(scenario());
    expect(finn(l, "x")).toMatchObject({ status: "ignorert", ignorertSom: "dublett" });
    expect(finn(l, "x").saldoKorrigering?.tidligere.status).toBe("ny");
  });
});

describe("saldokorrigering: angre", () => {
  it("gjenoppretter dubletten og koblingen nøyaktig, og logger begge sider", () => {
    const merket = merkSomDublett("a2", "frakoble", NAA)(scenario());
    const l = angreDublett("a2", SENERE)(merket);
    const opprinnelig = scenario();
    for (const id of ["a2", "f2"]) {
      const { korrigeringslogg, updatedAt, ...rest } = finn(l, id);
      expect(rest).toEqual(finn(opprinnelig, id));
      expect(updatedAt).toBe(SENERE);
      expect(korrigeringslogg?.map((p) => p.handling)).toEqual(
        id === "a2"
          ? ["merket_dublett", "angret_dublett"]
          : ["motpart_frakoblet", "motpart_gjenkoblet"],
      );
    }
    expect(koblingsMotpart(finn(l, "a2"), l)?.id).toBe("f2");
    expect(netto(l, "regningskonto")).toBe(netto(opprinnelig, "regningskonto"));
  });

  it("par-merket dublett angres for begge", () => {
    const merket = merkSomDublett("a2", "ogsaDublett", NAA)(scenario());
    const l = angreDublett("f2", SENERE)(merket);
    expect(finn(l, "a2")).toMatchObject({
      behandlingstype: "intern_overforing",
      motpartTransaksjonId: "f2",
    });
    expect(finn(l, "f2")).toMatchObject({
      behandlingstype: "intern_overforing",
      motpartTransaksjonId: "a2",
    });
  });

  it("nekter når motposten er koblet til noe annet siden — ingen halv kobling", () => {
    const merket = merkSomDublett("a2", "frakoble", NAA)(scenario());
    const ny = tx({ id: "n", konto: "helen", retning: "inn", status: "behandlet" });
    const omkoblet = merket.map((t) => (t.id === "f2" ? { ...t, motpartTransaksjonId: "n" } : t));
    const l = [
      ...omkoblet,
      { ...ny, behandlingstype: "intern_overforing", motpartTransaksjonId: "f2" },
    ];
    expect(vurderAngring(finn(l, "a2"), l)).toMatchObject({ kan: false });
    expect(angreDublett("a2", SENERE)(l)).toBe(l);
  });

  it("nekter når motposten ikke finnes lenger", () => {
    const merket = merkSomDublett("a2", "frakoble", NAA)(scenario()).filter((t) => t.id !== "f2");
    expect(vurderAngring(finn(merket, "a2"), merket)).toMatchObject({ kan: false });
  });
});

describe("saldokorrigering: omklassifiser ignorert (20.07 / 31.07)", () => {
  const juli = (): TransaksjonRecord[] => [
    tx({
      id: "j1",
      dato: "2026-07-20",
      tekst: "DNB BANK ASA",
      belop: 25000,
      retning: "ut",
      status: "ignorert",
      ignorertSom: "dublett",
    }),
    tx({
      id: "j2",
      dato: "2026-07-31",
      tekst: "DNB BANK ASA",
      belop: 7412.91,
      retning: "ut",
      status: "ignorert",
      ignorertSom: "dublett",
    }),
  ];

  it("feilmerket dublett blir ekte bevegelse og teller i saldoen, uten motpost", () => {
    const l = omklassifiserIgnorert(
      "j2",
      "bankbevegelse",
      NAA,
    )(omklassifiserIgnorert("j1", "bankbevegelse", NAA)(juli()));
    expect(maanedsgrunnlag(juli(), "regningskonto", "2026-07").nettoOre).toBe(0);
    expect(maanedsgrunnlag(l, "regningskonto", "2026-07").nettoOre).toBe(-3_241_291);
    expect(finn(l, "j1")).toMatchObject({ status: "ignorert", ignorertSom: "bankbevegelse" });
    expect(finn(l, "j1").korrigeringslogg).toEqual([
      {
        handling: "omklassifisert",
        tidspunkt: NAA,
        detalj: "dublett → ignorert, ekte bevegelse",
      },
    ]);
  });

  it("er reverserbar, og rører ikke en aktiv dublett-merking (den angres i stedet)", () => {
    const fram = omklassifiserIgnorert("j1", "bankbevegelse", NAA)(juli());
    const tilbake = omklassifiserIgnorert("j1", "dublett", SENERE)(fram);
    expect(finn(tilbake, "j1").ignorertSom).toBe("dublett");
    expect(finn(tilbake, "j1").korrigeringslogg).toHaveLength(2);
    const aktiv = merkSomDublett("a2", "frakoble", NAA)(scenario());
    expect(omklassifiserIgnorert("a2", "bankbevegelse", SENERE)(aktiv)).toEqual(aktiv);
  });
});

/**
 * Kontrolltårnets tre datarisikoer i review av #71 (2026-10-10):
 * 1) motposten endres uten kontroll av plassering/kvitteringskobling,
 * 2) en ny korrigering overskriver det som trengs for å angre en tidligere,
 * 3) angring gjenoppretter en feil kobling når motposten er endret siden.
 */
describe("saldokorrigering: datarisikoer fra review av #71", () => {
  const medF2 = (o: Partial<TransaksjonRecord>) =>
    scenario().map((t) => (t.id === "f2" ? { ...t, ...o } : t));

  it("1: motpost med plassering eller kvitteringsmatch nekter begge valg, og ingenting endres", () => {
    for (const o of [{ hendelseId: "h9" }, { matchetMot: "r9" }, { status: "matchet" }]) {
      const l = medF2(o);
      expect(vurderDublettMerking(finn(l, "a2"), l)).toMatchObject({
        kan: false,
        grunn: expect.stringContaining("Motposten"),
      });
      expect(merkSomDublett("a2", "frakoble", NAA)(l)).toBe(l);
      expect(merkSomDublett("a2", "ogsaDublett", NAA)(l)).toBe(l);
    }
  });

  it("1: ensidig eller ikke-intern kobling nektes i stedet for å gjettes", () => {
    const ensidig = scenario().map((t) =>
      t.id === "f2" ? { ...t, motpartTransaksjonId: "noe-annet" } : t,
    );
    expect(vurderDublettMerking(finn(ensidig, "a2"), ensidig)).toMatchObject({ kan: false });
    expect(merkSomDublett("a2", null, NAA)(ensidig)).toBe(ensidig);
    const ikkeIntern = medF2({ behandlingstype: "plassert" });
    expect(merkSomDublett("a2", "frakoble", NAA)(ikkeIntern)).toBe(ikkeIntern);
  });

  it("2: korrigeringer stables ikke — angreinformasjonen kan aldri overskrives", () => {
    const merket = merkSomDublett("a2", "frakoble", NAA)(scenario());
    // Den frakoblede motposten kan ikke merkes før den første merkingen er angret.
    expect(vurderDublettMerking(finn(merket, "f2"), merket)).toMatchObject({
      kan: false,
      grunn: expect.stringContaining("Angre den merkingen først"),
    });
    expect(merkSomDublett("f2", null, SENERE)(merket)).toBe(merket);
    // Dubletten selv kan ikke merkes eller omklassifiseres på nytt.
    expect(merkSomDublett("a2", null, SENERE)(merket)).toBe(merket);
    expect(omklassifiserIgnorert("a2", "bankbevegelse", SENERE)(merket)).toEqual(merket);
    // En annen intern overføring kan ikke frakoble en motpost som allerede er frakoblet.
    const stablet = [...merket, intern("z", "f2", { konto: "helen", retning: "inn" })].map((t) =>
      t.id === "f2" ? { ...t, motpartTransaksjonId: "z" } : t,
    );
    expect(vurderDublettMerking(finn(stablet, "z"), stablet)).toMatchObject({ kan: false });
    // Etter angring er alt som før, og ny merking er mulig igjen.
    const angret = angreDublett("a2", SENERE)(merket);
    expect(vurderDublettMerking(finn(angret, "f2"), angret)).toMatchObject({ kan: true });
  });

  it("3: angring nektes når motposten er endret siden merkingen — ingen feil kobling gjenopprettes", () => {
    const merket = merkSomDublett("a2", "frakoble", NAA)(scenario());
    const endringer: Partial<TransaksjonRecord>[] = [
      { hendelseId: "h1" },
      { matchetMot: "r1" },
      { status: "ignorert", ignorertSom: "bankbevegelse" },
      { behandlingstype: undefined, status: "ny" },
      { motpartTransaksjonId: "n" },
    ];
    for (const o of endringer) {
      const l = merket.map((t) => (t.id === "f2" ? { ...t, ...o } : t));
      expect(uendretSidenKorrigering(finn(l, "f2"))).toBe(false);
      expect(vurderAngring(finn(l, "a2"), l)).toMatchObject({
        kan: false,
        grunn: expect.stringContaining("Motposten er endret"),
      });
      expect(angreDublett("a2", SENERE)(l)).toBe(l);
    }
  });

  it("3: angring nektes også når dubletten selv er endret siden merkingen", () => {
    const merket = merkSomDublett("a2", "frakoble", NAA)(scenario());
    const l = merket.map((t) => (t.id === "a2" ? { ...t, hendelseId: "h2" } : t));
    expect(vurderAngring(finn(l, "a2"), l)).toMatchObject({
      kan: false,
      grunn: expect.stringContaining("Transaksjonen er endret"),
    });
    expect(angreDublett("a2", SENERE)(l)).toBe(l);
  });

  it("3: par-merkede dubletter angres bare når begge er uendret", () => {
    const merket = merkSomDublett("a2", "ogsaDublett", NAA)(scenario());
    expect(vurderAngring(finn(merket, "a2"), merket)).toMatchObject({
      kan: true,
      gjenkobles: true,
    });
    const endret = merket.map((t) => (t.id === "f2" ? { ...t, hendelseId: "h3" } : t));
    expect(angreDublett("a2", SENERE)(endret)).toBe(endret);
  });
});
