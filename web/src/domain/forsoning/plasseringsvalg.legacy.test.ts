/**
 * Differensiell karakterisering av plasseringsvalget (§Issue #34 R3b-1):
 * legacy `allePoster`, `finnAktivPostFraGammelId`, `finnKandidater` og
 * VisRad sin start-tilstand for `utkastFordelinger` trekkes ut ORDRETT fra
 * `index.html` og sammenlignes med portene.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { TransaksjonRecord } from "@app-types/forsoning";
import {
  extractConstArrow,
  extractInlineExpression,
  idSequence,
  loadLegacy,
} from "../../test/legacy";
import {
  allePoster,
  finnAktivPostFraGammelId,
  finnKandidater,
  startFordelinger,
} from "./plasseringsvalg";

const NAA = "2026-10-03T09:00:00.000Z"; // oktober → mnd 9
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NAA));
});
afterAll(() => vi.useRealTimers());

const mnd = (budget: number) =>
  Array.from({ length: 12 }, (_, i) => ({ budget: i === 9 ? budget : 1, spent: 0 }));
const budgetGroups: BudsjettGruppe[] = [
  {
    id: "mat",
    label: "Mat",
    items: [
      { id: "dagligvarer", name: "Dagligvarer REMA", months: mnd(4000), meta: { eier: "Felles" } },
      { id: "kantine", name: "Kantine jobb", months: mnd(240), meta: { eier: "Helen" } },
      { id: "gammel", name: "Gammel REMA-post", months: mnd(0), meta: { arkivert: true } },
      { id: "ny-id", name: "Strøm", months: mnd(1200), legacyIds: ["strom-gammel"] },
    ],
  },
  {
    id: "bil",
    label: "Bil",
    items: [
      { id: "drivstoff", name: "Drivstoff Circle", months: [] },
      { id: "bilservice", name: "Bil service", months: [] },
    ],
  },
];
const incomeGroups: BudsjettGruppe[] = [
  {
    id: "lonn",
    label: "Lønn",
    items: [{ id: "lonnHelen", name: "Lønn Helen", months: mnd(42000) }],
  },
];
const sparingGroups: BudsjettGruppe[] = [
  {
    id: "buffer",
    label: "Buffer",
    items: [
      { id: "bufferkonto", name: "Bufferkonto", months: mnd(5000), meta: { eier: "Eivind" } },
      { id: "spar-arkiv", name: "Arkivert", months: mnd(9), meta: { arkivert: true } },
    ],
  },
];
const grupper = { budgetGroups, incomeGroups, sparingGroups };

type AnyFn = (...args: unknown[]) => unknown;
let legacyUid = idSequence("id");
const motorer = loadLegacy<Record<string, AnyFn>>({
  functions: ["byggAlleSparingPoster", "beregnRestPaaSisteLinje", "jevnFordelEiere"],
  constArrows: ["budsjettpostMatcherId"],
  globals: { uid: () => legacyUid() },
});

/** Legacy-closurene med BankimportScreen/VisRad sine frie variabler. */
function legacyValg(t: TransaksjonRecord, effektivStatus: { harHendelse: boolean }) {
  legacyUid = idSequence("id");
  const env: Record<string, unknown> = {
    ...motorer,
    budgetGroups,
    incomeGroups,
    sparingGroups,
    t,
    effektivStatus,
    uid: () => legacyUid(),
  };
  const body = [
    // `const allePoster = ` finnes flere steder; markøren inkluderer BankimportScreen sin `mnd`-linje.
    "const mnd = new Date().getMonth();",
    `const allePoster = ${extractInlineExpression("const mnd = new Date().getMonth();\n  const allePoster = ")};`,
    extractConstArrow("finnAktivPostFraGammelId"),
    extractConstArrow("finnKandidater"),
    // Initialiseren i VisRad (~7201); `= useState(` finnes også i KorrigerHendelseModal.
    `const start = (() => {${extractInlineExpression("const [utkastFordelinger,setUtkastFordelinger] = useState(() => {")}})();`,
    "return { allePoster, finnAktivPostFraGammelId, finnKandidater, start };",
  ].join("\n");
  return new Function(...Object.keys(env), `"use strict";\n${body}`)(...Object.values(env)) as {
    allePoster: unknown[];
    finnAktivPostFraGammelId: (id: string | null | undefined) => unknown;
    finnKandidater: (t: TransaksjonRecord) => unknown[];
    start: unknown[];
  };
}

