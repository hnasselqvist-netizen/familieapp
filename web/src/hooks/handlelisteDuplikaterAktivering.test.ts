import { afterEach, describe, expect, it, vi } from "vitest";
import preview from "../../../.github/workflows/preview.yml?raw";
import production from "../../../.github/workflows/production.yml?raw";
import {
  HANDLELISTE_DUPLIKATER_I_PRODUKSJON,
  handlelisteDuplikaterAktiv,
} from "./handlelisteDuplikaterAktivering";

/**
 * Sammenslåing av handlelisteduplikater (Mat #20) er aktivert i produksjon
 * etter at legacy-vernet er på plass (ADR 0003 steg 6, #20 6507010011).
 * Disse testene låser at panelet vises i alle bygg, og at tilbakerulling
 * er én konstant.
 */
afterEach(() => vi.unstubAllEnvs());

describe("aktivering av handlelisteduplikater", () => {
  it("produksjonsflagget er på", () => {
    expect(HANDLELISTE_DUPLIKATER_I_PRODUKSJON).toBe(true);
  });

  it("på i produksjons- og preview-bygget, der emulatorflagget er «false» eller utelatt", () => {
    for (const verdi of ["false", "", "TRUE", "1", undefined]) {
      vi.stubEnv("VITE_FIREBASE_USE_EMULATOR", verdi as string);
      expect(handlelisteDuplikaterAktiv()).toBe(true);
    }
  });

  it("på mot emulatoren («true»)", () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATOR", "true");
    expect(handlelisteDuplikaterAktiv()).toBe(true);
  });

  it("production- og preview-bygget setter emulatorflagget til «false»", () => {
    for (const yml of [production, preview]) {
      expect(yml).toMatch(/VITE_FIREBASE_USE_EMULATOR: "false"/);
      expect(yml).not.toMatch(/VITE_FIREBASE_USE_EMULATOR: "true"/);
    }
  });
});
