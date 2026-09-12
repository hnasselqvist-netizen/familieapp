import { describe, expect, it } from "vitest";
import { DEFAULT_MEAL_EVENTS } from "./mealEventDefaults";

/**
 * Karakteriseringstest for den låste 3-hendelsesmodellen (§Helen-review,
 * PR #26, design-review runde 3, §8) — beviser at listen faktisk er
 * hendelsesmodellen fasiten beskriver, ikke bare at den har tre elementer.
 */
describe("DEFAULT_MEAL_EVENTS — den låste 3-hendelsesmodellen", () => {
  it("inneholder nøyaktig de tre låste hendelsene, i låst rekkefølge", () => {
    expect(DEFAULT_MEAL_EVENTS).toEqual([
      { name: "Spiser et annet sted", emoji: "🍽️", allowsDetail: true },
      { name: "Rester", emoji: "♻️" },
      { name: "Take-away", emoji: "🥡" },
    ]);
  });

  it('kun "Spiser et annet sted" tilbyr et valgfritt detaljfelt', () => {
    const medDetalj = DEFAULT_MEAL_EVENTS.filter((ev) => ev.allowsDetail);
    expect(medDetalj.map((ev) => ev.name)).toEqual(["Spiser et annet sted"]);
  });

  it("de fjernede mellomtilstandshendelsene finnes ikke lenger", () => {
    const navn = DEFAULT_MEAL_EVENTS.map((ev) => ev.name);
    expect(navn).not.toContain("Middag hos svigermor");
    expect(navn).not.toContain("Middag hos foreldrene");
    expect(navn).not.toContain("Enkel middag");
    expect(navn).not.toContain("Spiser ute");
    expect(navn).not.toContain("Hytta");
    expect(navn).not.toContain("Ingen middag hjemme");
    expect(navn).not.toContain("Annet");
    expect(navn).not.toContain("Grandiosa");
  });
});
