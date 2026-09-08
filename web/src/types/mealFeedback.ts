/**
 * Ny datamodell — INGEN legacy-forankring i `index.html` (dagens
 * `BekreftMiddag`/`events/{ts}_confirm`-mekanikk er eksplisitt IKKE
 * målmodellen, §Kontrolltårn-handoff Issue #2, kommentar 5584753823/
 * 5585975593). Lever på `families/{familyId}/mealFeedback/{weekKey}/{day}`
 * — en egen, sparsom samling adskilt fra `meals/{weekKey}/{day}` (planen),
 * IKKE en endring av den låste `MealValue`-unionen.
 *
 * Kjerneprinsipp: en passert dato regnes som at PLANEN ble faktisk middag,
 * med mindre denne posten finnes. Fraværende post = "ble som planlagt",
 * ingen skriving i normaltilfellet. `actual` settes KUN ved avvik, og
 * gjenbruker eksisterende `MealValue` (inkl. `type:"menu"` for flere
 * retter). `feedback` er valgfri, kan settes uavhengig av om det var et
 * avvik. Hele posten er slettbar/nullstillbar for å falle tilbake til
 * normalregelen «plan = faktisk».
 */
import type { MealValue, DayKey } from "./meal";

export interface MealFeedback {
  /** Kun satt ved avvik fra planen. Fravær = "ble som planlagt". */
  actual?: MealValue;
  feedback?: {
    /** "Ønskes igjen" */
    wantAgain?: boolean;
    /**
     * "Sett på pause" — vedvarende, men reversibelt: ekskluderer middagen
     * fra automatiske Førsteutkast-forslag inntil et SENERE, nyere
     * registrert `paused:false` eksplisitt gjenåpner den
     * (§domain/meals/mealFeedback.ts sin `derivePausedMealNames`).
     */
    paused?: boolean;
    /** Vises neste gang middagen velges, før shopping (§ForsteutkastPanel). */
    comment?: string;
  };
  /** Støtter retrospektiv korrigering — siste skriving vinner, ingen historikk-logg. */
  recordedAt: number;
}

export type WeekMealFeedback = Partial<Record<DayKey, MealFeedback>>;
