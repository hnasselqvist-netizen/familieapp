/**
 * Variasjon mot middager som allerede står i planperioden (#20, ordre
 * 6684401676), gjennom den faktiske generer→godkjenn-flyten i
 * `ForsteutkastPanel`. Syntetiske data, datahooks mocket, fast klokke.
 * Godkjenning skriver bare det åpne hullet; eksisterende dager og
 * hendelser røres ikke.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";
import type { WeekMeals } from "@app-types/meal";
import type { MealLibraryEntry } from "@app-types/shopping";
import { beregnPlanperiodeTilDato } from "@domain/meals/planningPeriod";

const NAA = new Date(2026, 8, 7, 10); // mandag 7.9.2026, lokal tid
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NAA);
});
afterAll(() => vi.useRealTimers());

// Standardperioden er i dag + 7 dager (se ForsteutkastPanel.test.tsx).
const slutt = new Date(NAA);
slutt.setDate(slutt.getDate() + 7);
const periode = beregnPlanperiodeTilDato(NAA, slutt);
const [man, tir, ons, ...resten] = periode;

// Mon fast «Fisk» (tag X), Tue åpent, Wed allerede «A» (tag Y), resten hendelser.
const allMeals: Record<string, WeekMeals> = {};
const sett = (d: (typeof periode)[number], v: WeekMeals[keyof WeekMeals]) => {
  allMeals[d.weekKey] = { ...(allMeals[d.weekKey] ?? {}), [d.dayKey]: v };
};
sett(man!, "Fisk");
sett(ons!, "A");
resten.forEach((d) => sett(d, { type: "event", name: "Borte" }));

const bibliotek: MealLibraryEntry[] = [
  { id: "fisk", name: "Fisk", variationTags: ["X"] },
  { id: "a", name: "A", variationTags: ["Y"] },
  { id: "b", name: "B", variationTags: ["X"] },
];

vi.mock("@hooks/useMealsRange", () => ({
  useMealsRange: () => ({ allMeals: loaded(allMeals) }),
}));
vi.mock("@hooks/useMealFeedbackRange", () => ({
  useMealFeedbackRange: () => ({ allFeedback: loaded({}) }),
}));
vi.mock("@hooks/useMealLibrary", () => ({
  useMealLibrary: () => ({ mealLibrary: loaded(bibliotek) }),
}));
vi.mock("@hooks/useRecipes", () => ({
  useRecipes: () => ({ recipes: loaded([]) }),
}));
const setDayToRecipeForWeek = vi.fn(async () => {});
vi.mock("@hooks/useMealsWriter", () => ({
  useMealsWriter: () => ({ setDayToRecipeForWeek }),
}));

const { ForsteutkastPanel } = await import("./ForsteutkastPanel");

describe("ForsteutkastPanel — planlagte middager i perioden", () => {
  it("foreslår ikke en middag som allerede står senere i perioden, og godkjenning fyller bare hullet", async () => {
    const onClose = vi.fn();
    render(<ForsteutkastPanel onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Generer forslag" }));
    fireEvent.click(screen.getByRole("button", { name: "Bruk denne planen" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(setDayToRecipeForWeek).toHaveBeenCalledTimes(1);
    expect(setDayToRecipeForWeek).toHaveBeenCalledWith(tir!.weekKey, tir!.dayKey, {
      name: "B",
      recipeId: null,
      mealLibraryId: "b",
    });
  });
});
