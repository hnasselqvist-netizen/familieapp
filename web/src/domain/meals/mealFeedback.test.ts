import { describe, expect, it } from "vitest";
import {
  buildEffectiveHistory,
  deriveLastFeedbackForMeal,
  derivePausedMealNames,
  isPastDay,
  resolveActualMeal,
} from "./mealFeedback";
import type { WeekMeals } from "@app-types/meal";
import type { WeekMealFeedback } from "@app-types/mealFeedback";

// "2026-09-07" er en mandag (samme referansepunkt som §weekKey.test.ts/§planningPeriod.test.ts).
const WK1 = "2026-W37"; // man 7. - søn 13. sep 2026
const WK2 = "2026-W38"; // man 14. - søn 20. sep 2026

describe("resolveActualMeal", () => {
  it("returnerer planen når det ikke finnes noen feedback-post i det hele tatt", () => {
    expect(resolveActualMeal("Taco", undefined)).toBe("Taco");
  });

  it("returnerer planen når feedback-posten finnes, men ikke registrerer noe avvik (kun feedback)", () => {
    expect(resolveActualMeal("Taco", { feedback: { wantAgain: true }, recordedAt: 1 })).toBe(
      "Taco",
    );
  });

  it("returnerer det registrerte avviket når `actual` er satt, uansett hva planen var", () => {
    expect(
      resolveActualMeal("Taco", {
        actual: { type: "recipe", name: "Pizza", recipeId: null },
        recordedAt: 1,
      }),
    ).toEqual({ type: "recipe", name: "Pizza", recipeId: null });
  });
});

describe("buildEffectiveHistory", () => {
  it("bruker planen uendret for dager uten feedback-post", () => {
    const allMeals: Record<string, WeekMeals> = { [WK1]: { Mon: "Taco", Tue: "Suppe" } };
    const result = buildEffectiveHistory(allMeals, {});
    expect(result[WK1]).toEqual({ Mon: "Taco", Tue: "Suppe" });
  });

  it("lar et registrert avvik overstyre planen for akkurat den dagen", () => {
    const allMeals: Record<string, WeekMeals> = { [WK1]: { Mon: "Taco", Tue: "Suppe" } };
    const allFeedback: Record<string, WeekMealFeedback> = {
      [WK1]: { Mon: { actual: "Pizza", recordedAt: 1 } },
    };
    const result = buildEffectiveHistory(allMeals, allFeedback);
    expect(result[WK1]).toEqual({ Mon: "Pizza", Tue: "Suppe" });
  });

  it("dager uten plan og uten avvik er fraværende, ikke tomme", () => {
    const result = buildEffectiveHistory({ [WK1]: {} }, {});
    expect(result[WK1]).toEqual({});
    expect(Object.keys(result[WK1] ?? {})).not.toContain("Mon");
  });
});

describe("derivePausedMealNames", () => {
  it("inkluderer en middag som er merket 'Sett på pause' og ikke senere gjenåpnet", () => {
    const allFeedback: Record<string, WeekMealFeedback> = {
      [WK1]: { Mon: { feedback: { paused: true }, recordedAt: 100 } },
    };
    const allMeals: Record<string, WeekMeals> = { [WK1]: { Mon: "Fiskesuppe" } };
    expect(derivePausedMealNames(allMeals, allFeedback)).toEqual(new Set(["fiskesuppe"]));
  });

  it("en SENERE eksplisitt paused:false gjenåpner middagen igjen", () => {
    const allMeals: Record<string, WeekMeals> = { [WK1]: { Mon: "Taco" }, [WK2]: { Mon: "Taco" } };
    const allFeedback: Record<string, WeekMealFeedback> = {
      [WK1]: { Mon: { feedback: { paused: true }, recordedAt: 100 } },
      [WK2]: { Mon: { feedback: { paused: false }, recordedAt: 200 } },
    };
    expect(derivePausedMealNames(allMeals, allFeedback).has("taco")).toBe(false);
  });

  it("rekkefølgen i input-objektet spiller ingen rolle — sortering skjer på recordedAt", () => {
    const allMeals: Record<string, WeekMeals> = { [WK1]: { Mon: "Taco" }, [WK2]: { Mon: "Taco" } };
    // Den NYESTE (recordedAt 200, paused:false) er satt inn FØR den eldste i objektet.
    const allFeedback: Record<string, WeekMealFeedback> = {
      [WK2]: { Mon: { feedback: { paused: false }, recordedAt: 200 } },
      [WK1]: { Mon: { feedback: { paused: true }, recordedAt: 100 } },
    };
    expect(derivePausedMealNames(allMeals, allFeedback).has("taco")).toBe(false);
  });

  it("pause gjelder det FAKTISKE (avvik-overstyrte) navnet, ikke det opprinnelig planlagte", () => {
    const allMeals: Record<string, WeekMeals> = { [WK1]: { Mon: "Taco" } };
    const allFeedback: Record<string, WeekMealFeedback> = {
      [WK1]: {
        Mon: {
          actual: { type: "recipe", name: "Pizza", recipeId: null },
          feedback: { paused: true },
          recordedAt: 100,
        },
      },
    };
    const paused = derivePausedMealNames(allMeals, allFeedback);
    expect(paused.has("pizza")).toBe(true);
    expect(paused.has("taco")).toBe(false);
  });

  it("feedback-poster uten en eksplisitt `paused`-verdi påvirker ikke pause-settet", () => {
    const allMeals: Record<string, WeekMeals> = { [WK1]: { Mon: "Taco" } };
    const allFeedback: Record<string, WeekMealFeedback> = {
      [WK1]: { Mon: { feedback: { comment: "God, men ikke satt på pause" }, recordedAt: 100 } },
    };
    expect(derivePausedMealNames(allMeals, allFeedback).size).toBe(0);
  });
});

