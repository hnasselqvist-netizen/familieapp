import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RegelsenterSkrivingStengt } from "./regelsenterAktivering";
import { useRegelsenter } from "./useRegelsenter";

const transactRules = vi.fn();
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
vi.mock("@data/gangen.repository", () => ({
  subscribeTransaksjoner: () => () => {},
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
});
