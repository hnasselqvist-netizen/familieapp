/**
 * Differensiell karakterisering av «Kjør regler»-forhåndsvisningen
 * (§Issue #34): legacy-RegelSenterets `forhandsvisKjorRegler` og
 * forhåndsvisningens grupperingsuttrykk (`autoLinjer` … `noeAaSkrive`,
 * `gruppeLabelFor`, `TYPE_LABEL_R`) trekkes ut ORDRETT fra `index.html`
 * (kun lesing) og kjøres side om side med portene på samme input.
 */
import { describe, expect, it } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import {
  extractConstArrow,
  extractInlineExpression,
  idSequence,
  loadLegacy,
} from "../../test/legacy";
import * as port from "./kjorReglerForhandsvisning";
import type { EndringsplanLinje, RegelEvaluering } from "./regler";

// ── Fixtures ────────────────────────────────────────────────────────
const tolv = () => Array.from({ length: 12 }, () => ({ budget: 0, spent: 0 }));
const budgetGroups: BudsjettGruppe[] = [
  {
    id: "mat",
    label: "Mat",
    items: [
      { id: "dagligvarer", name: "Dagligvarer", months: tolv() },
      { id: "kantine", name: "Kantine", months: tolv() },
    ],
  },
  { id: "bil", label: "Bil", items: [{ id: "drivstoff", name: "Drivstoff", months: tolv() }] },
];
const incomeGroups: BudsjettGruppe[] = [
  { id: "lonn", label: "Lønn", items: [{ id: "lonnHelen", name: "Lønn Helen", months: tolv() }] },
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
  tx({ id: "t-auto" }),
  tx({ id: "t-auto-ferdig" }), // har ferdig hendelse → vurderes ikke
  tx({ id: "t-forslag", tekst: "CIRCLE K 12.09 #4411", belop: 600 }),
  tx({ id: "t-vent", tekst: "CIRCLE K MAJORSTUEN", belop: 450 }),
  tx({ id: "t-lonn", tekst: "Lønn fra Arbeidsgiver AS sept", belop: 42000, retning: "inn" }),
  tx({ id: "t-buffer", tekst: "Overføring buffer", belop: 5000 }),
  tx({ id: "t-mangler", tekst: "KIWI 505 MAJORSTUEN", belop: 99.5 }),
  tx({ id: "t-ingen", tekst: "Ukjent butikk", belop: 10 }),
  tx({ id: "t-ingen-2", tekst: "Annet sted", belop: 20, konto: null }),
  tx({ id: "t-ignorert", tekst: "REMA 1000", status: "ignorert" }),
  tx({ id: "t-intern", tekst: "REMA 1000", behandlingstype: "intern_overforing" }),
];
const hendelse = (o: Partial<HendelseRecord> & { id: string }): HendelseRecord => ({
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [],
  dato: "2026-09-10",
  regelId: null,
  opprettet: "",
  oppdatert: "",
  ...o,
});
const hendelser: HendelseRecord[] = [
  hendelse({ id: "h-ferdig", transaksjonId: "t-auto-ferdig" }),
  hendelse({
    id: "h-vent",
    transaksjonId: "t-vent",
    status: "pa_vent",
    paaVentAarsak: "maa_avklares",
  }),
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
  regel({ id: "r-rema" }),
  regel({
    id: "r-circle",
    pattern: "circle k",
    normalizedPattern: "circle k",
    targetId: "drivstoff",
    targetName: "Drivstoff",
    mode: "review",
  }),
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
    id: "r-buffer",
    pattern: "overføring buffer",
    normalizedPattern: "overføring buffer",
    targetType: "sparing",
    targetId: "bufferkonto",
    targetName: "Bufferkonto",
  }),
  regel({ id: "r-kiwi", pattern: "kiwi", normalizedPattern: "kiwi", targetId: "slettetPost" }),
];

// ── Legacy ──────────────────────────────────────────────────────────
type AnyFn = (...args: unknown[]) => unknown;
let legacyUid: () => string = idSequence("forhandsvisning");
const motorer = loadLegacy<Record<string, AnyFn>>({
  functions: [
    "normaliserTransaksjonstekst",
    "regelMatcherTekst",
    "findMatchingRule",
    "finnMalpostForRegel",
    "evaluerReglerMotUavklarteTransaksjoner",
    "byggKjorReglerEndringsplan",
    "finnHendelseForTransaksjon",
    "byggFordelingFraPost",
    "jevnFordelEiere",
    "beregnRestPaaSisteLinje",
  ],
  globals: { uid: () => legacyUid() },
});

