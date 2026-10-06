/**
 * Differensiell karakterisering av Historikkeksport (#59, «Mer» over på
 * React): legacy `byggHistorikkEksport`/`byggHistorikkCsv` med hjelpere
 * trekkes ut ordrett fra `index.html` og kjøres side om side med porten.
 */
import { describe, expect, it } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, TransaksjonRecord } from "@app-types/forsoning";
import { loadLegacy } from "../../test/legacy";
import { byggHistorikkCsv, byggHistorikkEksport, historikkSammendrag } from "./historikkeksport";

type AnyFn = (...args: unknown[]) => unknown;
const legacy = loadLegacy<Record<string, AnyFn>>({
  functions: [
    "finnAktivPostForPlassering",
    "formaterEierTekst",
    "formaterEierdata",
    "byggHistorikkEksport",
    "escapeCsvFelt",
    "formaterTallForCsv",
    "byggHistorikkCsv",
  ],
  constArrows: ["budsjettpostMatcherId"],
  constValues: ["HISTORIKK_TYPE_LABEL", "HISTORIKK_KOLONNER", "HISTORIKK_NUMERISKE_KOLONNER"],
});

const post = (id: string, name: string, legacyIds?: string[]) => ({
  id,
  name,
  months: [],
  ...(legacyIds ? { legacyIds } : {}),
});
const budget: BudsjettGruppe[] = [
  { id: "bolig", label: "Bolig", items: [post("husleie", "Husleie", ["gammel-husleie"])] },
  { id: "mat", label: "Mat", items: [post("dagligvarer", "Dagligvarer"), post("delt", "Delt A")] },
];
const income: BudsjettGruppe[] = [
  { id: "lonn", label: "Lønn", items: [post("lonn-h", "Lønn Helen"), post("delt", "Delt B")] },
];
const sparing: BudsjettGruppe[] = [
  {
    id: "buffer",
    label: "Buffer",
    items: [post("buffer", "Bufferkonto"), post("flyttet", "Flyttet")],
  },
];

const t = (id: string, o: Partial<TransaksjonRecord> = {}): TransaksjonRecord => ({
  id,
  dato: "2026-09-01",
  tekst: `Tekst ${id}`,
  belop: 123.45,
  retning: "ut",
  konto: "Felles",
  status: "matchet",
  ...o,
});
const transaksjoner = [
  t("t1"),
  t("t2", { tekst: 'Butikk "AS"; Oslo', normalizedText: "butikk as" }),
  t("t3", { konto: null, belop: 1000 }),
];

const f = (
  plasseringId: string,
  plasseringType: "budget" | "income" | "sparing",
  belop: number,
  o: Record<string, unknown> = {},
) => ({
  plasseringId,
  plasseringType,
  plasseringNavn: `Hist ${plasseringId}`,
  belop,
  eiere: [],
  ...o,
});
const h = (id: string, o: Record<string, unknown>): HendelseRecord =>
  ({
    id,
    status: "ferdig",
    paaVentAarsak: null,
    transaksjonId: null,
    receiptId: null,
    fordelinger: [],
    dato: "2026-09-02",
    regelId: null,
    opprettet: "",
    oppdatert: "",
    ...o,
  }) as HendelseRecord;

const hendelser: HendelseRecord[] = [
  h("h1", { transaksjonId: "t1", fordelinger: [f("husleie", "budget", 12000)] }),
  h("h2", {
    transaksjonId: "t2",
    regelId: "r1",
    kommentar: "Splitt; med «sitat»",
    fordelinger: [
      f("dagligvarer", "budget", 400.5, { eiere: [{ person: "Helen", prosent: 100 }] }),
      f("gammel-husleie", "budget", -50, {
        eiere: [
          { person: "Helen", prosent: 50 },
          { person: "Eivind", prosent: 50 },
        ],
      }),
    ],
  }),
  h("h3", { receiptId: "r9", dato: "2026-08-15", fordelinger: [f("flyttet", "budget", 300)] }),
  h("h4", { kilde: "manuell", dato: "2026-10-01", fordelinger: [f("delt", "sparing", 75)] }),
  h("h5", { transaksjonId: "t3", fordelinger: [f("borte", "income", 999)] }),
  h("h6", { status: "pa_vent", fordelinger: [f("husleie", "budget", 1)] }),
  h("h7", { fordelinger: [] }),
  h("h8", { dato: "", fordelinger: [f("lonn-h", "income", 38000)] }),
];

describe("Historikkeksport ≡ legacy (index.html ~9760–9935)", () => {
  it("rader for alle kilde-, oppslag- og eiervarianter", () => {
    const port = byggHistorikkEksport(hendelser, transaksjoner, [], budget, income, sparing);
    const fasit = legacy.byggHistorikkEksport!(
      hendelser,
      transaksjoner,
      [],
      budget,
      income,
      sparing,
    );
    expect(port).toEqual(fasit);
    expect(new Set(port.map((r) => r["Oppslag status"]))).toEqual(
      new Set(["OK", "Tvetydig plassering", "Uavklart plassering"]),
    );
    expect(new Set(port.map((r) => r["Kilde"]))).toEqual(
      new Set(["bank", "kvittering", "manuell", "ukjent"]),
    );
  });

  it("CSV byte for byte (BOM, semikolon, escaping, desimalkomma, CRLF)", () => {
    const rader = byggHistorikkEksport(hendelser, transaksjoner, [], budget, income, sparing);
    expect(byggHistorikkCsv(rader)).toBe(legacy.byggHistorikkCsv!(rader));
    expect(byggHistorikkCsv([])).toBe(legacy.byggHistorikkCsv!([]));
  });

  it("tomme og manglende inndata", () => {
    expect(byggHistorikkEksport(null, null, null, null, null, null)).toEqual(
      legacy.byggHistorikkEksport!(null, null, null, null, null, null),
    );
  });

  it("sammendraget som skjermen viser", () => {
    const rader = byggHistorikkEksport(hendelser, transaksjoner, [], budget, income, sparing);
    expect(historikkSammendrag(hendelser, rader)).toEqual({
      antallHendelser: 6,
      antallRader: 7,
      forsteDato: "2026-08-15",
      sisteDato: "2026-10-01",
      antallUavklart: 1,
      antallTvetydig: 1,
    });
  });
});
