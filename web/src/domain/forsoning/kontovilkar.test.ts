/**
 * Avanserte regler (#59, Kontrolltårnet 2026-10-08): sammensatte kriterier
 * med AND-logikk — transaksjonstekst OG kontoen betalingen er gjort fra.
 *
 * Kjernen er regresjonen Helen trenger: samme tekst («REMA 1000») på
 * Felles-, Eivind- og Helen-kontoen skal kunne gå til hver sin post, og
 * bare den riktige sammensatte regelen skal treffe. At regler UTEN
 * kontovilkår er uendret, er bevist differensielt mot legacy i
 * `forsoning.legacy.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { HendelseRecord, MalPost, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import { gjorImport, type PreviewRad } from "./bankimport";
import { lagreBehandling, utvidRegelForslag } from "./beslutning";
import { lagreKorrigering } from "./korrigering";
import { kontoForLaering, regelVilkarTekst, tellTreff } from "./regelsenter";
import {
  evaluerReglerMotUavklarteTransaksjoner,
  findMatchingRule,
  oppdaterReglerVedLaering,
  regelMatcherKonto,
} from "./regler";

const NAA = "2026-10-08T08:00:00.000Z";
const idSequence = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
const deps = () => ({ newId: idSequence("ny"), naa: NAA });

const regel = (o: Partial<RegelRecord> & { id: string }): RegelRecord => ({
  pattern: "REMA 1000",
  normalizedPattern: "rema 1000",
  matchType: "inneholder",
  targetType: "budget",
  targetId: "dagligvarer",
  targetName: "Dagligvarer",
  mode: "auto",
  confidence: 100,
  active: true,
  ...o,
});

const tx = (o: Partial<TransaksjonRecord> & { id: string }): TransaksjonRecord => ({
  dato: "2026-10-01",
  tekst: "REMA 1000 GRUNERLOKKA",
  belop: 312,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...o,
});

/** Én generell regel og to sammensatte for samme tekst. */
const REGLER: RegelRecord[] = [
  regel({ id: "felles" }),
  regel({
    id: "helen",
    kontoVilkar: "helen",
    targetId: "helen-lomme",
    targetName: "Helens lommepenger",
  }),
  regel({
    id: "eivind",
    kontoVilkar: "eivind",
    targetId: "eivind-lomme",
    targetName: "Eivinds lommepenger",
  }),
];

const treffFor = (konto: string | null, regler = REGLER, importkilde?: string) =>
  findMatchingRule({ normalizedText: "rema 1000 grunerlokka", konto, importkilde }, regler).rule
    ?.id ?? null;

describe("matchingmotoren: tekst OG konto", () => {
  it("samme tekst på ulike kontoer treffer bare den riktige sammensatte regelen", () => {
    expect(treffFor("Helen brukskonto")).toBe("helen");
    expect(treffFor("Eivind")).toBe("eivind");
    expect(treffFor("Felleskonto")).toBe("felles");
    expect(treffFor("regningskonto")).toBe("felles");
  });

  it("uten en generell regel treffer ingenting på en konto ingen regel gjelder", () => {
    const bareKonto = REGLER.filter((r) => r.kontoVilkar);
    expect(treffFor("Felleskonto", bareKonto)).toBeNull();
    expect(treffFor("helen", bareKonto)).toBe("helen");
    const t = findMatchingRule({ normalizedText: "rema 1000", konto: "Felleskonto" }, bareKonto);
    expect(t).toEqual({
      rule: null,
      confidence: 0,
      begrunnelse: "Ingen regel matcher denne transaksjonen",
    });
  });

  it("riktig konto men feil tekst treffer ikke — begge vilkår må stemme", () => {
    expect(
      findMatchingRule({ normalizedText: "kiwi 505", konto: "helen" }, REGLER).rule,
    ).toBeNull();
  });

  it("den sammensatte regelen vinner over en generell regel med høyere poengsum", () => {
    const regler = [
      regel({ id: "eksakt", matchType: "er_lik", normalizedPattern: "rema 1000 grunerlokka" }),
      regel({ id: "helen", kontoVilkar: "helen", confidence: 80 }),
    ];
    const t = findMatchingRule({ normalizedText: "rema 1000 grunerlokka", konto: "helen" }, regler);
    expect(t.rule?.id).toBe("helen");
    expect(t.confidence).toBe(56);
    expect(t.begrunnelse).toBe("Monsteret inngar i teksten og kontoen stemmer");
    expect(treffFor("Felleskonto", regler)).toBe("eksakt");
  });

  it("en betaling uten kjent konto treffer aldri en kontoregel", () => {
    expect(regelMatcherKonto({ kontoVilkar: "helen" }, {})).toBe(false);
    expect(regelMatcherKonto({ kontoVilkar: "helen" }, null)).toBe(false);
    expect(treffFor(null)).toBe("felles");
  });

  it("kontoen leses som kontofilteret: importkilde når kontofeltet mangler, MC for DNB", () => {
    expect(treffFor(null, REGLER, "Helen")).toBe("helen");
    const mc = [regel({ id: "mc", kontoVilkar: "MC" })];
    expect(treffFor("MC", mc)).toBe("mc");
    expect(treffFor(null, mc, "dnb")).toBe("mc");
    expect(treffFor("helen", mc)).toBeNull();
  });

  it("deaktiverte kontoregler slipper den generelle regelen til", () => {
    const regler = REGLER.map((r) => (r.id === "helen" ? { ...r, active: false } : r));
    expect(treffFor("helen", regler)).toBe("felles");
  });
});

