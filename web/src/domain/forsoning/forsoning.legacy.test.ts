/**
 * DIFFERENSIELL karakterisering av forsoningslagets rene motorer (§Issue
 * #34, R0): hver TypeScript-port kjøres side om side med den FAKTISKE
 * legacy-funksjonen, trukket ut av `index.html` (§src/test/legacy.ts), på
 * samme input — med samme frosne klokke og samme id-sekvens. Ethvert avvik
 * i porten feiler testen.
 *
 * I tillegg til likhet låser noen tester eksplisitt de viktigste reglene
 * (og de kjente særegenhetene fra kartleggingen 5938206324), slik at en
 * fremtidig legacy-endring ikke stille flytter fasiten.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { idSequence, loadLegacy } from "../../test/legacy";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  HendelseRecord,
  KvitteringRecord,
  MalPost,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import * as parse from "./bankimportParse";
import * as fordeling from "./fordeling";
import * as intern from "./internOverforing";
import * as kvittering from "./kvittering";
import * as regler from "./regler";
import * as tekst from "./tekst";

const NAA = "2026-09-15T10:00:00.000Z";

type AnyFn = (...args: unknown[]) => unknown;
let legacyUid: () => string = idSequence();
const legacy = loadLegacy<Record<string, AnyFn>>({
  functions: [
    "normaliserTransaksjonstekst",
    "normalizeMerchant",
    "belopMatcherIOre",
    "dagerMellom",
    "fellesPrefiks",
    "regelMatcherTekst",
    "findMatchingRule",
    "finnMalpostForRegel",
    "evaluerReglerMotUavklarteTransaksjoner",
    "byggKjorReglerEndringsplan",
    "erEndringsplanUendret",
    "skrivEndringsplan",
    "oppdaterReglerVedLaering",
    "finnHendelseForTransaksjon",
    "finnHendelseForKvittering",
    "byggFordelingFraPost",
    "byggManuellHendelse",
    "byggKorrigertHendelse",
    "calculateSplitTotal",
    "erKvitteringKlarForLukking",
    "vurderKvitteringKobling",
    "finnKvitteringTransaksjonKandidater",
    "fordelingerFraKvitteringSplits",
    "byggSynkronisertKvitteringOgHendelse",
    "findReceipt",
    "kontoUlik",
    "retningMotsatt",
    "finnInterneOverforingsKandidater",
    "bekreftInternOverforing",
    "jevnFordelEiere",
    "beregnRestPaaSisteLinje",
    "byggAlleMalPoster",
    "byggAlleSparingPoster",
  ],
  constValues: ["BELOPSTOLERANSE_KOBLING", "KVITTERING_TIDSVINDU_DAGER"],
  constArrows: ["parseCSV", "mapRad", "dupKey", "normaliserKonto"],
  globals: { uid: () => legacyUid() },
});
const L = (name: string) => {
  const fn = legacy[name];
  if (!fn) throw new Error(`Legacy-funksjon mangler: ${name}`);
  return fn;
};

/** Ny, identisk id-sekvens for legacy og port før hver sammenligning. */
function freshIds() {
  legacyUid = idSequence();
  return idSequence();
}
const deps = () => ({ newId: freshIds(), naa: NAA });

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NAA));
});
afterAll(() => vi.useRealTimers());
beforeEach(() => void freshIds());

// ── Fixtures ────────────────────────────────────────────────────────
const tolv = () => Array.from({ length: 12 }, () => ({ budget: 0, spent: 0 }));
const budgetGroups: BudsjettGruppe[] = [
  {
    id: "mat",
    label: "Mat",
    items: [
      { id: "dagligvarer", name: "Dagligvarer", months: tolv(), meta: { eier: "Felles" } },
      { id: "kantine", name: "Kantine", months: tolv(), meta: { eier: "Helen" } },
      { id: "gammel", name: "Gammel post", months: tolv(), meta: { arkivert: true } },
    ],
  },
  { id: "bil", label: "Bil", items: [{ id: "drivstoff", name: "Drivstoff", months: tolv() }] },
];
const incomeGroups: BudsjettGruppe[] = [
  {
    id: "lonn",
    label: "Lønn",
    items: [{ id: "lonnHelen", name: "Lønn Helen", months: tolv(), meta: null }],
  },
];
const sparingGroups: BudsjettGruppe[] = [
  {
    id: "buffer",
    label: "Buffer",
    items: [{ id: "bufferkonto", name: "Bufferkonto", months: tolv() }],
  },
];

