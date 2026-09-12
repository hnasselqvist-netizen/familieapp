import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";
import { ActiveMealCard } from "./ActiveMealCard";
import type { Recipe } from "@app-types/recipe";
import type { MealLibraryEntry } from "@app-types/shopping";
import type { MealValue } from "@app-types/meal";

/**
 * Komponenttester for `ActiveMealCard` (Middagsplan v1, §Kontrolltårn-
 * handoff, Issue #20, "Byggehandoff — Middagsplan v1") — det aktive
 * dag-/middagskortet som samler ALLE dagendrende handlinger på ett sted.
 * `useMealEvents` mockes (egen Firebase-avhengig hendelseskatalog,
 * uavhengig av kortets øvrige props) — dekker: tom dag (søk + hendelser),
 * en meny/flere retter, variantvalg som hovedhandling, og
 * opprett/rediger/fjern egendefinert hendelse.
 */

const addEvent = vi.fn(async (event: { name: string; emoji?: string }) => ({
  id: "new-event-id",
  ...event,
}));
const updateEvent = vi.fn();
const removeEvent = vi.fn();

vi.mock("@hooks/useMealEvents", () => ({
  useMealEvents: () => ({
    mealEvents: loaded([{ id: "custom1", name: "Grøtkveld", emoji: "🥣" }]),
    addEvent,
    updateEvent,
    removeEvent,
  }),
}));

