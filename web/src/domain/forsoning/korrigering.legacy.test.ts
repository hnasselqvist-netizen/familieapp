/**
 * Differensiell karakterisering av korrigeringen (§Issue #34 R3b-4).
 *
 * `KorrigerHendelseModal` er en komponent, så logikken trekkes ut som
 * komponentkroppen ORDRETT fra `index.html` (kun lesing) frem til JSX-en,
 * og kjøres i en minimal hook-harness (`useState` med re-render etter hver
 * handling). Kallernes `onLagre` (Bankimport + Budsjett/Inntekter/Sparing)
 * og `transaksjonForKorrigering` trekkes også ut — og låses som identiske
 * på tvers av de fire kallestedene. Samme handlingssekvens kjøres mot
 * portene i `korrigering.ts`, og utkast, søk og skrevne noder sammenlignes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  Eierandel,
  HendelseRecord,
  MalPost,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { idSequence, loadLegacy, matchBlock } from "../../test/legacy";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type Korrigering,
  byttPostPaaLinje,
  fjernKorrigeringslinje,
  kanLagreKorrigering,
  korrigeringsPoster,
  korrigeringsRetning,
  korrigeringsTotal,
  lagreKorrigering,
  leggTilKorrigeringslinje,
  observasjonForKorrigering,
  settKorrigeringsBelop,
  settKorrigeringsEiere,
  sokKorrigeringsPoster,
  startKorrigering,
} from "./korrigering";

const NAA = "2026-10-03T09:00:00.000Z";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NAA));
});
afterAll(() => vi.useRealTimers());

const SRC = readFileSync(path.resolve(import.meta.dirname, "../../../../index.html"), "utf8");

// ── Fixtures ────────────────────────────────────────────────────────
const mnd = Array.from({ length: 12 }, () => ({ budget: 0, spent: 0 }));
const budgetGroups: BudsjettGruppe[] = [
  {
    id: "mat",
    label: "Mat",
    items: [
      {
        id: "dagligvarer",
        name: "Dagligvarer",
        months: mnd,
        legacyIds: ["dagligvarer_gammel"],
        meta: { eier: "Felles" } as never,
      },
      { id: "kantine", name: "Kantine", months: mnd, meta: { eier: "Helen" } as never },
      { id: "arkiv", name: "Dagligvarer arkiv", months: mnd, meta: { arkivert: true } as never },
    ],
  },
];
const incomeGroups: BudsjettGruppe[] = [
  {
    id: "lonn",
    label: "Lønn",
    items: [{ id: "lonnHelen", name: "Lønn Helen", months: mnd, meta: { eier: "Helen" } as never }],
  },
];
const sparingGroups: BudsjettGruppe[] = [
  {
    id: "spar",
    label: "Buffer",
    items: [
      { id: "bufferkonto", name: "Bufferkonto", months: mnd },
      { id: "ferie", name: "Feriekonto", months: mnd },
    ],
  },
];
const grupper = { budgetGroups, incomeGroups, sparingGroups };

const tx = (id: string, o: Partial<TransaksjonRecord> = {}): TransaksjonRecord => ({
  id,
  dato: "2026-09-10",
  tekst: "REMA 1000 GRUNERLOKKA",
  belop: 250,
  retning: "ut",
  konto: "felles",
  status: "ny",
  ...o,
});
const transaksjoner = [
  tx("t-rema", { hendelseId: "h-ferdig" }),
  tx("t-vent", { tekst: "VIPPS OLA", belop: 300, hendelseId: "h-vent" }),
  tx("t-spar", { tekst: "OVERFØRING SPAR", belop: 300, hendelseId: "h-sparing" }),
  tx("t-retur", { tekst: "REMA RETUR", belop: 50, hendelseId: "h-refusjon" }),
  tx("t-neg", { tekst: "KIWI", belop: -90, hendelseId: "h-negativ" }),
];
const fordeling = (
  plasseringId: string,
  belop: number,
  plasseringType: "budget" | "income" | "sparing" = "budget",
  eiere: Eierandel[] = [{ person: "Felles", prosent: 100 }],
) => ({ plasseringId, plasseringType, plasseringNavn: plasseringId, belop, eiere });
const h = (id: string, o: Partial<HendelseRecord>): HendelseRecord => ({
  id,
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
  h("h-ferdig", {
    transaksjonId: "t-rema",
    regelId: "r-gammel",
    fordelinger: [
      fordeling("dagligvarer_gammel", 200),
      fordeling("kantine", 50, "budget", [{ person: "Helen", prosent: 100 }]),
    ],
  }),
  h("h-vent", {
    transaksjonId: "t-vent",
    status: "pa_vent",
    paaVentAarsak: "venter_paa_kvittering",
  }),
  h("h-manuell-inn", {
    kilde: "manuell",
    fordelinger: [fordeling("lonnHelen", -120, "income")],
  }),
  h("h-sparing", {
    transaksjonId: "t-spar",
    fordelinger: [fordeling("bufferkonto", 300, "sparing")],
  }),
  // Inntektspost på en utgift: lagret med motsatt fortegn.
  h("h-refusjon", {
    transaksjonId: "t-retur",
    fordelinger: [fordeling("lonnHelen", -50, "income")],
  }),
  h("h-negativ", { transaksjonId: "t-neg", fordelinger: [fordeling("dagligvarer", 90)] }),
  h("h-slettet-post", { fordelinger: [{ ...fordeling("borte", 80), plasseringNavn: "Borte" }] }),
  h("h-tom-eier", { fordelinger: [{ ...fordeling("kantine", 10), eiere: [] }] }),
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
    timesUsed: 2,
  },
];

// ── Legacy ──────────────────────────────────────────────────────────
type AnyFn = (...args: unknown[]) => unknown;
let legacyUid: () => string = idSequence("id");
const motorer = loadLegacy<Record<string, AnyFn>>({
  functions: [
    "normaliserTransaksjonstekst",
    "regelMatcherTekst",
    "fellesPrefiks",
    "oppdaterReglerVedLaering",
    "byggAlleSparingPoster",
    "beregnRestPaaSisteLinje",
    "jevnFordelEiere",
    "byggFordelingFraPost",
    "byggKorrigertHendelse",
  ],
  constArrows: ["budsjettpostMatcherId"],
  globals: { uid: () => legacyUid() },
});

/** Komponentkroppen til `KorrigerHendelseModal`, frem til JSX-en. */
const KROPP = (() => {
  const start = SRC.indexOf("function KorrigerHendelseModal(");
  const aapne = SRC.indexOf("{", SRC.indexOf(")", start));
  const slutt = SRC.indexOf('  return (\n    <Modal title={"Korriger', aapne);
  if (start < 0 || slutt < 0) throw new Error("Fant ikke KorrigerHendelseModal");
  return SRC.slice(aapne + 1, slutt);
})();

