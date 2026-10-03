/**
 * Differensiell karakterisering av «Bruk resultatet» (§Issue #34 R3b):
 * legacy `bekreftKjorRegler` trekkes ut ORDRETT fra `index.html` (kun
 * lesing), kjøres med fangede settere og sammenlignes med `brukKjorRegler`
 * på samme data, samme id-sekvens og samme klokke. I tillegg låses de to
 * bevisste avvikene (skriverekkefølge og ingen dobbeltplassering ved
 * samtidig endring) eksplisitt.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import { extractConstArrow, idSequence, loadLegacy } from "../../test/legacy";
import {
  type BrukKjorReglerDeps,
  ENDRET_ADVARSEL,
  type ForsoningData,
  brukKjorRegler,
} from "./brukKjorRegler";
import { forhandsvisKjorRegler } from "./kjorReglerForhandsvisning";
import type { EndringsplanLinje } from "./regler";

const NAA = "2026-10-03T08:00:00.000Z";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NAA));
});
afterAll(() => vi.useRealTimers());

// ── Fixtures ────────────────────────────────────────────────────────
const tolv = () => Array.from({ length: 12 }, () => ({ budget: 0, spent: 0 }));
const budgetGroups: BudsjettGruppe[] = [
  { id: "mat", label: "Mat", items: [{ id: "dagligvarer", name: "Dagligvarer", months: tolv() }] },
  { id: "bil", label: "Bil", items: [{ id: "drivstoff", name: "Drivstoff", months: tolv() }] },
];
const incomeGroups: BudsjettGruppe[] = [
  { id: "lonn", label: "Lønn", items: [{ id: "lonnHelen", name: "Lønn Helen", months: tolv() }] },
];
const sparingGroups: BudsjettGruppe[] = [];

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
  tx({ id: "t-forslag", tekst: "CIRCLE K 12.09", belop: 600 }),
  tx({ id: "t-vent", tekst: "CIRCLE K BRYN", belop: 450 }),
  tx({ id: "t-lonn", tekst: "Lønn fra Arbeidsgiver AS", belop: 42000, retning: "inn" }),
  tx({ id: "t-mangler", tekst: "KIWI 505", belop: 99 }),
  tx({ id: "t-ingen", tekst: "Ukjent butikk", belop: 10 }),
  tx({ id: "t-ferdig", hendelseId: "h-ferdig" }),
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
  hendelse({ id: "h-ferdig", transaksjonId: "t-ferdig" }),
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
  regel({ id: "r-kiwi", pattern: "kiwi", normalizedPattern: "kiwi", targetId: "slettetPost" }),
];
const data: ForsoningData = {
  transaksjoner,
  hendelser,
  rules,
  budgetGroups,
  incomeGroups,
  sparingGroups,
};

// ── Legacy ──────────────────────────────────────────────────────────
type AnyFn = (...args: unknown[]) => unknown;
let legacyUid: () => string = idSequence("h");
const motorer = loadLegacy<Record<string, AnyFn>>({
  functions: [
    "normaliserTransaksjonstekst",
    "regelMatcherTekst",
    "findMatchingRule",
    "finnMalpostForRegel",
    "evaluerReglerMotUavklarteTransaksjoner",
    "byggKjorReglerEndringsplan",
    "erEndringsplanUendret",
    "skrivEndringsplan",
    "finnHendelseForTransaksjon",
    "byggFordelingFraPost",
    "jevnFordelEiere",
    "beregnRestPaaSisteLinje",
  ],
  globals: { uid: () => legacyUid() },
});

interface LegacyUtfall {
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  fanget: Record<string, unknown>;
  skrivinger: string[];
}

/** Legacy `bekreftKjorRegler` med fangede settere (samme kall-semantikk som `setX`). */
async function legacyBekreft(
  godkjentPlan: EndringsplanLinje[],
  d: ForsoningData,
): Promise<LegacyUtfall> {
  legacyUid = idSequence("h");
  const state = { transaksjoner: d.transaksjoner, hendelser: d.hendelser };
  const fanget: Record<string, unknown> = {};
  const skrivinger: string[] = [];
  const setter = (navn: string) => (v: unknown) => void (fanget[navn] = v);
  const nodeSetter =
    (node: "transaksjoner" | "hendelser") =>
    (v: unknown): Promise<void> => {
      skrivinger.push(node);
      const prev = state[node] as unknown[];
      (state as Record<string, unknown>)[node] =
        typeof v === "function" ? (v as (p: unknown[]) => unknown[])(prev) : v;
      return Promise.resolve();
    };
  const env: Record<string, unknown> = {
    ...motorer,
    ...d,
    kjorReglerPlan: godkjentPlan,
    setKjorReglerStatus: setter("status"),
    setKjorReglerEvaluering: setter("evaluering"),
    setKjorReglerPlan: setter("plan"),
    setKjorReglerAdvarsel: setter("advarsel"),
    setKjorReglerResultat: setter("resultat"),
    setTransaksjoner: nodeSetter("transaksjoner"),
    setHendelser: nodeSetter("hendelser"),
    console: { error: (...a: unknown[]) => void (fanget.feil = a) },
  };
  const fn = new Function(
    ...Object.keys(env),
    `"use strict";\n${extractConstArrow("bekreftKjorRegler")}\nreturn bekreftKjorRegler;`,
  )(...Object.values(env)) as () => Promise<void>;
  await fn();
  return { ...state, fanget, skrivinger };
}

