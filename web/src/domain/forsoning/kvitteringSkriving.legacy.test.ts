/**
 * Differensiell karakterisering av Kvitteringsinnboksens skrivende
 * handlinger (§Issue #34 R3b-3): legacy-closurene i
 * `KvitteringInnboksScreen` (`kobleKvitteringTilTransaksjon`,
 * `registrerKvittering`/`lagKvittering`, `oppdaterKvittering` og
 * bakgrunnseffektens updater) trekkes ut ORDRETT fra `index.html` (kun
 * lesing), kjøres med fangede settere, og sammenlignes med portene i
 * `kvitteringSkriving.ts` på samme data, id-sekvens og klokke.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HendelseRecord, KvitteringRecord, TransaksjonRecord } from "@app-types/forsoning";
import {
  extractConstArrow,
  extractInlineExpression,
  idSequence,
  loadLegacy,
} from "../../test/legacy";
import type { Beslutningsendring } from "./beslutning";
import {
  KONFLIKT_TEKST,
  type KvitteringSnapshot,
  type NyKvittering,
  type TvungetHandling,
  bakgrunnsforslag,
  kobleKvittering,
  nyKvittering,
  oppdaterKvittering,
} from "./kvitteringSkriving";

const NAA = "2026-10-03T09:00:00.000Z";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NAA));
});
afterAll(() => vi.useRealTimers());

// ── Fixtures ────────────────────────────────────────────────────────
const tx = (id: string, o: Partial<TransaksjonRecord> = {}): TransaksjonRecord => ({
  id,
  dato: "2026-09-10",
  tekst: "REMA 1000 OSLO",
  belop: 250,
  retning: "ut",
  konto: "felles",
  status: "ny",
  ...o,
});
const transaksjoner: TransaksjonRecord[] = [
  tx("t-ny"),
  tx("t-ferdig-lik", { hendelseId: "h-ferdig-lik" }),
  tx("t-ferdig-avvik", { hendelseId: "h-ferdig-avvik" }),
  tx("t-vent", { hendelseId: "h-vent" }),
  tx("t-ignorert", { status: "ignorert" }),
  tx("t-annen", { hendelseId: "h-annen" }),
  tx("t-gammel", { hendelseId: "h-gammel" }),
  tx("t-stor", { belop: 999, dato: "2026-09-11" }),
  tx("t-inn", { belop: 250, retning: "inn", tekst: "Lønn" }),
];

const hendelse = (id: string, o: Partial<HendelseRecord>): HendelseRecord => ({
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
const fordeling = (belop: number, id = "dagligvarer") => ({
  plasseringId: id,
  plasseringType: "budget" as const,
  plasseringNavn: "Dagligvarer",
  belop,
  eiere: [{ person: "Felles", prosent: 100 }],
});
const hendelser: HendelseRecord[] = [
  hendelse("h-ferdig-lik", {
    transaksjonId: "t-ferdig-lik",
    fordelinger: [fordeling(250)],
    regelId: "r-rema",
  }),
  hendelse("h-ferdig-avvik", { transaksjonId: "t-ferdig-avvik", fordelinger: [fordeling(100)] }),
  hendelse("h-vent", {
    transaksjonId: "t-vent",
    status: "pa_vent",
    paaVentAarsak: "venter_paa_kvittering",
    fordelinger: [fordeling(250)],
  }),
  hendelse("h-annen", { transaksjonId: "t-annen", receiptId: "k-annen" }),
  hendelse("h-gammel", {
    transaksjonId: "t-gammel",
    receiptId: "k-koblet",
    fordelinger: [fordeling(250)],
  }),
  // Kvitteringen peker hit, men hendelsen peker ikke tilbake.
  hendelse("h-asym", { transaksjonId: null, receiptId: "k-noe-annet" }),
];

const split = (
  amount: number,
  o: Partial<NonNullable<KvitteringRecord["splits"]>[number]> = {},
) => ({
  targetType: "budget" as const,
  targetId: "dagligvarer",
  targetName: "Dagligvarer",
  amount,
  ...o,
});
const kv = (id: string, o: Partial<KvitteringRecord> = {}): KvitteringRecord => ({
  id,
  merchant: "Rema 1000",
  purchaseDate: "2026-09-10",
  total: 250,
  allocationMode: "single",
  splits: [split(250)],
  matchingStatus: "unmatched",
  hendelseId: null,
  ...o,
});
const receipts: KvitteringRecord[] = [
  kv("k-klar"),
  kv("k-split", {
    allocationMode: "split",
    splits: [
      split(150, { eiere: [{ person: "Helen", prosent: 100 }] }),
      split(100, { targetType: "income", targetId: "lonnHelen", targetName: "Lønn Helen" }),
    ],
  }),
  kv("k-ufordelt", { allocationMode: null, splits: [] }),
  kv("k-splittavvik", { splits: [split(200)] }),
  kv("k-koblet", { hendelseId: "h-gammel", matchingStatus: "matched" }),
  kv("k-annen", { hendelseId: "h-annen", matchingStatus: "matched" }),
  kv("k-asym", { hendelseId: "h-asym", matchingStatus: "matched" }),
  kv("k-mangler-hendelse", { hendelseId: "h-finnes-ikke", matchingStatus: "matched" }),
  kv("k-foreslatt", { matchingStatus: "suggested", suggestedTransactionId: "t-ny" }),
];
const snapshot: KvitteringSnapshot = { transaksjoner, hendelser, receipts };

// ── Legacy ──────────────────────────────────────────────────────────
type AnyFn = (...args: unknown[]) => unknown;
let legacyUid: () => string = idSequence("id");
const motorer = loadLegacy<Record<string, AnyFn>>({
  functions: [
    "normalizeMerchant",
    "belopMatcherIOre",
    "dagerMellom",
    "finnHendelseForTransaksjon",
    "finnHendelseForKvittering",
    "finnKvitteringTransaksjonKandidater",
    "calculateSplitTotal",
    "erKvitteringKlarForLukking",
    "vurderKvitteringKobling",
    "fordelingerFraKvitteringSplits",
    "byggSynkronisertKvitteringOgHendelse",
  ],
  constValues: ["BELOPSTOLERANSE_KOBLING", "KVITTERING_TIDSVINDU_DAGER"],
  globals: { uid: () => legacyUid() },
});

type State = KvitteringSnapshot;
type Node = keyof State;

/** Kjører en legacy-closure med settere som anvender updateren umiddelbart (som `setX`). */
function legacy(start: State, kilde: string, retur: string, ekstra: Record<string, unknown> = {}) {
  legacyUid = idSequence("id");
  const state: State = { ...start };
  let konflikter: Record<string, unknown> = {};
  let syncFeil: unknown = "urørt";
  const skrevet = new Set<Node>();
  const setter = (node: Node) => (v: unknown) => {
    skrevet.add(node);
    const prev = state[node] as unknown[];
    (state as unknown as Record<string, unknown>)[node] =
      typeof v === "function" ? (v as (p: unknown[]) => unknown[])(prev) : v;
    return Promise.resolve();
  };
  const env: Record<string, unknown> = {
    ...motorer,
    transaksjoner: start.transaksjoner,
    hendelser: start.hendelser,
    receipts: start.receipts,
    setTransaksjoner: setter("transaksjoner"),
    setHendelser: setter("hendelser"),
    setReceipts: setter("receipts"),
    setKonflikter: (u: (p: Record<string, unknown>) => Record<string, unknown>) => {
      konflikter = u(konflikter);
    },
    setKvitteringSyncFeil: (v: unknown) => {
      syncFeil = v;
    },
    uid: () => legacyUid(),
    ...ekstra,
  };
  const fn = new Function(...Object.keys(env), `"use strict";\n${kilde}\nreturn ${retur};`)(
    ...Object.values(env),
  ) as AnyFn;
  return {
    fn,
    state,
    skrevet,
    konflikter: () => konflikter,
    syncFeil: () => syncFeil,
  };
}

