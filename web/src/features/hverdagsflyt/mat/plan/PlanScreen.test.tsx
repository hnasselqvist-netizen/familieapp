import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMealLibrary } from "@hooks/useMealLibrary";
import { useMeals } from "@hooks/useMeals";
import { loaded } from "@app-types/status";
import { PlanScreen } from "./PlanScreen";
import type { MealLibraryEntry } from "@app-types/shopping";

/**
 * Regresjonstester for handlingene som flyttet inn i `RoomHeader`/`Button`
 * i paritetsskiven (§Kontrolltårn-handoff, Issue #20, etter merge av
 * PR #22) — beviser at "Foreslå middager" og "Lag handleliste" fortsatt
 * fungerer som før adopsjonen, ikke at hele `PlanScreen` er dekket.
 * `ShoppingGeneratorModal`/`ForsteutkastPanel` mockes bort — deres egne
 * Firebase-avhengige oppførsel er allerede dekket av egne tester/e2e, og
 * er ikke det denne testfilen skal bevise noe om.
 *
 * Emoji-prefiksene (✨/🛒) er byttet til `sparkles`/`shopping-cart`-ikoner
 * (§Kontrolltårn-review, PR #26, design-review runde 2, §3) — `Icon` er
 * `aria-hidden` uten synlig tekst, så den tilgjengelige knappenavnet er nå
 * uten emoji.
 */

const defaultUseMealsReturn = {
  meals: loaded({}),
  setDayToRecipe: vi.fn(),
  setDayToText: vi.fn(),
  addRecipeToDay: vi.fn(),
  removeRecipeFromDay: vi.fn(),
  setDayToEvent: vi.fn(),
  clearDay: vi.fn(),
  setVariantForRecipe: vi.fn(),
};

vi.mock("@hooks/useMeals", () => ({
  useMeals: vi.fn(),
}));

vi.mock("@hooks/useRecipes", () => ({
  useRecipes: () => ({ recipes: loaded([]) }),
}));

vi.mock("@hooks/useMealLibrary", () => ({
  useMealLibrary: vi.fn(),
}));

vi.mock("@hooks/useMealFeedback", () => ({
  useMealFeedback: () => ({
    feedback: loaded({}),
    setFeedback: vi.fn(),
    deleteFeedback: vi.fn(),
  }),
}));

vi.mock("./ShoppingGeneratorModal", () => ({
  ShoppingGeneratorModal: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="handlelisteoppsett-mock">
      <button type="button" onClick={onClose}>
        Lukk mock
      </button>
    </div>
  ),
}));

vi.mock("./ForsteutkastPanel", () => ({
  ForsteutkastPanel: () => <div data-testid="forsteutkast-mock" />,
}));

vi.mock("./ActiveMealCard", () => ({
  ActiveMealCard: ({ dayLabel, onClose }: { dayLabel: string; onClose: () => void }) => (
    <div role="dialog" aria-label={`aktivt-kort-mock-${dayLabel}`}>
      <button type="button" onClick={onClose}>
        Lukk mock
      </button>
    </div>
  ),
}));

function renderPlanScreen() {
  return render(
    <MemoryRouter>
      <PlanScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(useMeals).mockReturnValue(defaultUseMealsReturn);
  vi.mocked(useMealLibrary).mockReturnValue({
    mealLibrary: loaded([]),
  } as unknown as ReturnType<typeof useMealLibrary>);
});

