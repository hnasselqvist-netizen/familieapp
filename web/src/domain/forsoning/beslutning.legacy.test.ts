/**
 * Differensiell karakterisering av Bankimport-beslutningene (§Issue #34
 * R3b-1): legacy-closurene i `BankimportScreen`/`VisRad` (`lagreBehandling`,
 * `opprettEllerOppdaterRegel`, `settStatus`, `merkFlerbruk`,
 * `merkRegelFlerbruk` og «bruk og utvid»-uttrykkene) trekkes ut ORDRETT fra
 * `index.html` (kun lesing), kjøres med fangede settere, og sammenlignes
 * med portene i `beslutning.ts` på samme data, id-sekvens og klokke.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HendelseRecord, MalPost, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import {
  extractConstArrow,
  extractInlineExpression,
  idSequence,
  loadLegacy,
} from "../../test/legacy";
import {
  type BeslutningUtkast,
  type Beslutningsendring,
  type ForsoningSnapshot,
  type UtkastFordeling,
  brukOgUtvidRegel,
  lagreBehandling,
  merkFlerbruk,
  settStatus,
  utvidRegelForslag,
} from "./beslutning";
import { normaliserTransaksjonstekst } from "./tekst";

const NAA = "2026-10-03T09:00:00.000Z";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NAA));
});
afterAll(() => vi.useRealTimers());

// ── Fixtures ────────────────────────────────────────────────────────
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
  tx({ id: "t-ny" }),
  tx({ id: "t-lik" }), // samme tekst → propageres ved læring
  tx({ id: "t-lik-ferdig", hendelseId: "h-lik" }), // samme tekst, men har hendelse
  tx({ id: "t-vent", tekst: "VIPPS OLA", belop: 300 }),
  tx({ id: "t-lonn", tekst: "Lønn fra Arbeidsgiver AS", belop: 42000, retning: "inn" }),
  tx({ id: "t-matchet", tekst: "KIWI 505", status: "matchet", matchetMot: "dagligvarer" }),
  tx({
    id: "t-kobling",
    tekst: "KIWI 505",
    laertKobling: { budgetItemId: "dagligvarer", navn: "Dagligvarer", flerbruk: false },
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
  opprettet: "2026-09-11T00:00:00.000Z",
  oppdatert: "2026-09-11T00:00:00.000Z",
  ...o,
});
const hendelser: HendelseRecord[] = [
  hendelse({ id: "h-lik", transaksjonId: "t-lik-ferdig" }),
  hendelse({
    id: "h-vent",
    transaksjonId: "t-vent",
    status: "pa_vent",
    paaVentAarsak: "venter_paa_kvittering",
    receiptId: "k-1",
  }),
];
const rules: RegelRecord[] = [
  {
    id: "r-rema",
    pattern: "rema 1000",
    normalizedPattern: "rema 1000",
    matchType: "inneholder",
    targetType: "budget",
    targetId: "dagligvarer",
    targetName: "Dagligvarer",
    mode: "auto",
    timesUsed: 3,
  },
  {
    id: "r-kiwi-annen",
    pattern: "kiwi majorstuen",
    normalizedPattern: "kiwi majorstuen",
    matchType: "inneholder",
    targetType: "budget",
    targetId: "kantine",
    targetName: "Kantine",
    mode: "auto",
  },
];
const snapshot: ForsoningSnapshot = { transaksjoner, hendelser, rules };

const post = (o: Partial<MalPost> & { id: string; name: string }): MalPost => ({
  retning: "ut",
  gruppe: "mat",
  eier: "Felles",
  ...o,
});
const dagligvarer = post({ id: "dagligvarer", name: "Dagligvarer" });
const kantine = post({ id: "kantine", name: "Kantine", eier: "Helen" });
const lonn = post({ id: "lonnHelen", name: "Lønn Helen", retning: "inn", gruppe: "lonn" });
const sparing = post({ id: "buffer", name: "Buffer", plasseringType: "sparing", gruppe: "spar" });
const f = (p: MalPost, belop: number, eiere = [{ person: "Felles", prosent: 100 }]) =>
  ({ post: p, belop, eiere }) as UtkastFordeling;

// ── Legacy ──────────────────────────────────────────────────────────
type AnyFn = (...args: unknown[]) => unknown;
let legacyUid: () => string = idSequence("id");
const motorer = loadLegacy<Record<string, AnyFn>>({
  functions: [
    "normaliserTransaksjonstekst",
    "regelMatcherTekst",
    "fellesPrefiks",
    "oppdaterReglerVedLaering",
    "finnHendelseForTransaksjon",
    "byggFordelingFraPost",
    "jevnFordelEiere",
    "beregnRestPaaSisteLinje",
  ],
  globals: { uid: () => legacyUid() },
});

type State = {
  transaksjoner: TransaksjonRecord[];
  hendelser: HendelseRecord[];
  rules: RegelRecord[];
};

/** Kjører legacy-closures med settere som anvender updateren umiddelbart (som `setX`). */
function legacy(start: ForsoningSnapshot, kilde: string, retur: string, ekstra = {}) {
  legacyUid = idSequence("id");
  const state: State = { ...start };
  const skrivinger: string[] = [];
  const setter = (node: keyof State) => (v: unknown) => {
    skrivinger.push(node);
    const prev = state[node] as unknown[];
    (state as Record<string, unknown>)[node] =
      typeof v === "function" ? (v as (p: unknown[]) => unknown[])(prev) : v;
    return Promise.resolve();
  };
  const env: Record<string, unknown> = {
    ...motorer,
    alle: start.transaksjoner,
    hendelser: start.hendelser,
    rules: start.rules,
    setTransaksjoner: setter("transaksjoner"),
    setHendelser: setter("hendelser"),
    setRules: setter("rules"),
    setApenId: () => {},
    uid: () => legacyUid(),
    ...ekstra,
  };
  const fn = new Function(...Object.keys(env), `"use strict";\n${kilde}\nreturn ${retur};`)(
    ...Object.values(env),
  ) as AnyFn;
  return { fn, state, skrivinger };
}