/** Port: anvender endringen i skriverens rekkefølge (hendelser → transaksjoner → receipts). */
function anvend(start: State, endring: Beslutningsendring | null) {
  if (!endring) return { state: start, skrevet: new Set<Node>() };
  const skrevet = new Set<Node>();
  const state: State = { ...start };
  if (endring.hendelser) {
    skrevet.add("hendelser");
    state.hendelser = endring.hendelser(start.hendelser);
  }
  if (endring.transaksjoner) {
    skrevet.add("transaksjoner");
    state.transaksjoner = endring.transaksjoner(start.transaksjoner);
  }
  if (endring.receipts) {
    skrevet.add("receipts");
    state.receipts = endring.receipts(start.receipts);
  }
  return { state, skrevet };
}
const deps = () => ({ newId: idSequence("id"), naa: NAA });

const KOBLE = extractConstArrow("kobleKvitteringTilTransaksjon");

describe("kobleKvittering ≡ legacy kobleKvitteringTilTransaksjon", () => {
  const handlinger: TvungetHandling[] = [null, "bruk_kvittering", "behold_eksisterende"];

  it("alle kvitteringer × alle transaksjoner × alle valg: samme skriving og konflikt", async () => {
    const koder = new Set<string>();
    for (const r of receipts) {
      for (const t of [...transaksjoner, tx("t-finnes-ikke")]) {
        for (const valg of handlinger) {
          const navn = `${r.id} → ${t.id} (${valg})`;
          const L = legacy(snapshot, KOBLE, "kobleKvitteringTilTransaksjon");
          await L.fn(r, t.id, valg);
          const p = kobleKvittering(snapshot, r, t.id, valg, deps());
          const portet = anvend(snapshot, p.endring);

          expect(portet.state, navn).toEqual(L.state);
          expect([...portet.skrevet].sort(), navn).toEqual([...L.skrevet].sort());
          expect(p.konflikt ?? undefined, navn).toEqual(L.konflikter()[r.id]);
          if (p.konflikt?.kode)
            koder.add(`${p.konflikt.kode}${p.konflikt.kunLenke ? "+lenke" : ""}`);
          if (p.endring) koder.add(p.konflikt ? "skrevet+lenke" : "skrevet+lukket");
        }
      }
    }
    // Dekning: alle grenene i legacy-orkestreringen er truffet.
    expect([...koder].sort()).toEqual(
      [
        "belop_avvik+lenke",
        "ikke_fordelt+lenke",
        "skrevet+lenke",
        "skrevet+lukket",
        "splitt_avvik+lenke",
        "transaksjon_har_avvikende_actual",
        "transaksjon_ignorert",
        "transaksjon_koblet_annen_kvittering",
      ].sort(),
    );
  });

  it("låst: ny kobling som kan lukkes lager en ferdig hendelse med kvitteringens splitter", () => {
    const p = kobleKvittering(snapshot, receipts[1]!, "t-ny", null, deps());
    const { state } = anvend(snapshot, p.endring);
    expect(p.konflikt).toBeNull();
    expect(state.hendelser.at(-1)).toMatchObject({
      id: "id-1",
      status: "ferdig",
      transaksjonId: "t-ny",
      receiptId: "k-split",
      fordelinger: [
        { plasseringId: "dagligvarer", plasseringType: "budget", belop: 150 },
        { plasseringId: "lonnHelen", plasseringType: "income", belop: 100 },
      ],
    });
    expect(state.transaksjoner.find((t) => t.id === "t-ny")!.hendelseId).toBe("id-1");
    expect(state.receipts.find((r) => r.id === "k-split")).toMatchObject({
      hendelseId: "id-1",
      matchingStatus: "matched",
      matchingUpdatedAt: NAA,
    });
  });

  it("låst: omkobling fjerner den gamle hendelsen og nullstiller den gamle transaksjonen", () => {
    const koblet = receipts.find((r) => r.id === "k-koblet")!;
    const p = kobleKvittering(snapshot, koblet, "t-ny", null, deps());
    const { state } = anvend(snapshot, p.endring);
    expect(state.hendelser.find((h) => h.id === "h-gammel")).toBeUndefined();
    expect(state.transaksjoner.find((t) => t.id === "t-gammel")!.hendelseId).toBeNull();
    expect(state.receipts.find((r) => r.id === "k-koblet")!.hendelseId).toBe("id-1");
  });

  it("låst: avvikende eksisterende fordeling krever et valg — uten valg skrives ingenting", () => {
    const p = kobleKvittering(snapshot, receipts[0]!, "t-ferdig-avvik", null, deps());
    expect(p.endring).toBeNull();
    expect(p.konflikt).toMatchObject({ kode: "transaksjon_har_avvikende_actual", kanKobles: true });
    const behold = kobleKvittering(
      snapshot,
      receipts[0]!,
      "t-ferdig-avvik",
      "behold_eksisterende",
      deps(),
    );
    const h = anvend(snapshot, behold.endring).state.hendelser.at(-1)!;
    expect(h).toMatchObject({ id: "h-ferdig-avvik", status: "ferdig", receiptId: "k-klar" });
    expect(h.fordelinger.map((f) => f.belop)).toEqual([100]);
  });

  it("KONFLIKT_TEKST ≡ legacy", () => {
    const expr = extractInlineExpression("const KONFLIKT_TEKST = ");
    expect(KONFLIKT_TEKST).toEqual(new Function(`return (${expr});`)());
  });
});

