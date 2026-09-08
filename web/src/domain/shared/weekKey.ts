/**
 * Ukenøkkel-beregning — rene funksjoner, ingen React, ingen Firebase.
 *
 * Portert 1:1 fra index.html sin `getWeekKey`/`getMondayOfWeek`/`addWeeks`
 * (linje ~773–786): standard ISO-8601-ukenummerering, mandag som første
 * dag. `weekKey`-formatet ("2026-W37") er allerede den ugjennomsiktige
 * strengen `WeekMeals`/`meals.repository.ts` forventer (§types/meal.ts).
 */

/** Speiler `getWeekKey` (linje ~773–779). */
export function getWeekKey(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNumber =
    1 +
    Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

/** Speiler `getMondayOfWeek` (linje ~780–784). */
function getMondayOfWeek(weekKey: string): Date {
  const [year, week] = weekKey.split("-W").map(Number) as [number, number];
  const jan4 = new Date(year, 0, 4);
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7) + (week - 1) * 7);
  return monday;
}

/** Speiler `addWeeks` (linje ~786). */
export function addWeeks(weekKey: string, n: number): string {
  const monday = getMondayOfWeek(weekKey);
  monday.setDate(monday.getDate() + n * 7);
  return getWeekKey(monday);
}

/** Speiler `getDayDate` (linje ~785) — `dayIndex` er 0=mandag..6=søndag. */
export function getDayDate(weekKey: string, dayIndex: number): Date {
  const monday = getMondayOfWeek(weekKey);
  const d = new Date(monday);
  d.setDate(monday.getDate() + dayIndex);
  return d;
}
