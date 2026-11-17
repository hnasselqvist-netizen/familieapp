import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BASISVARE_UGYLDIG_TEKST } from "@domain/shopping/basisvare";
import type { MergedShoppingItem } from "@app-types/shopping";
import { loaded } from "@app-types/status";
import { ShoppingGeneratorModal } from "./ShoppingGeneratorModal";

/**
 * «Ja, basisvare» i React-handlelistegeneratoren (Mat #20, ordre
 * 6944091801). Den ekte `useStaples` brukes, så hookens nøkkelvalidering
 * kjøres; bare adapteren (`markItemAsStaple`) er byttet ut. Syntetiske navn.
 *
 * - Ugyldig navn: eksisterende brukertekst, ingenting skrives.
 * - Avvist lagring: merkingen vises som ikke bekreftet.
 * - Beskjeden kan lukkes, og varen står utelatt.
 * - Mens skrivingen pågår er bekreftelsen sperret, og målet står synlig.
 */

const markItemAsStaple = vi.fn<(familyId: string, name: string) => Promise<void>>();
const varer = vi.hoisted(() => ({ naa: [] as MergedShoppingItem[] }));

vi.mock("@data/staples.repository", () => ({
  subscribeStaples: (_f: string, cb: (s: Record<string, boolean>) => void) => {
    cb({});
    return () => {};
  },
  markItemAsStaple: (f: string, n: string) => markItemAsStaple(f, n),
  removeStaple: vi.fn(),
}));
vi.mock("@hooks/useMeals", () => ({
  useMeals: () => ({ meals: loaded({ Mon: "Grøt" }) }),
}));
vi.mock("@hooks/useRecipes", () => ({ useRecipes: () => ({ recipes: loaded([]) }) }));
vi.mock("@hooks/useMealLibrary", () => ({ useMealLibrary: () => ({ mealLibrary: loaded([]) }) }));
vi.mock("@hooks/useItemHistory", () => ({ useItemHistory: () => ({ itemHistory: loaded({}) }) }));
vi.mock("@hooks/useFreezer", () => ({ useFreezer: () => ({ freezer: loaded([]) }) }));
vi.mock("@hooks/useShoppingList", () => ({
  useShoppingList: () => ({ shopping: loaded([]), leggTilFraGenerator: vi.fn() }),
}));
vi.mock("@generators/shopping/shopping", async (orig) => ({
  ...(await orig<typeof import("@generators/shopping/shopping")>()),
  buildShoppingItems: () => [],
  mergeShoppingItems: () => varer.naa,
}));

const vare = (name: string): MergedShoppingItem => ({
  key: name.toLowerCase(),
  itemId: null,
  name,
  amount: "1",
  unit: "",
  cat: "Ost og meieri",
  fromRecipes: ["Grøt"],
  isStaple: false,
});

/** Åpner gjennomgangen, utelater `navn` og svarer «Ja, basisvare». */
async function utelatOgMerk(navn: string) {
  varer.naa = [vare(navn), vare("Egg")];
  const user = userEvent.setup();
  render(<ShoppingGeneratorModal weekKey="2026-W47" onClose={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /Hent ingredienser/ }));
  await user.click(screen.getByText(navn, { exact: true }));
  expect(screen.getByText(`Har du vanligvis «${navn}» hjemme?`)).toBeInTheDocument();
  return user;
}
const ja = () => screen.getByRole("button", { name: "Ja, basisvare" });
const sporsmaal = (navn: string) => screen.queryByText(`Har du vanligvis «${navn}» hjemme?`);

beforeEach(() => {
  markItemAsStaple.mockReset();
});

describe("ShoppingGeneratorModal — «Ja, basisvare»", () => {
  it("ugyldig navn: eksisterende brukertekst, ingenting skrives, beskjeden lukkes og varen står utelatt", async () => {
    const user = await utelatOgMerk("Melk/Lett");
    await user.click(ja());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(BASISVARE_UGYLDIG_TEKST.ugyldige_tegn);
    expect(alert).toHaveTextContent("Ingenting er lagret.");
    expect(alert).toHaveTextContent("fortsatt utelatt");
    expect(markItemAsStaple).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sporsmaal("Melk/Lett")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeInTheDocument();
    expect(markItemAsStaple).not.toHaveBeenCalled();
  });

  it("avvist lagring: merkingen vises som ikke bekreftet, beskjeden lukkes og varen står utelatt", async () => {
    markItemAsStaple.mockRejectedValueOnce(new Error("PERMISSION_DENIED"));
    const user = await utelatOgMerk("Rømme");
    await user.click(ja());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("«Rømme» er ikke bekreftet lagret som basisvare.");
    expect(alert).toHaveTextContent("fortsatt utelatt");
    expect(markItemAsStaple).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(sporsmaal("Rømme")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeInTheDocument();
    expect(markItemAsStaple).toHaveBeenCalledTimes(1);
  });

  it("vellykket: dobbeltklikk skriver én gang med riktig navn, målet står synlig mens det lagres", async () => {
    let svar!: () => void;
    markItemAsStaple.mockReturnValueOnce(new Promise<void>((r) => (svar = r)));
    const user = await utelatOgMerk("Rømme");

    await user.dblClick(ja());
    expect(markItemAsStaple).toHaveBeenCalledTimes(1);
    expect(markItemAsStaple).toHaveBeenCalledWith("familie1", "Rømme");
    expect(sporsmaal("Rømme")).toBeInTheDocument();
    expect(ja()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nei" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Lagrer «Rømme» som basisvare…");

    svar();
    await vi.waitFor(() => expect(sporsmaal("Rømme")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeInTheDocument();
    expect(markItemAsStaple).toHaveBeenCalledTimes(1);
  });

  it("«Nei» lukker uten skriving, og varen står utelatt", async () => {
    const user = await utelatOgMerk("Rømme");
    await user.click(screen.getByRole("button", { name: "Nei" }));
    expect(sporsmaal("Rømme")).not.toBeInTheDocument();
    expect(markItemAsStaple).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeInTheDocument();
  });
});