describe("nyKvittering ≡ legacy registrerKvittering (uten bilde)", () => {
  const REGISTRER = extractConstArrow("registrerKvittering");
  const NY_TOTAL_TALL = extractInlineExpression("const nyTotalTall = ");
  const skjema: NyKvittering[] = [
    {
      dato: "2026-09-12",
      leverandor: "  Kiwi Majorstuen ",
      total: "349.90",
      allocationMode: "single",
      splits: [split(349.9)],
    },
    { dato: "2026-09-13", leverandor: "", total: "", allocationMode: null, splits: [] },
    { dato: "2026-09-14", leverandor: "Coop", total: "12,50", allocationMode: null, splits: [] },
    {
      dato: "2026-09-15",
      leverandor: "Obs",
      total: "abc",
      allocationMode: "split",
      splits: [split(10), split(20, { targetId: "kantine", targetName: "Kantine" })],
    },
  ];

  it.each(skjema.map((s) => [s.leverandor || "(tom)", s] as const))("%s", (_, s) => {
    const noop = () => {};
    const nyTotal = s.total;
    const nyTotalTall = new Function("nyTotal", `return (${NY_TOTAL_TALL});`)(nyTotal);
    const L = legacy(snapshot, REGISTRER, "registrerKvittering", {
      nyFil: null,
      nyDato: s.dato,
      nyLeverandor: s.leverandor,
      nyTotalTall,
      nyAllocationMode: s.allocationMode,
      nySplits: s.splits,
      setLasterOpp: noop,
      setFeilmelding: noop,
      setVisNy: noop,
      setNyDato: noop,
      setNyLeverandor: noop,
      setNyTotal: noop,
      setNyFil: noop,
      setNyAllocationMode: noop,
      setNySplits: noop,
      setNySokTekst: noop,
      lastGapiDriveClient: () => {
        throw new Error("Drive skal ikke brukes uten fil");
      },
    });
    L.fn();
    const portet = anvend(snapshot, nyKvittering(s, deps()));
    expect(portet.state).toEqual(L.state);
    expect([...portet.skrevet]).toEqual([...L.skrevet]);
  });
});