/** Alle fire kallestedenes `onLagre`-kropp, uten lukke-/navigasjonssettere. */
const ON_LAGRE = (() => {
  const marker = "onLagre={(oppdatertHendelse, laerData)=>{";
  const kropper: string[] = [];
  for (let i = SRC.indexOf(marker); i >= 0; i = SRC.indexOf(marker, i + 1)) {
    const aapne = i + marker.length - 1;
    kropper.push(
      SRC.slice(aapne + 1, matchBlock(SRC, aapne) - 1)
        .split("\n")
        .map((l) => l.trim())
        .filter(
          (l) => l && !l.startsWith("setKorrigerHendelseId(") && !l.startsWith("setDrillDown("),
        )
        .join("\n"),
    );
  }
  return kropper;
})();

/** Alle fire `transaksjonForKorrigering`-uttrykkene. */
const OBSERVASJON = (() => {
  const marker = "const transaksjonForKorrigering = ";
  const ut: string[] = [];
  for (let i = SRC.indexOf(marker); i >= 0; i = SRC.indexOf(marker, i + 1)) {
    ut.push(SRC.slice(i + marker.length, SRC.indexOf(";\n", i)));
  }
  return ut;
})();

const RETUR = [
  "utkastType",
  "utkastFordelinger",
  "utkastUklar",
  "utkastLaer",
  "sokTreff",
  "allePoster",
  "kanLagre",
  "transBelop",
  "transRetning",
  "setUtkastType",
  "setUtkastUklar",
  "setUtkastLaer",
  "setRedigerLinjeIdx",
  "setSokTekst",
  "leggTilFordeling",
  "velgPostForLinje",
  "oppdaterBelop",
  "oppdaterEiere",
  "fjernFordeling",
  "lagre",
];

