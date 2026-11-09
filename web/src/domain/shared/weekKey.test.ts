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

/**
 * #27 6738886786 (oppskrift til middagsplan via ChatGPT): 2026 har uke 53,
 * og nyttår 2026/2027 faller i den. Tabellen i
 * docs/drift/oppskrift-til-middagsplan.md §1 er låst her.
 */
describe("uke 53 og nyttår 2026/2027", () => {
  it.each([
    [new Date(2025, 11, 29), "2026-W01"],
    [new Date(2026, 11, 27), "2026-W52"],
    [new Date(2026, 11, 28), "2026-W53"],
    [new Date(2027, 0, 1), "2026-W53"],
    [new Date(2027, 0, 3), "2026-W53"],
    [new Date(2027, 0, 4), "2027-W01"],
  ])("%s → %s", (dato, uke) => {
    expect(getWeekKey(dato)).toBe(uke);
  });

  it("addWeeks og getDayDate går gjennom uke 53", () => {
    expect(addWeeks("2026-W52", 1)).toBe("2026-W53");
    expect(addWeeks("2026-W53", 1)).toBe("2027-W01");
    // Fredag (indeks 4) i uke 53 er 1. januar 2027.
    expect(getDayDate("2026-W53", 4)).toEqual(new Date(2027, 0, 1));
  });
});
