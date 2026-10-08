/**
 * Regelstyrt ansvar (#59, Kontrolltårnet 2026-10-08, oppdaget av Helen):
 * en regel styrer både plassering (post) OG eierskap (ansvar). Ansvaret er
 * en del av regelens RESULTAT; kontoen er bare et treffvilkår og bestemmer
 * aldri eier.
 *
 * Regler uten `eiere` plasserer `Felles 100 %` som før — differensielt
 * bevist mot legacy i `forsoning.legacy.test.ts`/`brukKjorRegler.legacy.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  Eierandel,
  HendelseRecord,
  MalPost,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { gjorImport, type PreviewRad } from "./bankimport";
import { lagreBehandling } from "./beslutning";
import { lagreKorrigering } from "./korrigering";
import { startFordelinger } from "./plasseringsvalg";
import { ansvarTekst, regelAnsvarTekst } from "./regelsenter";
import {
  byggKjorReglerEndringsplan,
  erEndringsplanUendret,
  evaluerReglerMotUavklarteTransaksjoner,
  oppdaterReglerVedLaering,
  regelEiere,
  skrivEndringsplan,
} from "./regler";

const NAA = "2026-10-08T09:00:00.000Z";
const ids = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
const deps = () => ({ newId: ids("ny"), naa: NAA });

const HELEN: Eierandel[] = [{ person: "Helen", prosent: 100 }];
const EIVIND: Eierandel[] = [{ person: "Eivind", prosent: 100 }];
const DELT: Eierandel[] = [
  { person: "Helen", prosent: 50 },
  { person: "Felles", prosent: 50 },
];
const FELLES: Eierandel[] = [{ person: "Felles", prosent: 100 }];

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

const budgetGroups: BudsjettGruppe[] = [
  {
    id: "mat",
    label: "Mat",
    items: [{ id: "dagligvarer", name: "Dagligvarer", months: [], meta: { eier: "Felles" } }],
  },
];

/** «Kjør regler» fra evaluering til skrevne hendelser og transaksjoner. */
function kjorRegler(transaksjoner: TransaksjonRecord[], rules: RegelRecord[]) {
  const ev = evaluerReglerMotUavklarteTransaksjoner(transaksjoner, [], rules, budgetGroups, [], []);
  const plan = byggKjorReglerEndringsplan(ev, transaksjoner, ids("h"));
  return { plan, ...skrivEndringsplan(plan, transaksjoner, NAA) };
}