const tx = (o: Partial<TransaksjonRecord> & { id: string }): TransaksjonRecord => ({
  dato: "2026-09-10",
  tekst: "REMA 1000 GRUNERLOKKA",
  belop: 250,
  retning: "ut",
  konto: "felleskonto",
  status: "ny",
  ...o,
});
const transaksjoner: TransaksjonRecord[] = [
  tx({ id: "t1" }),
  tx({ id: "t2", tekst: "CIRCLE K 12.09 #4411", belop: 600 }),
  tx({ id: "t3", tekst: "Lønn fra Arbeidsgiver AS sept 2026", belop: 42000, retning: "inn" }),
  tx({ id: "t4", tekst: "Overføring buffer", belop: 5000, konto: "felleskonto" }),
  tx({
    id: "t5",
    tekst: "Overføring buffer",
    belop: 5000,
    retning: "inn",
    konto: "helen",
    dato: "2026-09-11",
  }),
  tx({ id: "t6", tekst: "Netflix", belop: 129, status: "ignorert" }),
  tx({ id: "t7", tekst: "KIWI 505 MAJORSTUEN", belop: 99.5, dato: "2026-09-12" }),
  tx({ id: "t8", tekst: "Spotify", belop: 129, behandlingstype: "intern_overforing" }),
  tx({ id: "t9", tekst: "REMA 1000 GRUNERLOKKA", belop: 250, dato: "2026-09-14" }),
  // Refusjon (inn) med samme beløp/dato som kvittering k1 — må ALDRI bli kvitteringskandidat.
  tx({ id: "t10", tekst: "REMA 1000 REFUSJON", belop: 250, retning: "inn", dato: "2026-09-11" }),
  // Motpart til t4 nøyaktig 3 dager unna — utenfor 0–2-dagersvinduet for intern overføring.
  tx({
    id: "t11",
    tekst: "Overføring buffer",
    belop: 5000,
    retning: "inn",
    konto: "regningskonto",
    dato: "2026-09-13",
  }),
];
const hendelse = (o: Partial<HendelseRecord> & { id: string }): HendelseRecord => ({
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [],
  dato: "2026-09-10",
  regelId: null,
  opprettet: NAA,
  oppdatert: NAA,
  ...o,
});
const hendelser: HendelseRecord[] = [
  hendelse({
    id: "h1",
    transaksjonId: "t1",
    fordelinger: [
      {
        plasseringId: "dagligvarer",
        plasseringType: "budget",
        plasseringNavn: "Dagligvarer",
        belop: 250,
        eiere: [{ person: "Felles", prosent: 100 }],
      },
    ],
  }),
  hendelse({ id: "h2", transaksjonId: "t2", status: "pa_vent", paaVentAarsak: "maa_avklares" }),
  hendelse({ id: "h3", transaksjonId: "t9", receiptId: "kAnnen" }),
];
const regel = (o: Partial<RegelRecord> & { id: string }): RegelRecord => ({
  pattern: "rema 1000",
  normalizedPattern: "rema 1000",
  targetType: "budget",
  targetId: "dagligvarer",
  targetName: "Dagligvarer",
  mode: "auto",
  ...o,
});
const rules: RegelRecord[] = [
  regel({ id: "r1" }),
  regel({
    id: "r2",
    normalizedPattern: "circle k",
    pattern: "circle k",
    targetId: "drivstoff",
    targetName: "Drivstoff",
    mode: "review",
  }),
  regel({
    id: "r3",
    normalizedPattern: "lønn fra arbeidsgiver as",
    matchType: "starter_med",
    targetType: "income",
    targetId: "lonnHelen",
    targetName: "Lønn Helen",
  }),
  regel({ id: "r4", normalizedPattern: "kiwi", targetId: "slettetPost", targetName: "Slettet" }),
  regel({
    id: "r5",
    normalizedPattern: "overføring buffer",
    targetType: "sparing",
    targetId: "bufferkonto",
    targetName: "Bufferkonto",
    confidence: 50,
  }),
  regel({ id: "r6", normalizedPattern: "netflix", active: false }),
  regel({ id: "r7", normalizedPattern: "spotify", mode: "disabled" }),
  regel({
    id: "r8",
    normalizedPattern: "rema 1000 grunerlokka",
    matchType: "er_lik",
    targetId: "kantine",
    targetName: "Kantine",
  }),
];
const kv = (o: Partial<KvitteringRecord> & { id: string }): KvitteringRecord => ({
  merchant: "Rema 1000",
  purchaseDate: "2026-09-10",
  total: 250,
  allocationMode: "single",
  splits: [
    { targetType: "budget", targetId: "dagligvarer", targetName: "Dagligvarer", amount: 250 },
  ],
  matchingStatus: "unmatched",
  hendelseId: null,
  ...o,
});

