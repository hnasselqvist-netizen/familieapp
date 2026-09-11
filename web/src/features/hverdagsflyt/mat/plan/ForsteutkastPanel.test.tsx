import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";
import { ForsteutkastPanel } from "./ForsteutkastPanel";

/**
 * Komponenttester for den dynamiske planleggingshorisonten i
 * `ForsteutkastPanel` (Middagsplan v1, §Kontrolltårn-handoff, Issue #20,
 * "Byggehandoff — Middagsplan v1") — selve periodematematikken
 * (`beregnPlanperiodeTilDato`) er allerede karakteriseringstestet i
 * `domain/meals/planningPeriod.test.ts`; dette dekker at komponenten
 * faktisk bruker et brukervalgt sluttpunkt, med riktig standardverdi.
 */

vi.mock("@hooks/useMealsRange", () => ({
  useMealsRange: () => ({ allMeals: loaded({}) }),
}));
vi.mock("@hooks/useMealFeedbackRange", () => ({
  useMealFeedbackRange: () => ({ allFeedback: loaded({}) }),
}));
vi.mock("@hooks/useMealLibrary", () => ({
  useMealLibrary: () => ({ mealLibrary: loaded([]) }),
}));
vi.mock("@hooks/useRecipes", () => ({
  useRecipes: () => ({ recipes: loaded([]) }),
}));
const setDayToRecipeForWeek = vi.fn();
vi.mock("@hooks/useMealsWriter", () => ({
  useMealsWriter: () => ({ setDayToRecipeForWeek }),
}));

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

describe("ForsteutkastPanel — dynamisk planleggingshorisont", () => {
  it("standard sluttdato er i dag + 7 dager", () => {
    render(<ForsteutkastPanel onClose={vi.fn()} />);
    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    expect(screen.getByLabelText(/Planlegg til og med/)).toHaveValue(toISODate(expected));
  });

  it("datofeltets nedre grense (min) er i dag — kan ikke velge en sluttdato i fortiden", () => {
    render(<ForsteutkastPanel onClose={vi.fn()} />);
    expect(screen.getByLabelText(/Planlegg til og med/)).toHaveAttribute(
      "min",
      toISODate(new Date()),
    );
  });

  it("å endre sluttdatoen endrer periode-etiketten i panel-tittelen", () => {
    render(<ForsteutkastPanel onClose={vi.fn()} />);
    const foer = screen.getByText(/^Førsteutkast — /).textContent;

    const nySluttdato = new Date();
    nySluttdato.setDate(nySluttdato.getDate() + 21);
    fireEvent.change(screen.getByLabelText(/Planlegg til og med/), {
      target: { value: toISODate(nySluttdato) },
    });

    const etter = screen.getByText(/^Førsteutkast — /).textContent;
    expect(etter).not.toBe(foer);
  });

  it("viser en myk anbefaling (ikke en blokkering) når perioden blir lang", () => {
    render(<ForsteutkastPanel onClose={vi.fn()} />);
    const langSluttdato = new Date();
    langSluttdato.setDate(langSluttdato.getDate() + 30);
    fireEvent.change(screen.getByLabelText(/Planlegg til og med/), {
      target: { value: toISODate(langSluttdato) },
    });

    expect(
      screen.getByText("Tips: planlegg noen uker om gangen for best resultat."),
    ).toBeInTheDocument();
    // Fortsatt mulig å generere — ingen hard grense.
    expect(screen.getByRole("button", { name: "Generer forslag →" })).toBeEnabled();
  });

  it("ingen myk anbefaling vises for standardperioden (7 dager)", () => {
    render(<ForsteutkastPanel onClose={vi.fn()} />);
    expect(
      screen.queryByText("Tips: planlegg noen uker om gangen for best resultat."),
    ).not.toBeInTheDocument();
  });
});
