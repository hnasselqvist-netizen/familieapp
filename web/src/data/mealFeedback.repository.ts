/**
 * Datalag for måltidsavvik/feedback (`families/{familyId}/mealFeedback/{weekKey}/{day}`)
 * — se `@app-types/mealFeedback` sin toppkommentar for datamodellen og
 * §Kontrolltårn-handoff (Issue #2, kommentar 5585975593) for
 * produktretningen. Egen samling, adskilt fra `meals/{weekKey}/{day}`
 * (planen) — rører ALDRI planen selv.
 *
 * Skrivemønster: ren `set()`/`remove()` på ÉN DAG sin egen node, IKKE en
 * `runTransaction`. Dette er et bevisst valg, ikke en forglemmelse: hele
 * posten er «siste skriving vinner, ingen historikk-logg» (§types sin
 * toppkommentar) — retrospektiv korrigering betyr nettopp å overskrive
 * hele posten med en helt ny, selvstendig verdi. Det finnes derfor ingen
 * meningsfull "les-endre-skriv basert på forrige verdi"-operasjon å
 * beskytte, ulikt `transactMealDay`/`transactRecipe`.
 */
import { onValue, ref, remove, set } from "firebase/database";
import { getFirebaseDatabase } from "./firebase";
import { parseMealValue } from "./meals.repository";
import type { FamilyId } from "@app-types/family";
import type { DayKey } from "@app-types/meal";
import type { MealFeedback, WeekMealFeedback } from "@app-types/mealFeedback";

function weekFeedbackPath(familyId: FamilyId, weekKey: string): string {
  return `families/${familyId}/mealFeedback/${weekKey}`;
}

function dayFeedbackPath(familyId: FamilyId, weekKey: string, day: DayKey): string {
  return `${weekFeedbackPath(familyId, weekKey)}/${day}`;
}

/** Normaliserer én dags feedback-post slik den faktisk kommer tilbake fra Firebase. */
function parseMealFeedback(raw: Record<string, unknown>): MealFeedback {
  const rawFeedback = raw.feedback as Record<string, unknown> | undefined;
  return {
    ...(raw.actual !== undefined ? { actual: parseMealValue(raw.actual) ?? undefined } : {}),
    ...(rawFeedback !== undefined
      ? {
          feedback: {
            ...(rawFeedback.wantAgain !== undefined
              ? { wantAgain: rawFeedback.wantAgain as boolean }
              : {}),
            ...(rawFeedback.paused !== undefined ? { paused: rawFeedback.paused as boolean } : {}),
            ...(rawFeedback.comment !== undefined
              ? { comment: rawFeedback.comment as string }
              : {}),
          },
        }
      : {}),
    recordedAt: raw.recordedAt as number,
  };
}

/** Abonnerer på én ukes feedback-poster. Dager uten registrert avvik/feedback er fraværende nøkler. */
export function subscribeWeekMealFeedback(
  familyId: FamilyId,
  weekKey: string,
  onChange: (feedback: WeekMealFeedback) => void,
): () => void {
  const weekRef = ref(getFirebaseDatabase(), weekFeedbackPath(familyId, weekKey));
  const unsubscribe = onValue(weekRef, (snapshot) => {
    if (!snapshot.exists()) {
      onChange({});
      return;
    }
    const value = snapshot.val() as Record<string, Record<string, unknown>>;
    const result: WeekMealFeedback = {};
    for (const [day, raw] of Object.entries(value)) {
      result[day as DayKey] = parseMealFeedback(raw);
    }
    onChange(result);
  });
  return unsubscribe;
}

/**
 * Skriver (overskriver helt) én dags feedback-post — brukes både for
 * første registrering og retrospektiv korrigering (samme kall, samme
 * betydning: "dette er nå sannheten for denne dagen").
 */
export async function setMealFeedback(
  familyId: FamilyId,
  weekKey: string,
  day: DayKey,
  feedback: MealFeedback,
): Promise<void> {
  await set(ref(getFirebaseDatabase(), dayFeedbackPath(familyId, weekKey, day)), feedback);
}

/** Nullstiller én dags feedback-post — dagen faller tilbake til normalregelen «plan = faktisk». */
export async function deleteMealFeedback(
  familyId: FamilyId,
  weekKey: string,
  day: DayKey,
): Promise<void> {
  await remove(ref(getFirebaseDatabase(), dayFeedbackPath(familyId, weekKey, day)));
}
