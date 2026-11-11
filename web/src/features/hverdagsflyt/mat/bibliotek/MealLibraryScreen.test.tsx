import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";
import { TvetydigIdentitet } from "@data/mealLibrary.repository";
import { VariantvareIkkeLagret } from "@domain/mealLibrary/mealLibrary";
import { MealLibraryScreen, STOPPET_ENDRING, VARIANT_ENDRET } from "./MealLibraryScreen";
import type { MealLibraryEntry } from "@app-types/shopping";
import type { Recipe } from "@app-types/recipe";

/**
 * Komponenttester for Varianter-UI-en (§Helen-review, PR #26,
 * design-review runde 3, §13 — "Fullfør den allerede bygde modellen som
 * brukerfunksjon") — beviser at `addVariant`/`updateVariant`/
 * `removeVariant` (eksponert via `useMealLibrary`, §hooks/useMealLibrary.ts)
 * faktisk kalles fra den nye "Varianter"-seksjonen i meddetaljmodalen,
 * med riktig `source`-diskriminator i hvert tilfelle. Selve motoren
 * (`addVariant`/`updateVariant`/`removeVariant` i
 * §domain/mealLibrary/mealLibrary.ts) er allerede grundig
 * karakteriseringstestet i `mealLibrary.test.ts` — dekkes ikke på nytt
 * her.
 */

const addVariant = vi.fn();
const updateVariant = vi.fn();
const removeVariant = vi.fn();
const removeEntry = vi.fn();
const updateEntryFields = vi.fn();
const addVariantShoppingBaseItem = vi.fn();
const removeVariantShoppingBaseItem = vi.fn();

const pizzaEntry = (overrides: Partial<MealLibraryEntry> = {}): MealLibraryEntry => ({
  id: "meal1",
  name: "Pizza",
  shoppingBase: [],
  ...overrides,
});

let mealLibraryData: MealLibraryEntry[] = [pizzaEntry()];

vi.mock("@hooks/useMealLibrary", () => ({
  useMealLibrary: () => ({
    mealLibrary: loaded(mealLibraryData),
    addEntry: vi.fn(),
    removeEntry,
    addShoppingBaseItem: vi.fn(),
    updateShoppingBaseItemField: vi.fn(),
    clearShoppingBaseItemToFreeText: vi.fn(),
    replaceShoppingBaseItemFromPicker: vi.fn(),
    removeShoppingBaseItem: vi.fn(),
    updateEntryFields,
    addVariant,
    updateVariant,
    removeVariant,
    addVariantShoppingBaseItem,
    removeVariantShoppingBaseItem,
  }),
}));

vi.mock("@hooks/useItems", () => ({
  useItems: () => ({
    items: loaded([{ id: "i-ost", name: "Ost", cat: "Meieri" }]),
    findOrCreateItem: vi.fn(),
  }),
}));

const baseRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  id: "r1",
  name: "Hjemmelaget pizza",
  cat: "Middag",
  tags: [],
  time: 30,
  servings: 4,
  url: "",
  imageUrl: null,
  source: "quick",
  instructions: "",
  ingredients: [],
  ingredientGroups: [],
  lastCooked: null,
  timesCooked: 0,
  createdAt: 0,
  ...overrides,
});

vi.mock("@hooks/useRecipes", () => ({
  useRecipes: () => ({
    recipes: loaded([baseRecipe()]),
    addRecipe: vi.fn(),
    updateRecipe: vi.fn(),
    removeRecipe: vi.fn(),
  }),
}));

