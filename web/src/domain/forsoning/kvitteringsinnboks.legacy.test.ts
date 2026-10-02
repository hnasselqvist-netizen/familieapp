/**
 * Differensiell karakterisering av Kvitteringsinnboksens visning (§Issue
 * #34 R2): legacy-uttrykkene i `KvitteringInnboksScreen` trekkes ut ORDRETT
 * fra `index.html` (kun lesing) og kjøres side om side med portene.
 *
 * Bakgrunnsforslaget: legacy-effektens updater (det den ville SKREVET til
 * `receipts`) sammenlignes med `forslagIMinnet` — porten viser det samme,
 * men skriver ingenting.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { HendelseRecord, KvitteringRecord, TransaksjonRecord } from "@app-types/forsoning";
import { extractInlineExpression, loadLegacy } from "../../test/legacy";
import * as port from "./kvitteringsinnboks";

const NAA = "2026-10-02T12:00:00.000Z";
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NAA));
});
afterAll(() => vi.useRealTimers());

// --- Fixtures ---------------------------------------------------------------

const t = (id: string, felt: Partial<TransaksjonRecord>): TransaksjonRecord => ({
  id,
  dato: "2026-09-10",
  tekst: "REMA 1000 OSLO",
  belop: 250,
  retning: "ut",
  konto: "felles",
  status: "ny",
  ...felt,
});
const transaksjoner: TransaksjonRecord[] = [
  t("t-rema", {}),
  t("t-rema-sen", { dato: "2026-09-13" }), // samme beløp, 3 dager unna
  t("t-kiwi", { tekst: "KIWI 505", belop: 99.5, dato: "2026-09-01" }),
  t("t-inn", { retning: "inn", belop: 250 }), // feil retning
  t("t-annen-kv", { tekst: "COOP", belop: 400, dato: "2026-09-05" }),
  t("t-utenfor", { tekst: "REMA", belop: 250, dato: "2026-09-30" }), // > 5 dager
];

const k = (id: string, felt: Partial<KvitteringRecord>): KvitteringRecord => ({
  id,
  merchant: "Rema 1000",
  purchaseDate: "2026-09-10",
  total: 250,
  createdAt: "2026-09-10T10:00:00Z",
  ...felt,
});
const receipts: KvitteringRecord[] = [
  k("k-rema", { matchingStatus: "unmatched" }),
  k("k-allerede-riktig", {
    merchant: "Kiwi",
    total: 99.5,
    purchaseDate: "2026-09-01",
    matchingStatus: "suggested",
    suggestedTransactionId: "t-kiwi",
    matchConfidence: 100,
  }),
  k("k-matched", {
    matchingStatus: "matched",
    hendelseId: "h-ferdig",
    suggestedTransactionId: null,
  }),
  k("k-ingen", { total: 12345, matchingStatus: "suggested", suggestedTransactionId: "t-gammel" }),
  // Bankimport-opplasting: mangler matchingStatus/splits/allocationMode, har base64-bilde.
  {
    id: "k-bankimport",
    transactionId: "t-rema",
    imageUrl: "data:image/png;base64,AAAA",
    merchant: "",
    purchaseDate: "2026-09-10",
    total: 250,
    createdAt: "2026-09-11T00:00:00Z",
    ocrStatus: "uploaded",
  },
  k("k-forsinket", { purchaseDate: "2026-09-12" }), // beste forslag 1 dag unna → confidence < 100
  k("k-coop", { merchant: "Coop", total: 400, purchaseDate: "2026-09-05" }),
  k("k-forkastet", { forkastet: true }),
  k("k-uten-dato", { purchaseDate: undefined, createdAt: "2026-08-01T00:00:00Z" }),
  k("k-pa-vent", { merchant: "Kiwi", total: 1, purchaseDate: "2026-09-20" }),
  k("k-ingen-datoer", { purchaseDate: undefined, createdAt: undefined }),
];

const h = (id: string, felt: Partial<HendelseRecord>): HendelseRecord => ({
  id,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [],
  dato: "2026-09-10",
  regelId: null,
  opprettet: NAA,
  oppdatert: NAA,
  ...felt,
});
const hendelser: HendelseRecord[] = [
  h("h-ferdig", { receiptId: "k-matched", transaksjonId: "t-x" }),
  h("h-annen", { receiptId: "k-annen", transaksjonId: "t-annen-kv" }), // t-annen-kv er koblet til en annen kvittering
  h("h-vent", { receiptId: "k-pa-vent", status: "pa_vent" }),
];

// --- Legacy ------------------------------------------------------------------

type AnyFn = (...args: unknown[]) => unknown;
const legacy = loadLegacy<Record<string, AnyFn>>({
  functions: [
    "normalizeMerchant",
    "belopMatcherIOre",
    "dagerMellom",
    "finnHendelseForTransaksjon",
    "finnHendelseForKvittering",
    "finnKvitteringTransaksjonKandidater",
    "getDisplayDescription",
  ],
  constValues: ["BELOPSTOLERANSE_KOBLING", "KVITTERING_TIDSVINDU_DAGER"],
});

function evalLegacy(expr: string, scope: Record<string, unknown>): unknown {
  return new Function(...Object.keys(scope), `"use strict"; return (${expr});`)(
    ...Object.values(scope),
  );
}
const helpers = {
  finnHendelseForKvittering: legacy.finnHendelseForKvittering,
  finnKvitteringTransaksjonKandidater: legacy.finnKvitteringTransaksjonKandidater,
};

describe("Kvitteringsinnboks ≡ legacy", () => {
  it("bakgrunnsforslaget: forslagIMinnet = det legacy-effekten ville skrevet", () => {
    const updater = evalLegacy(
      extractInlineExpression(
        "jobbet mot en receipts-versjon fra FOR koblingen.\n    setReceipts(",
      ),
      { ...helpers, transaksjoner, hendelser },
    ) as (prev: KvitteringRecord[]) => KvitteringRecord[];
    const legacyResultat = updater(receipts);
    const portResultat = port.forslagIMinnet(receipts, transaksjoner, hendelser, NAA);
    expect(portResultat).toEqual(legacyResultat);
    // Uendrede kvitteringer er samme objekt (legacy hopper over skrivingen for dem).
    expect(portResultat[1]).toBe(receipts[1]);
    expect(portResultat.find((r) => r.id === "k-rema")).toMatchObject({
      matchingStatus: "suggested",
      suggestedTransactionId: "t-rema",
    });
  });

  it("bakgrunnsforslaget gjør ingenting uten transaksjoner (effektens vakt)", () => {
    expect(port.forslagIMinnet(receipts, [], hendelser, NAA)).toEqual(receipts);
  });

  it("aktive kvitteringer (filter + sortering)", () => {
    const pred = evalLegacy(extractInlineExpression("const aktiveKvitteringer = alle.filter("), {
      ...helpers,
      hendelser,
    }) as (r: KvitteringRecord) => boolean;
    const cmp = evalLegacy(extractInlineExpression("{aktiveKvitteringer\n        .sort("), {}) as (
      a: KvitteringRecord,
      b: KvitteringRecord,
    ) => number;
    expect(port.aktiveKvitteringer(receipts, hendelser)).toEqual(receipts.filter(pred).sort(cmp));
  });

  it("statustekst og foreslått transaksjon per kvittering", () => {
    const statusExpr = extractInlineExpression("const statusTekst = ");
    const foreslattExpr = extractInlineExpression("const foreslattTrans = ");
    for (const r of port.forslagIMinnet(receipts, transaksjoner, hendelser, NAA)) {
      const hendelseForRad = legacy.finnHendelseForKvittering!(
        hendelser,
        r.id,
      ) as HendelseRecord | null;
      const erFerdigBehandlet = !!(hendelseForRad && hendelseForRad.status === "ferdig");
      expect(port.kvitteringStatus(r, hendelser).tekst, r.id).toBe(
        evalLegacy(statusExpr, { r, erFerdigBehandlet }),
      );
      expect(port.foreslattTransaksjon(r, transaksjoner), r.id).toEqual(
        evalLegacy(foreslattExpr, { r, transaksjoner }),
      );
    }
  });

  it("visningsbeskrivelse for splitt-linjer", () => {
    for (const linje of [
      null,
      {},
      { description: "Brød" },
      { ocrDescription: "BROD GROVT" },
      { description: "", ocrDescription: "OCR" },
      { description: "Egen", ocrDescription: "OCR" },
    ]) {
      expect(port.getDisplayDescription(linje)).toBe(legacy.getDisplayDescription!(linje));
    }
  });
});
