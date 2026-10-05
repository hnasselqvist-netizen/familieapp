import { describe, expect, it } from "vitest";
import type { BudsjettGruppe, BudsjettPost } from "@app-types/budsjettfamilie";
import { summerGruppeBudsjett, summerGruppeFaktisk } from "./budsjettfamilie";
import { beregnOkonomibilde } from "./okonomi";

const MND = 9; // oktober

function post(id: string, budget: number, spent = 0): BudsjettPost {
  return {
    id,
    name: id,
    months: Array.from({ length: 12 }, (_, i) =>
      i === MND ? { budget, spent } : { budget: 1_000_000, spent: 1_000_000 },
    ),
  };
}

const gruppe = (id: string, label: string, items: BudsjettPost[]): BudsjettGruppe => ({
  id,
  label,
  items,
});

const incomeGroups = [gruppe("lonn", "Lønn", [post("helen", 40000), post("eivind", 35000)])];
const budgetGroups = [
  gruppe("bolig", "Bolig", [post("lan", 15000), post("strom", 2000, 1800)]),
  gruppe("mat", "Mat", [post("dagligvarer", 9000)]),
];
const sparingGroups = [gruppe("buffer", "Buffer", [post("bsu", 2500)])];

// Faktisk fra ferdige hendelser (plasseringId → beløp). «strom» har ingen
// hendelse, så lagret `spent` (1800) brukes — som på detaljskjermene.
const actualTotals = { helen: 40000, lan: 15000, dagligvarer: 4300.5, bsu: 2500 };

describe("beregnOkonomibilde", () => {
  const bilde = beregnOkonomibilde({ incomeGroups, budgetGroups, sparingGroups }, MND, {
    ...actualTotals,
  });

  it("summerer per område og per gruppe for valgt måned", () => {
    expect(bilde.inntekter).toEqual({
      budsjett: 75000,
      faktisk: 40000,
      grupper: [{ id: "lonn", label: "Lønn", budsjett: 75000, faktisk: 40000 }],
    });
    expect(bilde.kostnader.grupper).toEqual([
      { id: "bolig", label: "Bolig", budsjett: 17000, faktisk: 16800 },
      { id: "mat", label: "Mat", budsjett: 9000, faktisk: 4300.5 },
    ]);
    expect(bilde.kostnader.budsjett).toBe(26000);
    expect(bilde.kostnader.faktisk).toBe(21100.5);
    expect(bilde.sparing).toMatchObject({ budsjett: 2500, faktisk: 2500 });
  });

  it("«igjen» = inntekter − kostnader − sparing", () => {
    expect(bilde.igjen).toEqual({
      budsjett: 75000 - 26000 - 2500,
      faktisk: 40000 - 21100.5 - 2500,
    });
  });

  it("bruker nøyaktig detaljskjermenes summering (ingen egne tall)", () => {
    for (const [omrade, grupper] of [
      [bilde.inntekter, incomeGroups],
      [bilde.kostnader, budgetGroups],
      [bilde.sparing, sparingGroups],
    ] as const) {
      grupper.forEach((g, i) => {
        expect(omrade.grupper[i]!.budsjett).toBe(summerGruppeBudsjett(g, MND));
        expect(omrade.grupper[i]!.faktisk).toBe(summerGruppeFaktisk(g, MND, actualTotals));
      });
    }
  });

  it("tomme områder gir null, ikke feil", () => {
    expect(
      beregnOkonomibilde({ incomeGroups: [], budgetGroups: [], sparingGroups: [] }, MND, {}),
    ).toEqual({
      inntekter: { budsjett: 0, faktisk: 0, grupper: [] },
      kostnader: { budsjett: 0, faktisk: 0, grupper: [] },
      sparing: { budsjett: 0, faktisk: 0, grupper: [] },
      igjen: { budsjett: 0, faktisk: 0 },
    });
  });
});
