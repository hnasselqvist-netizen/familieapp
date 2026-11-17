/** Nøkkelvakt før skriving i useStaples (#20, ordre 6651329875). */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fjernBasisvareVersjonert, merkBasisvareVersjonert } from "@data/staples.repository";
import { UgyldigBasisvarenavn } from "@domain/shopping/basisvare";
import { vurderBasisvareFjerning } from "@domain/shopping/basisvareFjerning";
import { vurderBasisvareMerking } from "@domain/shopping/basisvareMerking";
import { useStaples } from "./useStaples";

vi.mock("@data/staples.repository", () => ({
  merkBasisvareVersjonert: vi.fn().mockResolvedValue({ utfall: "merket" }),
  fjernBasisvareVersjonert: vi.fn(),
  subscribeStaples: vi.fn(() => () => undefined),
}));

describe("useStaples.markAsStaple", () => {
  it("gyldig navn går til den versjonsbetingede adapteren med normalisert nøkkel, og utfallet returneres", async () => {
    const { result } = renderHook(() => useStaples());
    expect(await result.current.markAsStaple("Hvetemel")).toEqual({ utfall: "merket" });
    expect(merkBasisvareVersjonert).toHaveBeenCalledWith(
      "familie1",
      "hvetemel",
      vurderBasisvareMerking,
    );
  });

  it("ugyldige navn avvises før skriving — aldri undernoder eller bredere sti", async () => {
    vi.mocked(merkBasisvareVersjonert).mockClear();
    const { result } = renderHook(() => useStaples());
    for (const navn of ["salt/pepper", "a.b", "#", "$x", "[x]", "", "  ", "a\nb"]) {
      await expect(result.current.markAsStaple(navn), navn).rejects.toBeInstanceOf(
        UgyldigBasisvarenavn,
      );
    }
    expect(merkBasisvareVersjonert).not.toHaveBeenCalled();
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
