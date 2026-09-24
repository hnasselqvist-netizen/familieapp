import { describe, expect, it } from "vitest";
import {
  anvendRestenMåneder,
  byggTomAarsplanFraStruktur,
  finnNaermesteForegaaendeAar,
  flettAarsplanMedStruktur,
  fordelArskostnadMåneder,
  hentManglendeDetaljerFraKilde,
  konverterGroupsTilFlatPlan,
  nivaKeyForMeta,
  summerAlleGrupperAar,
  summerBudgetDetails,
  summerEtterEier,
  summerGrupperManed,
  summerGruppeAar,
  summerKostnaderEtterNiva,
  summerPostAar,
} from "./arsbudsjett";
import type { AnnualPlanSlice } from "@app-types/arsbudsjett";
import type { BudsjettGruppe, BudsjettPost } from "@app-types/budsjettfamilie";

const tolvMndBudget = (verdi = 0) =>
  Array.from({ length: 12 }, () => ({ budget: verdi, spent: 0 }));

function post(overrides: Partial<BudsjettPost> = {}): BudsjettPost {
  return { id: "p1", name: "Post", months: tolvMndBudget(), ...overrides };
}

function gruppe(overrides: Partial<BudsjettGruppe> = {}): BudsjettGruppe {
  return { id: "g1", label: "Gruppe", items: [], ...overrides };
}

describe("nivaKeyForMeta", () => {
  it("returnerer ukjent uten meta/niva", () => {
    expect(nivaKeyForMeta(undefined)).toBe("ukjent");
    expect(nivaKeyForMeta(null)).toBe("ukjent");
    expect(nivaKeyForMeta({})).toBe("ukjent");
  });
  it("splitter opprettholde i nødvendig/valgfri etter opprettholdType", () => {
    expect(nivaKeyForMeta({ niva: "opprettholde" })).toBe("opprettholde-nodvendig");
    expect(nivaKeyForMeta({ niva: "opprettholde", opprettholdType: "nodvendig" })).toBe(
      "opprettholde-nodvendig",
    );
    expect(nivaKeyForMeta({ niva: "opprettholde", opprettholdType: "valgfritt" })).toBe(
      "opprettholde-valgfri",
    );
  });
  it("returnerer niva-verdien direkte for andre nivåer", () => {
    expect(nivaKeyForMeta({ niva: "beskytte" })).toBe("beskytte");
    expect(nivaKeyForMeta({ niva: "velge" })).toBe("velge");
  });
});

describe("summerBudgetDetails", () => {
  it("returnerer 12 nullbeløp uten detaljer", () => {
    expect(summerBudgetDetails(undefined)).toEqual(
      tolvMndBudget().map((m) => ({ budget: m.budget })),
    );
    expect(summerBudgetDetails([])).toEqual(tolvMndBudget().map((m) => ({ budget: m.budget })));
  });
  it("summerer flere detaljer per måned uavhengig", () => {
    const details = [
      {
        id: "d1",
        name: "A",
        months: Array.from({ length: 12 }, (_, i) => ({ budget: i === 0 ? 100 : 0 })),
      },
      {
        id: "d2",
        name: "B",
        months: Array.from({ length: 12 }, (_, i) => ({ budget: i === 0 ? 50 : i === 1 ? 20 : 0 })),
      },
    ];
    const result = summerBudgetDetails(details);
    expect(result[0]!.budget).toBe(150);
    expect(result[1]!.budget).toBe(20);
    expect(result[2]!.budget).toBe(0);
  });
});

