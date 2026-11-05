/** Nøkkelvakt før skriving i useStaples (#20, ordre 6651329875). */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { markItemAsStaple } from "@data/staples.repository";
import { UgyldigBasisvarenavn } from "@domain/shopping/basisvare";
import { useStaples } from "./useStaples";

vi.mock("@data/staples.repository", () => ({
  markItemAsStaple: vi.fn().mockResolvedValue(undefined),
  removeStaple: vi.fn(),
  subscribeStaples: vi.fn(() => () => undefined),
}));

describe("useStaples.markAsStaple", () => {
  it("gyldig navn går til den familiebundne adapteren uendret", async () => {
    const { result } = renderHook(() => useStaples());
    await result.current.markAsStaple("Hvetemel");
    expect(markItemAsStaple).toHaveBeenCalledWith("familie1", "Hvetemel");
  });

  it("ugyldige navn avvises før skriving — aldri undernoder eller bredere sti", async () => {
    vi.mocked(markItemAsStaple).mockClear();
    const { result } = renderHook(() => useStaples());
    for (const navn of ["salt/pepper", "a.b", "#", "$x", "[x]", "", "  ", "a\nb"]) {
      await expect(result.current.markAsStaple(navn), navn).rejects.toBeInstanceOf(
        UgyldigBasisvarenavn,
      );
    }
    expect(markItemAsStaple).not.toHaveBeenCalled();
  });
});
