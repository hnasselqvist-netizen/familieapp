/**
 * Regelmotorens matchingkontrakt (#59, 6543087796 / 6543491911,
 * kontrakt 6543702753). Syntetiske data — ingen produksjonsverdier utover
 * formen «Til :<11 sifre>».
 *
 *  - Tallregel (bare sifre, ≥ 6): eksakt likhet med et sifferløp i
 *    RÅteksten. Andre kontonumre, lengre tall og KID med samme sifre inni
 *    treffer ikke.
 *  - Tekstregel: «inneholder» = teksten inneholder mønsteret, ikke omvendt
 *    («cc mat» treffer ikke «Mat»).
 *  - Læring/spredning/flerbruk bruker `laeringsnokkel`: «til :» blir aldri
 *    et mønster eller en spredningsnøkkel.
 */
import { describe, expect, it } from "vitest";
import type { HendelseRecord, MalPost, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import { gjorImport, laeringsKey, type PreviewRad } from "./bankimport";
import { lagreBehandling, merkFlerbruk, utvidRegelForslag } from "./beslutning";
import { tellTreff } from "./regelsenter";
import {
  evaluerReglerMotUavklarteTransaksjoner,
  findMatchingRule,
  oppdaterReglerVedLaering,
  regelMatcherTekst,
} from "./regler";
import { normaliserTransaksjonstekst } from "./tekst";
import {
  erSvakTekst,
  laeringsnokkel,
  sifferlop,
  tallmonster,
  treffgrunnlag,
} from "./treffgrunnlag";

const NAA = "2026-10-31T12:00:00.000Z";
const idSequence = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
const deps = () => ({ newId: idSequence("ny"), naa: NAA });

const KONTO = "20957976493";

const regel = (o: Partial<RegelRecord> & { id: string }): RegelRecord => ({
  pattern: KONTO,
  normalizedPattern: KONTO,
  matchType: "inneholder",
  targetType: "budget",
  targetId: "boliglan",
  targetName: "Boliglån",
  mode: "auto",
  confidence: 100,
  multiUse: false,
  active: true,
  eiere: [{ person: "Felles", prosent: 100 }],
  ...o,
});

const BOLIGLAN = regel({ id: "boliglan-regel" });
const CC_MAT = regel({
  id: "cc-mat",
  pattern: "CC MAT",
  normalizedPattern: "cc mat",
  targetId: "dagligvarer",
  targetName: "Dagligvarer",
});

const tx = (o: Partial<TransaksjonRecord> & { id: string }): TransaksjonRecord => ({
  dato: "2026-10-11",
  tekst: `Til :${KONTO}`,
  belop: 13807,
  retning: "ut",
  konto: "regningskonto",
  status: "ny",
  ...o,
});

const treff = (tekst: string, regler: RegelRecord[] = [BOLIGLAN], konto = "regningskonto") =>
  findMatchingRule({ normalizedText: normaliserTransaksjonstekst(tekst), tekst, konto }, regler)
    .rule?.id ?? null;

/** Samme mottaker, ulike skrivemåter: alle skal treffe. */
const LIK_MOTTAKER = [
  `Til :${KONTO}`,
  `Til:${KONTO}`,
  `Til: ${KONTO}`,
  `Til : ${KONTO}`,
  `TIL :${KONTO}`,
  "Til :2095.79.76493",
  "Til : 2095 79 76493",
  `${KONTO}`,
  `11.10 Til :${KONTO}`,
];

/** Annen mottaker / annet tall: ingen skal treffe boliglånsregelen. */
const ULIK_MOTTAKER = [
  "Til :20957976494", // nabokonto
  "Til :12345678903", // helt annen konto
  `Til :${KONTO}1`, // lengre tall
  `Til :1${KONTO}`,
  `KID 00${KONTO}`, // KID med samme sifre inni
  `KID ${KONTO}0`,
  "Til :2095797649", // ett siffer kortere
  `Til :${KONTO}.5`, // fortsetter med .<siffer>
  "Til :2095.79.764931",
  "Til :",
  "",
];

describe("sifferløp og tallmønster", () => {
  it("finner sammenhengende og 4-2-5-grupperte kontonumre", () => {
    expect(sifferlop(`Til :${KONTO}`)).toEqual([KONTO]);
    expect(sifferlop("Til :2095.79.76493")).toEqual([KONTO]);
    expect(sifferlop("Til : 2095 79 76493")).toEqual([KONTO]);
    expect(sifferlop("KID 001234567 og 7654321")).toEqual(["001234567", "7654321"]);
  });

  it("korte tall, datoer og beløp er ikke sifferløp", () => {
    expect(sifferlop("REMA 1000 12.10 kr 312,50")).toEqual([]);
    expect(sifferlop("Vipps 12345")).toEqual([]);
  });

  it("et lengre tall gir ikke et kortere løp", () => {
    expect(sifferlop(`${KONTO}1`)).toEqual([`${KONTO}1`]);
    expect(sifferlop(`${KONTO}.5`)).toEqual([]);
    expect(sifferlop("1.2095.79.76493")).toEqual([]);
  });

  it("tallregel bare for ≥ 6 sammenhengende sifre eller kontonummer skrevet 4-2-5", () => {
    expect(tallmonster(KONTO)).toBe(KONTO);
    expect(tallmonster(" 2095.79.76493 ")).toBe(KONTO);
    expect(tallmonster("2095 79 76493")).toBe(KONTO);
    expect(tallmonster("12345")).toBeNull();
    expect(tallmonster("1000 1000")).toBeNull();
    expect(tallmonster("12.10.2026")).toBeNull();
    expect(tallmonster(`til :${KONTO}`)).toBeNull();
    expect(tallmonster("rema 1000")).toBeNull();
    expect(tallmonster("")).toBeNull();
  });
});

describe("tallregel: lik og ulik mottaker", () => {
  it.each(LIK_MOTTAKER)("%j treffer boliglånsregelen", (tekst) => {
    expect(treff(tekst)).toBe("boliglan-regel");
  });

  it.each(ULIK_MOTTAKER)("%j treffer ikke", (tekst) => {
    expect(treff(tekst)).toBeNull();
  });

  it("matchType utvider ikke en tallregel", () => {
    for (const matchType of ["er_lik", "starter_med", "inneholder"] as const) {
      const r = regel({ id: matchType, matchType });
      expect(treff(`Til :${KONTO}`, [r])).toBe(matchType);
      expect(treff("Til :20957976494", [r])).toBeNull();
      expect(treff(`Til :${KONTO}1`, [r])).toBeNull();
    }
  });

  it("kontovilkåret gjelder fortsatt (OG)", () => {
    const r = regel({ id: "k", kontoVilkar: "regningskonto" });
    expect(treff(`Til :${KONTO}`, [r], "regningskonto")).toBe("k");
    expect(treff(`Til :${KONTO}`, [r], "Felleskonto")).toBeNull();
  });

  it("uten råtekst kan en tallregel ikke treffe (bare normalisert tekst)", () => {
    expect(
      findMatchingRule({ normalizedText: "til :", konto: "regningskonto" }, [BOLIGLAN]).rule,
    ).toBeNull();
    expect(regelMatcherTekst(BOLIGLAN, "til :")).toBe(false);
  });

  it("et blandet mønster med langt tall skrives ikke om og treffer ikke alle «til :»", () => {
    const blandet = regel({
      id: "blandet",
      pattern: `Til :${KONTO}`,
      normalizedPattern: `til :${KONTO}`,
    });
    for (const tekst of [...LIK_MOTTAKER, ...ULIK_MOTTAKER]) {
      expect(treff(tekst, [blandet]), tekst).toBeNull();
    }
  });
});

describe("KID-variasjon", () => {
  const KID = "004512345678901";
  const kidRegel = regel({ id: "kid", pattern: KID, normalizedPattern: KID });

  it("samme KID treffer, også med prefiks og mellomrom", () => {
    expect(treff(`KID ${KID}`, [kidRegel])).toBe("kid");
    expect(treff(`KID:${KID}`, [kidRegel])).toBe("kid");
    expect(treff(`Fjordkraft KID ${KID} 12.10`, [kidRegel])).toBe("kid");
  });

  it("nabo-KID, kortere/lengre KID og andre ledende nuller treffer ikke", () => {
    for (const annen of [
      "004512345678902",
      "04512345678901",
      "0004512345678901",
      "4512345678901",
      `${KID}7`,
    ]) {
      expect(treff(`KID ${annen}`, [kidRegel]), annen).toBeNull();
    }
  });

  it("leverandørtekst med KID treffer fortsatt tekstregelen (normaliseringen er uendret)", () => {
    const fjordkraft = regel({
      id: "fjordkraft",
      pattern: "Fjordkraft",
      normalizedPattern: "fjordkraft",
      targetId: "strom",
    });
    expect(treff(`Fjordkraft KID ${KID}`, [fjordkraft])).toBe("fjordkraft");
    expect(treff("Fjordkraft KID 009988776655", [fjordkraft])).toBe("fjordkraft");
    expect(normaliserTransaksjonstekst(`Fjordkraft KID ${KID}`)).toBe("fjordkraft kid");
  });
});

describe("tekstregel uten omvendt inklusjon (CC Mat)", () => {
  it.each(["CC MAT HAMAR", "CC MAT LILLEHAMMER", "Cc Mat Hamar 12.10", "VIPPS*CC MAT HAMAR"])(
    "«cc mat» treffer %j",
    (tekst) => {
      expect(treff(tekst, [CC_MAT], "Felleskonto")).toBe("cc-mat");
    },
  );

  it.each(["Mat", "MAT", "cc", "Overføring Mat", "Mat 01.10"])(
    "«cc mat» treffer ikke %j",
    (tekst) => {
      expect(treff(tekst, [CC_MAT], "Felleskonto")).toBeNull();
    },
  );

  it("begge bankretninger: «Mat» treffer verken ut fra regningskonto eller inn på felleskonto", () => {
    const trans = [
      tx({ id: "ut", tekst: "Mat", belop: 12000, retning: "ut", konto: "regningskonto" }),
      tx({ id: "inn", tekst: "Mat", belop: 12000, retning: "inn", konto: "Felleskonto" }),
      tx({ id: "cc-ut", tekst: "CC MAT HAMAR", retning: "ut", konto: "Felleskonto" }),
      tx({ id: "cc-inn", tekst: "CC MAT HAMAR", retning: "inn", konto: "Felleskonto" }),
    ];
    const ev = evaluerReglerMotUavklarteTransaksjoner(trans, [], [CC_MAT], GRUPPER, [], []);
    expect(ev.alle.map((r) => [r.transaksjonId, r.regel?.id ?? null])).toEqual([
      ["ut", null],
      ["inn", null],
      ["cc-ut", "cc-mat"],
      ["cc-inn", "cc-mat"],
    ]);
  });

  it("andre tallmønstre forblir tekstregler som før («1000 1000»)", () => {
    const r = regel({ id: "t", pattern: "1000 1000", normalizedPattern: "1000 1000" });
    expect(regelMatcherTekst(r, treffgrunnlag("Lotto 1000 1000"))).toBe(true);
  });

  it("er_lik og starter_med er uendret", () => {
    const erLik = regel({ id: "l", normalizedPattern: "cc mat", matchType: "er_lik" });
    const starter = regel({ id: "s", normalizedPattern: "cc mat", matchType: "starter_med" });
    expect(regelMatcherTekst(erLik, "cc mat")).toBe(true);
    expect(regelMatcherTekst(erLik, "cc mat hamar")).toBe(false);
    expect(regelMatcherTekst(starter, "cc mat hamar")).toBe(true);
    expect(regelMatcherTekst(starter, "mat")).toBe(false);
    expect(regelMatcherTekst(starter, "vipps cc mat")).toBe(false);
  });
});

const GRUPPER = [
  {
    id: "g",
    label: "G",
    items: ["boliglan", "dagligvarer", "strom"].map((id) => ({ id, name: id, months: [] })),
  },
];

describe("alle veier bruker samme matcher", () => {
  const rad = (tekst: string, i: number): PreviewRad => ({
    dato: "2026-10-11",
    tekst,
    belop: 13807,
    retning: "ut",
    konto: "regningskonto",
    originalRad: "",
    laeringsKey: laeringsKey(tekst),
    _dupKey: String(i),
    erDuplikat: false,
    status: "ny",
  });

  it("import: lik mottaker blir ferdig boliglån med Felles 100 %, ulik mottaker blir «ny»", () => {
    const tekster = [`Til :${KONTO}`, "Til :2095.79.76493", "Til :20957976494", `KID 00${KONTO}`];
    const endring = gjorImport(
      tekster.map(rad),
      { rules: [BOLIGLAN], liquidityPosts: [], kilde: "sparebank1" },
      deps(),
    );
    const hendelser = endring.hendelser!([]);
    expect(hendelser).toHaveLength(2);
    for (const h of hendelser) {
      expect(h.status).toBe("ferdig");
      expect(h.regelId).toBe("boliglan-regel");
      expect(h.fordelinger[0]).toMatchObject({
        plasseringId: "boliglan",
        eiere: [{ person: "Felles", prosent: 100 }],
      });
    }
    const trans = endring.transaksjoner!([]);
    expect(trans.map((t) => t.status)).toEqual([null, null, "ny", "ny"]);
    // «KID …» er ikke svak tekst (kontrakten: bare «til»/«fra»), så nøkkelen er «kid» som før.
    expect(trans.map((t) => t.laeringsKey)).toEqual([KONTO, KONTO, "20957976494", "kid"]);
  });

  it("«Kjør regler»: treffer også når lagret normalizedText er «til :»", () => {
    const trans = [
      tx({ id: "lik", normalizedText: "til :" }),
      tx({ id: "gruppert", tekst: "Til : 2095 79 76493" }),
      tx({ id: "ulik", tekst: "Til :20957976494", normalizedText: "til :" }),
      tx({ id: "lengre", tekst: `Til :${KONTO}1` }),
    ];
    const ev = evaluerReglerMotUavklarteTransaksjoner(trans, [], [BOLIGLAN], GRUPPER, [], []);
    expect(ev.alle.map((r) => [r.transaksjonId, r.utfall])).toEqual([
      ["lik", "auto"],
      ["gruppert", "auto"],
      ["ulik", "ingen_treff"],
      ["lengre", "ingen_treff"],
    ]);
  });

  it("«Treffer i dag» teller lik mottaker i alle skrivemåter, ikke andre", () => {
    const trans = [...LIK_MOTTAKER, ...ULIK_MOTTAKER].map((tekst) => ({
      tekst,
      konto: "regningskonto",
    }));
    expect(tellTreff(BOLIGLAN, trans)).toBe(LIK_MOTTAKER.length);
    expect(tellTreff(CC_MAT, [{ tekst: "Mat" }, { tekst: "CC MAT HAMAR" }])).toBe(1);
  });
});

describe("læring, spredning og flerbruk", () => {
  const post: MalPost = { id: "boliglan", name: "Boliglån", retning: "ut" };
  const plassert = (laer: boolean) => ({
    type: "plassert" as const,
    fordelinger: [{ post, belop: 13807, eiere: [{ person: "Felles", prosent: 100 }] }],
    laer,
    laerKonto: null,
    uklarValg: null,
  });

  it("læringsnøkkel: kontonummer for svak tekst, ellers normalisert tekst", () => {
    expect(laeringsnokkel(`Til :${KONTO}`)).toBe(KONTO);
    expect(laeringsnokkel("Fra: 2095.79.76493")).toBe(KONTO);
    expect(laeringsnokkel("Til :")).toBe("");
    expect(laeringsnokkel(`Til :${KONTO} / 12345678903`)).toBe("");
    expect(laeringsnokkel("REMA 1000 GRUNERLOKKA 123456789")).toBe("rema 1000 grunerlokka");
    expect(erSvakTekst("til :")).toBe(true);
    expect(erSvakTekst("nettgiro til :")).toBe(false);
  });

  it("eksisterende tallregel gjenbrukes — ingen ny «til :»-regel", () => {
    const ut = oppdaterReglerVedLaering([BOLIGLAN], tx({ id: "t" }), post, undefined, deps());
    expect(ut).toHaveLength(1);
    expect(ut[0]).toMatchObject({ id: "boliglan-regel", timesUsed: 1 });
  });

  it("uten eksisterende regel læres tallregelen på kontonummeret", () => {
    const ut = oppdaterReglerVedLaering([], tx({ id: "t" }), post, undefined, deps());
    expect(ut).toEqual([
      expect.objectContaining({
        pattern: KONTO,
        normalizedPattern: KONTO,
        matchType: "inneholder",
        targetId: "boliglan",
      }),
    ]);
    expect(treff("Til :20957976494", ut)).toBeNull();
    expect(treff(`Til: ${KONTO}`, ut)).toBe(ut[0]!.id);
  });

  it("svak tekst uten entydig tall lærer ingenting", () => {
    for (const tekst of ["Til :", `Til :${KONTO} 12345678903`]) {
      expect(oppdaterReglerVedLaering([], tx({ id: "t", tekst }), post, undefined, deps())).toEqual(
        [],
      );
    }
  });

  it("vanlig tekstlæring er uendret (rå tekst som mønster, normalisert som nøkkel)", () => {
    const ut = oppdaterReglerVedLaering(
      [],
      tx({ id: "t", tekst: "REMA 1000 GRUNERLOKKA" }),
      post,
      undefined,
      deps(),
    );
    expect(ut[0]).toMatchObject({
      pattern: "REMA 1000 GRUNERLOKKA",
      normalizedPattern: "rema 1000 grunerlokka",
    });
  });

  it("plassering med læring sprer forslag bare til samme mottaker", () => {
    const snapshot = {
      transaksjoner: [
        tx({ id: "t" }),
        tx({ id: "lik", dato: "2026-11-11", tekst: `Til: ${KONTO}` }),
        tx({ id: "ulik", dato: "2026-10-12", tekst: "Til :20957976494" }),
        tx({ id: "svak", dato: "2026-10-13", tekst: "Til :" }),
      ],
      hendelser: [] as HendelseRecord[],
      rules: [BOLIGLAN],
    };
    const endring = lagreBehandling(snapshot, "t", plassert(true), deps());
    expect(endring.hendelser!([])[0]!.regelId).toBe("boliglan-regel");
    expect(endring.rules!([BOLIGLAN])).toHaveLength(1);
    const trans = endring.transaksjoner!(snapshot.transaksjoner);
    expect(Object.fromEntries(trans.map((t) => [t.id, t.status]))).toEqual({
      t: "ny",
      lik: "foresoatt_match",
      ulik: "ny",
      svak: "ny",
    });
  });

  it("svak tekst uten tall: plasseringen lagres, men ingenting læres eller spres", () => {
    const snapshot = {
      transaksjoner: [tx({ id: "t", tekst: "Til :" }), tx({ id: "annen", tekst: "Til :" })],
      hendelser: [] as HendelseRecord[],
      rules: [] as RegelRecord[],
    };
    const endring = lagreBehandling(snapshot, "t", plassert(true), deps());
    expect(endring.hendelser!([])[0]).toMatchObject({ status: "ferdig", regelId: null });
    expect(endring.rules!([])).toEqual([]);
    const trans = endring.transaksjoner!(snapshot.transaksjoner);
    expect(trans.find((t) => t.id === "annen")!.status).toBe("ny");
  });

  it("flerbruk merker bare samme mottaker og tallregelen på den", () => {
    const annen = regel({ id: "annen", pattern: "12345678903", normalizedPattern: "12345678903" });
    const gruppert = regel({
      id: "gruppert",
      pattern: "2095.79.76493",
      normalizedPattern: "2095.79.76493",
    });
    const endring = merkFlerbruk(laeringsnokkel(`Til :${KONTO}`), NAA);
    const regler = endring.rules!([BOLIGLAN, annen, gruppert]);
    expect(regler.map((r) => [r.id, !!r.multiUse])).toEqual([
      ["boliglan-regel", true],
      ["annen", false],
      ["gruppert", true],
    ]);
    const trans = endring.transaksjoner!([
      tx({ id: "lik" }),
      tx({ id: "ulik", tekst: "Til :12345678903" }),
      tx({ id: "svak", tekst: "Til :" }),
    ]);
    expect(trans.map((t) => t.status)).toEqual(["krever_vurdering", "ny", "ny"]);
    expect(merkFlerbruk("", NAA)).toEqual({});
  });

  it("utvid tilbys aldri for en tallregel eller til et svakt prefiks", () => {
    const fordelinger = [{ post, belop: 13807, eiere: [] }];
    const t = tx({ id: "t", tekst: "Til :20957976494" });
    expect(utvidRegelForslag([BOLIGLAN], t, fordelinger, [t])).toBeNull();
    const tekstregel = regel({
      id: "tekst",
      pattern: "Til :Boliglån DNB",
      normalizedPattern: "til :boliglån dnb",
    });
    expect(utvidRegelForslag([tekstregel], t, fordelinger, [t])).toBeNull();
  });

  it("treffgrunnlag kombinerer normalisert tekst og sifferløp", () => {
    expect(treffgrunnlag(`Til :${KONTO}`)).toEqual({ normalisert: "til :", sifferlop: [KONTO] });
  });
});
