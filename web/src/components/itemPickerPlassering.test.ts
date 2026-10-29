import { describe, expect, it } from "vitest";
import {
  INGEN_FORSKYVNING,
  KANTMARG,
  MINSTE_PLASS,
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
      vis: true,
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

  it("trangt både over og under: høyden overstiger aldri den synlige plassen", () => {
    // Synlig 0–90, input 10–42: 40px under, 2px over. Før: tvunget til 96px.
    const p = beregnPlassering(
      { top: 10, bottom: 42, left: 0, width: 100 },
      INGEN_FORSKYVNING,
      { offsetTop: 0, height: 90 },
      90,
    );
    expect(p).toMatchObject({ over: false, vis: true, maxHeight: 90 - 42 - KANTMARG });
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(90 - KANTMARG);
  });

  it("ingen plass til én rad på noen side: listen vises ikke", () => {
    const p = beregnPlassering(
      { top: 10, bottom: 42, left: 0, width: 100 },
      INGEN_FORSKYVNING,
      { offsetTop: 0, height: 60 },
      60,
    );
    expect(p).toMatchObject({ vis: false, maxHeight: 0 });
  });

  it("negativ plass (input delvis under synlig kant) gir aldri negativ høyde", () => {
    // Synlig 0–420, input 400–432: stikker ut under. Over: 392px.
    const p = beregnPlassering(input, INGEN_FORSKYVNING, { offsetTop: 0, height: 420 }, 844);
    expect(p).toMatchObject({ over: true, vis: true, top: 400, maxHeight: 400 - KANTMARG });
  });

  it.each([
    ["over det synlige området", { offsetTop: 500, height: 300 }],
    ["under det synlige området (bak tastaturet)", { offsetTop: 0, height: 380 }],
  ])("input %s: listen vises ikke", (_navn, synlig) => {
    expect(beregnPlassering(input, INGEN_FORSKYVNING, synlig, 844)).toMatchObject({
      vis: false,
      maxHeight: 0,
    });
  });

  it("når listen vises, ligger hele listen innenfor det synlige området", () => {
    const synlig = { offsetTop: 300, height: 260 }; // 300–560
    for (let topp = 300; topp <= 528; topp += 4) {
      const p = beregnPlassering(
        { top: topp, bottom: topp + 32, left: 0, width: 100 },
        INGEN_FORSKYVNING,
        synlig,
        844,
      );
      if (!p.vis) continue;
      expect(p.maxHeight).toBeGreaterThanOrEqual(MINSTE_PLASS);
      if (p.over) {
        expect(p.top).toBe(topp);
        expect(p.top - p.maxHeight).toBeGreaterThanOrEqual(300 + KANTMARG);
      } else {
        expect(p.top).toBe(topp + 32);
        expect(p.top + p.maxHeight).toBeLessThanOrEqual(560 - KANTMARG);
      }
    }
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
    const satt = { top: 500, left: 24, width: 300, over: true, maxHeight: 192, vis: true };
    expect(malForskyvning(satt, { top: 50, bottom: 200, left: 24, width: 300 })).toEqual({
      x: 0,
      y: 300,
    });
  });
});

describe("likPlassering", () => {
  it("tåler avrundingsstøy, men ikke endret retning", () => {
    const a = { top: 10, left: 0, width: 100, over: false, maxHeight: 200, vis: true };
    expect(likPlassering(a, { ...a, top: 10.2 })).toBe(true);
    expect(likPlassering(a, { ...a, over: true })).toBe(false);
    expect(likPlassering(a, { ...a, vis: false })).toBe(false);
    expect(likPlassering(null, null)).toBe(true);
    expect(likPlassering(a, null)).toBe(false);
  });
});