// ── Tekst ───────────────────────────────────────────────────────────
const BANKTEKSTER = [
  "REMA 1000 GRUNERLOKKA",
  "CIRCLE K 12.09 #4411",
  "Lønn fra Arbeidsgiver AS sept 2026",
  "VIPPS*KIWI 505 15/09",
  "Husleie KID 123456789012",
  "Spotify (12)",
  "  Mange   mellomrom  ",
  "Kjøp 03.04.2025 Elkjøp",
  "januar regning 2031",
  "",
];

describe("tekst", () => {
  it.each(BANKTEKSTER)("normaliserTransaksjonstekst(%j) ≡ legacy", (t) => {
    expect(tekst.normaliserTransaksjonstekst(t)).toBe(L("normaliserTransaksjonstekst")(t));
  });

  it("låst: fjerner måned+dag, #løpenummer, KID og årstall", () => {
    expect(tekst.normaliserTransaksjonstekst("CIRCLE K 12.09 #4411")).toBe("circle k");
    expect(tekst.normaliserTransaksjonstekst("Husleie KID 123456789012")).toBe("husleie kid");
  });

  it.each([["REMA-1000"], ["Rema 1000"], [null], ["KIWI_505"]])(
    "normalizeMerchant(%j) ≡ legacy",
    (t) => {
      expect(tekst.normalizeMerchant(t)).toBe(L("normalizeMerchant")(t));
    },
  );

  it.each([
    [100, 100],
    [100, -100],
    [99.995, 100],
    [0.1 + 0.2, 0.3],
    [null, 0],
    [12.34, 12.35],
  ])("belopMatcherIOre(%j, %j) ≡ legacy", (a, b) => {
    expect(tekst.belopMatcherIOre(a, b)).toBe(L("belopMatcherIOre")(a, b));
  });

  it.each([
    ["2026-09-10", "2026-09-15"],
    ["2026-09-15", "2026-09-10"],
    ["2026-03-28", "2026-03-30"],
    [null, "2026-09-10"],
  ])("dagerMellom(%j, %j) ≡ legacy", (a, b) => {
    expect(tekst.dagerMellom(a, b)).toBe(L("dagerMellom")(a, b));
  });

  it.each([
    ["rema 1000 grunerlokka", "rema 1000 majorstuen"],
    ["circle k", "circle k"],
    ["kiwi 505", "kiwi"],
    ["abc", "xyz"],
  ])("fellesPrefiks(%j, %j) ≡ legacy", (a, b) => {
    expect(tekst.fellesPrefiks(a, b)).toBe(L("fellesPrefiks")(a, b));
  });
});

