/**
 * Datamodellen for Årsbudsjett sin egen node (`families/{familyId}/
 * annualBudgetPlans/{year}/{type}`, §index.html linje 13431–14477,
 * §Issue #34-kartlegging kommentar 5819852681). Kun for ÅR SOM IKKE ER
 * inneværende budsjettår (`currentBudgetYear`) — inneværende år bruker
 * fortsatt `budget`/`incomeGroups`/`sparingGroups` direkte (og dermed
 * `@app-types/budsjettfamilie` sine typer), siden STRUKTUR (post-id/
 * navn/meta/legacyIds) er årsuavhengig og forblir eid der. Denne noden
 * lagrer KUN de årsavhengige PLAN-feltene (`months`/`budgetDetails`) —
 * §index.html linje 542–550.
 */
import type { BudgetDetail } from "./budsjettfamilie";

/** Hvilken av de tre postgruppene en årsplan-skive gjelder. */
export type AnnualPlanType = "costs" | "income" | "savings";

/** Én post sin årsavhengige plan — samme feltnavn/form som lagres. */
export interface AnnualPlanEntry {
  /** Indeks 0–11 (januar–desember), alltid 12 elementer, kun `budget`. */
  months: { budget: number }[];
  /** Kun kostnad+inntekt, aldri Sparing — se `BudgetDetail`. */
  budgetDetails?: BudgetDetail[];
}

/** `{itemId: AnnualPlanEntry}` for én gruppe. */
export type AnnualPlanGroup = Record<string, AnnualPlanEntry>;

/** `{groupId: AnnualPlanGroup}` — én type (costs/income/savings) sin fulle plan for ett år. */
export type AnnualPlanSlice = Record<string, AnnualPlanGroup>;

/** Hele `annualBudgetPlans`-noden — `{år: {type: AnnualPlanSlice}}`. */
export type AnnualPlansByYear = Record<number, Partial<Record<AnnualPlanType, AnnualPlanSlice>>>;
