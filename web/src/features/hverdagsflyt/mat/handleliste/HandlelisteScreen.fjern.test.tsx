import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InnleggingsSkriveutfall, PostSjekk } from "@data/shopping.repository";
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
const sjekkFjerning = vi.fn<(plan: FjernPlan) => Promise<PostSjekk>>();
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
    sjekkFjerning,
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
  sjekkFjerning.mockReset();
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

  it("rågrunnlaget fra abonnementet følger planen (review 5913786153 pkt. 1)", async () => {
    liste([{ ...MELK, raaGrunnlag: "raa-m" }]);
    render(skjerm());
    fjernRad.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.click(fjernKnapp("Melk"));
    expect(fjernRad.mock.calls[0]![0]).toMatchObject({ id: "m", grunnlag: "raa-m" });
  });

  it("ukjent utfall: «Fjern» på raden er sperret; oppfølgingen er skrivefri; nektet/feilet oppfølging bevarer ukjent status; senere bekreftelse avklarer (review 5913786153 pkt. 2)", async () => {
    liste([MELK]);
    render(skjerm());
    fjernRad.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(fjernKnapp("Melk"));
    const melding = await screen.findByRole("alert", { name: "Fjern" });
    expect(melding).toHaveTextContent(/Vi vet ikke om «Melk» ble fjernet/);
    expect(within(melding).queryByRole("button", { name: "Lukk" })).toBeNull();
    const plan = fjernRad.mock.calls[0]![0];

    // Ordinært klikk under ukjent status sender ingenting.
    expect(fjernKnapp("Melk")).toBeDisabled();
    await userEvent.click(fjernKnapp("Melk"));
    expect(fjernRad).toHaveBeenCalledTimes(1);

    // Nektet oppfølging: fortsatt ukjent, samme plan, raden fortsatt sperret.
    sjekkFjerning.mockResolvedValueOnce({ utfall: "avvist" });
    await userEvent.click(within(melding).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert", { name: "Fjern" })).toHaveTextContent(
        /Fortsatt ikke avklart om «Melk» ble fjernet: ingen tilgang/,
      ),
    );
    expect(sjekkFjerning.mock.calls[0]![0]).toBe(plan);
    expect(fjernKnapp("Melk")).toBeDisabled();

    // Feilet lesing (også kastet feil): fortsatt ukjent.
    sjekkFjerning.mockRejectedValueOnce(new Error("nett"));
    await userEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert", { name: "Fjern" })).toHaveTextContent(
        /Fortsatt ikke avklart om «Melk» ble fjernet: handlelisten kunne ikke leses/,
      ),
    );
    expect(fjernKnapp("Melk")).toBeDisabled();

    // Senere bekreftet borte.
    sjekkFjerning.mockResolvedValueOnce({ utfall: "borte" });
    await userEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert", { name: "Fjern" })).toHaveTextContent(
        "«Melk» er ikke lenger på listen.",
      ),
    );
    expect(sjekkFjerning.mock.calls[2]![0]).toBe(plan);
    expect(fjernRad).toHaveBeenCalledTimes(1); // oppfølgingen sendte aldri en sletting
    await userEvent.click(screen.getByRole("button", { name: "Lukk" }));
    expect(screen.queryByRole("alert", { name: "Fjern" })).toBeNull();
  });

  it("ukjent utfall og raden står (f.eks. gjenopprettet): oppfølgingen sletter ikke; ny sletting er et eget valg med nytt grunnlag", async () => {
    liste([{ ...MELK, raaGrunnlag: "raa-1" }]);
    const r = render(skjerm());
    fjernRad.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(fjernKnapp("Melk"));
    await screen.findByRole("alert", { name: "Fjern" });

    liste([{ ...MELK, raaGrunnlag: "raa-2" }]);
    r.rerender(skjerm());
    sjekkFjerning.mockResolvedValueOnce({ utfall: "finnes" });
    await userEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(screen.getByRole("alert", { name: "Fjern" })).toHaveTextContent(
        "«Melk» står på listen. Ingenting er fjernet nå — trykk «Fjern» på raden hvis den skal bort.",
      ),
    );
    expect(fjernRad).toHaveBeenCalledTimes(1);
    expect(fjernKnapp("Melk")).toBeEnabled();

    fjernRad.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.click(fjernKnapp("Melk"));
    expect(fjernRad.mock.calls[1]![0]).toMatchObject({ id: "m", grunnlag: "raa-2" });
  });
});
