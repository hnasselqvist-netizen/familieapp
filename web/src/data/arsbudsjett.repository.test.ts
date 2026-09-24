/**
 * Karakteriseringstest for `parseAnnualPlans` — låser parsingen mot den
 * lagrede formen for `annualBudgetPlans/{year}/{type}/{groupId}/
 * {itemId}` (§types/arsbudsjett.ts, §domain/arsbudsjett/arsbudsjett.ts
 * sin toppkommentar). Samme regresjonslås-mønster som
 * `budsjettfamilie.repository.test.ts` (Spillerom sin
 * `parseForecastGroups`-fix, PR #35).
 */
import { describe, expect, it } from "vitest";
import { parseAnnualPlans } from "./arsbudsjett.repository";

describe("parseAnnualPlans", () => {
  it("parser {år: {type: {groupId: {itemId: {months, budgetDetails?}}}}}", () => {
    const raw = {
      2027: {
        costs: {
          bolig: { strom: { months: { 0: { budget: 500 } } } },
        },
      },
    };
    const result = parseAnnualPlans(raw);
    expect(result[2027]?.costs?.bolig?.strom?.months[0]).toEqual({ budget: 500 });
    expect(result[2027]?.costs?.bolig?.strom?.months[1]).toEqual({ budget: 0 });
  });

  it("utelater budgetDetails helt når feltet mangler/er tomt", () => {
    const raw = { 2027: { costs: { bolig: { strom: { months: {} } } } } };
    const result = parseAnnualPlans(raw);
    expect(result[2027]?.costs?.bolig?.strom?.budgetDetails).toBeUndefined();
  });

  it("parser budgetDetails med kun budget (ingen spent) per detaljmåned", () => {
    const raw = {
      2027: {
        costs: {
          bolig: {
            strom: {
              months: { 0: { budget: 500 } },
              budgetDetails: [{ id: "d1", name: "Fastledd", months: { 0: { budget: 200 } } }],
            },
          },
        },
      },
    };
    const result = parseAnnualPlans(raw);
    expect(result[2027]?.costs?.bolig?.strom?.budgetDetails).toEqual([
      { id: "d1", name: "Fastledd", months: [{ budget: 200 }, ...Array(11).fill({ budget: 0 })] },
    ]);
  });

  it("kun typer som faktisk finnes for et år er tilstede — ikke costs/income/savings som tomme placeholders", () => {
    const raw = { 2027: { costs: { bolig: { strom: { months: {} } } } } };
    const result = parseAnnualPlans(raw);
    expect(Object.keys(result[2027] ?? {})).toEqual(["costs"]);
  });

  it("gir tomt objekt for null/manglende data — ingen feil kastet", () => {
    expect(parseAnnualPlans(null)).toEqual({});
    expect(parseAnnualPlans(undefined)).toEqual({});
  });

  it("ignorerer ikke-numeriske nøkler på årsnivå uten å kaste", () => {
    const raw = { ikkeEtAar: { costs: {} }, 2027: { costs: {} } };
    const result = parseAnnualPlans(raw);
    expect(Object.keys(result)).toEqual(["2027"]);
  });
});
