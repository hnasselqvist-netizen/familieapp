/**
 * Planperiode-matte for Førsteutkast — portert 1:1 fra index.html
 * (`finnNesteTorsdag`/`beregnPlanperiode`/`beregnAktivPlanperiode`,
 * linje ~842–902). Rene funksjoner, ingen Firebase, ingen UI.
 *
 * Bekreftet UENDRET av Kontrolltårnet (Issue #2, kommentar 5584010648):
 * aktiv planperiode er fortsatt torsdag→torsdag (eller i inneværende
 * periode: dagens dato→nærmeste torsdag).
 */
import { getWeekKey } from "@domain/shared/weekKey";
import { DAYS } from "@app-types/meal";
import type { DayKey } from "@app-types/meal";

export interface PlanPeriodDay {
  dato: Date;
  weekKey: string;
  dayKey: DayKey;
}

const TORSDAG_IDX = 3;

export function dayKeyForDato(dato: Date): DayKey {
  const idx = (dato.getDay() + 6) % 7;
  const key = DAYS[idx];
  if (!key) throw new Error(`Ugyldig dagindeks: ${String(idx)}`);
  return key;
}

/**
 * Finner nærmeste FREMOVERRETTEDE torsdag fra en gitt dato. Er datoen
 * selv en torsdag, returneres den uendret (§index.html linje ~842–850).
 */
export function finnNesteTorsdag(fraDato: Date): Date {
  const d = new Date(fraDato);
  d.setHours(0, 0, 0, 0);
  const dagIdx = (d.getDay() + 6) % 7;
  const dagerTilTorsdag = (TORSDAG_IDX - dagIdx + 7) % 7;
  d.setDate(d.getDate() + dagerTilTorsdag);
  return d;
}

/**
 * Bygger de 8 datoene i en planperiode fra en gitt startdato (skal være
 * en torsdag) TIL OG MED neste torsdag — 8 middagsdager, ikke 7
 * (§index.html linje ~852–872).
 */
export function beregnPlanperiode(startDato: Date): PlanPeriodDay[] {
  const dager: PlanPeriodDay[] = [];
  for (let i = 0; i < 8; i++) {
    const dato = new Date(startDato);
    dato.setDate(startDato.getDate() + i);
    dager.push({ dato, weekKey: getWeekKey(dato), dayKey: dayKeyForDato(dato) });
  }
  return dager;
}

/**
 * DEN autoritative funksjonen for aktiv planperiode fra en gitt dato
 * (§index.html linje ~874–902). Er `fraDato` selv en torsdag, brukes
 * `beregnPlanperiode` uendret (8 dager). Ellers bygges perioden fra
 * `fraDato` til og med nærmeste kommende torsdag — INGEN dag mellom dem
 * hoppes over. Perioden kan derfor ha 2–8 dager avhengig av hvilken
 * ukedag runden startes på.
 */
export function beregnAktivPlanperiode(fraDato: Date): PlanPeriodDay[] {
  const start = new Date(fraDato);
  start.setHours(0, 0, 0, 0);
  const erTorsdag = (start.getDay() + 6) % 7 === TORSDAG_IDX;
  if (erTorsdag) return beregnPlanperiode(start);

  const sluttdato = finnNesteTorsdag(start);
  const antallDager = Math.round((sluttdato.getTime() - start.getTime()) / 86400000) + 1;
  const dager: PlanPeriodDay[] = [];
  for (let i = 0; i < antallDager; i++) {
    const dato = new Date(start);
    dato.setDate(start.getDate() + i);
    dager.push({ dato, weekKey: getWeekKey(dato), dayKey: dayKeyForDato(dato) });
  }
  return dager;
}

/**
 * Bygger planperioden fra `fraDato` TIL OG MED `tilDato` — den valgte
 * sluttdatoen er autoritativ, ikke en beregnet torsdag (Middagsplan v1,
 * §Kontrolltårn-handoff, Issue #20, "Byggehandoff — Middagsplan v1":
 * "Oppdater periodematematikken slik at den valgte sluttdatoen er
 * autoritativ i denne flyten fremfor å gjøre tors→tors til
 * produktbegrensning"). `beregnAktivPlanperiode`/`beregnPlanperiode`/
 * `finnNesteTorsdag` over er bevisst UENDRET — de er fortsatt korrekte,
 * karakteriserte funksjoner, bare ikke lenger `ForsteutkastPanel` sin
 * eneste kilde til periodens sluttpunkt.
 *
 * `tilDato` før `fraDato` gir en periode på nøyaktig 1 dag (kun
 * `fraDato` selv) — samme grasiøse bunngrense som å ikke la et
 * brukervalgt sluttpunkt produsere en tom eller negativ periode.
 */
export function beregnPlanperiodeTilDato(fraDato: Date, tilDato: Date): PlanPeriodDay[] {
  const start = new Date(fraDato);
  start.setHours(0, 0, 0, 0);
  const slutt = new Date(tilDato);
  slutt.setHours(0, 0, 0, 0);
  const antallDager = Math.max(1, Math.round((slutt.getTime() - start.getTime()) / 86400000) + 1);
  const dager: PlanPeriodDay[] = [];
  for (let i = 0; i < antallDager; i++) {
    const dato = new Date(start);
    dato.setDate(start.getDate() + i);
    dager.push({ dato, weekKey: getWeekKey(dato), dayKey: dayKeyForDato(dato) });
  }
  return dager;
}
