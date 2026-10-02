/**
 * Differensiell karakterisering av RegelSenter (§Issue #34, R1): de
 * komponent-lokale closurene i legacy `RegelSenter` (`index.html`
 * ~12515–12705) trekkes ut ORDRETT fra `index.html` (kun lesing) og
 * kjøres side om side med portene i `regelsenter.ts` på samme fixtures.
 *
 * Skriveoperasjonene evalueres med en injisert `setRules` som fanger
 * updateren legacy sender — updateren kjøres så mot samme liste som
 * porten får, med frosset klokke. Endres legacy-koden, feiler uttrekket
 * eller sammenligningen.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { RegelRecord } from "@app-types/forsoning";
import { extractInlineExpression, loadLegacy } from "../../test/legacy";
import * as port from "./regelsenter";

const NAA = "2026-10-02T12:00:00.000Z";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NAA));
});
afterAll(() => vi.useRealTimers());

// --- Fixtures ---------------------------------------------------------------

const post = (id: string, name: string, meta?: Record<string, unknown>) => ({
  id,
  name,
  budget: 0,
  spent: 0,
  ...(meta ? { meta } : {}),
});

const budgetGroups = [
  {
    id: "bolig",
    label: "Bolig",
    items: [
      post("b-lan", "Lån", { niva: "beskytte" }),
      post("b-strom", "Strøm", { niva: "opprettholde", opprettholdType: "nodvendig" }),
      post("b-tv", "TV", { niva: "opprettholde", opprettholdType: "valgfritt" }),
    ],
  },
  {
    id: "mat",
    label: "Mat",
    items: [
      post("b-mat", "Dagligvarer", { niva: "opprettholde" }),
      post("b-ute", "Spise ute", { niva: "velge" }),
      post("b-gml", "Gammel", { niva: "bygge" }),
      post("b-uten", "Uten nivå"),
    ],
  },
] as unknown as BudsjettGruppe[];
const incomeGroups = [
  { id: "lonn", label: "Lønn", items: [post("i-lonn", "Lønn Helen", { niva: "beskytte" })] },
] as unknown as BudsjettGruppe[];
const sparingGroups = [
  { id: "buffer", label: "Buffer", items: [post("s-buffer", "Bufferkonto")] },
  { id: "barn", label: "Barn", items: [post("s-barn", "BSU barn")] },
  { id: "tom", label: "Tom", items: [post("s-tom", "Ingen regler")] },
] as unknown as BudsjettGruppe[];
const grupper = { budgetGroups, incomeGroups, sparingGroups };

const regel = (id: string, felt: Partial<RegelRecord>): RegelRecord => ({
  id,
  pattern: id,
  normalizedPattern: id.toLowerCase(),
  targetType: "budget",
  targetId: "b-mat",
  targetName: "Dagligvarer",
  mode: "suggest",
  ...felt,
});

const regler: RegelRecord[] = [
  regel("REMA 1000", { timesUsed: 12, lastMatched: "2026-09-30T10:00:00Z", mode: "auto" }),
  regel("Kiwi", { timesUsed: 12, lastMatched: "2026-09-01T10:00:00Z", matchType: "starter_med" }),
  regel("Coop", { timesUsed: 3, active: false }),
  regel("Fjordkraft", { targetId: "b-strom", targetName: "Strøm", timesUsed: 5, mode: "review" }),
  regel("DNB lån", { targetId: "b-lan", targetName: "Lån", matchType: "er_lik", confidence: 80 }),
  regel("Netflix", { targetId: "b-tv", targetName: "TV", multiUse: true, timesUsed: 5 }),
  regel("Peppes", {
    targetId: "b-ute",
    targetName: "Spise ute",
    lastMatched: "2026-08-01T00:00:00Z",
  }),
  regel("Gammel regel", { targetId: "b-gml", targetName: "Gammel" }),
  regel("Ukjent post", { targetId: "finnes-ikke", targetName: "Slettet post", mode: "disabled" }),
  regel("Uten nivå", { targetId: "b-uten", targetName: "Uten nivå", active: true }),
  regel("Arbeidsgiver", { targetId: "i-lonn", targetType: "income", targetName: "Lønn Helen" }),
  regel("Buffer overføring", {
    targetId: "s-buffer",
    targetType: "sparing",
    targetName: "Bufferkonto",
    timesUsed: 2,
  }),
  regel("BSU", { targetId: "s-barn", targetType: "budget", targetName: "BSU barn" }), // flyttet til sparing: targetType er kun et hint
  {
    id: "tom",
    pattern: "",
    normalizedPattern: "",
    targetType: "budget",
    targetId: "",
    targetName: "",
    mode: "suggest",
  },
];

const transaksjoner = [
  { tekst: "REMA 1000 GRUNERLOKKA" },
  { tekst: "Rema 1000 Majorstuen" },
  { tekst: "KIWI 505 TORSHOV" },
  { tekst: "Vipps*Kiwi" },
  { tekst: "DNB lån" },
  { tekst: "NETFLIX.COM" },
  { tekst: "" },
  { tekst: null },
  {},
];

const sok = ["", "   ", "rema", "REMA", " kiwi ", "strøm", "dagligvarer", "lån", "finnes ikke"];

// --- Legacy-closurene, evaluert i ett skop -----------------------------------

type AnyFn = (...args: unknown[]) => unknown;

function legacyScope(extra: Record<string, unknown> = {}) {
  return loadLegacy<Record<string, AnyFn>>({
    functions: [
      "normaliserTransaksjonstekst",
      "normalizeMerchant",
      "regelMatcherTekst",
      "finnMalpostForRegel",
    ],
    constArrows: [
      "nivaKeyForMeta",
      "finnMalpost",
      "nivaKeyForRegel",
      "tellTreff",
      "oppdaterRegel",
      "slettRegel",
      "slaSammenRegler",
      "toggleValgtForSammenslaing",
    ],
    constValues: ["NIVA_REKKEFOLGE"],
    globals: {
      budgetGroups,
      incomeGroups,
      sparingGroups,
      transaksjoner,
      setRedigerId: () => {},
      setSammenslaModus: () => {},
      setValgteForSammenslaing: () => {},
      alle: [],
      valgteForSammenslaing: [],
      setRules: () => {},
      ...extra,
    },
  });
}

/** Evaluerer et ordrett uttrukket legacy-uttrykk med gitte frie variabler. */
function evalLegacy(expr: string, scope: Record<string, unknown>): unknown {
  return new Function(...Object.keys(scope), `"use strict"; return (${expr});`)(
    ...Object.values(scope),
  );
}

