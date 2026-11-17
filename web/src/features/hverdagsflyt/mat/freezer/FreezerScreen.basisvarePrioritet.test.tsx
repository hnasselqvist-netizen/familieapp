/**
 * Review 5939383134 (Mat #20, ordre 6948538722): Matlager tilbyr «Fjern»
 * bare for det fjerningen faktisk godtar. Den EKTE `useStaples` brukes;
 * bare datalaget er byttet ut. Abonnementet leverer både `val()` (uten
 * prioritet) og eksportformen (med prioritet), slik RTDB gjør. En `true`
 * med prioritet vises ikke som fjernbar, og ingenting skrives.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";

const fjernBasisvareVersjonert = vi.fn();
vi.mock("@data/staples.repository", () => ({
  subscribeStaples: (
    _f: string,
    cb: (val: Record<string, unknown>, eksport: Record<string, unknown>) => void,
  ) => {
    // `c` har prioritet: `val()` viser `true`, eksporten viser prioriteten.
    cb({ melk: true, c: true }, { melk: true, c: { ".value": true, ".priority": 1 } });
    return () => {};
  },
  markItemAsStaple: vi.fn(),
  fjernBasisvareVersjonert,
}));
vi.mock("@hooks/useFreezer", () => ({
  useFreezer: () => ({
    freezer: loaded([]),
    addBatch: vi.fn(),
    adjustBatchCount: vi.fn(),
    removeItem: vi.fn(),
  }),
}));
vi.mock("@hooks/useItems", () => ({
  useItems: () => ({ items: loaded([]), findOrCreateItem: vi.fn() }),
}));

const { FreezerScreen } = await import("./FreezerScreen");

describe("Matlager — fjernbare basisvarer følger beslutningen ved fjerning", () => {
  it("vanlig `true` er fjernbar; `true` med prioritet tilbys ikke og står urørt", async () => {
    const user = userEvent.setup();
    render(<FreezerScreen />);
    await user.click(screen.getByRole("button", { name: /basisvarer \(har vanligvis hjemme\)/ }));
    expect(screen.getByRole("button", { name: /^1 basisvarer/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fjern melk som basisvare" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fjern c som basisvare" })).toBeNull();
    expect(fjernBasisvareVersjonert).not.toHaveBeenCalled();
  });
});
