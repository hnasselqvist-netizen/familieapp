/**
 * Differensiell karakterisering av bankfil-import og manuell registrering
 * (§Issue #34 R3b-2): legacy-closurene i `BankimportScreen`
 * (`prosesserTekst`, `velgManuellKonto`, `finnMatchForPreview`,
 * `finnRegelForTekst`, `laeringsKey`, `gjorImport` og
 * `lagreManuellRegistrering`) trekkes ut ORDRETT fra `index.html` og
 * kjøres side om side med portene i `bankimport.ts`, med samme id-sekvens
 * og klokke.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import type { LiquidityPost } from "@app-types/liquidity";
import {
  extractConstArrow,
  extractInlineExpression,
  idSequence,
  loadLegacy,
} from "../../test/legacy";
import {
  type ManuellRegistrering,
  byggImportPreview,
  erSkyldigBelopLinje,
  finnMatchForPreview,
  gjorImport,
  lagreManuellRegistrering,
  velgManuellKonto,
} from "./bankimport";
import type { Beslutningsendring } from "./beslutning";
import { finnInterneOverforingsKandidater } from "./internOverforing";

const NAA = "2026-10-03T09:30:00.000Z";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NAA));
});
afterAll(() => vi.useRealTimers());

// ── Fixtures ────────────────────────────────────────────────────────
const FILER: [string, string][] = [
  [
    "sparebank1",
    "﻿Dato;Beskrivelse;Inn;Ut;Konto\r\n10.09.2026;REMA 1000 GRUNERLOKKA;;-250,50;Felleskonto\r\n11.09.2026;Lønn fra Arbeidsgiver AS;42 000,00;;Helen\r\n12.09.2026;KIWI 505;;-99,00;\r\n13.09.2026;Innbetaling;500;;Felleskonto\r\n14.09.2026;Strøm Fjordkraft;;-1180,00;Regningskonto\r\n15.09.2026;Overføring buffer;;-5000;Felleskonto\r\n16.09.2026;CIRCLE K BRYN;;-600,00;Felleskonto\r\n",
  ],
  [
    "dnb",
    "Dato;Beløpet gjelder;Inn;Ut;\n46275;CIRCLE K;;600,00;\n15.09.2026;Innbetaling;5000;;\n17.09.2026;REMA 1000 SENTRUM;;89,90;\n",
  ],
  ["annet", 'dato,tekst,belop\n"2026-09-10","Kaffe","45"\n"2026-09-11","Refusjon","-30"\n"",""\n'],
  ["sparebank1", "bare header\n"],
];
const tx = (o: Partial<TransaksjonRecord> & { id: string }): TransaksjonRecord => ({
  dato: "2026-09-10",
  tekst: "REMA 1000 GRUNERLOKKA",
  belop: 250.5,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...o,
});
// t-dup er en eksakt duplikat av første SpareBank1-rad.
const eksisterende: TransaksjonRecord[] = [
  tx({ id: "t-dup" }),
  tx({ id: "t-annen", dato: "2026-09-01" }),
];
const regel = (o: Partial<RegelRecord> & { id: string }): RegelRecord => ({
  pattern: "rema 1000",
  normalizedPattern: "rema 1000",
  matchType: "inneholder",
  targetType: "budget",
  targetId: "dagligvarer",
  targetName: "Dagligvarer",
  targetGruppe: "Mat",
  mode: "auto",
  confidence: 100,
  ...o,
});
const rules: RegelRecord[] = [
  regel({ id: "r-rema" }),
  regel({
    id: "r-lonn",
    pattern: "lønn fra arbeidsgiver as",
    normalizedPattern: "lønn fra arbeidsgiver as",
    matchType: "starter_med",
    targetType: "income",
    targetId: "lonnHelen",
    targetName: "Lønn Helen",
  }),
  regel({
    id: "r-kiwi",
    pattern: "kiwi",
    normalizedPattern: "kiwi",
    multiUse: true,
    mode: "review",
  }),
  regel({
    id: "r-buffer",
    pattern: "overføring buffer",
    normalizedPattern: "overføring buffer",
    targetType: "sparing",
    targetId: "bufferkonto",
    targetName: "Bufferkonto",
  }),
  regel({
    id: "r-circle",
    pattern: "circle k",
    normalizedPattern: "circle k",
    confidence: 60, // 70 × 0,6 = 42: under importens 60-grense
    targetId: "drivstoff",
  }),
];
const lp = (o: Partial<LiquidityPost> & { id: string }): LiquidityPost =>
  ({
    name: "Strøm",
    amount: 1180,
    direction: "out",
    date: "2026-09-14",
    type: "fast",
    kilde: "generator",
    ...o,
  }) as LiquidityPost;
const liquidityPosts: LiquidityPost[] = [
  lp({ id: "lp-strom", name: "Strøm Fjordkraft" }),
  lp({ id: "lp-dag-ulikt-navn", name: "Noe annet", amount: 600, date: "2026-09-16" }), // samme dag, samme beløp
  lp({ id: "lp-for-langt", name: "CIRCLE K", amount: 89.9, date: "2026-09-25" }),
  lp({ id: "lp-uten-dato", date: "" }),
  lp({ id: "lp-kaffe-4-dager", name: "Kaffe", amount: 45, date: "2026-09-14" }), // 4 dager → ingen match
  lp({ id: "lp-refusjon-1-5", name: "Refusjon", amount: 31.5, date: "2026-09-11" }), // 1,5 kr → ingen match
  lp({ id: "lp-lonn", name: "Lønn fra", amount: 42000, date: "2026-09-11" }), // matcher, men lønn auto-plasseres
];

// ── Legacy ──────────────────────────────────────────────────────────
type AnyFn = (...args: unknown[]) => unknown;
let legacyUid = idSequence("id");
const motorer = loadLegacy<Record<string, AnyFn>>({
  functions: [
    "normaliserTransaksjonstekst",
    "regelMatcherTekst",
    "findMatchingRule",
    "finnMalpostForRegel",
    "byggFordelingFraPost",
    "byggManuellHendelse",
    "jevnFordelEiere",
    "beregnRestPaaSisteLinje",
  ],
  constArrows: ["parseCSV", "mapRad", "dupKey"],
  globals: { uid: () => legacyUid() },
});

interface Fangst {
  preview: unknown;
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
}

function legacyScreen(state: {
  transaksjoner: TransaksjonRecord[];
  hendelser?: HendelseRecord[];
  preview?: unknown;
  kilde?: string;
  manuell?: Partial<ManuellRegistrering>;
}) {
  legacyUid = idSequence("id");
  const f: Fangst = {
    preview: state.preview ?? null,
    transaksjoner: state.transaksjoner,
    hendelser: state.hendelser ?? [],
  };
  const m = state.manuell ?? {};
  const env: Record<string, unknown> = {
    ...motorer,
    uid: () => legacyUid(),
    transaksjoner: state.transaksjoner,
    rules,
    liquidity: { posts: Object.fromEntries(liquidityPosts.map((p) => [p.id, p])) },
    kilde: state.kilde ?? "sparebank1",
    preview: state.preview ?? null,
    budgetGroups,
    incomeGroups,
    sparingGroups,
    manuellType: m.type ?? "kostnad",
    manuellPostId: m.postId ?? "",
    manuellDato: m.dato ?? "",
    manuellBelop: m.belop ?? "",
    manuellKommentar: m.kommentar ?? "",
    manuellEiere: m.eiere ?? [{ person: "Felles", prosent: 100 }],
    setPreview: (v: unknown) => {
      f.preview = typeof v === "function" ? (v as (p: unknown) => unknown)(f.preview) : v;
    },
    setTransaksjoner: (v: unknown) => {
      f.transaksjoner = (v as (p: unknown[]) => TransaksjonRecord[])(f.transaksjoner);
    },
    setHendelser: (v: unknown) => {
      f.hendelser = (v as (p: unknown[]) => HendelseRecord[])(f.hendelser);
    },
    setManuellKonto: () => {},
    setVisImport: () => {},
    setSeksjon: () => {},
    setVisManuellRegistrering: () => {},
    setManuellBelop: () => {},
    setManuellPostId: () => {},
    setManuellPostNavn: () => {},
    setManuellPostSok: () => {},
    setManuellKommentar: () => {},
    setManuellEiere: () => {},
  };
  const body = [
    extractConstArrow("finnRegelForTekst"),
    // Legacy-linjen har ekstra mellomrom: `const laeringsKey    = (tekst) => …`.
    `const laeringsKey = ${extractInlineExpression("const laeringsKey    = ")};`,
    extractConstArrow("prosesserTekst"),
    extractConstArrow("velgManuellKonto"),
    extractConstArrow("finnMatchForPreview"),
    extractConstArrow("gjorImport"),
    extractConstArrow("lagreManuellRegistrering"),
    "return { prosesserTekst, velgManuellKonto, finnMatchForPreview, gjorImport, lagreManuellRegistrering };",
  ].join("\n");
  const fns = new Function(...Object.keys(env), `"use strict";\n${body}`)(
    ...Object.values(env),
  ) as Record<string, AnyFn>;
  return { fns, f };
}

const anvend = (e: Beslutningsendring | null, start: Fangst) => ({
  transaksjoner: e?.transaksjoner ? e.transaksjoner(start.transaksjoner) : start.transaksjoner,
  hendelser: e?.hendelser ? e.hendelser(start.hendelser) : start.hendelser,
});
const deps = () => ({ newId: idSequence("id"), naa: NAA });

const tolv = () => Array.from({ length: 12 }, () => ({ budget: 0, spent: 0 }));
const budgetGroups: BudsjettGruppe[] = [
  { id: "mat", label: "Mat", items: [{ id: "dagligvarer", name: "Dagligvarer", months: tolv() }] },
];
const incomeGroups: BudsjettGruppe[] = [
  { id: "lonn", label: "Lønn", items: [{ id: "lonnHelen", name: "Lønn Helen", months: tolv() }] },
];
const sparingGroups: BudsjettGruppe[] = [
  {
    id: "spar",
    label: "Spar",
    items: [{ id: "bufferkonto", name: "Bufferkonto", months: tolv() }],
  },
];

describe("import ≡ legacy", () => {
  it.each(FILER.map(([k, f], i) => [i, k, f] as const))(
    "forhåndsvisning (fil %i, %s)",
    (_i, kilde, fil) => {
      const L = legacyScreen({ transaksjoner: eksisterende, kilde });
      L.fns.prosesserTekst!(fil);
      const port = byggImportPreview(fil, kilde, eksisterende);
      // Bevisst avvik (MC-import, #66): DNB/MC beholder «Innbetaling», som
      // legacy kastet. Resten er identisk med legacy.
      const utenAvvik =
        kilde === "dnb" ? port.filter((r) => r.tekst.trim().toLowerCase() !== "innbetaling") : port;
      expect(utenAvvik).toEqual(L.f.preview);
    },
  );

  describe("MC-import (#66): «Innbetaling» beholdes, «Skyldig beløp» filtreres", () => {
    const MC =
      "Dato;Beløpet gjelder;Inn;Ut;\n" +
      "01.10.2026;Skyldig beløp pr. 30.09.2026;;12 480,00;\n" +
      "02.10.2026;Innbetaling;12 480,00;;\n" +
      "03.10.2026;REMA 1000 SENTRUM;;89,90;\n" +
      "30.10.2026;SKYLDIG BELOP PR. 30.10;;7 210,00;\n";

    it("regresjon: «Innbetaling» importeres som reell inn-transaksjon på MC", () => {
      const preview = byggImportPreview(MC, "dnb", []);
      expect(preview.find((r) => r.tekst === "Innbetaling")).toMatchObject({
        dato: "2026-10-02",
        belop: 12480,
        retning: "inn",
        konto: "MC",
        erDuplikat: false,
      });
    });

    it("regresjon: «Skyldig beløp …» er ren informasjon og importeres ikke", () => {
      const preview = byggImportPreview(MC, "dnb", []);
      expect(preview.map((r) => r.tekst)).toEqual(["Innbetaling", "REMA 1000 SENTRUM"]);
      expect(erSkyldigBelopLinje("Skyldig beløp pr. 30.09.2026")).toBe(true);
      expect(erSkyldigBelopLinje("  skyldig belop")).toBe(true);
      expect(erSkyldigBelopLinje("Innbetaling skyldig beløp")).toBe(false);
    });

    it("importen skriver «Innbetaling» som transaksjon, og rører ikke historiske «Skyldig beløp»", () => {
      const historisk = tx({
        id: "t-skyldig-gammel",
        dato: "2026-09-01",
        tekst: "Skyldig beløp pr. 31.08.2026",
        belop: 9000,
        konto: "MC",
      });
      const preview = byggImportPreview(MC, "dnb", [historisk]);
      const r = anvend(
        gjorImport(preview, { rules: [], liquidityPosts: [], kilde: "dnb" }, deps()),
        {
          preview,
          transaksjoner: [historisk],
          hendelser: [],
        },
      );
      expect(r.transaksjoner.map((t) => t.tekst)).toEqual([
        "Skyldig beløp pr. 31.08.2026",
        "Innbetaling",
        "REMA 1000 SENTRUM",
      ]);
      expect(r.transaksjoner[1]).toMatchObject({ retning: "inn", konto: "MC", belop: 12480 });
    });

    it("den importerte «Innbetaling» kan kobles som intern overføring mot betalingen fra brukskontoen", () => {
      const betaling = tx({
        id: "t-betaling-mc",
        dato: "2026-10-01",
        tekst: "Betaling Mastercard",
        belop: 12480,
        retning: "ut",
        konto: "Felleskonto",
      });
      const preview = byggImportPreview(MC, "dnb", [betaling]);
      const r = anvend(
        gjorImport(preview, { rules: [], liquidityPosts: [], kilde: "dnb" }, deps()),
        {
          preview,
          transaksjoner: [betaling],
          hendelser: [],
        },
      );
      const innbetaling = r.transaksjoner.find((t) => t.tekst === "Innbetaling")!;
      expect(
        finnInterneOverforingsKandidater(innbetaling, r.transaksjoner).map((k) => k.transaction.id),
      ).toEqual(["t-betaling-mc"]);
    });

    it("andre kilder: «Innbetaling»-filteret er uendret", () => {
      const sb1 = "Dato;Beskrivelse;Inn;Ut;Konto\n13.09.2026;Innbetaling;500;;Felleskonto\n";
      expect(byggImportPreview(sb1, "sparebank1", [])).toEqual([]);
    });
  });

  it("manuell konto: bare rader uten konto, med ny duplikatnøkkel", () => {
    const fil = FILER[0]![1];
    const preview = byggImportPreview(fil, "sparebank1", eksisterende);
    // En eksisterende rad som bare blir duplikat når kontoen settes.
    const medKiwi = [
      ...eksisterende,
      tx({ id: "t-kiwi", dato: "2026-09-12", tekst: "KIWI 505", belop: 99, konto: "MC" }),
    ];
    for (const konto of ["MC", "Felleskonto"]) {
      const L = legacyScreen({ transaksjoner: medKiwi, preview });
      L.fns.velgManuellKonto!(konto);
      expect(velgManuellKonto(preview, konto, medKiwi)).toEqual(L.f.preview);
    }
    expect(
      velgManuellKonto(preview, "MC", medKiwi).find((r) => r.tekst === "KIWI 505")!.erDuplikat,
    ).toBe(true);
  });

  it("match mot likviditetsprognosen", () => {
    const L = legacyScreen({ transaksjoner: [] });
    const rader = FILER.flatMap(([k, f]) => byggImportPreview(f, k, []));
    for (const r of rader) {
      expect(finnMatchForPreview(r, liquidityPosts)).toEqual(L.fns.finnMatchForPreview!(r));
    }
  });

  it.each(FILER.map(([k, f], i) => [i, k, f] as const))(
    "gjorImport (fil %i, %s)",
    (_i, kilde, fil) => {
      const preview = byggImportPreview(fil, kilde, eksisterende);
      const L = legacyScreen({ transaksjoner: eksisterende, preview, kilde });
      L.fns.gjorImport!();
      const port = anvend(gjorImport(preview, { rules, liquidityPosts, kilde }, deps()), {
        preview,
        transaksjoner: eksisterende,
        hendelser: [],
      });
      expect(port).toEqual({ transaksjoner: L.f.transaksjoner, hendelser: L.f.hendelser });
    },
  );

  it("låser importens utfall eksplisitt", () => {
    const preview = byggImportPreview(FILER[0]![1], "sparebank1", eksisterende);
    const r = anvend(gjorImport(preview, { rules, liquidityPosts, kilde: "sparebank1" }, deps()), {
      preview,
      transaksjoner: [],
      hendelser: [],
    });
    const etter = (tekst: string) => r.transaksjoner.find((x) => x.tekst === tekst)!;
    expect(r.transaksjoner.map((x) => x.tekst)).toEqual([
      "Lønn fra Arbeidsgiver AS",
      "KIWI 505",
      "Strøm Fjordkraft",
      "Overføring buffer",
      "CIRCLE K BRYN",
    ]); // REMA er duplikat, «Innbetaling» filtrert
    expect(etter("Lønn fra Arbeidsgiver AS")).toMatchObject({
      status: null,
      importkilde: "sparebank1",
      importertDato: "2026-10-03",
    });
    expect(etter("KIWI 505").status).toBe("krever_vurdering");
    expect(etter("Strøm Fjordkraft")).toMatchObject({
      status: "foresoatt_match",
      matchetMot: "lp-strom",
    });
    expect(etter("CIRCLE K BRYN")).toMatchObject({
      status: "foresoatt_match",
      matchetMot: "lp-dag-ulikt-navn",
    });
    expect(
      r.hendelser.map((h) => [h.transaksjonId, h.regelId, h.fordelinger[0]!.plasseringType]),
    ).toEqual([
      [etter("Lønn fra Arbeidsgiver AS").id, "r-lonn", "income"],
      [etter("Overføring buffer").id, "r-buffer", "sparing"],
    ]);
  });
});

describe("manuell registrering ≡ legacy", () => {
  const TILFELLER: [string, Partial<ManuellRegistrering>][] = [
    [
      "kostnad",
      {
        type: "kostnad",
        postId: "dagligvarer",
        dato: "2026-09-30",
        belop: "450",
        kommentar: "  kontant ",
        eiere: [],
      },
    ],
    [
      "negativ kostnad (refusjon)",
      {
        type: "kostnad",
        postId: "dagligvarer",
        dato: "2026-09-30",
        belop: "-120.5",
        kommentar: "",
      },
    ],
    [
      "inntekt",
      {
        type: "inntekt",
        postId: "lonnHelen",
        dato: "2026-09-25",
        belop: "1000",
        kommentar: "bonus",
        eiere: [{ person: "Helen", prosent: 100 }],
      },
    ],
    [
      "sparing",
      { type: "sparing", postId: "bufferkonto", dato: "2026-09-25", belop: "2000", kommentar: "" },
    ],
    [
      "beløp 0",
      { type: "kostnad", postId: "dagligvarer", dato: "2026-09-30", belop: "0", kommentar: "" },
    ],
    [
      "tomt beløp",
      { type: "kostnad", postId: "dagligvarer", dato: "2026-09-30", belop: "", kommentar: "" },
    ],
    [
      "komma (som legacy: parseFloat)",
      { type: "kostnad", postId: "dagligvarer", dato: "2026-09-30", belop: "12,5", kommentar: "" },
    ],
    ["uten dato", { type: "kostnad", postId: "dagligvarer", dato: "", belop: "10", kommentar: "" }],
    [
      "post i feil type",
      { type: "inntekt", postId: "dagligvarer", dato: "2026-09-30", belop: "10", kommentar: "" },
    ],
  ];

  it.each(TILFELLER)("%s", (_navn, m) => {
    const L = legacyScreen({ transaksjoner: [], manuell: m });
    L.fns.lagreManuellRegistrering!();
    const r = {
      type: "kostnad",
      postId: "",
      dato: "",
      belop: "",
      kommentar: "",
      eiere: [{ person: "Felles", prosent: 100 }],
      ...m,
    } as ManuellRegistrering;
    const port = anvend(
      lagreManuellRegistrering(r, { budgetGroups, incomeGroups, sparingGroups }, deps()),
      {
        preview: null,
        transaksjoner: [],
        hendelser: [],
      },
    );
    expect(port.hendelser).toEqual(L.f.hendelser);
  });
});

describe("Excel-import i legacy (karakterisering, §r3b-cutover.md §7 valg 3)", () => {
  it("låst funn: legacy kaller `XLSX.read`, men laster aldri SheetJS — Excel feiler i dag", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../../../../index.html"), "utf8");
    expect(src).toContain("XLSX.read(ev.target.result");
    expect(src).not.toMatch(/<script[^>]*(xlsx|sheetjs)/i);
    expect(src).not.toMatch(/(XLSX|xlsx)\s*=|import\(\s*["'][^"']*xlsx/);
  });
});