describe("matching og auto-plassering bruker regelens ansvar", () => {
  it("uten eget ansvar plasseres Felles 100 % som før", () => {
    const { nyeHendelser } = kjorRegler([tx({ id: "a" })], [regel({ id: "r" })]);
    expect(nyeHendelser[0]!.fordelinger[0]!.eiere).toEqual(FELLES);
    expect(regelEiere(regel({ id: "r", eiere: [] }))).toEqual(FELLES);
  });

  it("«Kjør regler» plasserer med regelens ansvar: én eier og delt ansvar", () => {
    const helen = kjorRegler([tx({ id: "a" })], [regel({ id: "r", eiere: HELEN })]);
    expect(helen.nyeHendelser[0]!.fordelinger[0]).toMatchObject({
      plasseringId: "dagligvarer",
      belop: 312,
      eiere: HELEN,
    });
    const delt = kjorRegler([tx({ id: "a" })], [regel({ id: "r", eiere: DELT })]);
    expect(delt.nyeHendelser[0]!.fordelinger[0]!.eiere).toEqual(DELT);
  });

  it("tekst + konto → post + eier: samme tekst får hver sin eier ut fra regelen", () => {
    const regler = [
      regel({ id: "felles", eiere: FELLES }),
      regel({ id: "helen", kontoVilkar: "helen", eiere: HELEN }),
      regel({ id: "eivind", kontoVilkar: "eivind", eiere: EIVIND }),
    ];
    const { nyeHendelser } = kjorRegler(
      [
        tx({ id: "a", konto: "Helen" }),
        tx({ id: "b", konto: "Eivind" }),
        tx({ id: "c", konto: "Felleskonto" }),
      ],
      regler,
    );
    expect(nyeHendelser.map((h) => [h.transaksjonId, h.regelId, h.fordelinger[0]!.eiere])).toEqual([
      ["a", "helen", HELEN],
      ["b", "eivind", EIVIND],
      ["c", "felles", FELLES],
    ]);
  });

  it("kontoen bestemmer ALDRI eier: Helen-konto med regel-ansvar Felles gir Felles", () => {
    const { nyeHendelser } = kjorRegler(
      [tx({ id: "a", konto: "Helen" })],
      [regel({ id: "r", kontoVilkar: "helen", eiere: FELLES })],
    );
    expect(nyeHendelser[0]!.fordelinger[0]!.eiere).toEqual(FELLES);
    const utenAnsvar = kjorRegler(
      [tx({ id: "a", konto: "Helen" })],
      [regel({ id: "r", kontoVilkar: "helen" })],
    );
    expect(utenAnsvar.nyeHendelser[0]!.fordelinger[0]!.eiere).toEqual(FELLES);
  });

  it("forslag fra «Kjør regler» bærer regelens ansvar — og ingenting uten", () => {
    const med = kjorRegler([tx({ id: "a" })], [regel({ id: "r", mode: "review", eiere: HELEN })]);
    expect(med.nyeTransaksjoner[0]!.laertKobling).toMatchObject({ eiere: HELEN });
    const uten = kjorRegler([tx({ id: "a" })], [regel({ id: "r", mode: "review" })]);
    expect(uten.nyeTransaksjoner[0]!.laertKobling).not.toHaveProperty("eiere");
  });

  it("forhåndsvisningen regnes som endret når regelens ansvar endres", () => {
    const t = [tx({ id: "a" })];
    const a = kjorRegler(t, [regel({ id: "r", eiere: HELEN })]).plan;
    const b = kjorRegler(t, [regel({ id: "r", eiere: EIVIND })]).plan;
    expect(erEndringsplanUendret(a, a)).toBe(true);
    expect(erEndringsplanUendret(a, b)).toBe(false);
  });

  it("bankimport auto-plasserer med regelens ansvar; flerbruk blir vurdering som før", () => {
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
    const auto = gjorImport(
      [rad("Helen")],
      {
        rules: [regel({ id: "r", kontoVilkar: "helen", eiere: HELEN })],
        liquidityPosts: [],
        kilde: "x",
      },
      deps(),
    );
    expect(auto.hendelser!([])[0]!.fordelinger[0]!.eiere).toEqual(HELEN);

    const flerbruk = gjorImport(
      [rad("Helen")],
      { rules: [regel({ id: "r", multiUse: true, eiere: DELT })], liquidityPosts: [], kilde: "x" },
      deps(),
    );
    expect(flerbruk.hendelser).toBeUndefined();
    expect(flerbruk.transaksjoner!([])[0]).toMatchObject({ status: "krever_vurdering" });
  });
});

