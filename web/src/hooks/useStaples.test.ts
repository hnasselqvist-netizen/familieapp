/** Nøkkelvakt før skriving i useStaples (#20, ordre 6651329875). */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fjernBasisvareVersjonert, markItemAsStaple } from "@data/staples.repository";
import { UgyldigBasisvarenavn } from "@domain/shopping/basisvare";
import { vurderBasisvareFjerning } from "@domain/shopping/basisvareFjerning";
import { useStaples } from "./useStaples";

vi.mock("@data/staples.repository", () => ({
  markItemAsStaple: vi.fn().mockResolvedValue(undefined),
  fjernBasisvareVersjonert: vi.fn(),
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

describe("useStaples.fjernBasisvare (Mat #20, ordre 6948538722)", () => {
  it("eksakt lagret nøkkel går til den versjonsbetingede adapteren, uten normalisering", async () => {
    vi.mocked(fjernBasisvareVersjonert).mockResolvedValueOnce({ utfall: "fjernet" });
    const { result } = renderHook(() => useStaples());
    expect(await result.current.fjernBasisvare("Crème Fraîche")).toEqual({ utfall: "fjernet" });
    expect(fjernBasisvareVersjonert).toHaveBeenCalledWith(
      "familie1",
      "Crème Fraîche",
      vurderBasisvareFjerning,
    );
  });

  it("en nøkkel som ikke er én gyldig RTDB-nøkkel gir `ugyldig` uten skriving", async () => {
    vi.mocked(fjernBasisvareVersjonert).mockClear();
    const { result } = renderHook(() => useStaples());
    for (const k of ["salt/pepper", "a.b", "#", "", " ", "a\nb", "x".repeat(769)]) {
      expect(await result.current.fjernBasisvare(k), k).toEqual({ utfall: "ugyldig" });
    }
    expect(fjernBasisvareVersjonert).not.toHaveBeenCalled();
  });
});