// ── Regler ──────────────────────────────────────────────────────────
describe("regelmotoren", () => {
  it("regelMatcherTekst ≡ legacy for alle regler × alle tekster", () => {
    for (const r of rules) {
      for (const t of BANKTEKSTER.map(tekst.normaliserTransaksjonstekst)) {
        expect(regler.regelMatcherTekst(r, t), `${r.id} / ${t}`).toBe(L("regelMatcherTekst")(r, t));
      }
    }
  });

  it("låst særegenhet: «inneholder» matcher også når mønsteret inneholder teksten", () => {
    expect(
      regler.regelMatcherTekst(
        regel({ id: "x", normalizedPattern: "rema 1000 grunerlokka" }),
        "rema",
      ),
    ).toBe(true);
  });

  it("findMatchingRule ≡ legacy for alle tekster, og med tomme/inaktive regelsett", () => {
    for (const t of BANKTEKSTER) {
      const input = { normalizedText: tekst.normaliserTransaksjonstekst(t) };
      expect(regler.findMatchingRule(input, rules)).toEqual(L("findMatchingRule")(input, rules));
    }
    expect(regler.findMatchingRule({ tekst: "x" }, [])).toEqual(
      L("findMatchingRule")({ tekst: "x" }, []),
    );
    const inaktive = rules.filter((r) => r.active === false);
    expect(regler.findMatchingRule({ tekst: "netflix" }, inaktive)).toEqual(
      L("findMatchingRule")({ tekst: "netflix" }, inaktive),
    );
  });

  it("avanserte regler (#59): regler UTEN kontovilkår ≡ legacy også når transaksjonen bærer konto", () => {
    for (const t of BANKTEKSTER) {
      for (const konto of ["helen", "Felleskonto", "MC", null]) {
        for (const importkilde of [undefined, "sparebank1", "dnb"]) {
          const input = {
            normalizedText: tekst.normaliserTransaksjonstekst(t),
            konto,
            importkilde,
          };
          expect(regler.findMatchingRule(input, rules), `${t} / ${konto} / ${importkilde}`).toEqual(
            L("findMatchingRule")(input, rules),
          );
        }
      }
    }
    const trans = BANKTEKSTER.map((t, i) =>
      tx({ id: "k" + i, tekst: t, konto: i % 2 ? "helen" : "eivind" }),
    );
    expect(
      regler.evaluerReglerMotUavklarteTransaksjoner(
        trans,
        [],
        rules,
        budgetGroups,
        incomeGroups,
        sparingGroups,
      ),
    ).toEqual(
      L("evaluerReglerMotUavklarteTransaksjoner")(
        trans,
        [],
        rules,
        budgetGroups,
        incomeGroups,
        sparingGroups,
      ),
    );
  });

  it("låst: er_lik (100) slår inneholder (70), og confidence vekter scoren", () => {
    const treff = regler.findMatchingRule({ normalizedText: "rema 1000 grunerlokka" }, rules);
    expect(treff.rule?.id).toBe("r8");
    expect(treff.confidence).toBe(100);
    expect(regler.findMatchingRule({ normalizedText: "overføring buffer" }, rules).confidence).toBe(
      35,
    );
  });

  it("finnMalpostForRegel ≡ legacy (budget, income, sparing, mangler)", () => {
    for (const r of rules) {
      expect(regler.finnMalpostForRegel(r, budgetGroups, incomeGroups, sparingGroups)).toEqual(
        L("finnMalpostForRegel")(r, budgetGroups, incomeGroups, sparingGroups),
      );
    }
  });

  it("evaluerReglerMotUavklarteTransaksjoner ≡ legacy", () => {
    const args = [
      transaksjoner,
      hendelser,
      rules,
      budgetGroups,
      incomeGroups,
      sparingGroups,
    ] as const;
    const port = regler.evaluerReglerMotUavklarteTransaksjoner(...args);
    expect(port).toEqual(L("evaluerReglerMotUavklarteTransaksjoner")(...args));
    // Låst: ferdig hendelse, ignorert og intern overføring er aldri kandidater;
    // på-vent blir alltid forslag.
    const ider = port.alle.map((r) => r.transaksjonId);
    expect(ider).not.toContain("t1");
    expect(ider).not.toContain("t6");
    expect(ider).not.toContain("t8");
    expect(port.alle.find((r) => r.transaksjonId === "t2")).toMatchObject({
      utfall: "forslag",
      aarsak: "pa_vent",
    });
    expect(port.malMangler.map((r) => r.transaksjonId)).toEqual(["t7"]);
  });

  it("byggKjorReglerEndringsplan ≡ legacy (samme id-sekvens), og erEndringsplanUendret ignorerer hendelseId", () => {
    const evaluering = regler.evaluerReglerMotUavklarteTransaksjoner(
      transaksjoner,
      hendelser,
      rules,
      budgetGroups,
      incomeGroups,
      sparingGroups,
    );
    const newId = freshIds();
    const port = regler.byggKjorReglerEndringsplan(evaluering, transaksjoner, newId);
    expect(port).toEqual(L("byggKjorReglerEndringsplan")(evaluering, transaksjoner));

    const annenIdPlan = regler.byggKjorReglerEndringsplan(
      evaluering,
      transaksjoner,
      idSequence("annen"),
    );
    expect(regler.erEndringsplanUendret(port, annenIdPlan)).toBe(true);
    expect(L("erEndringsplanUendret")(port, annenIdPlan)).toBe(true);
    expect(regler.erEndringsplanUendret(port, port.slice(1))).toBe(false);
  });

  it("skrivEndringsplan ≡ legacy", () => {
    const evaluering = regler.evaluerReglerMotUavklarteTransaksjoner(
      transaksjoner,
      hendelser,
      rules,
      budgetGroups,
      incomeGroups,
      sparingGroups,
    );
    const plan = regler.byggKjorReglerEndringsplan(evaluering, transaksjoner, freshIds());
    expect(regler.skrivEndringsplan(plan, transaksjoner, NAA)).toEqual(
      L("skrivEndringsplan")(plan, transaksjoner),
    );
  });

  it.each<[string, MalPost, boolean | undefined]>([
    [
      "eksisterende regel oppdateres",
      { id: "dagligvarer", name: "Dagligvarer", retning: "ut" },
      undefined,
    ],
    ["ny regel (kostnad)", { id: "kantine", name: "Kantine", retning: "ut", gruppe: "Mat" }, false],
    [
      "ny regel (sparing)",
      { id: "bufferkonto", name: "Bufferkonto", retning: "ut", plasseringType: "sparing" },
      true,
    ],
    ["ny regel (inntekt)", { id: "lonnHelen", name: "Lønn Helen", retning: "inn" }, undefined],
    [
      "eksisterende regel blir flerbruk",
      { id: "dagligvarer", name: "Dagligvarer", retning: "ut" },
      true,
    ],
  ])("oppdaterReglerVedLaering: %s ≡ legacy", (_navn, post, multiUse) => {
    const t = { tekst: "REMA 1000 GRUNERLOKKA 12.09" };
    const d = deps();
    expect(regler.oppdaterReglerVedLaering(rules, t, post, multiUse, d)).toEqual(
      L("oppdaterReglerVedLaering")(rules, t, post, multiUse),
    );
  });
});