/** Port: anvender endringen i legacy sin rekkefølge for id-forbruk (rules sist). */
function anvend(start: ForsoningSnapshot, endring: Beslutningsendring): State {
  return {
    hendelser: endring.hendelser ? endring.hendelser(start.hendelser) : start.hendelser,
    transaksjoner: endring.transaksjoner
      ? endring.transaksjoner(start.transaksjoner)
      : start.transaksjoner,
    rules: endring.rules ? endring.rules(start.rules) : start.rules,
  };
}
const deps = () => ({ newId: idSequence("id"), naa: NAA });

const LAGRE = [
  extractConstArrow("opprettEllerOppdaterRegel"),
  extractConstArrow("lagreBehandling"),
].join("\n");

const UTKAST: [string, string, BeslutningUtkast][] = [
  [
    "plassering uten læring",
    "t-ny",
    { type: "plassert", fordelinger: [f(dagligvarer, 250)], laer: false, uklarValg: null },
  ],
  [
    "plassering med læring (eksisterende regel) + propagering",
    "t-ny",
    { type: "plassert", fordelinger: [f(dagligvarer, 250)], laer: true, uklarValg: null },
  ],
  [
    "læring mot ny post → ny regel",
    "t-ny",
    { type: "plassert", fordelinger: [f(kantine, 250)], laer: true, uklarValg: null },
  ],
  [
    "splitt med læring → ingen propagering",
    "t-ny",
    {
      type: "plassert",
      fordelinger: [f(dagligvarer, 150), f(kantine, 100, [{ person: "Helen", prosent: 100 }])],
      laer: true,
      uklarValg: null,
    },
  ],
  [
    "inntekt (motsatt retning)",
    "t-lonn",
    { type: "plassert", fordelinger: [f(lonn, 42000)], laer: true, uklarValg: null },
  ],
  [
    "sparing",
    "t-ny",
    { type: "plassert", fordelinger: [f(sparing, 250)], laer: false, uklarValg: null },
  ],
  [
    "på vent, ny hendelse",
    "t-ny",
    { type: "uklar", fordelinger: [], laer: false, uklarValg: "maa_avklares" },
  ],
  ["på vent uten årsak", "t-ny", { type: "uklar", fordelinger: [], laer: false, uklarValg: null }],
  [
    "eksisterende på vent → plassert (beholder id, opprettet og kvittering)",
    "t-vent",
    { type: "plassert", fordelinger: [f(dagligvarer, 300)], laer: false, uklarValg: null },
  ],
  [
    "eksisterende på vent → ny årsak",
    "t-vent",
    { type: "uklar", fordelinger: [], laer: false, uklarValg: "annet" },
  ],
  [
    "matchet uten hendelse → plassert med læring",
    "t-matchet",
    { type: "plassert", fordelinger: [f(dagligvarer, 250)], laer: true, uklarValg: null },
  ],
  [
    "verken på vent eller fordeling",
    "t-ny",
    { type: "plassert", fordelinger: [], laer: false, uklarValg: null },
  ],
  [
    "ukjent transaksjon",
    "t-finnes-ikke",
    { type: "plassert", fordelinger: [f(dagligvarer, 1)], laer: true, uklarValg: null },
  ],
];