/** Updateren legacy sender til `setRules` når `kall` kjøres. */
function captureSetRules(kall: (scope: Record<string, AnyFn>) => void, extra = {}) {
  let updater: ((prev: unknown) => unknown) | null = null;
  const scope = legacyScope({
    ...extra,
    setRules: (u: (prev: unknown) => unknown) => (updater = u),
  });
  kall(scope);
  return updater as ((prev: unknown) => unknown) | null;
}

const legacyFilter = extractInlineExpression("const filtrert = alle.filter(");
const legacySort = extractInlineExpression("const sortert = [...filtrert].sort(");
const legacyAktive = extractInlineExpression("const antallAktive = ");
const legacyAuto = extractInlineExpression("const antallAuto   = ");
const legacyVurder = extractInlineExpression("const antallVurder = ");
const legacySpare = extractInlineExpression("const spareReglerGruppert = ");

describe("RegelSenter-visning ≡ legacy", () => {
  it("søk (`filtrert`) for alle søkestrenger", () => {
    for (const s of sok) {
      const legacyPred = evalLegacy(legacyFilter, { sok: s }) as (r: RegelRecord) => boolean;
      expect(port.filtrerRegler(regler, s), s).toEqual(regler.filter(legacyPred));
    }
  });

  it("sortering (`sortert`): aktiv → flest bruk → sist brukt", () => {
    const cmp = evalLegacy(legacySort, {}) as (a: RegelRecord, b: RegelRecord) => number;
    expect(port.sorterRegler(regler)).toEqual([...regler].sort(cmp));
    expect(port.sorterRegler([...regler].reverse())).toEqual([...regler].reverse().sort(cmp));
  });

  it("statuspanelet", () => {
    for (const liste of [regler, [], regler.slice(0, 3)]) {
      expect(port.regelStatus(liste)).toEqual({
        totalt: liste.length,
        aktive: evalLegacy(legacyAktive, { alle: liste }),
        automatiske: evalLegacy(legacyAuto, { alle: liste }),
        kreverVurdering: evalLegacy(legacyVurder, { alle: liste }),
      });
    }
  });

  it("nivå-nøkkel per regel (inkl. sparing, flyttet post og manglende mål)", () => {
    const L = legacyScope();
    for (const r of regler) {
      expect(port.nivaKeyForRegel(r, grupper), r.id).toBe(L.nivaKeyForRegel!(r));
    }
  });

  it("nivåseksjonene (render-løkken over NIVA_REKKEFOLGE)", () => {
    const L = legacyScope();
    const NIVA = (L as unknown as { NIVA_REKKEFOLGE: { key: string; label: string }[] })
      .NIVA_REKKEFOLGE;
    const sortert = port.sorterRegler(regler);
    const legacySeksjoner = NIVA.map((niva) => ({
      key: niva.key,
      regler: sortert.filter((r) => L.nivaKeyForRegel!(r) === niva.key),
    })).filter((s) => s.regler.length > 0);
    // Etikettene sammenlignes ikke: Årsbudsjett-porten (`NIVA_REKKEFOLGE`)
    // retter legacy sin ASCII-staving («skal vaere» → «skal være»).
    expect(
      port.reglerPerNiva(sortert, grupper).map(({ key, regler: r }) => ({ key, regler: r })),
    ).toEqual(legacySeksjoner);
  });

  it("sparegrupperingen (`spareReglerGruppert`), tomme grupper utelatt", () => {
    const L = legacyScope();
    const sortert = port.sorterRegler(regler);
    const legacyResultat = evalLegacy(legacySpare, {
      sparingGroups,
      sortert,
      finnMalpost: L.finnMalpost,
    }) as { gruppeId: string; label: string; regler: RegelRecord[] }[];
    expect(port.spareReglerGruppert(sortert, grupper)).toEqual(
      legacyResultat.map((g) => ({ key: g.gruppeId, label: g.label, regler: g.regler })),
    );
  });

  it("«Treffer i dag» (`tellTreff`) per regel", () => {
    const L = legacyScope();
    for (const r of regler) {
      expect(port.tellTreff(r, transaksjoner), r.id).toBe(L.tellTreff!(r));
    }
  });
});

