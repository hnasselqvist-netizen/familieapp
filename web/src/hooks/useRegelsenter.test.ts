import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ForsoningSkrivingStengt } from "./forsoningAktivering";
import { RegelsenterSkrivingStengt } from "./regelsenterAktivering";
import { useRegelsenter } from "./useRegelsenter";

const transactRules = vi.fn();
// Rollback-veien: porten AV (som før cutover, eller etter flagget settes tilbake).
vi.mock("./forsoningAktivering", async (orig) => ({
  ...(await orig<typeof import("./forsoningAktivering")>()),
  forsoningSkrivingAktiv: () => false,
}));
vi.mock("@data/rules.repository", () => ({
  subscribeRules: (_f: string, cb: (r: unknown[]) => void) => {
    cb([]);
    return () => {};
  },
  transactRules: (...args: unknown[]) => transactRules(...args),
}));
vi.mock("@data/budsjettfamilie.repository", () => ({
  subscribeBudsjettGrupper: () => () => {},
}));
const transactForsoningNode = vi.fn();
vi.mock("@data/forsoningSkriving.repository", () => ({
  transactForsoningNode: (...args: unknown[]) => transactForsoningNode(...args),
}));
vi.mock("@data/forsoning.repository", () => ({
  subscribeTransaksjonRecords: () => () => {},
  subscribeHendelser: () => () => {},
}));
vi.mock("./useFamilyId", () => ({ useFamilyId: () => "familie1" }));

/**
 * Aktiveringsporten (§Issue #34 R1, Kontrolltårn-beslutning 5952884278):
 * så lenge den er av, når INGEN skriving datalaget — uansett hvilken
 * skjerm eller kode som kaller hooken.
 */
describe("useRegelsenter med aktiveringsporten AV", () => {
  it("rapporterer skriving av og avviser oppdater/slett/slå sammen uten å røre datalaget", async () => {
    const { result } = renderHook(() => useRegelsenter());
    expect(result.current.skrivingAktiv).toBe(false);
    expect(result.current.regler.status).toBe("loaded");
    await act(async () => {
      await expect(result.current.oppdater("r1", { mode: "auto" })).rejects.toBeInstanceOf(
        RegelsenterSkrivingStengt,
      );
      await expect(result.current.slett("r1")).rejects.toBeInstanceOf(RegelsenterSkrivingStengt);
      await expect(result.current.slaSammen("r1", "r2")).rejects.toBeInstanceOf(
        RegelsenterSkrivingStengt,
      );
    });
    expect(transactRules).not.toHaveBeenCalled();
  });

  it("avviser «Bruk resultatet» fra Kjør regler uten å røre transaksjoner/hendelser", async () => {
    const { result } = renderHook(() => useRegelsenter());
    await act(async () => {
      await expect(result.current.brukKjorReglerResultat([])).rejects.toBeInstanceOf(
        ForsoningSkrivingStengt,
      );
    });
    expect(transactForsoningNode).not.toHaveBeenCalled();
  });
});