// ── Fordeling og hendelser ──────────────────────────────────────────
describe("fordeling og hendelser", () => {
  it.each([[[]], [["Felles"]], [["Helen", "Eivind"]], [["A", "B", "C"]], [null]])(
    "jevnFordelEiere(%j) ≡ legacy",
    (personer) => {
      expect(fordeling.jevnFordelEiere(personer)).toEqual(L("jevnFordelEiere")(personer));
    },
  );

  it("beregnRestPaaSisteLinje ≡ legacy", () => {
    const linjer = [{ belop: 100 }, { belop: 50 }, { belop: 0 }];
    expect(fordeling.beregnRestPaaSisteLinje(linjer, 400, "belop")).toEqual(
      L("beregnRestPaaSisteLinje")(linjer, 400, "belop"),
    );
    expect(fordeling.beregnRestPaaSisteLinje([], 400, "belop")).toEqual(
      L("beregnRestPaaSisteLinje")([], 400, "belop"),
    );
  });

  it("byggAlleMalPoster / byggAlleSparingPoster ≡ legacy (arkiverte utelatt)", () => {
    expect(fordeling.byggAlleMalPoster(budgetGroups, incomeGroups)).toEqual(
      L("byggAlleMalPoster")(budgetGroups, incomeGroups),
    );
    expect(fordeling.byggAlleSparingPoster(sparingGroups)).toEqual(
      L("byggAlleSparingPoster")(sparingGroups),
    );
    expect(fordeling.byggAlleMalPoster(budgetGroups, incomeGroups).map((p) => p.id)).not.toContain(
      "gammel",
    );
  });

  it.each<[string, MalPost, "inn" | "ut"]>([
    ["kostnad, samme retning", { id: "dagligvarer", name: "Dagligvarer", retning: "ut" }, "ut"],
    [
      "refusjon (motsatt retning → negativ)",
      { id: "dagligvarer", name: "Dagligvarer", retning: "ut" },
      "inn",
    ],
    ["inntekt", { id: "lonnHelen", name: "Lønn Helen", retning: "inn" }, "inn"],
    [
      "sparing overstyrer type",
      { id: "bufferkonto", name: "Bufferkonto", retning: "ut", plasseringType: "sparing" },
      "ut",
    ],
  ])("byggFordelingFraPost: %s ≡ legacy", (_n, post, retning) => {
    const eiere = [{ person: "Helen", prosent: 100 }];
    expect(fordeling.byggFordelingFraPost(post, 199, eiere, retning)).toEqual(
      L("byggFordelingFraPost")(post, 199, eiere, retning),
    );
  });

  it("byggManuellHendelse ≡ legacy (med og uten eiere/kommentar)", () => {
    const post: MalPost = { id: "dagligvarer", name: "Dagligvarer", retning: "ut" };
    for (const [kommentar, eiere] of [
      ["Gavekort", [{ person: "Helen", prosent: 100 }]],
      [null, []],
    ] as const) {
      const d = deps();
      expect(
        fordeling.byggManuellHendelse("2026-09-01", post, -300, kommentar, [...eiere], d),
      ).toEqual(L("byggManuellHendelse")("2026-09-01", post, -300, kommentar, [...eiere]));
    }
  });

  it("byggKorrigertHendelse ≡ legacy (på vent, uendret linje, endret post, regelId)", () => {
    const eksisterende = hendelser[0]!;
    const utkast = [
      { type: "uklar" as const, uklarValg: "annet" },
      {
        type: "plassert" as const,
        fordelinger: [
          {
            post: { id: "dagligvarer", name: "Dagligvarer", retning: "ut" as const },
            belop: 150,
            eiere: [],
          },
          {
            post: { id: "kantine", name: "Kantine", retning: "ut" as const },
            belop: 100,
            eiere: [{ person: "Helen", prosent: 100 }],
            postErEndret: true,
          },
        ],
      },
      { type: "plassert" as const, fordelinger: [], regelId: "r1" },
    ];
    for (const u of utkast) {
      expect(fordeling.byggKorrigertHendelse(eksisterende, "inn", u, NAA)).toEqual(
        L("byggKorrigertHendelse")(eksisterende, "inn", u),
      );
    }
  });

  it("finnHendelseForTransaksjon/-Kvittering ≡ legacy", () => {
    for (const id of ["t1", "t9", "tUkjent", null]) {
      expect(fordeling.finnHendelseForTransaksjon(hendelser, id)).toEqual(
        L("finnHendelseForTransaksjon")(hendelser, id),
      );
    }
    for (const id of ["kAnnen", "kUkjent", undefined]) {
      expect(fordeling.finnHendelseForKvittering(hendelser, id)).toEqual(
        L("finnHendelseForKvittering")(hendelser, id),
      );
    }
  });
});

