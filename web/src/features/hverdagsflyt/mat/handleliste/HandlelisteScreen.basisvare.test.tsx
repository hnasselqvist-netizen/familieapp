import { render, screen } from "@testing-library/react";
import type { BasisvareMerkingUtfall } from "@hooks/useStaples";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InnleggingsSkriveutfall, LeseAvslag } from "@data/shopping.repository";
import type { FeltLesing, FeltPlan } from "@domain/shopping/handlelisteFelt";
import type { MengdePlan } from "@domain/shopping/handlelisteMengde";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import { loaded } from "@app-types/status";
import type { ShoppingItem } from "@app-types/shopping";
import { HandlelisteScreen } from "./HandlelisteScreen";

/**
 * «Merk som basisvare» i redigeringspanelet (Mat #20, ordre 6936021912):
 * handlingen er bundet til varen panelet ble åpnet for. Erstattes raden med
 * en annen vare under samme nøkkel, sendes ingenting før den nye varen er
 * åpnet eksplisitt.
 */

vi.mock("@hooks/handlelisteDuplikaterAktivering", () => ({ handlelisteDuplikaterAktiv: vi.fn() }));
vi.mock("@hooks/useShoppingList", () => ({ useShoppingList: vi.fn() }));
vi.mock("@hooks/useItems", () => ({ useItems: vi.fn() }));
vi.mock("@hooks/useStaples", () => ({ useStaples: vi.fn() }));

const settFelt = vi.fn<(plan: FeltPlan) => Promise<InnleggingsSkriveutfall>>();
const sjekkFelt = vi.fn<(plan: FeltPlan) => Promise<FeltLesing | LeseAvslag>>();
const settMengde = vi.fn<(plan: MengdePlan) => Promise<InnleggingsSkriveutfall>>();
const updateField = vi.fn();
const MELK: ShoppingItem = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};

function liste(rader: ShoppingItem[]) {
  vi.mocked(useShoppingList).mockReturnValue({
    shopping: loaded(rader),
    settStatus: vi.fn(),
    sjekkStatus: vi.fn(),
    settMengde,
    sjekkMengde: vi.fn(),
    settFelt,
    sjekkFelt,
    updateField,
    fjernRad: vi.fn(),
    sjekkFjerning: vi.fn(),
    fjernFullforte: vi.fn(),
    sjekkFjernFullforte: vi.fn(),
    slaaSammen: vi.fn(),
    angreSammenslaing: vi.fn(),
  } as unknown as ReturnType<typeof useShoppingList>);
}
const skjerm = () => (
  <MemoryRouter>
    <HandlelisteScreen />
  </MemoryRouter>
);
const markAsStaple = vi.fn<(navn: string) => Promise<BasisvareMerkingUtfall>>();
const merkKnapp = () => screen.getByRole("button", { name: "Merk som basisvare" });
async function aapne(navn = "Melk") {
  await userEvent.click(screen.getByText(navn));
}
const EGG: ShoppingItem = { ...MELK, name: "Egg", itemId: "v-egg" };

beforeEach(() => {
  settMengde.mockReset();
  markAsStaple.mockReset();
  markAsStaple.mockResolvedValue({ utfall: "merket" });
  settFelt.mockReset();
  sjekkFelt.mockReset();
  updateField.mockReset();
  vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
  vi.mocked(useStaples).mockReturnValue({
    staples: loaded({}),
    markAsStaple,
    fjernbareBasisvarer: [],
    fjernBasisvare: vi.fn(),
  });
  vi.mocked(useItems).mockReturnValue({
    items: loaded([]),
    findOrCreateItem: vi.fn(),
  } as unknown as ReturnType<typeof useItems>);
});

describe("HandlelisteScreen: «Merk som basisvare» er bundet til varen som ble åpnet", () => {
  it("knappen har fokus når raden erstattes med en annen umerket vare (samme kategori og nøkkel): tastaturaktivering sender ingenting", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    merkKnapp().focus();
    liste([EGG]);
    r.rerender(skjerm());
    expect(screen.getByRole("alert", { name: "Raden er byttet ut" })).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(markAsStaple).not.toHaveBeenCalled();
  });

  it("vanlig merking med tastatur på samme vare: én handling med faktisk navn", async () => {
    liste([MELK]);
    render(skjerm());
    await aapne();
    merkKnapp().focus();
    await userEvent.keyboard("{Enter}");
    expect(markAsStaple).toHaveBeenCalledTimes(1);
    expect(markAsStaple).toHaveBeenCalledWith("Melk");
  });

  it("etter eksplisitt «Åpne «Egg»» gjelder et nytt valg Egg: én handling med faktisk navn", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    liste([EGG]);
    r.rerender(skjerm());
    expect(merkKnapp()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Åpne «Egg»" }));
    expect(merkKnapp()).toBeEnabled();
    merkKnapp().focus();
    await userEvent.keyboard("{Enter}");
    expect(markAsStaple).toHaveBeenCalledTimes(1);
    expect(markAsStaple).toHaveBeenCalledWith("Egg");
  });

  it("samme vare med nytt navn (varekobling) er ikke byttet: merking gjelder det viste navnet", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    liste([{ ...MELK, name: "Lettmelk" }]);
    r.rerender(skjerm());
    expect(screen.queryByRole("alert", { name: "Raden er byttet ut" })).toBeNull();
    await userEvent.click(merkKnapp());
    expect(markAsStaple).toHaveBeenCalledWith("Lettmelk");
  });
});