describe("alle kallerne bruker kontoen", () => {
  it("bankimport plasserer samme tekst på hver sin post ut fra konto", () => {
    const rad = (konto: string): PreviewRad => ({
      dato: "2026-10-01",
      tekst: "REMA 1000 GRUNERLOKKA",
      belop: 312,
      retning: "ut",
      konto,
      originalRad: "",
      laeringsKey: "rema 1000 grunerlokka",
      _dupKey: konto,
      erDuplikat: false,
      status: "ny",
    });
    const endring = gjorImport(
      [rad("Helen"), rad("Eivind"), rad("Felleskonto")],
      { rules: REGLER, liquidityPosts: [], kilde: "sparebank1" },
      deps(),
    );
    const hendelser = endring.hendelser!([]);
    expect(hendelser.map((h) => [h.fordelinger[0]!.plasseringId, h.regelId])).toEqual([
      ["helen-lomme", "helen"],
      ["eivind-lomme", "eivind"],
      ["dagligvarer", "felles"],
    ]);
  });

  it("«Kjør regler» vurderer hver transaksjon mot sin egen konto", () => {
    const trans = [
      tx({ id: "a", konto: "helen" }),
      tx({ id: "b", konto: "eivind" }),
      tx({ id: "c", konto: "Felleskonto" }),
    ];
    const grupper = [
      {
        id: "g",
        label: "G",
        items: ["dagligvarer", "helen-lomme", "eivind-lomme"].map((id) => ({
          id,
          name: id,
          months: [],
        })),
      },
    ];
    const ev = evaluerReglerMotUavklarteTransaksjoner(trans, [], REGLER, grupper, [], []);
    expect(ev.alle.map((r) => [r.transaksjonId, r.regel?.id])).toEqual([
      ["a", "helen"],
      ["b", "eivind"],
      ["c", "felles"],
    ]);
  });

  it("«Treffer i dag» teller bare observasjoner fra regelens konto", () => {
    const trans = [
      tx({ id: "a", konto: "helen" }),
      tx({ id: "b", konto: "eivind" }),
      tx({ id: "c", konto: "Felleskonto" }),
      tx({ id: "d", konto: "helen", tekst: "KIWI 505" }),
    ];
    expect(tellTreff(REGLER[0]!, trans)).toBe(3);
    expect(tellTreff(REGLER[1]!, trans)).toBe(1);
  });
});