const tx = (o: Partial<TransaksjonRecord> & { id: string }): TransaksjonRecord => ({
  dato: "2026-09-10",
  tekst: "REMA 1000 GRUNERLOKKA",
  belop: 412,
  retning: "ut",
  konto: "felleskonto",
  status: "ny",
  ...o,
});
const TX: TransaksjonRecord[] = [
  tx({ id: "t-rema" }),
  tx({ id: "t-belop", tekst: "Ukjent", belop: 4300 }), // innen 15 % av 4000
  tx({ id: "t-belop-utenfor", tekst: "Ukjent", belop: 5000 }),
  tx({ id: "t-circle", tekst: "CIRCLE K 12.09, Oslo", belop: 600 }),
  tx({ id: "t-lonn", tekst: "Lønn Helen sept", belop: 42000, retning: "inn" }),
  tx({ id: "t-tom", tekst: "", belop: 0 }),
  // Tre-bokstavsord teller ikke («BIL» ≠ «Bil service»).
  tx({ id: "t-kort-ord", tekst: "BIL vask", belop: 77 }),
  tx({ id: "t-matchet", status: "matchet", matchetMot: "strom-gammel", belop: 1180 }),
  tx({
    id: "t-forslag",
    status: "foresoatt_match",
    laertKobling: { budgetItemId: "bufferkonto", navn: "Bufferkonto", flerbruk: false },
    matchetMot: "dagligvarer",
  }),
  tx({ id: "t-matchet-arkiv", status: "matchet", matchetMot: "gammel" }),
  tx({ id: "t-matchet-inntekt", status: "matchet", matchetMot: "lonnHelen", retning: "inn" }),
];

describe("plasseringsvalg ≡ legacy", () => {
  it("allePoster (aktive poster, månedens budsjett, eier, sparing med plasseringType)", () => {
    const L = legacyValg(TX[0]!, { harHendelse: false });
    expect(allePoster(grupper, new Date().getMonth())).toEqual(L.allePoster);
    expect(allePoster(grupper, 9).map((p) => p.id)).toEqual([
      "dagligvarer",
      "kantine",
      "ny-id",
      "drivstoff",
      "bilservice",
      "lonnHelen",
      "bufferkonto",
    ]);
  });

  it("finnAktivPostFraGammelId (id, legacyIds, arkivert, inntekt, sparing, ukjent, tom)", () => {
    const L = legacyValg(TX[0]!, { harHendelse: false });
    for (const id of [
      "dagligvarer",
      "strom-gammel",
      "gammel",
      "lonnHelen",
      "bufferkonto",
      "spar-arkiv",
      "finnes-ikke",
      "",
      null,
      undefined,
    ]) {
      expect(finnAktivPostFraGammelId(id, grupper)).toEqual(L.finnAktivPostFraGammelId(id));
    }
  });

  it.each(TX.map((t) => [t.id, t] as const))("finnKandidater: %s", (_id, t) => {
    const L = legacyValg(t, { harHendelse: false });
    expect(finnKandidater(t, allePoster(grupper, 9))).toEqual(L.finnKandidater(t));
  });

  it.each(
    TX.flatMap(
      (t) =>
        [
          [`${t.id} uten hendelse`, t, false],
          [`${t.id} med hendelse`, t, true],
        ] as const,
    ),
  )("startFordelinger: %s", (_navn, t, harHendelse) => {
    const L = legacyValg(t, { harHendelse });
    expect(startFordelinger(t, harHendelse, grupper, idSequence("id"))).toEqual(L.start);
  });

  it("låser forhåndsvalget eksplisitt", () => {
    const [linje] = startFordelinger(
      TX.find((t) => t.id === "t-matchet")!,
      false,
      grupper,
      idSequence("id"),
    );
    expect(linje).toEqual({
      id: "id-1",
      post: { id: "ny-id", name: "Strøm", gruppe: "Mat", retning: "ut", eier: "Felles" },
      belop: 1180,
      eiere: [{ person: "Felles", prosent: 100 }],
    });
    expect(
      startFordelinger(
        TX.find((t) => t.id === "t-forslag")!,
        false,
        grupper,
        idSequence("id"),
      )[0]!.post,
    ).toMatchObject({
      id: "bufferkonto",
      plasseringType: "sparing",
    });
  });
});