describe("PlanScreen — header-handlinger etter RoomHeader/Button-adopsjon", () => {
  it("viser tittelen som RoomHeader sitt semantiske h1", () => {
    renderPlanScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Middagsplan" })).toBeInTheDocument();
  });

  it('"Lag handleliste" beholder sin fulle synlige tekst', () => {
    renderPlanScreen();
    expect(screen.getByRole("button", { name: "Lag handleliste" })).toBeInTheDocument();
  });

  it('trykk på "Lag handleliste" åpner handlelistegeneratoren, som før adopsjonen', async () => {
    const user = userEvent.setup();
    renderPlanScreen();
    await user.click(screen.getByRole("button", { name: "Lag handleliste" }));
    expect(screen.getByRole("dialog", { name: "handlelisteoppsett-mock" })).toBeInTheDocument();
  });

  it('"Foreslå middager" vises inne i RoomHeader sin actions-rad og åpner ForsteutkastPanel ved trykk', async () => {
    const user = userEvent.setup();
    renderPlanScreen();
    const knapp = screen.getByRole("button", { name: "Foreslå middager" });
    expect(knapp).toBeInTheDocument();
    await user.click(knapp);
    expect(screen.getByTestId("forsteutkast-mock")).toBeInTheDocument();
  });

  it('"Foreslå middager" forsvinner når panelet er åpent — speiler dagens `!showForsteutkast`-vakt uendret', async () => {
    const user = userEvent.setup();
    renderPlanScreen();
    await user.click(screen.getByRole("button", { name: "Foreslå middager" }));
    expect(screen.queryByRole("button", { name: "Foreslå middager" })).not.toBeInTheDocument();
  });

  it('"Lag handleliste" er en Button-instans (type=button, ikke skjema-submit)', () => {
    renderPlanScreen();
    expect(screen.getByRole("button", { name: "Lag handleliste" })).toHaveAttribute(
      "type",
      "button",
    );
  });
});

describe("PlanScreen — Middagsplan v1: dagraden er en ren oppsummering, ActiveMealCard eier endring", () => {
  it('en tom dag viser "Velg middag" på raden (ikke "Legg til middag…")', () => {
    renderPlanScreen();
    expect(screen.getAllByText("Velg middag").length).toBeGreaterThan(0);
  });

  it("klikk på en dagrad åpner ActiveMealCard for akkurat den dagen", async () => {
    const user = userEvent.setup();
    renderPlanScreen();
    await user.click(screen.getByLabelText("Mandag"));
    expect(screen.getByRole("dialog", { name: "aktivt-kort-mock-Mandag" })).toBeInTheDocument();
  });

  it("kun én dags ActiveMealCard er åpen om gangen — klikk på en annen dag bytter, ikke stabler", async () => {
    const user = userEvent.setup();
    renderPlanScreen();
    await user.click(screen.getByLabelText("Mandag"));
    await user.click(screen.getByLabelText("Tirsdag"));
    expect(screen.getByRole("dialog", { name: "aktivt-kort-mock-Tirsdag" })).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "aktivt-kort-mock-Mandag" }),
    ).not.toBeInTheDocument();
  });

  it("lukking av kortet (onClose) fjerner det fra DOM-en igjen", async () => {
    const user = userEvent.setup();
    renderPlanScreen();
    await user.click(screen.getByLabelText("Mandag"));
    await user.click(screen.getByText("Lukk mock"));
    expect(
      screen.queryByRole("dialog", { name: "aktivt-kort-mock-Mandag" }),
    ).not.toBeInTheDocument();
  });

  it("dagraden har ingen ✕/bytt/hendelse-knapper lenger — de flyttet inn i ActiveMealCard", () => {
    renderPlanScreen();
    expect(screen.queryByText("＋ Rett")).not.toBeInTheDocument();
    expect(screen.queryByText("🏡 Hendelse")).not.toBeInTheDocument();
  });

  it('en hendelse vises på LIKE premisser som en middag på dagraden — ingen "hendelse"-badge eller egen visuell klassifisering (§Kontrolltårn-review, PR #24)', () => {
    vi.mocked(useMeals).mockReturnValue({
      ...defaultUseMealsReturn,
      meals: loaded({ Mon: { type: "event", name: "Middag hos svigermor", emoji: "🏡" } }),
    });
    renderPlanScreen();
    expect(screen.getByText("Middag hos svigermor")).toBeInTheDocument();
    expect(screen.queryByText("hendelse")).not.toBeInTheDocument();
  });
});

/**
 * §Helen-test med reelle data, PR #26, §4: dagradens bok-ikon skal følge
 * den KONKRET resolverte varianten, ikke bare det gamle
 * middagskonseptets `recipeId` (som er `null` for et bibliotekskonsept
 * med varianter).
 */