describe("deriveLastFeedbackForMeal", () => {
  it("returnerer null når ingen feedback-post matcher middagsnavnet", () => {
    expect(deriveLastFeedbackForMeal("Taco", {}, {})).toBeNull();
  });

  it("finner siste feedback for middagen, case-insensitivt navnematch", () => {
    const allMeals: Record<string, WeekMeals> = { [WK1]: { Mon: "taco" } };
    const allFeedback: Record<string, WeekMealFeedback> = {
      [WK1]: { Mon: { feedback: { comment: "Bra!" }, recordedAt: 100 } },
    };
    expect(deriveLastFeedbackForMeal("Taco", allMeals, allFeedback)).toEqual({
      comment: "Bra!",
      at: 100,
    });
  });

  it("velger den NYESTE av flere matchende feedback-poster på tvers av uker", () => {
    const allMeals: Record<string, WeekMeals> = { [WK1]: { Mon: "Taco" }, [WK2]: { Tue: "Taco" } };
    const allFeedback: Record<string, WeekMealFeedback> = {
      [WK1]: { Mon: { feedback: { comment: "Gammel kommentar" }, recordedAt: 100 } },
      [WK2]: { Tue: { feedback: { comment: "Ny kommentar" }, recordedAt: 200 } },
    };
    expect(deriveLastFeedbackForMeal("Taco", allMeals, allFeedback)?.comment).toBe("Ny kommentar");
  });

  it("matcher mot det FAKTISKE (avvik-overstyrte) navnet, ikke planen", () => {
    const allMeals: Record<string, WeekMeals> = { [WK1]: { Mon: "Taco" } };
    const allFeedback: Record<string, WeekMealFeedback> = {
      [WK1]: {
        Mon: {
          actual: { type: "recipe", name: "Pizza", recipeId: null },
          feedback: { comment: "Ble pizza i stedet" },
          recordedAt: 100,
        },
      },
    };
    expect(deriveLastFeedbackForMeal("Pizza", allMeals, allFeedback)?.comment).toBe(
      "Ble pizza i stedet",
    );
    expect(deriveLastFeedbackForMeal("Taco", allMeals, allFeedback)).toBeNull();
  });
});

describe("isPastDay", () => {
  it("en dag tidligere i inneværende uke enn 'nå' er passert", () => {
    const now = new Date(2026, 8, 10); // torsdag
    expect(isPastDay(WK1, "Mon", now)).toBe(true);
  });

  it("dagens dato selv er IKKE passert", () => {
    const now = new Date(2026, 8, 10); // torsdag
    expect(isPastDay(WK1, "Thu", now)).toBe(false);
  });

  it("en fremtidig dag er ikke passert", () => {
    const now = new Date(2026, 8, 10); // torsdag
    expect(isPastDay(WK1, "Fri", now)).toBe(false);
    expect(isPastDay(WK2, "Mon", now)).toBe(false);
  });
});