interface Grupper {
  budgetGroups: BudsjettGruppe[];
  incomeGroups: BudsjettGruppe[];
  sparingGroups: BudsjettGruppe[];
}

/** Legacy `forhandsvisKjorRegler` med state-setterne fanget. */
function legacyForhandsvis(
  t: TransaksjonRecord[],
  h: HendelseRecord[],
  r: RegelRecord[],
  g: Grupper,
): { evaluering: RegelEvaluering; plan: EndringsplanLinje[] } {
  legacyUid = idSequence("forhandsvisning");
  const fanget: Record<string, unknown> = {};
  const setter = (navn: string) => (v: unknown) => void (fanget[navn] = v);
  const env: Record<string, unknown> = {
    ...motorer,
    transaksjoner: t,
    hendelser: h,
    rules: r,
    ...g,
    setKjorReglerEvaluering: setter("evaluering"),
    setKjorReglerPlan: setter("plan"),
    setKjorReglerResultat: setter("resultat"),
    setKjorReglerAdvarsel: setter("advarsel"),
    setKjorReglerStatus: setter("status"),
  };
  const fn = new Function(
    ...Object.keys(env),
    `"use strict";\n${extractConstArrow("forhandsvisKjorRegler")}\nreturn forhandsvisKjorRegler;`,
  )(...Object.values(env)) as () => void;
  fn();
  expect(fanget).toMatchObject({ resultat: null, advarsel: null, status: "forhandsvist" });
  return {
    evaluering: fanget.evaluering as RegelEvaluering,
    plan: fanget.plan as EndringsplanLinje[],
  };
}

/** Forhåndsvisningens grupperingsuttrykk (~12888–12898), i samme skop som komponenten. */
function legacyOppsummering(
  kjorReglerPlan: EndringsplanLinje[],
  kjorReglerEvaluering: RegelEvaluering | null,
  g: Grupper,
) {
  const uttrykk = (navn: string) =>
    `const ${navn} = ${extractInlineExpression(`const ${navn} = `)};`;
  const body = [
    uttrykk("TYPE_LABEL_R"),
    extractConstArrow("gruppeLabelFor"),
    uttrykk("autoLinjer"),
    uttrykk("forslagLinjer"),
    uttrykk("paaVentLinjer"),
    uttrykk("malManglerLinjer"),
    uttrykk("ingenTreffAntall"),
    uttrykk("noeAaSkrive"),
    "return { TYPE_LABEL_R, gruppeLabelFor, oppsummering: { auto: autoLinjer, forslag: forslagLinjer, paaVent: paaVentLinjer, malMangler: malManglerLinjer, ingenTreffAntall, noeAaSkrive } };",
  ].join("\n");
  const env = { kjorReglerPlan, kjorReglerEvaluering, ...g };
  return new Function(...Object.keys(env), `"use strict";\n${body}`)(...Object.values(env)) as {
    TYPE_LABEL_R: Record<string, string>;
    gruppeLabelFor: (target: unknown) => string;
    oppsummering: port.KjorReglerOppsummering;
  };
}

const grupper: Grupper = { budgetGroups, incomeGroups, sparingGroups };
const kjorPort = (t = transaksjoner, h = hendelser, r = rules, g = grupper) =>
  port.forhandsvisKjorRegler(t, h, r, g.budgetGroups, g.incomeGroups, g.sparingGroups);

const ids = (linjer: EndringsplanLinje[]) => linjer.map((l) => l.transaksjonId);

