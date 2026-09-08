/**
 * Førsteutkast — deterministisk forslagsmotor for Middagsplan. IKKE en
 * 1:1-port av index.html sin `sorterBibliotekEtterHistorikk`/
 * `genererForsteutkast` (linje ~801–936) — ny rangeringsalgoritme per
 * eksplisitt produktretning fra Kontrolltårnet (Issue #2, kommentar
 * 5584010648 og 5584753823):
 *
 *  - Deterministisk, ingen `Math.random` noe sted.
 *  - Eksisterende planer/hendelser beskyttes ALDRI overskrevet —
 *    funksjonen skriver ingenting selv, den returnerer kun forslag
 *    kalleren eksplisitt kan bruke (samme prinsipp som legacy).
 *  - Historikk brukes som MYK vekting for å unngå/nedvekte nylig spiste
 *    middager — INGEN hard terskel ("8 uker" ble eksplisitt avvist).
 *  - Forslag optimaliseres for VARIASJON (unngå at like middager
 *    klumper seg på påfølgende dager), ikke alfabetisk/eldst-sist-
 *    listing slik `sorterBibliotekEtterHistorikk` gjorde.
 *  - "Lettvint"-dager (pre-planleggingsinput, IKKE en hendelse) filtrerer
 *    kandidatpoolen til kun `lettvint:true`-merkede biblioteksmiddager,
 *    med grasiøs degradering til hele biblioteket dersom ingen
 *    kvalifiserte finnes.
 *  - Similaritet i v1 er enkel delt-tag-overlapp mellom `variationTags`
 *    (§types/shopping.ts, §types/recipe.ts) — bevisst IKKE fritekst
 *    `tags`, som kan brukes som FALLBACK der `variationTags` mangler.
 */
import { getDayDate } from "@domain/shared/weekKey";
import { getMealName } from "./meals";
import type { PlanPeriodDay } from "./planningPeriod";
import type { DayKey, WeekMeals } from "@app-types/meal";
import { DAYS } from "@app-types/meal";
import type { Recipe } from "@app-types/recipe";
import type { MealLibraryEntry } from "@app-types/shopping";

/** Historisk vindu for rangering — et rent datahentings-bånd (§hooks/useMealsRange.ts), IKKE en forslags-terskel. */
export type HistoricalMeals = Record<string, WeekMeals>;

/** Speiler `sisteGangPlanlagt` (index.html linje ~801–815) 1:1. */
function sisteGangPlanlagt(mealName: string, allMeals: HistoricalMeals): Date | null {
  let sisteDato: Date | null = null;
  const navnLower = mealName.toLowerCase();
  for (const [weekKey, uke] of Object.entries(allMeals)) {
    DAYS.forEach((day, di) => {
      const val = uke[day];
      if (!val) return;
      if (getMealName(val).toLowerCase() !== navnLower) return;
      const dato = getDayDate(weekKey, di);
      if (!sisteDato || dato > sisteDato) sisteDato = dato;
    });
  }
  return sisteDato;
}

function effectiveVariationTags(meal: MealLibraryEntry, recipes: Recipe[]): string[] {
  if (meal.variationTags && meal.variationTags.length > 0) return meal.variationTags;
  const recipe = recipes.find((r) => r.name.toLowerCase() === meal.name.toLowerCase());
  return recipe?.tags ?? [];
}

function harTagOverlapp(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const setB = new Set(b.map((t) => t.toLowerCase()));
  return a.some((t) => setB.has(t.toLowerCase()));
}

interface RangertKandidat {
  meal: MealLibraryEntry;
  tags: string[];
  sisteGang: Date | null;
  alleredeBrukt: boolean;
  overlapperForrige: boolean;
}