const baseRecipe = (overrides: Partial<Recipe> = {}): Recipe => ({
  id: "r1",
  name: "Taco",
  cat: "Middag",
  tags: [],
  time: 20,
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

const libraryMeal = (overrides: Partial<MealLibraryEntry> = {}): MealLibraryEntry => ({
  id: "lib1",
  name: "Fiskegrateng",
  shoppingBase: [],
  ...overrides,
});

function renderCard(
  overrides: Partial<{
    mealVal: MealValue | null | undefined;
    recipes: Recipe[];
    mealLibrary: MealLibraryEntry[];
  }> = {},
) {
  const onSetRecipe = vi.fn();
  const onSetEvent = vi.fn();
  const onAddRecipe = vi.fn();
  const onRemoveRecipe = vi.fn();
  const onClearDay = vi.fn();
  const onSetVariant = vi.fn();
  const onClose = vi.fn();

  render(
    <ActiveMealCard
      dayLabel="Mandag"
      mealVal={overrides.mealVal}
      recipes={overrides.recipes ?? []}
      mealLibrary={overrides.mealLibrary ?? []}
      onSetRecipe={onSetRecipe}
      onSetEvent={onSetEvent}
      onAddRecipe={onAddRecipe}
      onRemoveRecipe={onRemoveRecipe}
      onClearDay={onClearDay}
      onSetVariant={onSetVariant}
      onClose={onClose}
    />,
  );

  return {
    onSetRecipe,
    onSetEvent,
    onAddRecipe,
    onRemoveRecipe,
    onClearDay,
    onSetVariant,
    onClose,
  };
}

describe("ActiveMealCard — tom dag", () => {
  it("åpner direkte i søkemodus (ingen sammendrag å vise) og viser standardhendelsene", () => {
    renderCard();
    expect(screen.getByPlaceholderText("Søk i kokebok eller biblioteket…")).toBeInTheDocument();
    expect(screen.getByText("Spiser et annet sted")).toBeInTheDocument();
    expect(screen.getByText("Rester")).toBeInTheDocument();
    expect(screen.getByText("Take-away")).toBeInTheDocument();
    // "Grandiosa" er fjernet fra standardhendelsene (Middagsplan v1) — en konkret rett, ikke en hendelse.
    expect(screen.queryByText("Grandiosa")).not.toBeInTheDocument();
    // "Enkel middag" er et Førsteutkast-input, ikke en hendelse (§Helen-review, runde 3, §8).
    expect(screen.queryByText("Enkel middag")).not.toBeInTheDocument();
  });

  it("viser den egendefinerte hendelsen fra useMealEvents ved siden av standardsettet", () => {
    renderCard();
    expect(screen.getByText("Grøtkveld")).toBeInTheDocument();
  });

  it("velger en Kokebok-oppskrift fra søket — setter recipeId og lukker kortet", async () => {
    const user = userEvent.setup();
    const { onSetRecipe, onClose } = renderCard({ recipes: [baseRecipe({ name: "Taco" })] });
    await user.type(screen.getByPlaceholderText("Søk i kokebok eller biblioteket…"), "Taco");
    await user.click(screen.getByText("Taco"));
    expect(onSetRecipe).toHaveBeenCalledWith({ name: "Taco", recipeId: "r1" });
    expect(onClose).toHaveBeenCalled();
  });

  it("velger en biblioteksmiddag fra søket — recipeId:null", async () => {
    const user = userEvent.setup();
    const { onSetRecipe } = renderCard({ mealLibrary: [libraryMeal({ name: "Fiskegrateng" })] });
    await user.type(screen.getByPlaceholderText("Søk i kokebok eller biblioteket…"), "Fiske");
    await user.click(screen.getByText("Fiskegrateng"));
    expect(onSetRecipe).toHaveBeenCalledWith({ name: "Fiskegrateng", recipeId: null });
  });

  it('viser "Bruk «query»" for fritekst som ikke matcher noe, og skriver den som recipeId:null ved klikk', async () => {
    const user = userEvent.setup();
    const { onSetRecipe } = renderCard();
    await user.type(
      screen.getByPlaceholderText("Søk i kokebok eller biblioteket…"),
      "Pasta med det vi har",
    );
    await user.click(screen.getByText("Bruk «Pasta med det vi har»"));
    expect(onSetRecipe).toHaveBeenCalledWith({ name: "Pasta med det vi har", recipeId: null });
  });

  it("skjuler fritekst-alternativet når query er et eksakt treff mot en eksisterende oppskrift", async () => {
    const user = userEvent.setup();
    renderCard({ recipes: [baseRecipe({ name: "Taco" })] });
    await user.type(screen.getByPlaceholderText("Søk i kokebok eller biblioteket…"), "Taco");
    expect(screen.queryByText("Bruk «Taco»")).not.toBeInTheDocument();
  });

  it("velger en standardhendelse uten detaljfelt — setter hendelsen og lukker kortet direkte", async () => {
    const user = userEvent.setup();
    const { onSetEvent, onClose } = renderCard();
    await user.click(screen.getByText("Rester"));
    expect(onSetEvent).toHaveBeenCalledWith({ name: "Rester", emoji: "♻️" });
    expect(onClose).toHaveBeenCalled();
  });

  it('"Spiser et annet sted" åpner et valgfritt detaljsteg — tom detalj bruker kun standardnavnet', async () => {
    const user = userEvent.setup();
    const { onSetEvent, onClose } = renderCard();
    await user.click(screen.getByText("Spiser et annet sted"));
    expect(onSetEvent).not.toHaveBeenCalled();
    await user.click(screen.getByText("Velg"));
    expect(onSetEvent).toHaveBeenCalledWith({ name: "Spiser et annet sted", emoji: "🍽️" });
    expect(onClose).toHaveBeenCalled();
  });

  it('"Spiser et annet sted" med utfylt detalj kombinerer navn og detalj', async () => {
    const user = userEvent.setup();
    const { onSetEvent } = renderCard();
    await user.click(screen.getByText("Spiser et annet sted"));
    await user.type(
      screen.getByPlaceholderText("Valgfri detalj, f.eks. hos svigermor…"),
      "hos svigermor",
    );
    await user.click(screen.getByText("Velg"));
    expect(onSetEvent).toHaveBeenCalledWith({
      name: "Spiser et annet sted – hos svigermor",
      emoji: "🍽️",
    });
  });

  it("oppretter en ny egendefinert hendelse og setter dagen til den, i ett steg", async () => {
    const user = userEvent.setup();
    const { onSetEvent, onClose } = renderCard();
    await user.click(screen.getByText("＋ Ny hendelse"));
    await user.type(screen.getByPlaceholderText("Navn på hendelsen…"), "Pizza-kveld");
    await user.click(screen.getByText("Legg til hendelse"));
    expect(addEvent).toHaveBeenCalledWith({ name: "Pizza-kveld", emoji: undefined });
    expect(onSetEvent).toHaveBeenCalledWith({ name: "Pizza-kveld", emoji: undefined });
    expect(onClose).toHaveBeenCalled();
  });

  it("redigerer en egendefinert hendelse — lagrer nytt navn via updateEvent", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByLabelText("Rediger hendelsen Grøtkveld"));
    const nameInput = screen.getByDisplayValue("Grøtkveld");
    await user.clear(nameInput);
    await user.type(nameInput, "Grøt og bær");
    await user.click(screen.getByText("Lagre"));
    expect(updateEvent).toHaveBeenCalledWith("custom1", { name: "Grøt og bær", emoji: "🥣" });
  });

  it("fjerner en egendefinert hendelse via redigeringsvisningen", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByLabelText("Rediger hendelsen Grøtkveld"));
    await user.click(screen.getByText("Fjern"));
    expect(removeEvent).toHaveBeenCalledWith("custom1");
  });

  it("standardhendelser har ingen redigeringsknapp — kun egendefinerte er redigerbare", () => {
    renderCard();
    expect(
      screen.queryByLabelText("Rediger hendelsen Spiser et annet sted"),
    ).not.toBeInTheDocument();
  });
});