describe("byggTomAarsplanFraStruktur", () => {
  it("bygger 0×12 for alle poster uten detaljkilde", () => {
    const groups = [gruppe({ id: "g1", items: [post({ id: "p1" }), post({ id: "p2" })] })];
    const plan = byggTomAarsplanFraStruktur(groups);
    expect(plan.g1!.p1!.months).toEqual(tolvMndBudget().map((m) => ({ budget: m.budget })));
    expect(plan.g1!.p1!.budgetDetails).toBeUndefined();
    expect(plan.g1!.p2!.months.every((m) => m.budget === 0)).toBe(true);
  });
  it("kopierer KUN detalj-struktur (id+navn) fra kilde, aldri beløp", () => {
    const groups = [gruppe({ id: "g1", items: [post({ id: "p1" })] })];
    const detaljkilde: AnnualPlanSlice = {
      g1: {
        p1: {
          months: tolvMndBudget().map((m) => ({ budget: m.budget })),
          budgetDetails: [
            {
              id: "d1",
              name: "Strøm",
              months: Array.from({ length: 12 }, (_, i) => ({ budget: i === 0 ? 500 : 0 })),
            },
          ],
        },
      },
    };
    const plan = byggTomAarsplanFraStruktur(groups, detaljkilde);
    expect(plan.g1!.p1!.budgetDetails).toEqual([
      { id: "d1", name: "Strøm", months: tolvMndBudget().map((m) => ({ budget: m.budget })) },
    ]);
  });
  it("gir ingen detaljer når kildeposten ikke har noen", () => {
    const groups = [gruppe({ id: "g1", items: [post({ id: "p1" })] })];
    const detaljkilde: AnnualPlanSlice = {
      g1: { p1: { months: tolvMndBudget().map((m) => ({ budget: m.budget })) } },
    };
    const plan = byggTomAarsplanFraStruktur(groups, detaljkilde);
    expect(plan.g1!.p1!.budgetDetails).toBeUndefined();
  });
});

describe("konverterGroupsTilFlatPlan", () => {
  it("plukker kun months+budgetDetails, ikke meta/navn/legacyIds", () => {
    const groups = [
      gruppe({
        id: "g1",
        items: [
          post({
            id: "p1",
            name: "Strøm",
            meta: { eier: "Felles" },
            legacyIds: ["gammel"],
            months: tolvMndBudget(100),
          }),
        ],
      }),
    ];
    const plan = konverterGroupsTilFlatPlan(groups);
    expect(plan.g1!.p1).toEqual({ months: tolvMndBudget(100).map((m) => ({ budget: m.budget })) });
  });
  it("bevarer budgetDetails når posten har dem", () => {
    const details = [
      { id: "d1", name: "A", months: tolvMndBudget(10).map((m) => ({ budget: m.budget })) },
    ];
    const groups = [gruppe({ id: "g1", items: [post({ id: "p1", budgetDetails: details })] })];
    expect(konverterGroupsTilFlatPlan(groups).g1!.p1!.budgetDetails).toEqual(details);
  });
});

describe("finnNaermesteForegaaendeAar", () => {
  it("inkluderer currentBudgetYear som kandidat selv uten lagrede år", () => {
    expect(finnNaermesteForegaaendeAar(2028, [], 2026)).toBe(2026);
  });
  it("finner nærmeste EKSISTERENDE år, ikke bare currentBudgetYear", () => {
    expect(finnNaermesteForegaaendeAar(2029, [2027, 2028], 2026)).toBe(2028);
  });
  it("ignorerer år som ikke er tidligere enn målåret", () => {
    expect(finnNaermesteForegaaendeAar(2027, [2028, 2029], 2026)).toBe(2026);
  });
  it("returnerer null når ingen tidligere år finnes i det hele tatt", () => {
    expect(finnNaermesteForegaaendeAar(2025, [], 2026)).toBeNull();
  });
});

