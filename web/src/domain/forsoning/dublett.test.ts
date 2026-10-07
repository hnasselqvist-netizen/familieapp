import { describe, expect, it } from "vitest";
import type { HendelseRecord, TransaksjonRecord } from "@app-types/forsoning";
import { finnMuligDublett } from "./transaksjonsoversikt";

const t = (id: string, felt: Partial<TransaksjonRecord> = {}): TransaksjonRecord => ({
  id,
  dato: "2026-09-10",
  tekst: "REMA 1000",
  belop: 250,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...felt,
});
const ferdig = (transaksjonId: string): HendelseRecord => ({
  id: `h-${transaksjonId}`,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId,
  receiptId: null,
  fordelinger: [],
  dato: "2026-09-10",
  regelId: null,
  opprettet: "",
  oppdatert: "",
});

describe("finnMuligDublett (#66)", () => {
  it("finner en annen transaksjon med samme dato, beløp og retning, også med annen tekst og konto", () => {
    const vent = t("vent", { tekst: "REMA 1000 GRUNERLOKKA", konto: "dnb" });
    const original = t("original", { tekst: "Rema 1000", konto: "Felleskonto" });
    expect(finnMuligDublett(vent, [vent, original], [], [])).toEqual({
      tvilling: original,
      plassert: false,
    });
  });

  it("foretrekker en plassert tvilling som «originalen»", () => {
    const vent = t("vent");
    const annen = t("annen");
    const plassert = t("plassert");
    expect(finnMuligDublett(vent, [vent, annen, plassert], [ferdig("plassert")], [])).toEqual({
      tvilling: plassert,
      plassert: true,
    });
  });

  it("ulik dato, beløp eller retning er ikke dublett, og en transaksjon er aldri sin egen dublett", () => {
    const vent = t("vent");
    const alle = [
      vent,
      t("dato", { dato: "2026-09-11" }),
      t("belop", { belop: 251 }),
      t("retning", { retning: "inn" }),
    ];
    expect(finnMuligDublett(vent, alle, [], [])).toBeNull();
  });

  it("uten dato finnes ingen dublett", () => {
    const a = t("a", { dato: "" });
    expect(finnMuligDublett(a, [a, t("b", { dato: "" })], [], [])).toBeNull();
  });
});
