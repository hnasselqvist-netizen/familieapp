import { describe, expect, it } from "vitest";
import type { HendelseRecord, KvitteringRecord, TransaksjonRecord } from "@app-types/forsoning";
import { aktiveKvitteringer } from "./kvitteringsinnboks";
import { beregnOppmerksomhet } from "./oppmerksomhet";
import { arbeidsko } from "./transaksjonsoversikt";

const t = (id: string, felt: Partial<TransaksjonRecord> = {}): TransaksjonRecord => ({
  id,
  dato: "2026-10-01",
  tekst: id,
  belop: 100,
  retning: "ut",
  konto: "felleskonto",
  status: "ny",
  ...felt,
});

const h = (id: string, felt: Partial<HendelseRecord>): HendelseRecord => ({
  id,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [],
  dato: "2026-10-01",
  regelId: null,
  opprettet: "2026-10-01T00:00:00Z",
  oppdatert: "2026-10-01T00:00:00Z",
  ...felt,
});

const k = (id: string, felt: Partial<KvitteringRecord> = {}): KvitteringRecord =>
  ({ id, matchingStatus: "unmatched", ...felt }) as KvitteringRecord;

const transaksjoner = [
  t("ny-1"),
  t("ny-2", { status: null }), // regelplassert uten hendelse → fortsatt å vurdere
  t("flerbruk", { status: "krever_vurdering" }),
  t("forslag", { status: "foresoatt_match" }),
  t("ferdig", { status: null, hendelseId: "h-ferdig" }),
  t("vent", { status: "ny", hendelseId: "h-vent" }),
  t("ignorert", { status: "ignorert" }),
  t("intern", { behandlingstype: "intern_overforing" }),
];
const hendelser = [
  h("h-ferdig", { transaksjonId: "ferdig" }),
  h("h-vent", { transaksjonId: "vent", status: "pa_vent" }),
  h("h-kvittering", { receiptId: "k-ferdig" }),
];
const kvitteringer = [
  k("k-ny"),
  k("k-forslag", { matchingStatus: "suggested", suggestedTransactionId: "ny-1" }),
  k("k-ferdig", { matchingStatus: "matched" }),
  k("k-forkastet", { forkastet: true }),
];

describe("beregnOppmerksomhet", () => {
  const o = beregnOppmerksomhet(transaksjoner, hendelser, [], kvitteringer);

  it("teller hver ting ett sted, med samme kilde som køene", () => {
    expect(o).toEqual({
      transaksjonerAVurdere: 3, // ny-1, ny-2, flerbruk — ikke forslaget
      forslagTilMatch: 1,
      kvitteringer: 2, // k-ny, k-forslag (ikke ferdig, ikke forkastet)
      kvitteringerMedForslag: 1,
      paaVent: 1,
      antallHandlinger: 6, // på vent er en tatt beslutning, ikke en ny handling
    });
    const ko = arbeidsko(transaksjoner, hendelser, []);
    expect(o.transaksjonerAVurdere).toBe(ko.vurdering.length);
    expect(o.forslagTilMatch).toBe(ko.forslag.length);
    expect(o.kvitteringer).toBe(aktiveKvitteringer(kvitteringer, hendelser).length);
  });

  it("«krever_vurdering»-status er bare én del av «å vurdere» (forklarer 21 mot 7)", () => {
    const medStatus = transaksjoner.filter((x) => x.status === "krever_vurdering").length;
    expect(medStatus).toBe(1);
    expect(o.transaksjonerAVurdere).toBeGreaterThan(medStatus);
  });

  it("ingenting å gjøre gir null handlinger", () => {
    expect(
      beregnOppmerksomhet([t("ferdig", { hendelseId: "h-ferdig" })], hendelser, [], []),
    ).toMatchObject({ antallHandlinger: 0, paaVent: 0 });
  });
});