describe("oppdaterKvittering ≡ legacy (redigering, forkasting, synk av koblet hendelse)", () => {
  const OPPDATER = extractConstArrow("oppdaterKvittering");
  const tilfeller: [string, Partial<KvitteringRecord>][] = [
    ["k-klar", { merchant: "Rema Storo", total: 260, splits: [split(260)] }],
    ["k-klar", { forkastet: true }],
    ["k-koblet", { splits: [split(200), split(50, { targetId: "kantine" })] }],
    ["k-koblet", { forkastet: true }],
    ["k-koblet", { allocationMode: null, splits: [] }],
    ["k-asym", { total: 1 }],
    ["k-mangler-hendelse", { total: 1 }],
    ["k-finnes-ikke", { total: 1 }],
  ];

  it.each(tilfeller)("%s %j", (id, felter) => {
    const L = legacy(snapshot, OPPDATER, "oppdaterKvittering");
    L.fn(id, felter);
    const p = oppdaterKvittering(snapshot, id, felter, NAA);
    const portet = anvend(snapshot, p?.endring ?? null);
    expect(portet.state).toEqual(L.state);
    expect([...portet.skrevet].sort()).toEqual([...L.skrevet].sort());
    // Feilen som vises inline: legacy setter {id, melding} ved feil, null ved suksess.
    const legacyFeil = L.syncFeil();
    if (!p) expect(legacyFeil).toBe("urørt");
    else if (p.feil) expect(legacyFeil).toEqual({ id, melding: p.feil });
    else expect(legacyFeil).toBeNull();
  });
});