// ── Kvittering ──────────────────────────────────────────────────────
describe("kvitteringsmotorene", () => {
  const kvitteringer: KvitteringRecord[] = [
    kv({ id: "k1" }),
    kv({ id: "k2", allocationMode: null, splits: [] }),
    kv({
      id: "k3",
      total: 300,
      allocationMode: "split",
      splits: [
        { targetType: "budget", targetId: "dagligvarer", targetName: "Dagligvarer", amount: 200 },
        { targetType: "budget", targetId: "kantine", targetName: "Kantine", amount: 50 },
      ],
    }),
    kv({ id: "k4", total: 99.5, merchant: "Kiwi 505", purchaseDate: "2026-09-13" }),
    kv({ id: "kAnnen", hendelseId: "h3" }),
    kv({ id: "k6", total: 600, merchant: "Circle K", purchaseDate: "2026-09-20" }),
  ];

  it("konstantene er de samme", () => {
    expect(kvittering.BELOPSTOLERANSE_KOBLING).toBe(L("BELOPSTOLERANSE_KOBLING"));
    expect(kvittering.KVITTERING_TIDSVINDU_DAGER).toBe(L("KVITTERING_TIDSVINDU_DAGER"));
  });

  it("calculateSplitTotal / erKvitteringKlarForLukking ≡ legacy", () => {
    for (const r of [...kvitteringer, null]) {
      expect(kvittering.calculateSplitTotal(r)).toBe(L("calculateSplitTotal")(r));
      expect(kvittering.erKvitteringKlarForLukking(r)).toEqual(L("erKvitteringKlarForLukking")(r));
    }
  });

  it("vurderKvitteringKobling ≡ legacy for alle kvitteringer × alle transaksjoner", () => {
    for (const r of kvitteringer) {
      for (const t of transaksjoner) {
        expect(
          kvittering.vurderKvitteringKobling(r, t, hendelser, kvitteringer),
          `${r.id}/${t.id}`,
        ).toEqual(L("vurderKvitteringKobling")(r, t, hendelser, kvitteringer));
      }
    }
  });

  it("låst: kobling mot transaksjon eid av annen kvittering blokkeres; ignorert blokkeres", () => {
    expect(
      kvittering.vurderKvitteringKobling(kvitteringer[0]!, transaksjoner[8]!, hendelser).kode,
    ).toBe("transaksjon_koblet_annen_kvittering");
    expect(
      kvittering.vurderKvitteringKobling(kvitteringer[0]!, transaksjoner[5]!, hendelser).kode,
    ).toBe("transaksjon_ignorert");
    expect(
      kvittering.vurderKvitteringKobling(kvitteringer[0]!, transaksjoner[0]!, hendelser),
    ).toMatchObject({
      kanLukkes: true,
      handling: "bekreft_eksisterende_hendelse",
    });
  });

  it("finnKvitteringTransaksjonKandidater ≡ legacy", () => {
    for (const r of kvitteringer) {
      expect(kvittering.finnKvitteringTransaksjonKandidater(r, transaksjoner, hendelser)).toEqual(
        L("finnKvitteringTransaksjonKandidater")(r, transaksjoner, hendelser),
      );
    }
    // Låst: utenfor 5-dagersvinduet → ingen kandidat.
    expect(
      kvittering.finnKvitteringTransaksjonKandidater(kvitteringer[5]!, transaksjoner, hendelser),
    ).toEqual([]);
  });

  it("fordelingerFraKvitteringSplits ≡ legacy (inkl. standard-eier Felles)", () => {
    for (const r of kvitteringer) {
      expect(kvittering.fordelingerFraKvitteringSplits(r.splits)).toEqual(
        L("fordelingerFraKvitteringSplits")(r.splits),
      );
    }
  });

  it("byggSynkronisertKvitteringOgHendelse ≡ legacy (ukoblet, koblet, manglende og asymmetrisk)", () => {
    const koblet = kv({ id: "kKoblet", hendelseId: "hK" });
    const hendelserMedK = [
      ...hendelser,
      hendelse({ id: "hK", receiptId: "kKoblet", status: "pa_vent" }),
    ];
    const tilfeller: [KvitteringRecord, HendelseRecord[]][] = [
      [kvitteringer[0]!, hendelser],
      [koblet, hendelserMedK],
      [koblet, hendelser],
      [kv({ id: "kAsym", hendelseId: "h1" }), hendelser],
    ];
    const felter = {
      total: 260,
      splits: [
        {
          targetType: "income" as const,
          targetId: "lonnHelen",
          targetName: "Lønn Helen",
          amount: 260,
        },
      ],
    };
    for (const [r, hs] of tilfeller) {
      expect(kvittering.byggSynkronisertKvitteringOgHendelse(r, felter, hs, NAA)).toEqual(
        L("byggSynkronisertKvitteringOgHendelse")(r, felter, hs),
      );
    }
    // Låst, kjent asymmetri (§2.6): redigering til tom fordeling lukker likevel hendelsen.
    const tom = kvittering.byggSynkronisertKvitteringOgHendelse(
      koblet,
      { splits: [] },
      hendelserMedK,
      NAA,
    );
    expect(tom.nyHendelse).toMatchObject({ status: "ferdig", fordelinger: [] });
  });

  it("findReceipt ≡ legacy (eldre transactionId-kobling)", () => {
    const medDirekte = [...kvitteringer, kv({ id: "kDir", transactionId: "t7" })];
    for (const id of ["t7", "t1", null]) {
      expect(kvittering.findReceipt(id, medDirekte)).toEqual(L("findReceipt")(id, medDirekte));
    }
  });
});