/** Minimal hook-harness: `useState` husker verdier på tvers av renderinger. */
function legacyModal(hendelse: HendelseRecord, transaksjon: unknown) {
  legacyUid = idSequence("id");
  const verdier: unknown[] = [];
  let forste = true;
  let lagret: [HendelseRecord, { transaksjon: unknown; post: MalPost } | null] | null = null;
  const render = () => {
    let i = 0;
    const useState = (init: unknown) => {
      const idx = i++;
      if (forste) verdier[idx] = typeof init === "function" ? (init as () => unknown)() : init;
      const sett = (v: unknown) => {
        verdier[idx] = typeof v === "function" ? (v as (p: unknown) => unknown)(verdier[idx]) : v;
      };
      return [verdier[idx], sett];
    };
    const env: Record<string, unknown> = {
      ...motorer,
      uid: () => legacyUid(),
      useState,
      hendelse,
      transaksjon,
      budgetGroups,
      incomeGroups,
      sparingGroups,
      rules,
      onLagre: (oppdatert: HendelseRecord, laer: never) => {
        lagret = [oppdatert, laer];
      },
      onClose: () => {},
    };
    const ut = new Function(
      ...Object.keys(env),
      `"use strict";\n${KROPP}\nreturn { ${RETUR.join(", ")} };`,
    )(...Object.values(env)) as Record<string, AnyFn & unknown>;
    forste = false;
    return ut;
  };
  return { render, lagret: () => lagret };
}

/** Kjører kallerens `onLagre` med fangede settere mot startdata. */
function legacyOnLagre(
  oppdatert: HendelseRecord,
  laerData: { transaksjon: unknown; post: MalPost } | null,
) {
  legacyUid = idSequence("regel");
  const state = { hendelser: [...hendelser], rules: [...rules] };
  const skrevet: string[] = [];
  const env: Record<string, unknown> = {
    ...motorer,
    oppdatertHendelse: oppdatert,
    laerData,
    setHendelser: (u: (p: HendelseRecord[]) => HendelseRecord[]) => {
      skrevet.push("hendelser");
      state.hendelser = u(state.hendelser);
    },
    setRules: (u: (p: RegelRecord[]) => RegelRecord[]) => {
      skrevet.push("rules");
      state.rules = u(state.rules);
    },
  };
  new Function(...Object.keys(env), `"use strict";\n${ON_LAGRE[0]}`)(...Object.values(env));
  return { state, skrevet };
}

// ── Handlinger, kjørt likt mot legacy og port ──────────────────────
type Handling =
  | ["type", "uklar" | null]
  | ["uklar", string]
  | ["laer", boolean]
  | ["rediger", number]
  | ["velg", string]
  | ["belop", number, number]
  | ["eiere", number, Eierandel[]]
  | ["fjern", number];

/** Linje-id-er er bare React-nøkler og skrives aldri — de sammenlignes ikke. */
const utenId = (k: { linjer: { id: string }[] }) =>
  k.linjer.map((l) => Object.fromEntries(Object.entries(l).filter(([n]) => n !== "id")));

