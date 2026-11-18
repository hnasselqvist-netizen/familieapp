import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SletteUtfall } from "@domain/mealLibrary/sletting";
import { loaded } from "@app-types/status";
import type { MealLibraryEntry } from "@app-types/shopping";
import { MealLibraryScreen } from "./MealLibraryScreen";

/**
 * «Slett middag» med frosset mål og grunnlag (Mat #20, ordre 6968416205):
 * bekreftelsen holder middagen slik den ble vist da den åpnet, dobbeltklikk
 * sender én gang, utfallene vises tydelig, og ingenting slettes på nytt
 * automatisk.
 */

const slettEntry = vi.fn<(observert: MealLibraryEntry) => Promise<SletteUtfall>>();
let data: MealLibraryEntry[] = [];

vi.mock("@hooks/useMealLibrary", () => ({
  useMealLibrary: () => ({
    mealLibrary: loaded(data),
    addEntry: vi.fn(),
    slettEntry,
    addShoppingBaseItem: vi.fn(),
    updateShoppingBaseItemField: vi.fn(),
    clearShoppingBaseItemToFreeText: vi.fn(),
    replaceShoppingBaseItemFromPicker: vi.fn(),
    removeShoppingBaseItem: vi.fn(),
    updateEntryFields: vi.fn(),
    addVariant: vi.fn(),
    updateVariant: vi.fn(),
    removeVariant: vi.fn(),
    addVariantShoppingBaseItem: vi.fn(),
    removeVariantShoppingBaseItem: vi.fn(),
  }),
}));
vi.mock("@hooks/useItems", () => ({
  useItems: () => ({ items: loaded([]), findOrCreateItem: vi.fn() }),
}));
vi.mock("@hooks/useRecipes", () => ({
  useRecipes: () => ({ recipes: loaded([]) }),
}));

const PIZZA: MealLibraryEntry = { id: "m1", name: "Pizza", shoppingBase: [] };
const TACO: MealLibraryEntry = { id: "m2", name: "Taco" };

function utsatt() {
  let svar!: (u: SletteUtfall) => void;
  const promise = new Promise<SletteUtfall>((r) => (svar = r));
  return { promise, svar };
}
const dialog = () => screen.getByRole("dialog", { name: /Slette? middag/ });
async function aapneSletting(user: ReturnType<typeof userEvent.setup>, navn = "Pizza") {
  await user.click(screen.getByText(navn));
  await user.click(screen.getByRole("button", { name: /Slett middag/ }));
}

beforeEach(() => {
  slettEntry.mockReset();
  data = [PIZZA, TACO];
});

describe("MealLibraryScreen — «Slett middag» med grunnlagsvern", () => {
  it("bekreftelsen forklarer handlegrunnlaget og lover ikke at ukeplaner er upåvirket", async () => {
    const user = userEvent.setup();
    render(<MealLibraryScreen />);
    await aapneSletting(user);
    expect(
      screen.getByText(
        "«Pizza» fjernes fra biblioteket. Dager i ukeplanen som henter handlegrunnlag eller varianter fra denne middagen, beholder navnet, men gir ikke lenger varer fra den når du lager handleliste. En oppskrift som er koblet direkte til dagen, gir fortsatt varer.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/påvirkes ikke/)).toBeNull();
  });

  it("målet og grunnlaget fryses når bekreftelsen åpnes: en ny visning av posten endrer ikke hva som sendes", async () => {
    const user = userEvent.setup();
    const r = render(<MealLibraryScreen />);
    await aapneSletting(user);
    // En annen klient endrer posten; abonnementet leverer et nytt objekt.
    data = [{ ...PIZZA, name: "Pizza", lettvint: true }, TACO];
    r.rerender(<MealLibraryScreen />);
    slettEntry.mockResolvedValueOnce("endret");
    await user.click(screen.getByRole("button", { name: "Slett" }));
    expect(slettEntry).toHaveBeenCalledTimes(1);
    expect(slettEntry.mock.calls[0]![0]).toBe(PIZZA); // objektet som ble vist, med sitt grunnlag
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "«Pizza» er endret på en annen enhet siden du åpnet bekreftelsen. Ingenting er slettet.",
    );
    // Ingen automatisk ny sletting, og ingen «Slett» i utfallet.
    expect(screen.queryByRole("button", { name: "Slett" })).toBeNull();
    expect(slettEntry).toHaveBeenCalledTimes(1);
  });

  it("dobbeltklikk sender én gang; mens slettingen pågår er knappene og lukking sperret; svaret vises i samme bekreftelse", async () => {
    const user = userEvent.setup();
    render(<MealLibraryScreen />);
    await aapneSletting(user);
    const d = utsatt();
    slettEntry.mockReturnValueOnce(d.promise);
    await user.dblClick(screen.getByRole("button", { name: "Slett" }));
    expect(slettEntry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Sletter «Pizza» …");
    expect(screen.getByRole("button", { name: "Slett" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Avbryt" })).toBeDisabled();
    await user.click(within(dialog()).getByRole("button", { name: "Lukk" }));
    expect(screen.getByRole("status")).toHaveTextContent("Sletter «Pizza» …");

    d.svar("slettet");
    await vi.waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("«Pizza» er slettet fra biblioteket."),
    );
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog", { name: /Slette? middag/ })).toBeNull();
    expect(slettEntry).toHaveBeenCalledTimes(1);
  });

  it.each<[SletteUtfall, string]>([
    ["mangler", "«Pizza» var allerede slettet på en annen enhet. Ingenting er gjenopprettet."],
    ["avvist", "Du har ikke tilgang til å slette middagen. Ingenting er slettet."],
    ["ikkeLest", "Kunne ikke kontrollere «Pizza» nå. Ingenting er slettet — prøv igjen."],
    [
      "ukjent",
      "Vi vet ikke om «Pizza» ble slettet — svaret uteble. Se om den fortsatt står i biblioteket før du prøver igjen.",
    ],
  ])("utfallet %s vises tydelig, uten nytt slettevalg", async (utfall, tekst) => {
    const user = userEvent.setup();
    render(<MealLibraryScreen />);
    await aapneSletting(user);
    slettEntry.mockResolvedValueOnce(utfall);
    await user.click(screen.getByRole("button", { name: "Slett" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(tekst);
    expect(screen.queryByRole("button", { name: "Slett" })).toBeNull();
    expect(slettEntry).toHaveBeenCalledTimes(1);
  });

  it("et kast fra datalaget vises som uavklart, ikke som slettet", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<MealLibraryScreen />);
    await aapneSletting(user);
    slettEntry.mockRejectedValueOnce(new Error("nett"));
    await user.click(screen.getByRole("button", { name: "Slett" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Vi vet ikke om «Pizza» ble slettet/,
    );
  });

  it("ny bekreftelse etter et utfall fryser det som vises da — og gjelder bare den middagen", async () => {
    const user = userEvent.setup();
    const r = render(<MealLibraryScreen />);
    await aapneSletting(user);
    slettEntry.mockResolvedValueOnce("endret");
    await user.click(screen.getByRole("button", { name: "Slett" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "OK" }));

    const ny = { ...PIZZA, lettvint: true };
    data = [ny, TACO];
    r.rerender(<MealLibraryScreen />);
    await aapneSletting(user);
    slettEntry.mockResolvedValueOnce("slettet");
    await user.click(screen.getByRole("button", { name: "Slett" }));
    await screen.findByText("«Pizza» er slettet fra biblioteket.");
    expect(slettEntry.mock.calls.map((c) => c[0])).toEqual([PIZZA, ny]);
    expect(slettEntry.mock.calls[1]![0]).toBe(ny);
  });
});
