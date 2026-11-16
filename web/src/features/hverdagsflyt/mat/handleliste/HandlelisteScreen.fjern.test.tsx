import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InnleggingsSkriveutfall } from "@data/shopping.repository";
import type { FjernPlan } from "@domain/shopping/handlelisteFjerning";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import { loaded } from "@app-types/status";
import type { ShoppingItem } from "@app-types/shopping";
import { HandlelisteScreen } from "./HandlelisteScreen";

/**
 * «Fjern» på én rad (Mat #20, ordre 6903150917): grunnlaget er raden slik
 * den vises, dobbeltklikk sender én gang, og hvert utfall er tydelig.
 */

vi.mock("@hooks/handlelisteDuplikaterAktivering", () => ({ handlelisteDuplikaterAktiv: vi.fn() }));
vi.mock("@hooks/useShoppingList", () => ({ useShoppingList: vi.fn() }));
vi.mock("@hooks/useItems", () => ({ useItems: vi.fn() }));
vi.mock("@hooks/useStaples", () => ({ useStaples: vi.fn() }));

const fjernRad = vi.fn<(plan: FjernPlan) => Promise<InnleggingsSkriveutfall>>();
const MELK: ShoppingItem = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};
const BROD: ShoppingItem = {
  id: "b",
  itemId: "v-brod",
  name: "Brød",
  amount: "1",
  cat: "Brød og bakst",
  done: true,
};

function liste(rader: ShoppingItem[]) {
  vi.mocked(useShoppingList).mockReturnValue({
    shopping: loaded(rader),
    toggleDone: vi.fn(),
    updateField: vi.fn(),
    fjernRad,
    clearDone: vi.fn(),
    slaaSammen: vi.fn(),
    angreSammenslaing: vi.fn(),
  } as unknown as ReturnType<typeof useShoppingList>);
}
const skjerm = () => (
  <MemoryRouter>
    <HandlelisteScreen />
  </MemoryRouter>
);
function utsatt() {
  let svar!: (u: InnleggingsSkriveutfall) => void;
  const promise = new Promise<InnleggingsSkriveutfall>((r) => (svar = r));
  return { promise, svar };
}
const fjernKnapp = (navn: string) => screen.getByRole("button", { name: `Fjern ${navn}` });

beforeEach(() => {
  fjernRad.mockReset();
  vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
  vi.mocked(useStaples).mockReturnValue({
    staples: loaded({}),
    markAsStaple: vi.fn(),
    unmarkStaple: vi.fn(),
  });
  vi.mocked(useItems).mockReturnValue({
    items: loaded([]),
    findOrCreateItem: vi.fn(),
  } as unknown as ReturnType<typeof useItems>);
});

describe("HandlelisteScreen: «Fjern» på én rad", () => {
  it("aktiv rad: grunnlaget er raden slik den vises; dobbeltklikk sender én gang; fjernet rad gir ingen melding", async () => {
    liste([MELK, BROD]);
    render(skjerm());
    const d = utsatt();
    fjernRad.mockReturnValueOnce(d.promise);
    await userEvent.dblClick(fjernKnapp("Melk"));
    expect(fjernRad).toHaveBeenCalledTimes(1);
    expect(fjernRad.mock.calls[0]![0]).toEqual({
      id: "m",
      sett: { name: "Melk", amount: "2", cat: "Ost og meieri", itemId: "v-melk", done: false },
    });
    expect(fjernKnapp("Melk")).toBeDisabled();
    d.svar({ utfall: "anvendt" });
    await vi.waitFor(() => expect(fjernKnapp("Melk")).toBeEnabled());
    expect(screen.queryByRole("alert", { name: "Fjern" })).toBeNull();
  });

  it("fullført rad: grunnlaget har fullførtstatusen som vises", async () => {
    liste([MELK, BROD]);
    render(skjerm());
    fjernRad.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.click(screen.getByRole("button", { name: /1 FULLFØRT/ }));
    await userEvent.click(fjernKnapp("Brød"));
    expect(fjernRad.mock.calls[0]![0]).toEqual({
      id: "b",
      sett: { name: "Brød", amount: "1", cat: "Brød og bakst", itemId: "v-brod", done: true },
    });
  });

  it("samtidig endring: raden står, endringen vises, og et nytt valg bygger på den oppdaterte raden", async () => {
    liste([MELK]);
    const r = render(skjerm());
    fjernRad.mockResolvedValueOnce({
      utfall: "konflikt",
      grunn:
        "«Melk» er endret på en annen enhet siden du så den (mengde 2 → 3). Den er ikke fjernet — se den oppdaterte raden og trykk «Fjern» igjen hvis den fortsatt skal bort.",
    });
    await userEvent.click(fjernKnapp("Melk"));
    expect(await screen.findByRole("alert", { name: "Fjern" })).toHaveTextContent(
      /mengde 2 → 3\)\. Den er ikke fjernet/,
    );

    // Abonnementet viser den oppdaterte raden; nytt valg sender det nye grunnlaget.
    liste([{ ...MELK, amount: "3" }]);
    r.rerender(skjerm());
    expect(screen.getByText("3")).toBeInTheDocument();
    fjernRad.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.click(fjernKnapp("Melk"));
    expect(fjernRad.mock.calls[1]![0].sett.amount).toBe("3");
    await vi.waitFor(() => expect(screen.queryByRole("alert", { name: "Fjern" })).toBeNull());
  });

  it("posten er allerede borte: entydig melding", async () => {
    liste([MELK]);
    render(skjerm());
    fjernRad.mockResolvedValueOnce({ utfall: "allerede" });
    await userEvent.click(fjernKnapp("Melk"));
    expect(await screen.findByRole("alert", { name: "Fjern" })).toHaveTextContent(
      "«Melk» var allerede fjernet fra listen. Ingenting mer er endret.",
    );
  });

  it("avvist og ikkeLest: ingenting er fjernet", async () => {
    liste([MELK]);
    render(skjerm());
    fjernRad.mockResolvedValueOnce({ utfall: "avvist" });
    await userEvent.click(fjernKnapp("Melk"));
    expect(await screen.findByRole("alert", { name: "Fjern" })).toHaveTextContent(
      "Ingen tilgang til å fjerne «Melk». Ingenting er fjernet.",
    );
    fjernRad.mockResolvedValueOnce({ utfall: "ikkeLest" });
    await userEvent.click(fjernKnapp("Melk"));
    expect(await screen.findByRole("alert", { name: "Fjern" })).toHaveTextContent(
      "Kunne ikke lese handlelisten. «Melk» er ikke fjernet — prøv igjen.",
    );
  });

  it("ukjent utfall: «Prøv igjen» sender samme grunnlag; bekreftet fjernet og borte er entydige", async () => {
    liste([MELK]);
    render(skjerm());
    fjernRad.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(fjernKnapp("Melk"));
    const melding = await screen.findByRole("alert", { name: "Fjern" });
    expect(melding).toHaveTextContent(/Vi vet ikke om «Melk» ble fjernet/);
    const plan = fjernRad.mock.calls[0]![0];

    fjernRad.mockResolvedValueOnce({ utfall: "allerede" });
    await userEvent.click(within(melding).getByRole("button", { name: "Prøv igjen" }));
    expect(fjernRad.mock.calls[1]![0]).toBe(plan);
    expect(await screen.findByRole("alert", { name: "Fjern" })).toHaveTextContent(
      "«Melk» er ikke lenger på listen.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Lukk" }));
    expect(screen.queryByRole("alert", { name: "Fjern" })).toBeNull();
  });
});
