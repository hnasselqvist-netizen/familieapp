/**
 * Måltidsavvik/feedback-motoren — rene funksjoner, ingen React, ingen
 * Firebase. Utleder "faktisk historikk" og avledet tilstand
 * (pause/siste-feedback) fra `meals` (planen) + `mealFeedback` (avvik/
 * feedback-unntakene), i tråd med den låste livssyklusen
 * (§Kontrolltårn-handoff, Issue #2, kommentar 5585975593): en passert
 * dato regnes som at planen ble faktisk middag MED MINDRE et eksplisitt
 * avvik er registrert.
 *
 * Bevisst IKKE lagrede/denormaliserte felt her (`lastFeedback` på
 * Recipe/MealLibraryEntry ble eksplisitt avvist) — alt i denne filen er
 * avledet on-the-fly fra historikk kalleren allerede har hentet (samme
 * mønster som `forsteutkast.ts` sin `sisteGangPlanlagt`), aldri skrevet
 * tilbake noe sted.
 */
import { getDayDate } from "@domain/shared/weekKey";
import { getMealName } from "./meals";
import { DAYS } from "@app-types/meal";
import type { DayKey, MealValue, WeekMeals } from "@app-types/meal";
import type { MealFeedback, WeekMealFeedback } from "@app-types/mealFeedback";

/** Samme datahentings-vindu-form som `forsteutkast.ts` sin `HistoricalMeals` — se den for hvorfor dette ikke er en forslags-terskel. */
export type HistoricalMeals = Record<string, WeekMeals>;
export type HistoricalMealFeedback = Record<string, WeekMealFeedback>;

/**
 * "Faktisk" middag for én dag: et registrert avvik (`feedback.actual`)
 * hvis det finnes, ellers planen selv. Dette ER kjerneregelen —
 * normaltilfellet (ingen feedback-post) faller automatisk tilbake til
 * planen uten noen spesialsjekk hos kalleren.
 */
export function resolveActualMeal(
  planned: MealValue | null | undefined,
  feedback: MealFeedback | null | undefined,
): MealValue | null | undefined {
  if (feedback?.actual !== undefined) return feedback.actual;
  return planned;
}

/**
 * Bygger et "effektivt" historikk-uke-map der hver dag er den FAKTISKE
 * middagen (planen, med mindre et avvik overstyrer den) — grunnlaget alt
 * historikk-basert rangering/sortering (§forsteutkast.ts) skal bruke
 * fremover, ikke den rå planen.
 */
export function buildEffectiveHistory(
  allMeals: HistoricalMeals,
  allFeedback: HistoricalMealFeedback,
): HistoricalMeals {
  const result: HistoricalMeals = {};
  for (const [weekKey, week] of Object.entries(allMeals)) {
    const effectiveWeek: WeekMeals = {};
    for (const day of DAYS) {
      const actual = resolveActualMeal(week[day], allFeedback[weekKey]?.[day]);
      if (actual) effectiveWeek[day] = actual;
    }
    result[weekKey] = effectiveWeek;
  }
  return result;
}

/**
 * Utleder settet av middagsnavn (lowercase) som for øyeblikket er "satt
 * på pause" — skal ekskluderes fra AUTOMATISKE Førsteutkast-forslag
 * inntil brukeren eksplisitt gjenåpner dem. "Vedvarende, men
 * reversibelt": går gjennom all feedback i kronologisk
 * `recordedAt`-rekkefølge og lar siste eksplisitte `feedback.paused`-
 * verdi PER MIDDAGSNAVN vinne, slik at en senere `paused:false`
 * (eksplisitt gjenåpning) opphever en tidligere pause. Middagsnavnet en
 * pause gjelder er det FAKTISKE navnet den dagen (avvik overstyrer
 * planen, samme regel som `resolveActualMeal`).
 */
export function derivePausedMealNames(
  allMeals: HistoricalMeals,
  allFeedback: HistoricalMealFeedback,
): Set<string> {
  const entries: { mealName: string; paused: boolean; recordedAt: number }[] = [];
  for (const [weekKey, weekFeedback] of Object.entries(allFeedback)) {
    for (const day of DAYS) {
      const feedback = weekFeedback[day];
      if (!feedback || feedback.feedback?.paused === undefined) continue;
      const actual = resolveActualMeal(allMeals[weekKey]?.[day], feedback);
      const mealName = getMealName(actual);
      if (!mealName) continue;
      entries.push({
        mealName: mealName.toLowerCase(),
        paused: feedback.feedback.paused,
        recordedAt: feedback.recordedAt,
      });
    }
  }
  entries.sort((a, b) => a.recordedAt - b.recordedAt);

  const paused = new Set<string>();
  for (const entry of entries) {
    if (entry.paused) paused.add(entry.mealName);
    else paused.delete(entry.mealName);
  }
  return paused;
}

export interface LastFeedback {
  wantAgain?: boolean;
  paused?: boolean;
  comment?: string;
  at: number;
}

/**
 * Siste registrerte feedback for en gitt middag (navnematch, case-
 * insensitivt), nyeste `recordedAt` vinner. Brukt til å vise
 * "familieerfaring" (kommentar m.m.) neste gang middagen velges, FØR
 * shopping (§Kontrolltårn-handoff) — uten noen `lastFeedback`-
 * denormalisering, se filens toppkommentar.
 */
export function deriveLastFeedbackForMeal(
  mealName: string,
  allMeals: HistoricalMeals,
  allFeedback: HistoricalMealFeedback,
): LastFeedback | null {
  const navnLower = mealName.toLowerCase();
  let latest: LastFeedback | null = null;

  for (const [weekKey, weekFeedback] of Object.entries(allFeedback)) {
    for (const day of DAYS) {
      const feedback = weekFeedback[day];
      if (!feedback?.feedback) continue;
      const actual = resolveActualMeal(allMeals[weekKey]?.[day], feedback);
      if (getMealName(actual).toLowerCase() !== navnLower) continue;
      if (!latest || feedback.recordedAt > latest.at) {
        latest = { ...feedback.feedback, at: feedback.recordedAt };
      }
    }
  }
  return latest;
}

/**
 * Alle passerte dager (dato < `now`) i `allMeals` som verken har en
 * planlagt hendelse eller allerede en registrert feedback-post — brukt
 * til å vise "retrospektiv korrigering tilgjengelig"-affordansen i
 * Middagsplanen uten å måtte gjenta denne datosjekken flere steder.
 * Rent hjelpefunksjon for UI-laget, ingen skriving.
 */
export function isPastDay(weekKey: string, dayKey: DayKey, now: Date): boolean {
  const dayIndex = DAYS.indexOf(dayKey);
  const dato = getDayDate(weekKey, dayIndex);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  dato.setHours(0, 0, 0, 0);
  return dato.getTime() < today.getTime();
}
