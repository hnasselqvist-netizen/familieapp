/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * `getWeekKey`/`addWeeks` (index.html linje ~773–786) slik den er lest og
 * verifisert manuelt mot koden FØR noe ble flyttet.
 */
import { describe, expect, it } from "vitest";
import { addWeeks, getDayDate, getWeekKey } from "./weekKey";

describe("getWeekKey", () => {
  it("gir korrekt ISO-ukenøkkel for en mandag", () => {
    expect(getWeekKey(new Date(2026, 8, 7))).toBe("2026-W37");
  });

  it("gir samme ukenøkkel for alle dager i samme uke (mandag til søndag)", () => {
    const monday = getWeekKey(new Date(2026, 8, 7));
    const sunday = getWeekKey(new Date(2026, 8, 13));
    expect(sunday).toBe(monday);
  });

  it("håndterer årsskifte korrekt (uke 1 kan starte i desember)", () => {
    // 2025-01-01 er en onsdag — tilhører 2025 sin uke 1.
    expect(getWeekKey(new Date(2025, 0, 1))).toBe("2025-W01");
  });
});

describe("addWeeks", () => {
  it("legger til én uke", () => {
    expect(addWeeks("2026-W37", 1)).toBe("2026-W38");
  });

  it("går bakover med negativt tall", () => {
    expect(addWeeks("2026-W37", -1)).toBe("2026-W36");
  });

  it("håndterer årsskifte", () => {
    expect(addWeeks("2025-W52", 1)).toBe("2026-W01");
  });
});

describe("getDayDate", () => {
  it("gir mandagens dato for indeks 0", () => {
    expect(getDayDate("2026-W37", 0)).toEqual(new Date(2026, 8, 7));
  });

  it("gir søndagens dato for indeks 6", () => {
    expect(getDayDate("2026-W37", 6)).toEqual(new Date(2026, 8, 13));
  });
});