// ── Intern overføring ───────────────────────────────────────────────
describe("intern overføring", () => {
  it("kontoUlik / retningMotsatt ≡ legacy for alle par", () => {
    for (const a of transaksjoner) {
      for (const b of transaksjoner) {
        expect(intern.kontoUlik(a, b)).toBe(L("kontoUlik")(a, b));
        expect(intern.retningMotsatt(a, b)).toBe(L("retningMotsatt")(a, b));
      }
    }
  });

  it("finnInterneOverforingsKandidater ≡ legacy for alle transaksjoner", () => {
    for (const t of transaksjoner) {
      expect(intern.finnInterneOverforingsKandidater(t, transaksjoner)).toEqual(
        L("finnInterneOverforingsKandidater")(t, transaksjoner),
      );
    }
    expect(
      intern
        .finnInterneOverforingsKandidater(transaksjoner[3]!, transaksjoner)
        .map((k) => k.transaction.id),
    ).toEqual(["t5"]);
  });

  it("bekreftInternOverforing ≡ legacy, symmetrisk og idempotent", () => {
    const en = intern.bekreftInternOverforing(transaksjoner, "t4", "t5", NAA);
    expect(en).toEqual(L("bekreftInternOverforing")(transaksjoner, "t4", "t5"));
    expect(intern.bekreftInternOverforing(en, "t4", "t5", NAA)).toEqual(en);
  });
});