/** React-siden med in-memory-transaksjoner (samme semantikk som helnode-transaksjonen). */
function minneDeps(start: ForsoningData) {
  const state = { transaksjoner: start.transaksjoner, hendelser: start.hendelser };
  const skrivinger: string[] = [];
  const deps: BrukKjorReglerDeps = {
    transactHendelser: async (u) => {
      skrivinger.push("hendelser");
      state.hendelser = u(state.hendelser);
    },
    transactTransaksjoner: async (u) => {
      skrivinger.push("transaksjoner");
      state.transaksjoner = u(state.transaksjoner);
    },
    newId: idSequence("h"),
    naa: NAA,
  };
  return { state, skrivinger, deps };
}

const godkjent = (d: ForsoningData) =>
  forhandsvisKjorRegler(
    d.transaksjoner,
    d.hendelser,
    d.rules,
    d.budgetGroups,
    d.incomeGroups,
    d.sparingGroups,
    idSequence("godkjent"),
  ).plan;

describe("«Bruk resultatet» ≡ legacy bekreftKjorRegler", () => {
  it("uendret plan: samme transaksjoner, samme hendelser og samme resultat", async () => {
    const plan = godkjent(data);
    const legacy = await legacyBekreft(plan, data);
    const react = minneDeps(data);
    const utfall = await brukKjorRegler(plan, data, react.deps);

    expect(legacy.fanget.feil).toBeUndefined();
    expect(legacy.fanget.status).toBe("ferdig");
    expect(utfall).toEqual({ status: "skrevet", resultat: legacy.fanget.resultat });
    expect(react.state.hendelser).toEqual(legacy.hendelser);
    expect(react.state.transaksjoner).toEqual(legacy.transaksjoner);

    // Fasiten låst eksplisitt.
    expect(utfall).toEqual({
      status: "skrevet",
      resultat: { auto: 2, forslagSkrevet: 1, forslagPaaVent: 1, malMangler: 1 },
    });
    const ny = react.state.hendelser.filter((h) => !["h-ferdig", "h-vent"].includes(h.id));
    expect(ny.map((h) => h.transaksjonId)).toEqual(["t-auto", "t-lonn"]);
    expect(ny.every((h) => h.status === "ferdig" && h.opprettet === NAA)).toBe(true);
    const t = (id: string) => react.state.transaksjoner.find((x) => x.id === id)!;
    expect(t("t-auto").hendelseId).toBe(ny[0]!.id);
    expect(t("t-forslag")).toMatchObject({ status: "krever_vurdering", matchetMot: "drivstoff" });
    expect(t("t-vent")).toEqual(transaksjoner.find((x) => x.id === "t-vent"));
    expect(t("t-mangler")).toEqual(transaksjoner.find((x) => x.id === "t-mangler"));
  });

  it("endret data: ingenting skrives, samme advarsel og samme ferske plan", async () => {
    // Godkjent mot et eldre regelsett (uten lønnsregelen).
    const plan = godkjent({ ...data, rules: rules.filter((r) => r.id !== "r-lonn") });
    const legacy = await legacyBekreft(plan, data);
    const react = minneDeps(data);
    const utfall = await brukKjorRegler(plan, data, react.deps);

    expect(legacy.skrivinger).toEqual([]);
    expect(react.skrivinger).toEqual([]);
    expect(legacy.fanget.status).toBe("forhandsvist");
    expect(utfall.status).toBe("endret");
    if (utfall.status !== "endret") return;
    expect(utfall.advarsel).toBe(legacy.fanget.advarsel);
    expect(utfall.advarsel).toBe(ENDRET_ADVARSEL);
    expect(utfall.forhandsvisning.plan).toEqual(legacy.fanget.plan);
    expect(utfall.forhandsvisning.evaluering).toEqual(legacy.fanget.evaluering);
  });

  it("ingen treff: resultat uten skriving av hendelser (legacy skriver bare transaksjoner uendret)", async () => {
    const d = { ...data, rules: [] };
    const plan = godkjent(d);
    const legacy = await legacyBekreft(plan, d);
    const react = minneDeps(d);
    const utfall = await brukKjorRegler(plan, d, react.deps);
    expect(utfall).toEqual({ status: "skrevet", resultat: legacy.fanget.resultat });
    expect(legacy.transaksjoner).toEqual(transaksjoner);
    expect(react.state).toEqual({ transaksjoner, hendelser });
    // Legacy skriver hele transaksjonslisten uendret; React skriver ingenting.
    expect(legacy.skrivinger).toEqual(["transaksjoner"]);
    expect(react.skrivinger).toEqual([]);
  });
});