function rangerKandidater(
  mealLibrary: MealLibraryEntry[],
  recipes: Recipe[],
  allMeals: HistoricalMeals,
  kreverLettvint: boolean,
  brukIDennePerioden: Set<string>,
  forrigeValgTags: string[],
): MealLibraryEntry[] {
  const lettvintKvalifiserte = kreverLettvint ? mealLibrary.filter((m) => m.lettvint) : mealLibrary;
  // Grasiøs degradering: krever lettvint, men ingen kvalifiserte finnes -> tillat hele biblioteket
  // fremfor å la dagen stå tom (samme prinsipp som legacy sin "biblioteket for lite"-fallback).
  const pool = lettvintKvalifiserte.length > 0 ? lettvintKvalifiserte : mealLibrary;

  const kandidater: RangertKandidat[] = pool.map((meal) => {
    const tags = effectiveVariationTags(meal, recipes);
    return {
      meal,
      tags,
      sisteGang: sisteGangPlanlagt(meal.name, allMeals),
      alleredeBrukt: brukIDennePerioden.has(meal.name.toLowerCase()),
      overlapperForrige: harTagOverlapp(tags, forrigeValgTags),
    };
  });

  kandidater.sort((a, b) => {
    if (a.alleredeBrukt !== b.alleredeBrukt) return a.alleredeBrukt ? 1 : -1;
    if (a.overlapperForrige !== b.overlapperForrige) return a.overlapperForrige ? 1 : -1;
    if (!a.sisteGang && !b.sisteGang) return a.meal.name.localeCompare(b.meal.name, "no");
    if (!a.sisteGang) return -1;
    if (!b.sisteGang) return 1;
    return a.sisteGang.getTime() - b.sisteGang.getTime();
  });

  const ikkeBrukt = kandidater.filter((k) => !k.alleredeBrukt);
  return (ikkeBrukt.length > 0 ? ikkeBrukt : kandidater).map((k) => k.meal);
}

export interface ForsteutkastInput {
  planDager: PlanPeriodDay[];
  mealLibrary: MealLibraryEntry[];
  recipes: Recipe[];
  allMeals: HistoricalMeals;
  /** `"weekKey|dayKey"` for dager som krever en lettvint-kvalifisert middag. */
  lettvintDager: Set<string>;
}

/** `"weekKey|dayKey"` — samme nøkkelformat som index.html sin `draft.valg`. */
export type ForsteutkastForslag = Record<string, string>;

export function planPeriodeNoekkel(weekKey: string, dayKey: DayKey): string {
  return `${weekKey}|${dayKey}`;
}

/**
 * Genererer et deterministisk forsteutkast for en planperiode. Returnerer
 * `{"weekKey|dayKey": navn}` KUN for dager som i dag er tomme — regel 1:
 * eksisterende planlagte dager overskrives ALDRI (funksjonen skriver
 * ingenting selv, den returnerer kun forslag kalleren eksplisitt kan
 * bruke). Forslag hentes UTELUKKENDE fra `mealLibrary`.
 */
export function genererForsteutkast(input: ForsteutkastInput): ForsteutkastForslag {
  const { planDager, mealLibrary, recipes, allMeals, lettvintDager } = input;
  const forslag: ForsteutkastForslag = {};
  if (mealLibrary.length === 0) return forslag;

  const brukIDennePerioden = new Set<string>();
  let forrigeValgTags: string[] = [];

  for (const { weekKey, dayKey } of planDager) {
    const noekkel = planPeriodeNoekkel(weekKey, dayKey);
    const eksisterende = (allMeals[weekKey] ?? {})[dayKey];
    if (eksisterende) {
      const rec = mealLibrary.find(
        (m) => m.name.toLowerCase() === getMealName(eksisterende).toLowerCase(),
      );
      forrigeValgTags = rec ? effectiveVariationTags(rec, recipes) : [];
      continue;
    }

    const kandidater = rangerKandidater(
      mealLibrary,
      recipes,
      allMeals,
      lettvintDager.has(noekkel),
      brukIDennePerioden,
      forrigeValgTags,
    );
    const valgt = kandidater[0];
    if (!valgt) continue;

    brukIDennePerioden.add(valgt.name.toLowerCase());
    forrigeValgTags = effectiveVariationTags(valgt, recipes);
    forslag[noekkel] = valgt.name;
  }
  return forslag;
}

/**
 * Historikk-sorterte biblioteksalternativer for "Bytt"-flyten — speiler
 * `sorterBibliotekEtterHistorikk` (index.html linje ~822–830) sin
 * enklere, ikke-variasjonsbevisste sortering. Brukt kun til å FORESLÅ
 * alternativer i bytteflyten, ikke i selve `genererForsteutkast`.
 */
export function sorterBibliotekEtterHistorikk(
  mealLibrary: MealLibraryEntry[],
  allMeals: HistoricalMeals,
): MealLibraryEntry[] {
  return [...mealLibrary].sort((a, b) => {
    const sisteA = sisteGangPlanlagt(a.name, allMeals);
    const sisteB = sisteGangPlanlagt(b.name, allMeals);
    if (!sisteA && !sisteB) return a.name.localeCompare(b.name, "no");
    if (!sisteA) return -1;
    if (!sisteB) return 1;
    return sisteA.getTime() - sisteB.getTime();
  });
}
