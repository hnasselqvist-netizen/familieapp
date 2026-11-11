/**
 * #20 6754247077 / review 5834974250: varer i en variant. Hooken kaster
 * `VariantvareIkkeLagret` når datalaget stoppet endringen, unntatt en rad som
 * allerede er fjernet. Selve stoppet er testet mot emulatoren
 * (mealLibrary.repository.integration.test.ts).
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VariantvareIkkeLagret } from "@domain/mealLibrary/mealLibrary";

const transactMealLibraryEntryMedUtfall = vi.hoisted(() => vi.fn());
vi.mock("@data/mealLibrary.repository", () => ({
  transactMealLibraryEntryMedUtfall,
  transactMealLibraryEntry: vi.fn(),
  createMealLibraryEntry: vi.fn(),
  removeMealLibraryEntry: vi.fn(),
  subscribeMealLibrary: () => () => {},
}));
vi.mock("@data/meals.repository", () => ({ backfillMealLibraryIdAcrossWeeks: vi.fn() }));
vi.mock("./useFamilyId", () => ({ useFamilyId: () => "familie1" }));

const { useMealLibrary } = await import("./useMealLibrary");

beforeEach(() => transactMealLibraryEntryMedUtfall.mockReset());

describe("useMealLibrary: varer i en variant", () => {
  it.each(["variantMangler", "kildeByttet", "tvetydigVariant", "middagMangler"] as const)(
    "tillegg stoppet med %s kastes som VariantvareIkkeLagret",
    async (utfall) => {
      transactMealLibraryEntryMedUtfall.mockResolvedValueOnce(utfall);
      const { result } = renderHook(() => useMealLibrary());
      const kall = result.current.addVariantShoppingBaseItem("m1", "v2", {
        itemId: "i",
        name: "N",
        cat: "K",
      });
      await expect(kall).rejects.toBeInstanceOf(VariantvareIkkeLagret);
      await expect(kall).rejects.toMatchObject({ utfall });
    },
  );

  it("fjerning av en rad som allerede er borte, er ikke en feil; tvetydig rad er det", async () => {
    const { result } = renderHook(() => useMealLibrary());
    transactMealLibraryEntryMedUtfall.mockResolvedValueOnce("radMangler");
    await act(() => result.current.removeVariantShoppingBaseItem("m1", "v2", "s1"));
    transactMealLibraryEntryMedUtfall.mockResolvedValueOnce("tvetydigRad");
    await expect(
      result.current.removeVariantShoppingBaseItem("m1", "v2", "s1"),
    ).rejects.toMatchObject({ utfall: "tvetydigRad" });
  });

  it("lagret endring (null) løser uten feil, med «middagMangler» som utfall for slettet middag", async () => {
    transactMealLibraryEntryMedUtfall.mockResolvedValueOnce(null);
    const { result } = renderHook(() => useMealLibrary());
    await act(() =>
      result.current.addVariantShoppingBaseItem("m1", "v2", { itemId: "i", name: "N", cat: "K" }),
    );
    expect(transactMealLibraryEntryMedUtfall).toHaveBeenCalledWith(
      "familie1",
      "m1",
      expect.any(Function),
      "middagMangler",
    );
  });
});
