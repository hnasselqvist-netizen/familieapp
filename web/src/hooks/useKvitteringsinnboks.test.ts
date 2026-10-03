import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KvitteringRecord, TransaksjonRecord } from "@app-types/forsoning";
import { useKvitteringsinnboks } from "./useKvitteringsinnboks";

const gate = vi.hoisted(() => ({ aktiv: false }));
vi.mock("./forsoningAktivering", async (orig) => ({
  ...(await orig<typeof import("./forsoningAktivering")>()),
  forsoningSkrivingAktiv: () => gate.aktiv,
}));
const transactForsoningNode = vi.fn().mockResolvedValue([]);
vi.mock("@data/forsoningSkriving.repository", () => ({
  transactForsoningNode: (...args: unknown[]) => transactForsoningNode(...args),
}));

const transaksjoner: TransaksjonRecord[] = [
  {
    id: "t1",
    dato: "2026-09-10",
    tekst: "REMA 1000",
    belop: 250,
    retning: "ut",
    konto: "felles",
    status: "ny",
  },
];
const kvitteringer: KvitteringRecord[] = [
  {
    id: "k1",
    merchant: "Rema",
    purchaseDate: "2026-09-10",
    total: 250,
    matchingStatus: "unmatched",
  },
];
const lever = (data: unknown) => (_f: string, cb: (d: unknown) => void) => {
  cb(data);
  return () => {};
};
vi.mock("@data/forsoning.repository", () => ({
  subscribeTransaksjonRecords: (f: string, cb: (d: unknown) => void) => lever(transaksjoner)(f, cb),
  subscribeHendelser: (f: string, cb: (d: unknown) => void) => lever([])(f, cb),
  subscribeKvitteringer: (f: string, cb: (d: unknown) => void) => lever(kvitteringer)(f, cb),
}));
vi.mock("@data/budsjettfamilie.repository", () => ({
  subscribeBudsjettGrupper: () => () => {},
}));
vi.mock("./useFamilyId", () => ({ useFamilyId: () => "familie1" }));

beforeEach(() => transactForsoningNode.mockClear());

/** Bakgrunnsforslaget (§Issue #34 R3b-3): skrives KUN med porten på. */
describe("useKvitteringsinnboks — bakgrunnsforslaget", () => {
  it("porten av: forslaget beregnes i minnet, ingenting skrives", async () => {
    gate.aktiv = false;
    const { result } = renderHook(() => useKvitteringsinnboks());
    await waitFor(() => expect(result.current.kvitteringer.status).toBe("loaded"));
    expect(result.current.skrivingAktiv).toBe(false);
    expect(result.current.medForslag[0]).toMatchObject({ suggestedTransactionId: "t1" });
    expect(transactForsoningNode).not.toHaveBeenCalled();
  });

  it("porten på: forslaget skrives som én helnode-updater mot fersk receipts", async () => {
    gate.aktiv = true;
    renderHook(() => useKvitteringsinnboks());
    await waitFor(() => expect(transactForsoningNode).toHaveBeenCalledTimes(1));
    const [familie, node, updater] = transactForsoningNode.mock.calls[0]!;
    expect([familie, node]).toEqual(["familie1", "receipts"]);
    const fersk = [...kvitteringer, { id: "k-ny", total: 1, matchingStatus: "matched" as const }];
    const etter = (updater as (p: KvitteringRecord[]) => KvitteringRecord[])(fersk);
    expect(etter[0]).toMatchObject({ matchingStatus: "suggested", suggestedTransactionId: "t1" });
    expect(etter[1]).toBe(fersk[1]); // samtidig skrevet kvittering bevares
  });
});