function kjor(hendelse: HendelseRecord, handlinger: Handling[], laerUtenObs = false) {
  const obs = observasjonForKorrigering(hendelse, transaksjoner);
  // Legacy-modalen
  const L = legacyModal(hendelse, obs);
  let v = L.render();
  for (const hd of handlinger) {
    if (hd[0] === "type") (v.setUtkastType as AnyFn)(hd[1]);
    if (hd[0] === "uklar") (v.setUtkastUklar as AnyFn)(hd[1]);
    if (hd[0] === "laer") (v.setUtkastLaer as AnyFn)(hd[1]);
    if (hd[0] === "rediger") (v.setRedigerLinjeIdx as AnyFn)(hd[1]);
    if (hd[0] === "velg") {
      const post = (v.allePoster as unknown as MalPost[]).find((p) => p.id === hd[1]);
      (v.velgPostForLinje as AnyFn)(post);
    }
    if (hd[0] === "belop") (v.oppdaterBelop as AnyFn)(hd[1], hd[2]);
    if (hd[0] === "eiere") (v.oppdaterEiere as AnyFn)(hd[1], hd[2]);
    if (hd[0] === "fjern") (v.fjernFordeling as AnyFn)(hd[1]);
    v = L.render();
  }

  // Porten
  const newId = idSequence("p");
  let k: Korrigering = startKorrigering(hendelse, grupper, newId);
  let rediger: number | null = null;
  const total = korrigeringsTotal(obs);
  const retning = korrigeringsRetning(obs);
  const poster = korrigeringsPoster(grupper);
  for (const hd of handlinger) {
    if (hd[0] === "type") k = { ...k, type: hd[1] };
    if (hd[0] === "uklar") k = { ...k, uklar: hd[1] };
    if (hd[0] === "laer") k = { ...k, laer: hd[1] };
    if (hd[0] === "rediger") rediger = hd[1];
    if (hd[0] === "velg") {
      const post = poster.find((p) => p.id === hd[1])!;
      k = {
        ...k,
        linjer:
          rediger !== null
            ? byttPostPaaLinje(k.linjer, rediger, post, retning)
            : leggTilKorrigeringslinje(k.linjer, post, total, newId),
      };
      rediger = null;
    }
    if (hd[0] === "belop")
      k = { ...k, linjer: settKorrigeringsBelop(k.linjer, hd[1], hd[2], total) };
    if (hd[0] === "eiere") k = { ...k, linjer: settKorrigeringsEiere(k.linjer, hd[1], hd[2]) };
    if (hd[0] === "fjern") k = { ...k, linjer: fjernKorrigeringslinje(k.linjer, hd[1], total) };
  }

  // Utkastet underveis er likt…
  expect(k.type).toEqual(v.utkastType);
  expect(k.uklar).toEqual(v.utkastUklar);
  expect(k.laer).toEqual(v.utkastLaer);
  expect(utenId(k)).toEqual(utenId({ linjer: v.utkastFordelinger as never }));
  expect(kanLagreKorrigering(k)).toBe(v.kanLagre);
  expect(total).toBe(v.transBelop);
  expect(retning).toBe(v.transRetning);
  if (laerUtenObs) return;

  // …og det som skrives er likt.
  (v.lagre as AnyFn)();
  const [oppdatert, laerData] = L.lagret()!;
  const legacyRes = legacyOnLagre(oppdatert, laerData);
  const endring = lagreKorrigering(hendelse, obs, k, rules, {
    newId: idSequence("regel"),
    naa: NAA,
  });
  const portRes = {
    hendelser: endring.hendelser!(hendelser),
    rules: endring.rules ? endring.rules(rules) : rules,
  };
  expect(portRes).toEqual(legacyRes.state);
  expect(Object.keys(endring).sort()).toEqual([...new Set(legacyRes.skrevet)].sort());
  return portRes;
}

