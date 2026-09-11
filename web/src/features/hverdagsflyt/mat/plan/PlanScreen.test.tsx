import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";
import { PlanScreen } from "./PlanScreen";

/**
 * Regresjonstester for handlingene som flyttet inn i `RoomHeader`/`Button`
 * i paritetsskiven (§Kontrolltårn-handoff, Issue #20, etter merge av
 * PR #22) — beviser at "✨ Foreslå middager" og "🛒 Lag handleliste" fortsatt
 * fungerer som før adopsjonen, ikke at hele `PlanScreen` er dekket.
 * `ShoppingGeneratorModal`/`ForsteutkastPanel` mockes bort — deres egne
 * Firebase-avhengige oppførsel er allerede dekket av egne tester/e2e, og
 * er ikke det denne testfilen skal bevise noe om.
 */

vi.mock("@hooks/useMeals", () => ({
  useMeals: () => ({
    meals: loaded({}),
    setDayToRecipe: vi.fn(),
    setDayToText: vi.fn(),
    addRecipeToDay: vi.fn(),
    removeRecipeFromDay: vi.fn(),
    setDayToEvent: vi.fn(),
    clearDay: vi.fn(),
  }),
}));

vi.mock("@hooks/useRecipes", () => ({
  useRecipes: () => ({ recipes: loaded([]) }),
}));

vi.mock("@hooks/useMealLibrary", () => ({
  useMealLibrary: () => ({ mealLibrary: loaded([]) }),
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

function renderPlanScreen() {
  return render(
    <MemoryRouter>
      <PlanScreen />
    </MemoryRouter>,
  );
}

describe("PlanScreen — header-handlinger etter RoomHeader/Button-adopsjon", () => {
  it("viser tittelen som RoomHeader sitt semantiske h1", () => {
    renderPlanScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Middagsplan" })).toBeInTheDocument();
  });

  it('"🛒 Lag handleliste" beholder sin fulle synlige tekst (inkl. emoji) — Icon-bytte er bevisst utelatt her, se toppkommentaren i PlanScreen.tsx', () => {
    renderPlanScreen();
    expect(screen.getByRole("button", { name: "🛒 Lag handleliste" })).toBeInTheDocument();
  });

  it('trykk på "🛒 Lag handleliste" åpner handlelistegeneratoren, som før adopsjonen', async () => {
    const user = userEvent.setup();
    renderPlanScreen();
    await user.click(screen.getByRole("button", { name: "🛒 Lag handleliste" }));
    expect(screen.getByRole("dialog", { name: "handlelisteoppsett-mock" })).toBeInTheDocument();
  });

  it('"✨ Foreslå middager" vises inne i RoomHeader sin actions-rad og åpner ForsteutkastPanel ved trykk', async () => {
    const user = userEvent.setup();
    renderPlanScreen();
    const knapp = screen.getByRole("button", { name: "✨ Foreslå middager" });
    expect(knapp).toBeInTheDocument();
    await user.click(knapp);
    expect(screen.getByTestId("forsteutkast-mock")).toBeInTheDocument();
  });

  it('"✨ Foreslå middager" forsvinner når panelet er åpent — speiler dagens `!showForsteutkast`-vakt uendret', async () => {
    const user = userEvent.setup();
    renderPlanScreen();
    await user.click(screen.getByRole("button", { name: "✨ Foreslå middager" }));
    expect(screen.queryByRole("button", { name: "✨ Foreslå middager" })).not.toBeInTheDocument();
  });

  it('"🛒 Lag handleliste" er en Button-instans (type=button, ikke skjema-submit)', () => {
    renderPlanScreen();
    expect(screen.getByRole("button", { name: "🛒 Lag handleliste" })).toHaveAttribute(
      "type",
      "button",
    );
  });
});
