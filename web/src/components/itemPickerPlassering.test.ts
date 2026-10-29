import { describe, expect, it } from "vitest";
import {
  INGEN_FORSKYVNING,
  KANTMARG,
  MINSTE_HOYDE,
  beregnPlassering,
  likPlassering,
  malForskyvning,
} from "./itemPickerPlassering";

const input = { top: 400, bottom: 432, left: 24, width: 300 };

describe("beregnPlassering", () => {
  it("uten tastatur: rett under inputen, med plassen ned til viewportens kant", () => {
    expect(beregnPlassering(input, INGEN_FORSKYVNING, { offsetTop: 0, height: 844 }, 844)).toEqual({
      top: 432,
      left: 24,
      width: 300,
      over: false,
      maxHeight: 844 - 432 - KANTMARG,
    });
  });

  it("uten visualViewport: bruker layout-høyden", () => {
    expect(beregnPlassering(input, INGEN_FORSKYVNING, null, 844).maxHeight).toBe(
      844 - 432 - KANTMARG,
    );
  });

  it("WebKit med panorert viewport: målt forskyvning legges til, så listen ankres til inputen", () => {
    // Målt rect er relativ til synlig viewport, som er panorert 300px ned.
    const p = beregnPlassering(input, { x: 0, y: 300 }, { offsetTop: 300, height: 600 }, 844);
    expect(p.over).toBe(false);
    expect(p.top).toBe(432 + 300);
    expect(p.left).toBe(24);
  });

  it("tastaturet dekker plassen under: listen legges over inputen", () => {
    // Synlig område i layoutkoordinater: 300–520. Inputen: 500–532.
    const p = beregnPlassering(
      { top: 200, bottom: 232, left: 24, width: 300 },
      { x: 0, y: 300 },
      { offsetTop: 300, height: 220 },
      844,
    );
    expect(p.over).toBe(true);
    expect(p.top).toBe(500);
    expect(p.maxHeight).toBe(500 - 300 - KANTMARG);
  });

  it("trangt både over og under: blir under med minstehøyde", () => {
    const p = beregnPlassering(
      { top: 10, bottom: 42, left: 0, width: 100 },
      INGEN_FORSKYVNING,
      { offsetTop: 0, height: 60 },
      60,
    );
    expect(p.over).toBe(false);
    expect(p.maxHeight).toBe(MINSTE_HOYDE);
  });
});

describe("malForskyvning", () => {
  it("er 0 når satt og målt posisjon er like", () => {
    const satt = beregnPlassering(input, INGEN_FORSKYVNING, null, 844);
    expect(malForskyvning(satt, { top: 432, bottom: 600, left: 24, width: 300 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("finner WebKit-avviket fra listens målte overkant", () => {
    const satt = beregnPlassering(input, INGEN_FORSKYVNING, null, 844);
    expect(malForskyvning(satt, { top: 132, bottom: 300, left: 24, width: 300 })).toEqual({
      x: 0,
      y: 300,
    });
  });

  it("bruker listens underkant som anker når listen ligger over", () => {
    const satt = { top: 500, left: 24, width: 300, over: true, maxHeight: 192 };
    expect(malForskyvning(satt, { top: 50, bottom: 200, left: 24, width: 300 })).toEqual({
      x: 0,
      y: 300,
    });
  });
});

describe("likPlassering", () => {
  it("tåler avrundingsstøy, men ikke endret retning", () => {
    const a = { top: 10, left: 0, width: 100, over: false, maxHeight: 200 };
    expect(likPlassering(a, { ...a, top: 10.2 })).toBe(true);
    expect(likPlassering(a, { ...a, over: true })).toBe(false);
    expect(likPlassering(null, null)).toBe(true);
    expect(likPlassering(a, null)).toBe(false);
  });
});
