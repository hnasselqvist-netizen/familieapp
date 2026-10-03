import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ForsoningSkrivingStengt } from "./forsoningAktivering";
import { useTransaksjonsoversikt } from "./useTransaksjonsoversikt";

const transactForsoningNode = vi.fn();
vi.mock("@data/forsoningSkriving.repository", () => ({
  transactForsoningNode: (...args: unknown[]) => transactForsoningNode(...args),
}));
vi.mock("@data/forsoning.repository", () => ({
  subscribeTransaksjonRecords: (_f: string, cb: (t: unknown[]) => void) => {
    cb([]);
    return () => {};
  },
  subscribeHendelser: () => () => {},
  subscribeKvitteringer: () => () => {},
}));
vi.mock("@data/rules.repository", () => ({ subscribeRules: () => () => {} }));
vi.mock("@data/budsjettfamilie.repository", () => ({
  subscribeBudsjettGrupper: () => () => {},
}));
vi.mock("./useFamilyId", () => ({ useFamilyId: () => "familie1" }));

/** Forsoningsporten er AV: ingen beslutning når datalaget (§Issue #34 R3b-1). */
describe("useTransaksjonsoversikt med forsoningsporten AV", () => {
  it("rapporterer skriving av og avviser `utfor` uten å røre noen node", async () => {
    const { result } = renderHook(() => useTransaksjonsoversikt());
    expect(result.current.skrivingAktiv).toBe(false);
    expect(result.current.transaksjoner.status).toBe("loaded");
    await act(async () => {
      await expect(
        result.current.utfor({
          hendelser: (p) => p,
          transaksjoner: (p) => p,
          rules: (p) => p,
        }),
      ).rejects.toBeInstanceOf(ForsoningSkrivingStengt);
    });
    expect(transactForsoningNode).not.toHaveBeenCalled();
  });
});