describe("læring av sammensatte regler", () => {
  const post: MalPost = { id: "helen-lomme", name: "Helens lommepenger", retning: "ut" };

  it("læring med kontovilkår oppretter en ny sammensatt regel", () => {
    const ut = oppdaterReglerVedLaering([], tx({ id: "a" }), post, false, deps(), "helen");
    expect(ut).toHaveLength(1);
    expect(ut[0]).toMatchObject({
      normalizedPattern: "rema 1000 grunerlokka",
      targetId: "helen-lomme",
      kontoVilkar: "helen",
      mode: "auto",
    });
  });

  it("læring uten kontovilkår skriver ikke feltet (samme form som før)", () => {
    const ut = oppdaterReglerVedLaering([], tx({ id: "a" }), post, false, deps());
    expect(ut[0]).not.toHaveProperty("kontoVilkar");
  });

  it("læring gjenbruker bare en regel med SAMME kontovilkår — ingen stille omskriving", () => {
    const fra = [
      regel({ id: "generell", targetId: "helen-lomme", timesUsed: 4 }),
      regel({ id: "helen", targetId: "helen-lomme", kontoVilkar: "helen", timesUsed: 2 }),
    ];
    const medKonto = oppdaterReglerVedLaering(fra, tx({ id: "a" }), post, false, deps(), "helen");
    expect(medKonto.map((r) => [r.id, r.timesUsed, r.kontoVilkar ?? null])).toEqual([
      ["generell", 4, null],
      ["helen", 3, "helen"],
    ]);
    const utenKonto = oppdaterReglerVedLaering(fra, tx({ id: "a" }), post, false, deps());
    expect(utenKonto.map((r) => [r.id, r.timesUsed])).toEqual([
      ["generell", 5],
      ["helen", 2],
    ]);
  });

  it("en ren tekstlæring oppretter ny regel selv om det finnes en kontoregel for posten", () => {
    const fra = [regel({ id: "helen", targetId: "helen-lomme", kontoVilkar: "helen" })];
    const ut = oppdaterReglerVedLaering(fra, tx({ id: "a" }), post, false, deps());
    expect(ut).toHaveLength(2);
    expect(ut[0]).toEqual(fra[0]);
    expect(ut[1]).not.toHaveProperty("kontoVilkar");
  });

  it("plassering med «Bare fra Helen» lærer kontoregel og foreslår bare Helens like transaksjoner", () => {
    const snapshot = {
      transaksjoner: [
        tx({ id: "t", konto: "helen" }),
        tx({ id: "lik-helen", konto: "helen", dato: "2026-10-02" }),
        tx({ id: "lik-felles", konto: "Felleskonto", dato: "2026-10-03" }),
      ],
      hendelser: [] as HendelseRecord[],
      rules: [] as RegelRecord[],
    };
    const endring = lagreBehandling(
      snapshot,
      "t",
      {
        type: "plassert",
        fordelinger: [{ post, belop: 312, eiere: [{ person: "Helen", prosent: 100 }] }],
        laer: true,
        laerKonto: "helen",
        uklarValg: null,
      },
      deps(),
    );
    expect(endring.rules!([])).toEqual([
      expect.objectContaining({ kontoVilkar: "helen", targetId: "helen-lomme" }),
    ]);
    const trans = endring.transaksjoner!(snapshot.transaksjoner);
    expect(trans.find((t) => t.id === "lik-helen")!.status).toBe("foresoatt_match");
    expect(trans.find((t) => t.id === "lik-felles")!.status).toBe("ny");
  });

  it("kontovalget ignoreres når «Lær» ikke er krysset av", () => {
    const snapshot = {
      transaksjoner: [tx({ id: "t", konto: "helen" })],
      hendelser: [] as HendelseRecord[],
      rules: [] as RegelRecord[],
    };
    const endring = lagreBehandling(
      snapshot,
      "t",
      {
        type: "plassert",
        fordelinger: [{ post, belop: 312, eiere: [{ person: "Helen", prosent: 100 }] }],
        laer: false,
        laerKonto: "helen",
        uklarValg: null,
      },
      deps(),
    );
    expect(endring.rules).toBeUndefined();
  });

  it("korrigering med kontovilkår lærer en sammensatt regel og peker hendelsen dit", () => {
    const fra = [regel({ id: "helen", targetId: "helen-lomme", kontoVilkar: "helen" })];
    const hendelse: HendelseRecord = {
      id: "h",
      status: "ferdig",
      paaVentAarsak: null,
      transaksjonId: "t",
      receiptId: null,
      fordelinger: [],
      dato: "2026-10-01",
      regelId: null,
      opprettet: NAA,
      oppdatert: NAA,
    };
    const linje = {
      id: "l",
      post,
      belop: 312,
      eiere: [{ person: "Helen", prosent: 100 }],
      postErEndret: false,
    };
    const endring = lagreKorrigering(
      hendelse,
      tx({ id: "t", konto: "helen" }),
      { type: null, linjer: [linje], uklar: null, laer: true, laerKonto: "helen" },
      fra,
      deps(),
    );
    expect(endring.hendelser!([hendelse])[0]!.regelId).toBe("helen");
    expect(endring.rules!(fra)).toEqual([expect.objectContaining({ id: "helen", timesUsed: 1 })]);
  });

  it("«Bruk og utvid» tilbys bare for en regel med samme kontovilkår", () => {
    const fordelinger = [{ post, belop: 312, eiere: [] }];
    const t = tx({ id: "t", konto: "helen", tekst: "REMA 1000 MAJORSTUEN" });
    const regler = [
      regel({
        id: "generell",
        targetId: "helen-lomme",
        matchType: "er_lik",
        normalizedPattern: "rema 1000 grunerlokka",
      }),
    ];
    expect(utvidRegelForslag(regler, t, fordelinger, [t])?.regel.id).toBe("generell");
    expect(utvidRegelForslag(regler, t, fordelinger, [t], "helen")).toBeNull();
  });
});

describe("Regelsenter-tekst", () => {
  it("viser begge vilkårene i klartekst", () => {
    expect(regelVilkarTekst(REGLER[0]!)).toBe("Inneholder «rema 1000»");
    expect(regelVilkarTekst(REGLER[1]!)).toBe("Inneholder «rema 1000» og betalt fra Helen");
    expect(regelVilkarTekst({ ...REGLER[1]!, kontoVilkar: "felleskonto" })).toBe(
      "Inneholder «rema 1000» og betalt fra Felleskonto",
    );
  });

  it("kontoen en læring kan låses til er den kanoniske kontoen, eller ingen", () => {
    expect(kontoForLaering({ konto: "Helen brukskonto" })).toBe("helen");
    expect(kontoForLaering({ konto: null, importkilde: "dnb" })).toBe("MC");
    expect(kontoForLaering({ konto: null })).toBeNull();
    expect(kontoForLaering(null)).toBeNull();
  });
});