describe("hentManglendeDetaljerFraKilde", () => {
  const groups = [gruppe({ id: "g1", items: [post({ id: "p1" }), post({ id: "p2" })] })];

  it("legger til detalj-struktur på post uten detaljer når kilden har det", () => {
    const kilde: AnnualPlanSlice = {
      g1: {
        p1: {
          months: tolvMndBudget().map((m) => ({ budget: m.budget })),
          budgetDetails: [
            { id: "d1", name: "A", months: tolvMndBudget(99).map((m) => ({ budget: m.budget })) },
          ],
        },
      },
    };
    const resultat = hentManglendeDetaljerFraKilde(undefined, groups, kilde);
    expect(resultat.g1!.p1!.budgetDetails).toEqual([
      { id: "d1", name: "A", months: tolvMndBudget().map((m) => ({ budget: m.budget })) },
    ]);
    expect(resultat.g1!.p2!.budgetDetails).toBeUndefined();
  });

  it("rører ALDRI en post som allerede har budgetDetails", () => {
    const eksisterende: AnnualPlanSlice = {
      g1: {
        p1: {
          months: tolvMndBudget(5).map((m) => ({ budget: m.budget })),
          budgetDetails: [
            {
              id: "gammel",
              name: "Uendret",
              months: tolvMndBudget(5).map((m) => ({ budget: m.budget })),
            },
          ],
        },
      },
    };
    const kilde: AnnualPlanSlice = {
      g1: {
        p1: {
          months: tolvMndBudget().map((m) => ({ budget: m.budget })),
          budgetDetails: [
            {
              id: "ny",
              name: "Skal ikke brukes",
              months: tolvMndBudget().map((m) => ({ budget: m.budget })),
            },
          ],
        },
      },
    };
    const resultat = hentManglendeDetaljerFraKilde(eksisterende, groups, kilde);
    expect(resultat.g1!.p1).toEqual(eksisterende.g1!.p1);
  });

  it("rører aldri months på en eksisterende post uten detaljer", () => {
    const eksisterende: AnnualPlanSlice = {
      g1: { p1: { months: tolvMndBudget(42).map((m) => ({ budget: m.budget })) } },
    };
    const resultat = hentManglendeDetaljerFraKilde(eksisterende, groups, undefined);
    expect(resultat.g1!.p1!.months).toEqual(tolvMndBudget(42).map((m) => ({ budget: m.budget })));
  });

  it("gir tom plan for post uten eksisterende data og uten kilde", () => {
    const resultat = hentManglendeDetaljerFraKilde(undefined, groups, undefined);
    expect(resultat.g1!.p1).toEqual({ months: tolvMndBudget().map((m) => ({ budget: m.budget })) });
  });
});

describe("flettAarsplanMedStruktur", () => {
  it("gir 0×12 for post uten plan-data (aldri lånt fra et annet år)", () => {
    const groups = [gruppe({ id: "g1", items: [post({ id: "p1", months: tolvMndBudget(999) })] })];
    const resultat = flettAarsplanMedStruktur(groups, undefined);
    expect(resultat[0]!.items[0]!.months).toEqual(tolvMndBudget(0));
  });
  it("bruker plan-dataen når den finnes, bevarer struktur (navn/meta)", () => {
    const groups = [
      gruppe({ id: "g1", items: [post({ id: "p1", name: "Strøm", meta: { eier: "Felles" } })] }),
    ];
    const plan: AnnualPlanSlice = {
      g1: { p1: { months: tolvMndBudget(200).map((m) => ({ budget: m.budget })) } },
    };
    const resultat = flettAarsplanMedStruktur(groups, plan);
    expect(resultat[0]!.items[0]!.name).toBe("Strøm");
    expect(resultat[0]!.items[0]!.meta).toEqual({ eier: "Felles" });
    expect(resultat[0]!.items[0]!.months.every((m) => m.budget === 200)).toBe(true);
  });
  it("fjerner budgetDetails fra strukturen når planen ikke har noen", () => {
    const groups = [
      gruppe({
        id: "g1",
        items: [
          post({
            id: "p1",
            budgetDetails: [
              {
                id: "d1",
                name: "Gammel",
                months: tolvMndBudget().map((m) => ({ budget: m.budget })),
              },
            ],
          }),
        ],
      }),
    ];
    const resultat = flettAarsplanMedStruktur(groups, undefined);
    expect(resultat[0]!.items[0]!.budgetDetails).toBeUndefined();
  });
});