describe("ActiveMealCard — dag med innhold", () => {
  it("viser navnet og de sekundære handlingene Bytt middag/＋ Rett/Fjern middag", () => {
    renderCard({ mealVal: { type: "recipe", name: "Taco", recipeId: "r1" } });
    expect(screen.getByText("Taco")).toBeInTheDocument();
    expect(screen.getByText("Bytt middag")).toBeInTheDocument();
    expect(screen.getByText("＋ Rett")).toBeInTheDocument();
    expect(screen.getByText("Fjern middag")).toBeInTheDocument();
  });

  it('"Fjern middag" fjerner dagen og lukker kortet', async () => {
    const user = userEvent.setup();
    const { onClearDay, onClose } = renderCard({
      mealVal: { type: "recipe", name: "Taco", recipeId: "r1" },
    });
    await user.click(screen.getByText("Fjern middag"));
    expect(onClearDay).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('"Bytt middag" åpner søket/hendelseslisten på nytt, med en vei tilbake til sammendraget', async () => {
    const user = userEvent.setup();
    renderCard({ mealVal: { type: "recipe", name: "Taco", recipeId: "r1" } });
    await user.click(screen.getByText("Bytt middag"));
    expect(screen.getByPlaceholderText("Søk i kokebok eller biblioteket…")).toBeInTheDocument();
    expect(screen.getByText("Avbryt")).toBeInTheDocument();
  });

  it('"＋ Rett" legger til en ny rett via addRecipeToDay og går tilbake til sammendraget (kortet forblir åpent)', async () => {
    const user = userEvent.setup();
    const { onAddRecipe, onClose } = renderCard({
      mealVal: { type: "recipe", name: "Taco", recipeId: "r1" },
      recipes: [baseRecipe({ id: "r1", name: "Taco" }), baseRecipe({ id: "r2", name: "Salat" })],
    });
    await user.click(screen.getByText("＋ Rett"));
    await user.type(screen.getByPlaceholderText("Søk etter rett å legge til…"), "Salat");
    await user.click(screen.getByText("Salat"));
    expect(onAddRecipe).toHaveBeenCalledWith({ id: "r2", name: "Salat" });
    expect(onClose).not.toHaveBeenCalled();
    // Tilbake i sammendraget, ikke fortsatt i søket.
    expect(screen.queryByPlaceholderText("Søk etter rett å legge til…")).not.toBeInTheDocument();
  });

  it("en hendelse-dag har ingen ＋ Rett-knapp — hendelser har ingen oppskrifter å legge til", () => {
    renderCard({ mealVal: { type: "event", name: "Rester", emoji: "♻️" } });
    expect(screen.queryByText("＋ Rett")).not.toBeInTheDocument();
    expect(screen.getByText("Rester")).toBeInTheDocument();
  });

  it("viser hver rett i en meny med egen ✕-fjernknapp, kaller onRemoveRecipe med riktig indeks", async () => {
    const user = userEvent.setup();
    const { onRemoveRecipe } = renderCard({
      mealVal: {
        type: "menu",
        name: "Taco · Pannekaker",
        recipes: [
          { name: "Taco", recipeId: "r1" },
          { name: "Pannekaker", recipeId: "r2" },
        ],
      },
    });
    expect(screen.getByText("Taco")).toBeInTheDocument();
    expect(screen.getByText("Pannekaker")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Fjern Pannekaker fra Mandag"));
    expect(onRemoveRecipe).toHaveBeenCalledWith(1);
  });

  it("en enkeltoppskrift har ingen ✕-fjernknapp på selve retten (kun Fjern middag for hele dagen)", () => {
    renderCard({ mealVal: { type: "recipe", name: "Taco", recipeId: "r1" } });
    expect(screen.queryByLabelText("Fjern Taco fra Mandag")).not.toBeInTheDocument();
  });
});

describe("ActiveMealCard — variantvalg (Middagsplan v1)", () => {
  const mealLibraryWithVariants = [
    libraryMeal({
      id: "lib1",
      name: "Pizza",
      shoppingBase: undefined,
      variants: [
        { id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" },
        { id: "v2", name: "Kjøpepizza", source: "shoppingBase", shoppingBase: [] },
      ],
    }),
  ];

  it("viser variantvalget som hovedhandling når konseptet har 2+ varianter og ingen er valgt", () => {
    renderCard({
      mealVal: { type: "recipe", name: "Pizza", recipeId: null },
      mealLibrary: mealLibraryWithVariants,
    });
    expect(screen.getByText("Velg hvordan «Pizza» løses:")).toBeInTheDocument();
    expect(screen.getByText("Hjemmelaget")).toBeInTheDocument();
    expect(screen.getByText("Kjøpepizza")).toBeInTheDocument();
  });

  it("klikk på en variant kaller onSetVariant med riktig indeks og variantId", async () => {
    const user = userEvent.setup();
    const { onSetVariant } = renderCard({
      mealVal: { type: "recipe", name: "Pizza", recipeId: null },
      mealLibrary: mealLibraryWithVariants,
    });
    await user.click(screen.getByText("Kjøpepizza"));
    expect(onSetVariant).toHaveBeenCalledWith(0, "v2");
  });

  it("variantvelgeren blir stående etter at variantId er satt — vises fortsatt, ikke skjult (§Kontrolltårn-review, PR #24)", () => {
    renderCard({
      mealVal: { type: "recipe", name: "Pizza", recipeId: null, variantId: "v1" },
      mealLibrary: mealLibraryWithVariants,
    });
    expect(screen.getByText("Løses som Hjemmelaget — bytt om ønskelig:")).toBeInTheDocument();
    expect(screen.getByText("Hjemmelaget")).toBeInTheDocument();
    expect(screen.getByText("Kjøpepizza")).toBeInTheDocument();
  });

  it("den valgte varianten er markert (aria-pressed) blant de andre valgene", () => {
    renderCard({
      mealVal: { type: "recipe", name: "Pizza", recipeId: null, variantId: "v1" },
      mealLibrary: mealLibraryWithVariants,
    });
    expect(screen.getByText("Hjemmelaget")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Kjøpepizza")).toHaveAttribute("aria-pressed", "false");
  });

  it("bytte til en annen variant er ett klikk — kaller onSetVariant direkte, uten å gå via Bytt middag", async () => {
    const user = userEvent.setup();
    const { onSetVariant } = renderCard({
      mealVal: { type: "recipe", name: "Pizza", recipeId: null, variantId: "v1" },
      mealLibrary: mealLibraryWithVariants,
    });
    await user.click(screen.getByText("Kjøpepizza"));
    expect(onSetVariant).toHaveBeenCalledWith(0, "v2");
  });

  it("viser IKKE variantvalg for et konsept uten variants i det hele tatt (regresjon)", () => {
    renderCard({
      mealVal: { type: "recipe", name: "Fiskegrateng", recipeId: null },
      mealLibrary: [libraryMeal({ name: "Fiskegrateng" })],
    });
    expect(screen.queryByText(/Velg hvordan/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Løses som/)).not.toBeInTheDocument();
  });
});