// ── Bankfil-parsing ─────────────────────────────────────────────────
describe("bankfil-parsing", () => {
  const FILER = [
    "﻿Dato;Beskrivelse;Inn;Ut;Konto\r\n10.09.2026;REMA 1000;;-250,50;Felleskonto\r\n11.09.2026;Lønn;42 000,00;;Helen\r\n",
    'dato,tekst,belop\n"2026-09-10","Kaffe","-45"\n"2026-09-11","Refusjon","30"\n',
    "Dato;Beløpet gjelder;Inn;Ut;\n46275;CIRCLE K;;600,00;\n15.09.2026;Innbetaling;5000;;\n",
    "bare header\n",
    "",
  ];

  it.each(FILER)("parseCSV ≡ legacy (fil %#)", (fil) => {
    expect(parse.parseCSV(fil)).toEqual(L("parseCSV")(fil));
  });

  it("mapRad ≡ legacy for alle rader × alle kilder", () => {
    for (const fil of FILER) {
      for (const rad of parse.parseCSV(fil)) {
        for (const kilde of ["sparebank1", "dnb", "annet"]) {
          expect(parse.mapRad(rad, kilde), `${kilde}: ${JSON.stringify(rad)}`).toEqual(
            L("mapRad")(rad, kilde),
          );
        }
      }
    }
  });

  it("låst: DNB Excel-serienummer blir ISO-dato; «Innbetaling» er IKKE filtrert i mapRad", () => {
    const rader = parse.parseCSV(FILER[2]!);
    expect(parse.mapRad(rader[0]!, "dnb")).toMatchObject({
      dato: "2026-09-10",
      belop: 600,
      retning: "ut",
    });
    expect(parse.mapRad(rader[1]!, "dnb")).toMatchObject({
      tekst: "Innbetaling",
      retning: "inn",
      belop: 5000,
    });
  });

  it("dupKey / normaliserKonto ≡ legacy", () => {
    for (const t of transaksjoner) {
      expect(parse.dupKey(t)).toBe(L("dupKey")(t));
      expect(parse.normaliserKonto(t)).toBe(L("normaliserKonto")(t));
    }
    for (const k of ["MC", "dnb", "Mastercard", "Regningskonto 1234", "krav", "", "ukjent"]) {
      expect(parse.normaliserKonto({ konto: k })).toBe(L("normaliserKonto")({ konto: k }));
    }
    expect(parse.normaliserKonto({ importkilde: "dnb" })).toBe(
      L("normaliserKonto")({ importkilde: "dnb" }),
    );
  });
});
