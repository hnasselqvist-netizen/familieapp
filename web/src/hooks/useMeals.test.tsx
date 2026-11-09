/**
 * #20 6743172675: delvise endringer i middagsplanen ber datalaget bevare
 * råfelt, mens erstatning og tømming bevisst ikke gjør det. Selve
 * bevaringen er testet mot emulatoren (meals.repository.integration.test.ts).
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const transactMealDay = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@data/meals.repository", () => ({
  transactMealDay,
  subscribeWeekMeals: () => () => {},
}));
vi.mock("./useFamilyId", () => ({ useFamilyId: () => "familie1" }));

const { useMeals } = await import("./useMeals");

const valg = () => transactMealDay.mock.calls.at(-1)?.[4];

beforeEach(() => transactMealDay.mockClear());

describe("useMeals: hvem som bevarer råfelt", () => {
  it.each([
    [
      "addRecipeToDay",
      (h: ReturnType<typeof useMeals>) => h.addRecipeToDay("Fri", { id: "r1", name: "Taco" }),
    ],
    [
      "addLibraryMealToDay",
      (h: ReturnType<typeof useMeals>) => h.addLibraryMealToDay("Fri", { id: "b1", name: "Pizza" }),
    ],
    ["removeRecipeFromDay", (h: ReturnType<typeof useMeals>) => h.removeRecipeFromDay("Fri", 0)],
    [
      "setVariantForRecipe",
      (h: ReturnType<typeof useMeals>) => h.setVariantForRecipe("Fri", 0, "v1"),
    ],
  ])("%s (delvis endring) sender bevarRaafelt", async (_navn, kall) => {
    const { result } = renderHook(() => useMeals("2026-W46"));
    await act(() => kall(result.current));
    expect(valg()).toEqual({ bevarRaafelt: true });
  });

  it.each([
    [
      "setDayToRecipe",
      (h: ReturnType<typeof useMeals>) => h.setDayToRecipe("Fri", { name: "Taco", recipeId: "r1" }),
    ],
    ["setDayToText", (h: ReturnType<typeof useMeals>) => h.setDayToText("Fri", "Rester")],
    ["setDayToEvent", (h: ReturnType<typeof useMeals>) => h.setDayToEvent("Fri", { name: "Ute" })],
    ["clearDay", (h: ReturnType<typeof useMeals>) => h.clearDay("Fri")],
  ])("%s (erstatning/tømming) bevarer ikke gamle felt", async (_navn, kall) => {
    const { result } = renderHook(() => useMeals("2026-W46"));
    await act(() => kall(result.current));
    expect(valg()).toBeUndefined();
  });
});