describe("summerPostAar / summerGruppeAar / summerAlleGrupperAar / summerGrupperManed", () => {
  const groups = [
    gruppe({
      id: "g1",
      items: [
        post({ id: "p1", months: tolvMndBudget(100) }),
        post({ id: "p2", months: tolvMndBudget(50) }),
      ],
    }),
    gruppe({ id: "g2", items: [post({ id: "p3", months: tolvMndBudget(10) })] }),
  ];

  it("summerPostAar summerer kun months, ikke budgetDetails", () => {
    const p = post({
      months: Array.from({ length: 12 }, () => ({ budget: 999, spent: 0 })),
    });
    expect(summerPostAar(p)).toBe(999 * 12);
  });
  it("summerGruppeAar summerer alle poster i gruppen", () => {
    expect(summerGruppeAar(groups[0]!)).toBe(150 * 12);
  });
  it("summerAlleGrupperAar summerer på tvers av alle grupper", () => {
    expect(summerAlleGrupperAar(groups)).toBe(160 * 12);
  });
  it("summerGrupperManed summerer én kalendermåned på tvers av grupper", () => {
    expect(summerGrupperManed(groups, 0)).toBe(160);
  });
});

describe("summerKostnaderEtterNiva", () => {
  it("klassifiserer poster uten meta/niva under ukjent", () => {
    const groups = [gruppe({ items: [post({ months: tolvMndBudget(100) })] })];
    expect(summerKostnaderEtterNiva(groups).ukjent).toBe(1200);
  });
  it("summerer per nivå-nøkkel, inkl. opprettholde-splitten", () => {
    const groups = [
      gruppe({
        items: [
          post({ id: "a", months: tolvMndBudget(10), meta: { niva: "beskytte" } }),
          post({
            id: "b",
            months: tolvMndBudget(20),
            meta: { niva: "opprettholde", opprettholdType: "valgfritt" },
          }),
        ],
      }),
    ];
    const sum = summerKostnaderEtterNiva(groups);
    expect(sum.beskytte).toBe(120);
    expect(sum["opprettholde-valgfri"]).toBe(240);
  });
});

describe("summerEtterEier", () => {
  it("legger post uten gyldig eier under Uklassifisert, aldri gjettet", () => {
    const groups = [gruppe({ items: [post({ months: tolvMndBudget(100) })] })];
    const sum = summerEtterEier(groups, ["Felles", "Helen", "Eivind"]);
    expect(sum.Uklassifisert).toBe(1200);
    expect(sum.Felles).toBe(0);
  });
  it("summerer per eier-verdi", () => {
    const groups = [
      gruppe({
        items: [
          post({ id: "a", months: tolvMndBudget(10), meta: { eier: "Helen" } }),
          post({ id: "b", months: tolvMndBudget(20), meta: { eier: "Helen" } }),
        ],
      }),
    ];
    expect(summerEtterEier(groups, ["Felles", "Helen", "Eivind"]).Helen).toBe(360);
  });
});

describe("fordelArskostnadMåneder", () => {
  it("fordeler jevnt uten rest", () => {
    expect(fordelArskostnadMåneder(1200).every((m) => m.budget === 100)).toBe(true);
  });
  it("legger avrundingsdifferansen på desember", () => {
    const result = fordelArskostnadMåneder(1000);
    expect(result.slice(0, 11).every((m) => m.budget === 83)).toBe(true);
    expect(result[11]!.budget).toBe(83 + (1000 - 83 * 12));
  });
  it("håndterer 0/negativt uten å kaste", () => {
    expect(fordelArskostnadMåneder(0).every((m) => m.budget === 0)).toBe(true);
    expect(fordelArskostnadMåneder(Number.NaN).every((m) => m.budget === 0)).toBe(true);
  });
});

describe("anvendRestenMåneder", () => {
  it("setter samme verdi fra og med fraMonthIndex, urørt før", () => {
    const months = tolvMndBudget(10).map((m) => ({ budget: m.budget }));
    const result = anvendRestenMåneder(months, 6, 500);
    expect(result.slice(0, 6).every((m) => m.budget === 10)).toBe(true);
    expect(result.slice(6).every((m) => m.budget === 500)).toBe(true);
  });
  it("fraMonthIndex 0 setter alle 12 måneder", () => {
    const months = tolvMndBudget(1).map((m) => ({ budget: m.budget }));
    expect(anvendRestenMåneder(months, 0, 77).every((m) => m.budget === 77)).toBe(true);
  });
});
