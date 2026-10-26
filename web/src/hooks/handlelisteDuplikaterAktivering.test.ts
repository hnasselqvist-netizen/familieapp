import { afterEach, describe, expect, it, vi } from "vitest";
import preview from "../../../.github/workflows/preview.yml?raw";
import production from "../../../.github/workflows/production.yml?raw";
import {
  HANDLELISTE_DUPLIKATER_I_PRODUKSJON,
  handlelisteDuplikaterAktiv,
} from "./handlelisteDuplikaterAktivering";

/**
 * Sammenslåing av handlelisteduplikater (Mat #20) er utilgjengelig i
 * produksjon og preview til legacy-vernet er reviewet (#77, review
 * 6355066911). Disse testene låser at panelet bare vises mot emulatoren.
 */
afterEach(() => vi.unstubAllEnvs());

describe("aktivering av handlelisteduplikater", () => {
  it("produksjonsflagget er av", () => {
    expect(HANDLELISTE_DUPLIKATER_I_PRODUKSJON).toBe(false);
  });

  it("av når emulatorflagget er «false», utelatt eller noe annet enn «true»", () => {
    for (const verdi of ["false", "", "TRUE", "1", undefined]) {
      vi.stubEnv("VITE_FIREBASE_USE_EMULATOR", verdi as string);
      expect(handlelisteDuplikaterAktiv()).toBe(false);
    }
  });

  it("på bare mot emulatoren («true»)", () => {
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