describe("«Bruk resultatet» — bevisste avvik for datasikkerhet", () => {
  it("skriver hendelser FØR transaksjoner (legacy: omvendt)", async () => {
    const plan = godkjent(data);
    const legacy = await legacyBekreft(plan, data);
    const react = minneDeps(data);
    await brukKjorRegler(plan, data, react.deps);
    expect(legacy.skrivinger).toEqual(["transaksjoner", "hendelser"]);
    expect(react.skrivinger).toEqual(["hendelser", "transaksjoner"]);
  });

  it("feiler transaksjonssteget, er hendelsene likevel skrevet og transaksjonen plassert via transaksjonId", async () => {
    const plan = godkjent(data);
    const react = minneDeps(data);
    react.deps.transactTransaksjoner = () => Promise.reject(new Error("nett"));
    await expect(brukKjorRegler(plan, data, react.deps)).rejects.toThrow("nett");
    expect(react.state.hendelser.some((h) => h.transaksjonId === "t-auto")).toBe(true);
    expect(react.state.transaksjoner).toEqual(transaksjoner);
  });

  it("samtidig plassering mellom forhåndsvisning og skriving: ingen dobbel hendelse, ingen peker", async () => {
    const plan = godkjent(data);
    const react = minneDeps(data);
    // En annen klient rakk å plassere t-auto (og la t-forslag på vent) før vår transaksjon.
    react.state.hendelser = [
      ...hendelser,
      hendelse({ id: "h-annen", transaksjonId: "t-auto" }),
      hendelse({ id: "h-annen-2", transaksjonId: "t-forslag", status: "pa_vent" }),
    ];
    await brukKjorRegler(plan, data, react.deps);
    expect(react.state.hendelser.filter((h) => h.transaksjonId === "t-auto")).toHaveLength(1);
    const t = (id: string) => react.state.transaksjoner.find((x) => x.id === id)!;
    expect(t("t-auto").hendelseId).toBeUndefined();
    expect(t("t-forslag").status).toBe("ny");
    // t-lonn var ikke berørt av den andre klienten og skrives som vanlig.
    expect(t("t-lonn").hendelseId).toBeDefined();
  });
});