describe("bakgrunnsforslag ≡ legacy-effektens updater", () => {
  const UPDATER = extractInlineExpression(
    "jobbet mot en receipts-versjon fra FOR koblingen.\n    setReceipts(",
  );
  const kjorLegacy = (rs: KvitteringRecord[], ts: TransaksjonRecord[], hs: HendelseRecord[]) => {
    if (!ts || ts.length === 0) return rs; // effektens vakter
    if (!rs || rs.length === 0) return rs;
    const updater = new Function(
      "finnKvitteringTransaksjonKandidater",
      "transaksjoner",
      "hendelser",
      `"use strict"; return (${UPDATER});`,
    )(motorer.finnKvitteringTransaksjonKandidater, ts, hs) as (
      p: KvitteringRecord[],
    ) => KvitteringRecord[];
    return updater(rs);
  };

  it("skriver når et forslag endres, og ingenting når legacy returnerer prev", () => {
    const tilfeller: [KvitteringRecord[], TransaksjonRecord[]][] = [
      [receipts, transaksjoner],
      [receipts, []],
      [[], transaksjoner],
    ];
    // Etter én runde er alt stabilt → ingen ny skriving (legacy: samme referanse).
    const stabil = kjorLegacy(receipts, transaksjoner, hendelser);
    tilfeller.push([stabil, transaksjoner]);
    for (const [rs, ts] of tilfeller) {
      const legacyRes = kjorLegacy(rs, ts, hendelser);
      const p = bakgrunnsforslag(rs, ts, hendelser, NAA);
      if (legacyRes === rs) expect(p).toBeNull();
      else expect(p!.receipts!(rs)).toEqual(legacyRes);
    }
    expect(bakgrunnsforslag(stabil, transaksjoner, hendelser, NAA)).toBeNull();
    expect(bakgrunnsforslag(receipts, transaksjoner, hendelser, NAA)).not.toBeNull();
  });

  it("updateren regner mot FERSK verdi (en samtidig kobling overskrives ikke)", () => {
    const p = bakgrunnsforslag(receipts, transaksjoner, hendelser, NAA)!;
    const fersk = receipts.map((r) =>
      r.id === "k-klar" ? { ...r, matchingStatus: "matched" as const, hendelseId: "h-x" } : r,
    );
    expect(p.receipts!(fersk).find((r) => r.id === "k-klar")).toEqual(fersk[0]);
  });
});