/** Kopi uten `eiere` — feltet legacy ikke kjenner (bevisst avvik, #59). */
function utenEiere<T extends object>(o: T): T {
  const kopi = { ...o } as Record<string, unknown>;
  delete kopi.eiere;
  return kopi as T;
}

/**
 * Bevisst avvik (#59, regelstyrt ansvar): læring lagrer ansvaret som
 * regelens resultat (`rules[].eiere`) og på propagerte forslag
 * (`laertKobling.eiere`). Legacy kjenner ikke feltet; alt annet skal være
 * identisk, så feltet tas ut før sammenligningen og låses i egne tester.
 */
function utenAnsvarsAvvik(state: State): State {
  return {
    ...state,
    rules: state.rules.map(utenEiere),
    transaksjoner: state.transaksjoner.map((t) =>
      t.laertKobling ? { ...t, laertKobling: utenEiere(t.laertKobling) } : t,
    ),
  };
}

describe("lagreBehandling ≡ legacy", () => {
  it.each(UTKAST)("%s", (_navn, tranId, utkast) => {
    const L = legacy(snapshot, LAGRE, "lagreBehandling");
    L.fn(tranId, utkast);
    const port = anvend(snapshot, lagreBehandling(snapshot, tranId, utkast, deps()));
    expect(utenAnsvarsAvvik(port)).toEqual(L.state);
  });

  it("låser hovedtilfellene eksplisitt", () => {
    const plass = anvend(snapshot, lagreBehandling(snapshot, "t-ny", UTKAST[1]![2], deps()));
    const h = plass.hendelser.at(-1)!;
    expect(h).toMatchObject({
      status: "ferdig",
      transaksjonId: "t-ny",
      regelId: "r-rema",
      opprettet: NAA,
    });
    expect(h.fordelinger).toEqual([
      {
        plasseringId: "dagligvarer",
        plasseringType: "budget",
        plasseringNavn: "Dagligvarer",
        belop: 250,
        eiere: [{ person: "Felles", prosent: 100 }],
      },
    ]);
    const t = (id: string) => plass.transaksjoner.find((x) => x.id === id)!;
    expect(t("t-ny").hendelseId).toBe(h.id);
    expect(t("t-lik")).toMatchObject({ status: "foresoatt_match", matchetMot: "dagligvarer" });
    expect(t("t-lik-ferdig").status).toBe("ny");
    expect(plass.rules.find((r) => r.id === "r-rema")).toMatchObject({
      timesUsed: 4,
      lastMatched: NAA,
    });

    const vent = anvend(snapshot, lagreBehandling(snapshot, "t-vent", UTKAST[8]![2], deps()));
    expect(vent.hendelser.filter((x) => x.transaksjonId === "t-vent")).toEqual([
      expect.objectContaining({
        id: "h-vent",
        status: "ferdig",
        receiptId: "k-1",
        opprettet: "2026-09-11T00:00:00.000Z",
        oppdatert: NAA,
      }),
    ]);
  });
});

