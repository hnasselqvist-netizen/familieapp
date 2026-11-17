import { describe, expect, it } from "vitest";
import { vurderBasisvareMerking } from "./basisvareMerking";

describe("vurderBasisvareMerking (Mat #20, ordre 6953147250)", () => {
  it("opprett bare ved faktisk fravær", () => {
    expect(vurderBasisvareMerking(null)).toBe("opprett");
    expect(vurderBasisvareMerking(undefined)).toBe("opprett");
  });

  it("eksisterende `true`, også med prioritet, er allerede merket", () => {
    expect(vurderBasisvareMerking(true)).toBe("allerede");
    expect(vurderBasisvareMerking({ ".value": true, ".priority": 3 })).toBe("allerede");
  });

  it("alt annet er konflikt og overskrives aldri", () => {
    for (const v of [
      false,
      "true",
      1,
      {},
      { ukjent: "råfelt" },
      { ".value": false, ".priority": 1 },
      { ".value": true, ".priority": 1, x: 1 },
      [true],
    ]) {
      expect(vurderBasisvareMerking(v), JSON.stringify(v)).toBe("konflikt");
    }
  });
});