describe("korrigering ≡ legacy KorrigerHendelseModal + onLagre", () => {
  it("de fire kallestedene skriver og slår opp observasjonen identisk", () => {
    expect(ON_LAGRE).toHaveLength(4);
    expect(new Set(ON_LAGRE).size).toBe(1);
    expect(OBSERVASJON).toHaveLength(4);
    for (const hd of hendelser) {
      for (const expr of OBSERVASJON) {
        const legacy = new Function("hendelseSomKorrigeres", "transaksjoner", `return (${expr});`)(
          hd,
          transaksjoner,
        );
        expect(observasjonForKorrigering(hd, transaksjoner) ?? null, hd.id).toEqual(legacy ?? null);
      }
    }
  });

  it("startutkast, poster og søk for alle hendelser", () => {
    for (const hd of hendelser) {
      const obs = observasjonForKorrigering(hd, transaksjoner);
      const L = legacyModal(hd, obs);
      const v = L.render();
      const k = startKorrigering(hd, grupper, idSequence("p"));
      expect(utenId(k), hd.id).toEqual(utenId({ linjer: v.utkastFordelinger as never }));
      expect(korrigeringsPoster(grupper)).toEqual(v.allePoster);
      for (const sok of ["", "dag", "KAN", " buf ", "lønn", "konto", "zzz"]) {
        for (const rediger of [null, 0]) {
          (v.setSokTekst as AnyFn)(sok);
          (v.setRedigerLinjeIdx as AnyFn)(rediger);
          const v2 = L.render();
          expect(
            sokKorrigeringsPoster(korrigeringsPoster(grupper), sok, k.linjer, rediger),
            `${hd.id} «${sok}» ${rediger}`,
          ).toEqual(v2.sokTreff);
        }
      }
    }
  });

  it.each<[string, string, Handling[]]>([
    ["uendret lagring (legacy-id → dagens post)", "h-ferdig", []],
    [
      "bytt post på signert linje → inntekt, så beløp og fjern",
      "h-ferdig",
      [
        ["rediger", 0],
        ["velg", "lonnHelen"],
        ["belop", 0, 120],
        ["fjern", 1],
      ],
    ],
    [
      "bytt post to ganger (beløpet gjøres rått bare én gang)",
      "h-ferdig",
      [
        ["rediger", 0],
        ["velg", "lonnHelen"],
        ["rediger", 0],
        ["velg", "bufferkonto"],
      ],
    ],
    [
      "del opp: ny sparelinje, eiere og beløp",
      "h-ferdig",
      [
        ["velg", "bufferkonto"],
        [
          "eiere",
          2,
          [
            { person: "Felles", prosent: 50 },
            { person: "Helen", prosent: 50 },
          ],
        ],
        ["belop", 0, 100],
      ],
    ],
    [
      "én linje + læring: eksisterende regel matcher (regelId + timesUsed)",
      "h-ferdig",
      [
        ["fjern", 1],
        ["rediger", 0],
        ["velg", "dagligvarer"],
        ["laer", true],
      ],
    ],
    [
      "én linje + læring: ny regel",
      "h-ferdig",
      [
        ["fjern", 0],
        ["laer", true],
      ],
    ],
    ["læring ignoreres med to linjer", "h-ferdig", [["laer", true]]],
    ["på vent: bytt årsak", "h-vent", [["uklar", "annet"]]],
    [
      "på vent → plassering med læring",
      "h-vent",
      [
        ["type", null],
        ["velg", "dagligvarer"],
        ["laer", true],
      ],
    ],
    [
      "ferdig → på vent",
      "h-ferdig",
      [
        ["type", "uklar"],
        ["uklar", "privat"],
      ],
    ],
    [
      "manuell inntekt: syntetisk retning «inn» ved postbytte",
      "h-manuell-inn",
      [
        ["rediger", 0],
        ["velg", "kantine"],
      ],
    ],
    [
      "sparing → annen sparepost",
      "h-sparing",
      [
        ["rediger", 0],
        ["velg", "ferie"],
      ],
    ],
    ["slettet post beholdes med historisk navn", "h-slettet-post", []],
    [
      "motsatt signert linje får ny post (beløpet gjøres rått)",
      "h-refusjon",
      [
        ["rediger", 0],
        ["velg", "dagligvarer"],
      ],
    ],
    [
      "negativt bankbeløp: rest regnes av absoluttverdien",
      "h-negativ",
      [
        ["velg", "kantine"],
        ["belop", 0, 40],
      ],
    ],
    ["ny linje får postens eier", "h-sparing", [["velg", "lonnHelen"]]],
    ["tom eierliste blir Felles 100", "h-tom-eier", []],
  ])("%s", (_navn, id, handlinger) => {
    kjor(
      hendelser.find((x) => x.id === id)!,
      handlinger,
    );
  });

  it("låst: læring krever én linje og en observasjon; uten læring røres ikke rules", () => {
    const hd = hendelser[0]!;
    const obs = observasjonForKorrigering(hd, transaksjoner);
    const k = startKorrigering(hd, grupper, idSequence("p"));
    const utenLaer = lagreKorrigering(hd, obs, { ...k, laer: true }, rules, {
      newId: idSequence(),
      naa: NAA,
    });
    expect(utenLaer.rules).toBeUndefined();
    const res = kjor(hd, [
      ["fjern", 0],
      ["laer", true],
    ])!;
    expect(res.rules).toHaveLength(2);
    expect(res.hendelser.at(-1)).toMatchObject({ id: "h-ferdig", regelId: null, status: "ferdig" });
  });
});