describe("enkle handlinger ≡ legacy", () => {
  it("settStatus («Ignorer») og med ekstra felt", () => {
    for (const [status, extra] of [
      ["ignorert", undefined],
      ["matchet", { matchetMot: "x" }],
    ] as const) {
      const L = legacy(snapshot, extractConstArrow("settStatus"), "settStatus");
      L.fn("t-ny", status, extra);
      expect(anvend(snapshot, settStatus("t-ny", status, extra))).toEqual(L.state);
    }
  });

  it("merkFlerbruk (regel + alle transaksjoner med samme tekst)", () => {
    for (const tekst of ["KIWI 505", "REMA 1000 GRUNERLOKKA", "finnes ikke"]) {
      const kilde = [
        extractConstArrow("merkRegelFlerbruk"),
        extractConstArrow("merkFlerbruk"),
      ].join("\n");
      const L = legacy(
        {
          ...snapshot,
          rules: [...rules, { ...rules[1]!, id: "r-kiwi", normalizedPattern: "kiwi 505" }],
        },
        kilde,
        "merkFlerbruk",
      );
      const mønster = normaliserTransaksjonstekst(tekst);
      L.fn(mønster);
      const start = {
        ...snapshot,
        rules: [...rules, { ...rules[1]!, id: "r-kiwi", normalizedPattern: "kiwi 505" }],
      };
      expect(anvend(start, merkFlerbruk(mønster, NAA))).toEqual(L.state);
    }
  });

  it("«bruk og utvid regel»: forslag og skriving", () => {
    const kilde = [
      `const naertregelForSammeTarget = ${extractInlineExpression("const naertregelForSammeTarget = ")};`,
      `const utvidetMonster = ${extractInlineExpression("const utvidetMonster = ")};`,
      `const utvidBrukAntall = ${extractInlineExpression("const utvidBrukAntall = ")};`,
      extractConstArrow("brukOgUtvidRegel"),
    ].join("\n");
    const tilfeller: [string, UtkastFordeling[]][] = [
      ["t-matchet", [f(kantine, 250)]], // r-kiwi-annen: «kiwi majorstuen» vs «kiwi 505» → prefiks «kiwi»
      ["t-ny", [f(dagligvarer, 250)]], // r-rema matcher allerede → ingen forslag
      ["t-ny", [f(kantine, 100), f(dagligvarer, 150)]], // splitt → ingen forslag
      ["t-lonn", [f(kantine, 1)]], // ingen felles prefiks
    ];
    // En INAKTIV regel for samme post først: legacy hopper over den.
    const inaktiv: RegelRecord = {
      ...rules[1]!,
      id: "r-kiwi-inaktiv",
      normalizedPattern: "kiwi 9",
      pattern: "kiwi 9",
      active: false,
    };
    for (const regelsett of [rules, [inaktiv, ...rules]])
      for (const [tranId, fordelinger] of tilfeller) {
        const start = { ...snapshot, rules: regelsett };
        const t = transaksjoner.find((x) => x.id === tranId)!;
        const L = legacy(
          start,
          kilde,
          "{ naertregelForSammeTarget, utvidetMonster, utvidBrukAntall, brukOgUtvidRegel }",
          {
            t,
            utkastFordelinger: fordelinger,
          },
        );
        const lv = L.fn as unknown as {
          naertregelForSammeTarget: RegelRecord | null | undefined;
          utvidetMonster: string;
          utvidBrukAntall: number;
          brukOgUtvidRegel: () => void;
        };
        const forslag = utvidRegelForslag(regelsett, t, fordelinger, transaksjoner);
        expect(forslag?.regel ?? null).toEqual(lv.naertregelForSammeTarget ?? null);
        expect(forslag?.utvidetMonster ?? "").toBe(lv.utvidetMonster);
        expect(forslag?.brukAntall ?? 0).toBe(lv.utvidBrukAntall);
        lv.brukOgUtvidRegel();
        const port = forslag ? anvend(start, brukOgUtvidRegel(forslag, NAA)) : { ...start };
        expect(port).toEqual(L.state);
      }
  });
});