describe("MealLibraryScreen — kortliste", () => {
  it('viser "N varianter" som sekundærinfo når varianter finnes', () => {
    mealLibraryData = [
      pizzaEntry({
        variants: [
          { id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" },
          { id: "v2", name: "Grandiosa", source: "shoppingBase", shoppingBase: [] },
        ],
      }),
    ];
    render(<MealLibraryScreen />);
    expect(screen.getByText("2 varianter")).toBeInTheDocument();
  });

  it("faller tilbake til varetall når ingen varianter finnes", () => {
    mealLibraryData = [
      pizzaEntry({
        shoppingBase: [
          { id: "s1", itemId: "i1", name: "Mel", amount: "", unit: "", cat: "Diverse" },
        ],
      }),
    ];
    render(<MealLibraryScreen />);
    expect(screen.getByText("1 varer")).toBeInTheDocument();
  });
});

describe("MealLibraryScreen — Varianter-seksjonen i meddetaljmodalen", () => {
  it("viser eksisterende varianter med navn og kildeinfo", async () => {
    const user = userEvent.setup();
    mealLibraryData = [
      pizzaEntry({
        variants: [{ id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" }],
      }),
    ];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    expect(screen.getByText("Hjemmelaget")).toBeInTheDocument();
    expect(screen.getByText("Hjemmelaget pizza")).toBeInTheDocument();
  });

  it("variant som peker på en slettet oppskrift: vises som «Oppskrift fjernet», uten krasj (#27 6794055423)", async () => {
    const user = userEvent.setup();
    mealLibraryData = [
      pizzaEntry({
        variants: [{ id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "slettet-id" }],
      }),
    ];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    expect(screen.getByText("Hjemmelaget")).toBeInTheDocument();
    expect(screen.getByText("Oppskrift fjernet")).toBeInTheDocument();
  });

  it('"Legg til enkel variant" oppretter en shoppingBase-variant med tomt handlegrunnlag', async () => {
    const user = userEvent.setup();
    mealLibraryData = [pizzaEntry()];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByText("＋ Legg til variant"));
    await user.click(screen.getByText("Legg til enkel variant"));
    await user.type(screen.getByPlaceholderText("Variantens navn, f.eks. Grandiosa"), "Grandiosa");
    await user.click(screen.getByText("Opprett"));
    expect(addVariant).toHaveBeenCalledWith("meal1", {
      name: "Grandiosa",
      source: "shoppingBase",
      shoppingBase: [],
    });
  });

  it('"Knytt til oppskrift i kokebok" oppretter en recipe-variant med valgt oppskrifts-id', async () => {
    const user = userEvent.setup();
    mealLibraryData = [pizzaEntry()];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByText("＋ Legg til variant"));
    await user.click(screen.getByText("Knytt til oppskrift i kokebok"));
    await user.type(screen.getByPlaceholderText("Søk etter oppskrift…"), "Hjemmelaget");
    await user.click(screen.getByText("Hjemmelaget pizza"));
    expect(addVariant).toHaveBeenCalledWith("meal1", {
      name: "Hjemmelaget pizza",
      source: "recipe",
      recipeId: "r1",
    });
  });

  it("bruker et eksplisitt variantnavn fremfor oppskriftens navn når det er fylt inn", async () => {
    const user = userEvent.setup();
    mealLibraryData = [pizzaEntry()];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByText("＋ Legg til variant"));
    await user.click(screen.getByText("Knytt til oppskrift i kokebok"));
    await user.type(
      screen.getByPlaceholderText("Variantnavn (valgfritt — bruker oppskriftens navn ellers)"),
      "Vår favoritt",
    );
    await user.type(screen.getByPlaceholderText("Søk etter oppskrift…"), "Hjemmelaget");
    await user.click(screen.getByText("Hjemmelaget pizza"));
    expect(addVariant).toHaveBeenCalledWith("meal1", {
      name: "Vår favoritt",
      source: "recipe",
      recipeId: "r1",
    });
  });

  it("fjerner en variant", async () => {
    const user = userEvent.setup();
    mealLibraryData = [
      pizzaEntry({
        variants: [{ id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" }],
      }),
    ];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByLabelText("Fjern varianten Hjemmelaget"));
    expect(removeVariant).toHaveBeenCalledWith("meal1", "v1");
  });

  it("middag uten varianter viser fortsatt det flate handlegrunnlaget", async () => {
    const user = userEvent.setup();
    mealLibraryData = [
      pizzaEntry({
        shoppingBase: [
          { id: "s1", itemId: "i1", name: "Mel", amount: "", unit: "", cat: "Diverse" },
        ],
      }),
    ];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    expect(screen.getByText("Handlegrunnlag")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Mel")).toBeInTheDocument();
  });

  it("middag med 1+ varianter skjuler middagsnivåets flate handlegrunnlag, men beholder dataen", async () => {
    const user = userEvent.setup();
    mealLibraryData = [
      pizzaEntry({
        shoppingBase: [
          { id: "s1", itemId: "i1", name: "Mel", amount: "", unit: "", cat: "Diverse" },
        ],
        variants: [{ id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" }],
      }),
    ];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    expect(screen.queryByText("Handlegrunnlag")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Mel")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Handlegrunnlaget styres nå av variantene over — hver variant eier sin egen kilde. Middagens eget handlegrunnlag er skjult, ikke slettet.",
      ),
    ).toBeInTheDocument();
    // Selve dataen ligger fortsatt i mealLibraryData (uendret av UI-skjulingen) —
    // reell bevaringsgaranti, ikke bare et visuelt inntrykk.
    expect(mealLibraryData[0]?.shoppingBase).toEqual([
      { id: "s1", itemId: "i1", name: "Mel", amount: "", unit: "", cat: "Diverse" },
    ]);
  });

  it("endrer navnet på en eksisterende variant", async () => {
    const user = userEvent.setup();
    mealLibraryData = [
      pizzaEntry({
        variants: [{ id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" }],
      }),
    ];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByLabelText("Rediger navn på Hjemmelaget"));
    const nameInput = screen.getByDisplayValue("Hjemmelaget");
    await user.clear(nameInput);
    await user.type(nameInput, "Vår hjemmelagde");
    await user.click(screen.getByText("Lagre"));
    expect(updateVariant).toHaveBeenCalledWith("meal1", "v1", { name: "Vår hjemmelagde" });
  });
});

/**
 * §Helen-tillegg, PR #26: "middagsnavn skal kunne redigeres" — navnefeltet
 * lagrer eksplisitt på blur/Enter, en ren patch (aldri slett+opprett).
 */
describe("MealLibraryScreen — redigering av middagsnavn", () => {
  it("viser et redigerbart navnefelt forhåndsutfylt med det eksisterende navnet", async () => {
    const user = userEvent.setup();
    mealLibraryData = [pizzaEntry()];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    expect(screen.getByDisplayValue("Pizza")).toBeInTheDocument();
  });

  it("lagrer det nye navnet når feltet forlater fokus (blur)", async () => {
    const user = userEvent.setup();
    mealLibraryData = [pizzaEntry()];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    const nameInput = screen.getByDisplayValue("Pizza");
    await user.clear(nameInput);
    await user.type(nameInput, "Pizza Deluxe");
    await user.tab();
    expect(updateEntryFields).toHaveBeenCalledWith("meal1", { name: "Pizza Deluxe" });
  });

  it("lagrer det nye navnet på Enter uten å kreve et separat lagre-trykk", async () => {
    const user = userEvent.setup();
    mealLibraryData = [pizzaEntry()];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    const nameInput = screen.getByDisplayValue("Pizza");
    await user.clear(nameInput);
    await user.type(nameInput, "Pizza Deluxe{Enter}");
    expect(updateEntryFields).toHaveBeenCalledWith("meal1", { name: "Pizza Deluxe" });
  });

  it("et tomt navn lagres ikke — feltet faller tilbake til det eksisterende navnet", async () => {
    const user = userEvent.setup();
    mealLibraryData = [pizzaEntry()];
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    const nameInput = screen.getByDisplayValue("Pizza");
    await user.clear(nameInput);
    await user.tab();
    expect(updateEntryFields).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Pizza")).toBeInTheDocument();
  });
});

/**
 * Review 5832401946 (#138): når datalaget stopper en endring
 * (`TvetydigIdentitet`), sier skjermen at ingenting ble lagret, og
 * redigeringsutkastet beholdes.
 */
describe("MealLibraryScreen — stoppet endring", () => {
  it("«Lettvint» som stoppes, viser at ingenting ble lagret; «Lukk» fjerner meldingen", async () => {
    const user = userEvent.setup();
    mealLibraryData = [pizzaEntry()];
    updateEntryFields.mockRejectedValueOnce(new TvetydigIdentitet("handlegrunnlaget"));
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByLabelText(/Lettvint middag/));

    expect(updateEntryFields).toHaveBeenCalledWith("meal1", { lettvint: true });
    expect(await screen.findByRole("alert")).toHaveTextContent(STOPPET_ENDRING);
    await user.click(screen.getByText("Lukk"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("nytt variantnavn som stoppes, beholdes i redigeringsfeltet; neste vellykkede lagring lukker det", async () => {
    const user = userEvent.setup();
    mealLibraryData = [
      pizzaEntry({
        variants: [{ id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" }],
      }),
    ];
    updateVariant.mockRejectedValueOnce(new TvetydigIdentitet("variantene"));
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByLabelText("Rediger navn på Hjemmelaget"));
    const felt = screen.getByPlaceholderText("Variantnavn");
    await user.clear(felt);
    await user.type(felt, "Fra bunnen");
    await user.click(screen.getByText("Lagre"));

    expect(updateVariant).toHaveBeenCalledWith("meal1", "v1", { name: "Fra bunnen" });
    expect(await screen.findByRole("alert")).toHaveTextContent(STOPPET_ENDRING);
    expect(screen.getByPlaceholderText("Variantnavn")).toHaveValue("Fra bunnen");

    updateVariant.mockResolvedValueOnce(undefined);
    await user.click(screen.getByText("Lagre"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Variantnavn")).not.toBeInTheDocument();
  });
});

/**
 * #20 6754247077: varer i en variant legges til og fjernes per rad-id via
 * hooken, som regner endringen ut fra den ferske varianten. Skjermen sender
 * ikke lenger en hel liste via `updateVariant`.
 */
describe("MealLibraryScreen — varer i en variant", () => {
  const medVariantvarer = () =>
    pizzaEntry({
      variants: [
        {
          id: "v2",
          name: "Grandiosa",
          source: "shoppingBase",
          shoppingBase: [
            { id: "s1", itemId: "i1", name: "Pizza", amount: "", unit: "", cat: "Frys" },
          ],
        },
      ],
    });

  it("fjerner en vare per rad-id uten å sende en hel liste", async () => {
    const user = userEvent.setup();
    mealLibraryData = [medVariantvarer()];
    updateVariant.mockClear();
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByLabelText("Vis handlegrunnlag for Grandiosa"));
    await user.click(screen.getByLabelText("Fjern Pizza fra Grandiosa"));
    expect(removeVariantShoppingBaseItem).toHaveBeenCalledWith("meal1", "v2", "s1");
    expect(updateVariant).not.toHaveBeenCalled();
  });

  it("legger til en vare via hooken; stoppet lagring viser melding og beholder det som er skrevet", async () => {
    const user = userEvent.setup();
    mealLibraryData = [medVariantvarer()];
    updateVariant.mockClear();
    addVariantShoppingBaseItem.mockRejectedValueOnce(
      new TvetydigIdentitet("variantens handlegrunnlag"),
    );
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByLabelText("Vis handlegrunnlag for Grandiosa"));
    const felt = screen.getByPlaceholderText("Legg til vare i varianten…");
    await user.type(felt, "Os");
    await user.click(screen.getByText("Ost"));

    expect(addVariantShoppingBaseItem).toHaveBeenCalledWith("meal1", "v2", {
      itemId: "i-ost",
      name: "Ost",
      cat: "Meieri",
    });
    expect(updateVariant).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(STOPPET_ENDRING);
    expect(screen.getByPlaceholderText("Legg til vare i varianten…")).toHaveValue("Ost");
  });

  it("avvist tillegg fordi varianten er borte: tydelig melding, ingenting lagret, utkastet beholdes", async () => {
    const user = userEvent.setup();
    mealLibraryData = [medVariantvarer()];
    addVariantShoppingBaseItem.mockRejectedValueOnce(new VariantvareIkkeLagret("variantMangler"));
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByLabelText("Vis handlegrunnlag for Grandiosa"));
    await user.type(screen.getByPlaceholderText("Legg til vare i varianten…"), "Os");
    await user.click(screen.getByText("Ost"));

    expect(await screen.findByRole("alert")).toHaveTextContent(VARIANT_ENDRET);
    expect(screen.getByPlaceholderText("Legg til vare i varianten…")).toHaveValue("Ost");
  });

  it("tvetydig rad-id ved fjerning vises som stoppet endring", async () => {
    const user = userEvent.setup();
    mealLibraryData = [medVariantvarer()];
    removeVariantShoppingBaseItem.mockRejectedValueOnce(new VariantvareIkkeLagret("tvetydigRad"));
    render(<MealLibraryScreen />);
    await user.click(screen.getByText("Pizza"));
    await user.click(screen.getByLabelText("Vis handlegrunnlag for Grandiosa"));
    await user.click(screen.getByLabelText("Fjern Pizza fra Grandiosa"));
    expect(await screen.findByRole("alert")).toHaveTextContent(STOPPET_ENDRING);
  });
});