describe("«Kjør regler»-forhåndsvisning ≡ legacy", () => {
  it("forhandsvisKjorRegler: samme evaluering og plan (samme id-sekvens)", () => {
    const legacy = legacyForhandsvis(transaksjoner, hendelser, rules, grupper);
    const p = kjorPort();
    expect(p.evaluering).toEqual(legacy.evaluering);
    expect(p.plan).toEqual(legacy.plan);
  });

  it("oppsummering: alle fire seksjoner, uten-treff-teller og noeAaSkrive", () => {
    const legacy = legacyForhandsvis(transaksjoner, hendelser, rules, grupper);
    const L = legacyOppsummering(legacy.plan, legacy.evaluering, grupper);
    const p = kjorPort();
    expect(p.oppsummering).toEqual(L.oppsummering);
    // Fasiten låst eksplisitt, så en legacy-endring ikke stille flytter den.
    expect(ids(p.oppsummering.auto)).toEqual(["t-auto", "t-lonn", "t-buffer"]);
    expect(ids(p.oppsummering.forslag)).toEqual(["t-forslag"]);
    expect(ids(p.oppsummering.paaVent)).toEqual(["t-vent"]);
    expect(ids(p.oppsummering.malMangler)).toEqual(["t-mangler"]);
    expect(p.oppsummering.ingenTreffAntall).toBe(2);
    expect(p.oppsummering.noeAaSkrive).toBe(true);
    expect(p.evaluering.vurdert).toBe(8);
  });

  it("oppsummering: hver seksjon alene, tom plan og manglende evaluering", () => {
    const legacy = legacyForhandsvis(transaksjoner, hendelser, rules, grupper);
    const varianter: [EndringsplanLinje[], RegelEvaluering | null][] = [
      [[], null],
      [[], legacy.evaluering],
      [legacy.plan, null],
      ...(["auto", "forslag", "forslag_pa_vent", "mal_mangler"] as const).map(
        (h): [EndringsplanLinje[], RegelEvaluering | null] => [
          legacy.plan.filter((l) => l.handling === h),
          legacy.evaluering,
        ],
      ),
      // Auto-linje som ikke skal skrives (transaksjonen forsvant) og
      // forslag med skalSkrives=false telles ikke som treff.
      [
        [
          { ...legacy.plan[0]!, skalSkrives: false },
          { ...legacy.plan.find((l) => l.handling === "forslag")!, skalSkrives: false },
        ],
        legacy.evaluering,
      ],
    ];
    for (const [plan, evaluering] of varianter) {
      expect(port.oppsummerKjorRegler(plan, evaluering)).toEqual(
        legacyOppsummering(plan, evaluering, grupper).oppsummering,
      );
    }
    expect(port.oppsummerKjorRegler([], null).noeAaSkrive).toBe(false);
  });

  it("«Ingen nye treff»: uten regler blir alt uten treff og ingenting skrives", () => {
    const p = kjorPort(transaksjoner, hendelser, []);
    const legacy = legacyForhandsvis(transaksjoner, hendelser, [], grupper);
    expect(p.plan).toEqual(legacy.plan);
    expect(p.oppsummering).toEqual(
      legacyOppsummering(legacy.plan, legacy.evaluering, grupper).oppsummering,
    );
    expect(p.oppsummering.noeAaSkrive).toBe(false);
    expect(p.oppsummering.ingenTreffAntall).toBe(8);
  });

  it("TYPE_LABEL_R og gruppeLabelFor (inkl. ukjent gruppe og ukjent kildeType)", () => {
    const L = legacyOppsummering([], null, grupper);
    expect(port.TYPE_LABEL_R).toEqual(L.TYPE_LABEL_R);
    const targets = [
      { kildeType: "budget", gruppeId: "mat" },
      { kildeType: "budget", gruppeId: "bil" },
      { kildeType: "income", gruppeId: "lonn" },
      { kildeType: "sparing", gruppeId: "buffer" },
      { kildeType: "income", gruppeId: "mat" }, // feil node → id-en
      { kildeType: "budget", gruppeId: "borte" },
      { kildeType: "ukjent", gruppeId: "mat" }, // faller til budget
    ] as const;
    for (const target of targets) {
      expect(port.gruppeLabelFor(target as never, grupper)).toBe(L.gruppeLabelFor(target));
    }
    const tomme = { budgetGroups: [], incomeGroups: [], sparingGroups: [] };
    expect(port.gruppeLabelFor({ kildeType: "budget", gruppeId: "mat" }, tomme)).toBe(
      legacyOppsummering([], null, tomme).gruppeLabelFor({ kildeType: "budget", gruppeId: "mat" }),
    );
  });
});