describe("RegelSenter-skriveoperasjoner ≡ legacy (updateren som sendes til setRules)", () => {
  const felter: port.RegelFelt[] = [
    { mode: "auto" },
    { matchType: "er_lik" },
    { confidence: 55 },
    { active: false },
    { multiUse: true },
    port.monsterFelt("Rema 1000 Ny"),
    { mode: "review", confidence: 0 },
  ];

  it("oppdaterRegel for hvert felt, også ukjent id og tom liste", () => {
    for (const felt of felter) {
      for (const id of ["Kiwi", "tom", "finnes-ikke"]) {
        const updater = captureSetRules((L) => L.oppdaterRegel!(id, felt))!;
        for (const prev of [regler, [], null]) {
          expect(port.oppdaterRegel(prev, id, felt, NAA), `${id} ${JSON.stringify(felt)}`).toEqual(
            updater(prev),
          );
        }
      }
    }
  });

  it("mønsterfeltet lagrer pattern + normalizedPattern (legacy `lagre`)", () => {
    const lagre = extractInlineExpression("const lagre = () => oppdaterRegel(r.id, ");
    expect(evalLegacy(lagre, { utkast: "Rema 1000 Ny" })).toEqual(port.monsterFelt("Rema 1000 Ny"));
  });

  it("slettRegel, også ukjent id og tom liste", () => {
    for (const id of ["Coop", "tom", "finnes-ikke"]) {
      const updater = captureSetRules((L) => L.slettRegel!(id))!;
      for (const prev of [regler, [], null]) {
        expect(port.slettRegel(prev, id)).toEqual(updater(prev));
      }
    }
  });

  it("slaSammenRegler: høyest bruk beholdes (≥ ved likhet), bruken summeres", () => {
    const par: [string, string][] = [
      ["REMA 1000", "Kiwi"], // likt bruk (12/12): første beholdes
      ["Kiwi", "REMA 1000"],
      ["Coop", "Fjordkraft"], // 3 < 5: andre beholdes
      ["Peppes", "Gammel regel"], // begge uten timesUsed
    ];
    for (const [aId, bId] of par) {
      const updater = captureSetRules((L) => L.slaSammenRegler!(), {
        alle: regler,
        valgteForSammenslaing: [aId, bId],
      })!;
      expect(port.slaSammenRegler(regler, aId, bId, NAA), `${aId}+${bId}`).toEqual(updater(regler));
    }
  });

  it("slaSammenRegler: færre enn to valgt eller ukjent regel → ingen skriving (legacy) / uendret liste (port)", () => {
    for (const valgte of [[], ["Kiwi"], ["Kiwi", "finnes-ikke"]]) {
      const updater = captureSetRules((L) => L.slaSammenRegler!(), {
        alle: regler,
        valgteForSammenslaing: valgte,
      });
      expect(updater).toBeNull();
      if (valgte.length === 2) {
        expect(port.slaSammenRegler(regler, valgte[0]!, valgte[1]!, NAA)).toEqual(regler);
      }
    }
  });

  it("valg til sammenslåing: veksle og behold maks to", () => {
    let legacyUpdater: ((prev: string[]) => string[]) | null = null;
    const L = legacyScope({
      setValgteForSammenslaing: (u: (prev: string[]) => string[]) => (legacyUpdater = u),
    });
    for (const [prev, id] of [
      [[], "a"],
      [["a"], "b"],
      [["a", "b"], "c"],
      [["a", "b"], "a"],
      [["a"], "a"],
    ] as [string[], string][]) {
      L.toggleValgtForSammenslaing!(id);
      expect(port.velgForSammenslaing(prev, id)).toEqual(legacyUpdater!(prev));
    }
  });
});