describe("PlanScreen — dagradens bok-ikon følger den resolverte varianten", () => {
  const pizzaLib = (overrides: Partial<MealLibraryEntry> = {}): MealLibraryEntry => ({
    id: "lib1",
    name: "Pizza",
    shoppingBase: [],
    ...overrides,
  });

  it("en konkret Kokebok-oppskrift uten variant viser fortsatt ikonet direkte (dagens oppførsel)", () => {
    vi.mocked(useMeals).mockReturnValue({
      ...defaultUseMealsReturn,
      meals: loaded({ Mon: { type: "recipe", name: "Taco", recipeId: "r1" } }),
    });
    renderPlanScreen();
    expect(screen.getByLabelText("Åpne oppskrift for Mandag")).toBeInTheDocument();
  });

  it("et bibliotekskonsept med 1 oppskrift-variant viser ikonet via auto-resolvert variant", () => {
    vi.mocked(useMeals).mockReturnValue({
      ...defaultUseMealsReturn,
      meals: loaded({ Mon: { type: "recipe", name: "Pizza", recipeId: null } }),
    });
    vi.mocked(useMealLibrary).mockReturnValue({
      mealLibrary: loaded([
        pizzaLib({
          variants: [{ id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" }],
        }),
      ]),
    } as unknown as ReturnType<typeof useMealLibrary>);
    renderPlanScreen();
    expect(screen.getByLabelText("Åpne oppskrift for Mandag")).toBeInTheDocument();
  });

  it("et bibliotekskonsept med en valgt shoppingBase-variant viser IKKE ikonet", () => {
    vi.mocked(useMeals).mockReturnValue({
      ...defaultUseMealsReturn,
      meals: loaded({ Mon: { type: "recipe", name: "Pizza", recipeId: null, variantId: "v2" } }),
    });
    vi.mocked(useMealLibrary).mockReturnValue({
      mealLibrary: loaded([
        pizzaLib({
          variants: [
            { id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" },
            { id: "v2", name: "Grandiosa", source: "shoppingBase", shoppingBase: [] },
          ],
        }),
      ]),
    } as unknown as ReturnType<typeof useMealLibrary>);
    renderPlanScreen();
    expect(screen.queryByLabelText("Åpne oppskrift for Mandag")).not.toBeInTheDocument();
  });

  it("et bibliotekskonsept med 2+ varianter og INGEN valgt variant viser IKKE ikonet ennå", () => {
    vi.mocked(useMeals).mockReturnValue({
      ...defaultUseMealsReturn,
      meals: loaded({ Mon: { type: "recipe", name: "Pizza", recipeId: null } }),
    });
    vi.mocked(useMealLibrary).mockReturnValue({
      mealLibrary: loaded([
        pizzaLib({
          variants: [
            { id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" },
            { id: "v2", name: "Frossenpizza", source: "recipe", recipeId: "r2" },
          ],
        }),
      ]),
    } as unknown as ReturnType<typeof useMealLibrary>);
    renderPlanScreen();
    expect(screen.queryByLabelText("Åpne oppskrift for Mandag")).not.toBeInTheDocument();
  });

  it("bytte til en oppskrift-variant blant flere viser ikonet for akkurat DEN valgte varianten", () => {
    vi.mocked(useMeals).mockReturnValue({
      ...defaultUseMealsReturn,
      meals: loaded({ Mon: { type: "recipe", name: "Pizza", recipeId: null, variantId: "v2" } }),
    });
    vi.mocked(useMealLibrary).mockReturnValue({
      mealLibrary: loaded([
        pizzaLib({
          variants: [
            { id: "v1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" },
            { id: "v2", name: "Frossenpizza", source: "recipe", recipeId: "r2" },
          ],
        }),
      ]),
    } as unknown as ReturnType<typeof useMealLibrary>);
    renderPlanScreen();
    expect(screen.getByLabelText("Åpne oppskrift for Mandag")).toHaveAttribute(
      "href",
      "/mat/kokebok?apne=r2",
    );
  });
});
