import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { loaded } from "@app-types/status";
import type { ShoppingItem } from "@app-types/shopping";
import { HandlelisteScreen } from "./HandlelisteScreen";

/**
 * Tilbakerulling (ADR 0003, #77 review 6355434985 pkt. 1): med porten for
 * nye sammenslåinger AV skal eksisterende sammenslåinger fortsatt kunne
 * angres fra handlelisten.
 */

vi.mock("@hooks/handlelisteDuplikaterAktivering", () => ({ handlelisteDuplikaterAktiv: vi.fn() }));
vi.mock("@hooks/useShoppingList", () => ({ useShoppingList: vi.fn() }));
vi.mock("@hooks/useItems", () => ({ useItems: vi.fn() }));

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
const SAMMENSLATT = rad("a", {
  amount: "3",
  sammenslaing: { opId: "op-1", tidspunkt: "t", antallKilder: 1 },
});

const angreSammenslaing = vi.fn().mockResolvedValue({ utfall: "anvendt" });
const slaaSammen = vi.fn();

function vis(rader: ShoppingItem[]) {
  vi.mocked(useShoppingList).mockReturnValue({
    shopping: loaded(rader),
    addItem: vi.fn(),
    toggleDone: vi.fn(),
    updateField: vi.fn(),
    removeItem: vi.fn(),
    clearDone: vi.fn(),
    slaaSammen,
    angreSammenslaing,
  } as unknown as ReturnType<typeof useShoppingList>);
  return render(
    <MemoryRouter>
      <HandlelisteScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(useItems).mockReturnValue({
    items: loaded([]),
    findOrCreateItem: vi.fn(),
  } as unknown as ReturnType<typeof useItems>);
});

describe("HandlelisteScreen: aktiveringsport og angring", () => {
  it("porten AV: ingen nye sammenslåinger, men eksisterende kan angres", async () => {
    vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
    vis([SAMMENSLATT, rad("b", { amount: "2" }), rad("c", { amount: "5" })]);
    expect(screen.queryByText(/Mulige duplikater/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Angre sammenslåing av Melk" }));
    expect(angreSammenslaing).toHaveBeenCalledWith("a", "op-1");
    expect(await screen.findByRole("status")).toHaveTextContent("Sammenslåingen er angret.");
  });

  it("porten AV og ingen sammenslåtte rader: ingenting om duplikater vises", () => {
    vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
    vis([rad("b"), rad("c")]);
    expect(screen.queryByText(/Mulige duplikater/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Sammenslåtte rader" })).not.toBeInTheDocument();
  });

  it("porten PÅ: både forslag og angring", () => {
    vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(true);
    vis([SAMMENSLATT, rad("b"), rad("c")]);
    expect(screen.getByText("Mulige duplikater (1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Angre sammenslåing av Melk" })).toBeInTheDocument();
  });
});