describe("læring lagrer ansvaret Helen valgte", () => {
  const post: MalPost = { id: "dagligvarer", name: "Dagligvarer", retning: "ut" };

  it("ny regel får ansvaret som resultat; uten ansvar er formen som før", () => {
    const med = oppdaterReglerVedLaering([], tx({ id: "a" }), post, false, deps(), {
      eiere: HELEN,
    });
    expect(med[0]).toMatchObject({ targetId: "dagligvarer", eiere: HELEN });
    const uten = oppdaterReglerVedLaering([], tx({ id: "a" }), post, false, deps());
    expect(uten[0]).not.toHaveProperty("eiere");
  });

  it("gjenlæring er et eksplisitt valg og oppdaterer ansvaret på regelen den treffer", () => {
    const fra = [regel({ id: "r", timesUsed: 3, eiere: HELEN })];
    const ut = oppdaterReglerVedLaering(fra, tx({ id: "a" }), post, false, deps(), {
      eiere: DELT,
    });
    expect(ut).toHaveLength(1);
    expect(ut[0]).toMatchObject({ id: "r", timesUsed: 4, eiere: DELT });
    // Uten ansvar i læringen røres regelens ansvar ikke.
    const urort = oppdaterReglerVedLaering(fra, tx({ id: "a" }), post, false, deps());
    expect(urort[0]!.eiere).toEqual(HELEN);
  });

  it("plassering med læring lagrer ansvar på regelen og på forslagene til like transaksjoner", () => {
    const snapshot = {
      transaksjoner: [tx({ id: "t" }), tx({ id: "lik", dato: "2026-10-02" })],
      hendelser: [] as HendelseRecord[],
      rules: [] as RegelRecord[],
    };
    const endring = lagreBehandling(
      snapshot,
      "t",
      {
        type: "plassert",
        fordelinger: [{ post, belop: 312, eiere: DELT }],
        laer: true,
        uklarValg: null,
      },
      deps(),
    );
    expect(endring.hendelser!([])[0]!.fordelinger[0]!.eiere).toEqual(DELT);
    expect(endring.rules!([])).toEqual([expect.objectContaining({ eiere: DELT })]);
    const lik = endring.transaksjoner!(snapshot.transaksjoner).find((x) => x.id === "lik")!;
    expect(lik).toMatchObject({ status: "foresoatt_match", laertKobling: { eiere: DELT } });
  });

  it("splitt med læring: regelen lærer posten og ansvaret til linjen den peker på", () => {
    const kantine: MalPost = { id: "kantine", name: "Kantine", retning: "ut" };
    const snapshot = {
      transaksjoner: [tx({ id: "t" })],
      hendelser: [] as HendelseRecord[],
      rules: [] as RegelRecord[],
    };
    const endring = lagreBehandling(
      snapshot,
      "t",
      {
        type: "plassert",
        fordelinger: [
          { post: kantine, belop: 200, eiere: HELEN },
          { post, belop: 112, eiere: FELLES },
        ],
        laer: true,
        uklarValg: null,
      },
      deps(),
    );
    expect(endring.rules!([])).toEqual([
      expect.objectContaining({ targetId: "kantine", eiere: HELEN }),
    ]);
  });

  it("korrigering med læring lagrer ansvaret på regelen", () => {
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
    const endring = lagreKorrigering(
      hendelse,
      tx({ id: "t" }),
      {
        type: null,
        linjer: [{ id: "l", post, belop: 312, eiere: EIVIND, postErEndret: false }],
        uklar: null,
        laer: true,
      },
      [],
      deps(),
    );
    expect(endring.rules!([])).toEqual([expect.objectContaining({ eiere: EIVIND })]);
  });

  it("et forslag med lært ansvar forhåndsvelger ansvaret i stedet for postens standard", () => {
    const g = { budgetGroups, incomeGroups: [], sparingGroups: [] };
    const lk = { budgetItemId: "dagligvarer", navn: "Dagligvarer", flerbruk: false };
    const med = startFordelinger(
      tx({ id: "t", status: "foresoatt_match", laertKobling: { ...lk, eiere: HELEN } }),
      false,
      g,
      ids("l"),
    );
    expect(med[0]!.eiere).toEqual(HELEN);
    const uten = startFordelinger(
      tx({ id: "t", status: "foresoatt_match", laertKobling: lk }),
      false,
      g,
      ids("l"),
    );
    expect(uten[0]!.eiere).toEqual(FELLES);
  });
});

describe("Regelsenter-tekst for ansvar", () => {
  it("viser eget ansvar, delt ansvar og standarden", () => {
    expect(ansvarTekst(HELEN)).toBe("Helen");
    expect(ansvarTekst(DELT)).toBe("Helen 50 % · Felles 50 %");
    expect(regelAnsvarTekst({ eiere: EIVIND })).toBe("Eivind");
    expect(regelAnsvarTekst({})).toBe("Felles (standard)");
    expect(regelAnsvarTekst({ eiere: [] })).toBe("Felles (standard)");
  });
});
