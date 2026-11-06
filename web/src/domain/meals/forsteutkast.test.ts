/**
 * Tester for den NYE rangeringsalgoritmen (ikke en legacy-karakterisering
 * — se filens egen toppkommentar for hvorfor). Dekker de fem låste
 * produktkravene fra Kontrolltårnet (Issue #2): deterministisk,
 * beskytter eksisterende dager, historikk-vekting uten terskel,
 * variasjon fremfor klumping, og lettvint-filtrering med grasiøs
 * degradering.
 */
import { describe, expect, it } from "vitest";
import {
  genererForsteutkast,
  planPeriodeNoekkel,
  sorterBibliotekEtterHistorikk,
} from "./forsteutkast";
import type { PlanPeriodDay } from "./planningPeriod";
import type { WeekMeals } from "@app-types/meal";
import type { Recipe } from "@app-types/recipe";
import type { MealLibraryEntry } from "@app-types/shopping";

const dag = (dato: string, weekKey: string, dayKey: PlanPeriodDay["dayKey"]): PlanPeriodDay => ({
  dato: new Date(dato),
  weekKey,
  dayKey,
});

const meal = (name: string, overrides: Partial<MealLibraryEntry> = {}): MealLibraryEntry => ({
  id: name.toLowerCase(),
  name,
  ...overrides,
});

describe("genererForsteutkast", () => {
  it("overskriver aldri en eksisterende dag", () => {
    const planDager = [dag("2026-09-10", "2026-W37", "Thu")];
    const allMeals: Record<string, WeekMeals> = { "2026-W37": { Thu: "Taco" } };
    const mealLibrary = [meal("Taco"), meal("Pizza")];

    const forslag = genererForsteutkast({
      planDager,
      mealLibrary,
      recipes: [],
      allMeals,
      allFeedback: {},
      lettvintDager: new Set(),
    });

    expect(forslag).toEqual({});
  });

  it("foreslår kun for tomme dager, aldri de samme som allerede har en middag", () => {
    const planDager = [dag("2026-09-10", "2026-W37", "Thu"), dag("2026-09-11", "2026-W37", "Fri")];
    const allMeals: Record<string, WeekMeals> = { "2026-W37": { Thu: "Taco" } };
    const mealLibrary = [meal("Taco"), meal("Pizza")];

    const forslag = genererForsteutkast({
      planDager,
      mealLibrary,
      recipes: [],
      allMeals,
      allFeedback: {},
      lettvintDager: new Set(),
    });

    expect(Object.keys(forslag)).toEqual([planPeriodeNoekkel("2026-W37", "Fri")]);
  });

  it("er deterministisk — samme input gir samme forslag hver gang", () => {
    const planDager = [
      dag("2026-09-10", "2026-W37", "Thu"),
      dag("2026-09-11", "2026-W37", "Fri"),
      dag("2026-09-12", "2026-W37", "Sat"),
    ];
    const mealLibrary = [meal("Taco"), meal("Pizza"), meal("Suppe")];
    const input = {
      planDager,
      mealLibrary,
      recipes: [],
      allMeals: {},
      allFeedback: {},
      lettvintDager: new Set<string>(),
    };

    const forslag1 = genererForsteutkast(input);
    const forslag2 = genererForsteutkast(input);

    expect(forslag1).toEqual(forslag2);
  });

  it("nedvekter (men ekskluderer ikke hardt) nylig spiste middager — ingen 8-ukers terskel", () => {
    const planDager = [dag("2026-09-10", "2026-W37", "Thu")];
    // Taco ble planlagt (og dermed "spist") for kun 3 dager siden — ikke i nærheten av 8 uker.
    const allMeals: Record<string, WeekMeals> = { "2026-W36": { Mon: "Taco" } };
    const mealLibrary = [meal("Taco"), meal("Pizza")];

    const forslag = genererForsteutkast({
      planDager,
      mealLibrary,
      recipes: [],
      allMeals,
      allFeedback: {},
      lettvintDager: new Set(),
    });

    // Pizza (aldri planlagt) rangeres foran Taco (nylig planlagt) — myk vekting, ikke en terskel.
    expect(forslag[planPeriodeNoekkel("2026-W37", "Thu")]).toBe("Pizza");
  });

  it("unngår at to middager med overlappende variationTags klumper seg på påfølgende dager", () => {
    const planDager = [dag("2026-09-10", "2026-W37", "Thu"), dag("2026-09-11", "2026-W37", "Fri")];
    const mealLibrary = [
      meal("Fiskesuppe", { variationTags: ["fisk"] }),
      meal("Fiskegrateng", { variationTags: ["fisk"] }),
      meal("Taco", { variationTags: ["meksikansk"] }),
    ];

    const forslag = genererForsteutkast({
      planDager,
      mealLibrary,
      recipes: [],
      allMeals: {},
      allFeedback: {},
      lettvintDager: new Set(),
    });

    const dag1 = forslag[planPeriodeNoekkel("2026-W37", "Thu")];
    const dag2 = forslag[planPeriodeNoekkel("2026-W37", "Fri")];
    expect(dag1).toBe("Fiskegrateng"); // alfabetisk først blant to aldri-spiste
    expect(dag2).toBe("Taco"); // IKKE Fiskesuppe — samme tag som dagen før
  });

  it("filtrerer til lettvint-kvalifiserte middager på dager som krever det", () => {
    const planDager = [dag("2026-09-10", "2026-W37", "Thu")];
    const mealLibrary = [meal("Taco", { lettvint: false }), meal("Omelett", { lettvint: true })];

    const forslag = genererForsteutkast({
      planDager,
      mealLibrary,
      recipes: [],
      allMeals: {},
      allFeedback: {},
      lettvintDager: new Set([planPeriodeNoekkel("2026-W37", "Thu")]),
    });

    expect(forslag[planPeriodeNoekkel("2026-W37", "Thu")]).toBe("Omelett");
  });

  it("degraderer grasiøst til hele biblioteket når ingen lettvint-kvalifiserte finnes", () => {
    const planDager = [dag("2026-09-10", "2026-W37", "Thu")];
    const mealLibrary = [meal("Taco", { lettvint: false })];

    const forslag = genererForsteutkast({
      planDager,
      mealLibrary,
      recipes: [],
      allMeals: {},
      allFeedback: {},
      lettvintDager: new Set([planPeriodeNoekkel("2026-W37", "Thu")]),
    });

    expect(forslag[planPeriodeNoekkel("2026-W37", "Thu")]).toBe("Taco");
  });

  it("tillater gjentakelse først når biblioteket er for lite til å dekke perioden uten", () => {
    const planDager = [dag("2026-09-10", "2026-W37", "Thu"), dag("2026-09-11", "2026-W37", "Fri")];
    const mealLibrary = [meal("Taco")];

    const forslag = genererForsteutkast({
      planDager,
      mealLibrary,
      recipes: [],
      allMeals: {},
      allFeedback: {},
      lettvintDager: new Set(),
    });

    expect(forslag[planPeriodeNoekkel("2026-W37", "Thu")]).toBe("Taco");
    expect(forslag[planPeriodeNoekkel("2026-W37", "Fri")]).toBe("Taco");
  });

  it("bruker oppskriftens fritekst-tags som fallback når variationTags mangler på biblioteksmiddagen", () => {
    const planDager = [dag("2026-09-10", "2026-W37", "Thu"), dag("2026-09-11", "2026-W37", "Fri")];
    const recipes: Recipe[] = [
      {
        id: "r1",
        name: "Fiskesuppe",
        cat: "Middag",
        tags: ["fisk"],
        time: 30,
        servings: 4,
        url: "",
        imageUrl: null,
        source: "manual",
        instructions: "",
        ingredients: [],
        ingredientGroups: [],
        lastCooked: null,
        timesCooked: 0,
        createdAt: 0,
      },
    ];
    const mealLibrary = [
      meal("Fiskesuppe"), // ingen variationTags -> faller tilbake til oppskriftens tags
      meal("Fiskegrateng", { variationTags: ["fisk"] }),
      meal("Taco", { variationTags: ["meksikansk"] }),
    ];

    const forslag = genererForsteutkast({
      planDager,
      mealLibrary,
      recipes,
      allMeals: {},
      allFeedback: {},
      lettvintDager: new Set(),
    });

    const dag1 = forslag[planPeriodeNoekkel("2026-W37", "Thu")];
    const dag2 = forslag[planPeriodeNoekkel("2026-W37", "Fri")];
    expect(dag1).toBe("Fiskegrateng");
    expect(dag2).toBe("Taco"); // ikke Fiskesuppe, selv om dens tag kom fra fallback-oppskriften
  });

  it("returnerer tomt forslag når biblioteket er tomt", () => {
    const forslag = genererForsteutkast({
      planDager: [dag("2026-09-10", "2026-W37", "Thu")],
      mealLibrary: [],
      recipes: [],
      allMeals: {},
      allFeedback: {},
      lettvintDager: new Set(),
    });
    expect(forslag).toEqual({});
  });

  it("ekskluderer en middag satt 'på pause' helt fra kandidatpoolen", () => {
    const planDager = [dag("2026-09-10", "2026-W37", "Thu")];
    const mealLibrary = [meal("Taco"), meal("Pizza")];
    const allFeedback = {
      "2026-W35": { Mon: { feedback: { paused: true as boolean }, recordedAt: 100 } },
    };
    // Taco er "satt på pause" via en tidligere feedback-post der Taco faktisk ble spist.
    const allMeals: Record<string, WeekMeals> = { "2026-W35": { Mon: "Taco" } };

    const forslag = genererForsteutkast({
      planDager,
      mealLibrary,
      recipes: [],
      allMeals,
      allFeedback,
      lettvintDager: new Set(),
    });

    expect(forslag[planPeriodeNoekkel("2026-W37", "Thu")]).toBe("Pizza");
  });

  it("rangerer mot FAKTISK historikk (avvik overstyrer planen), ikke den rå planen", () => {
    const planDager = [dag("2026-09-10", "2026-W37", "Thu")];
    const mealLibrary = [meal("Taco"), meal("Pizza")];
    // Planen sier Taco ble planlagt for 3 dager siden, men et registrert avvik sier det faktisk
    // ble Pizza — rangeringen skal nedvekte Pizza (nylig faktisk spist), ikke Taco.
    const allMeals: Record<string, WeekMeals> = { "2026-W36": { Mon: "Taco" } };
    const allFeedback = {
      "2026-W36": {
        Mon: {
          actual: { type: "recipe" as const, name: "Pizza", recipeId: null },
          recordedAt: 1,
        },
      },
    };

    const forslag = genererForsteutkast({
      planDager,
      mealLibrary,
      recipes: [],
      allMeals,
      allFeedback,
      lettvintDager: new Set(),
    });

    expect(forslag[planPeriodeNoekkel("2026-W37", "Thu")]).toBe("Taco");
  });
});

describe("sorterBibliotekEtterHistorikk", () => {
  it("setter aldri-planlagte middager foran nylig planlagte, alfabetisk ved uavgjort", () => {
    const allMeals: Record<string, WeekMeals> = { "2026-W36": { Mon: "Taco" } };
    const sortert = sorterBibliotekEtterHistorikk(
      [meal("Taco"), meal("Bolognese"), meal("Pizza")],
      allMeals,
      {},
    );
    expect(sortert.map((m) => m.name)).toEqual(["Bolognese", "Pizza", "Taco"]);
  });

  it("ekskluderer pausede middager helt fra alternativlisten", () => {
    const allMeals: Record<string, WeekMeals> = { "2026-W36": { Mon: "Taco" } };
    const allFeedback = {
      "2026-W36": { Mon: { feedback: { paused: true as boolean }, recordedAt: 1 } },
    };
    const sortert = sorterBibliotekEtterHistorikk(
      [meal("Taco"), meal("Bolognese"), meal("Pizza")],
      allMeals,
      allFeedback,
    );
    expect(sortert.map((m) => m.name)).toEqual(["Bolognese", "Pizza"]);
  });
});

/**
 * Planlagte middager i hele planperioden (#20, ordre 6684401676): en middag
 * som allerede står på en dag i perioden — før eller etter hullet — regnes
 * som brukt i perioden ved automatisk rangering. Hendelser er ikke middager.
 */
describe("genererForsteutkast — allerede planlagte middager i perioden", () => {
  const W = "2026-W37";
  const tre = [
    dag("2026-09-07", W, "Mon"),
    dag("2026-09-08", W, "Tue"),
    dag("2026-09-09", W, "Wed"),
  ];
  const gen = (o: {
    planDager?: PlanPeriodDay[];
    mealLibrary: MealLibraryEntry[];
    allMeals: Record<string, WeekMeals>;
    lettvintDager?: Set<string>;
    allFeedback?: Parameters<typeof genererForsteutkast>[0]["allFeedback"];
  }) =>
    genererForsteutkast({
      planDager: o.planDager ?? tre,
      mealLibrary: o.mealLibrary,
      recipes: [],
      allMeals: o.allMeals,
      allFeedback: o.allFeedback ?? {},
      lettvintDager: o.lettvintDager ?? new Set(),
    });

  it("repro: senere planlagt A vinner ikke over B selv om B overlapper forrige dag", () => {
    // Mon fast (tag X), Tue åpent, Wed allerede A (tag Y). B har tag X.
    const forslag = gen({
      mealLibrary: [
        meal("Fisk", { variationTags: ["X"] }),
        meal("A", { variationTags: ["Y"] }),
        meal("B", { variationTags: ["X"] }),
      ],
      allMeals: { [W]: { Mon: "Fisk", Wed: "A" } },
    });
    expect(forslag).toEqual({ [planPeriodeNoekkel(W, "Tue")]: "B" });
  });

  it("planlagt FØR hullet regnes også som brukt", () => {
    const forslag = gen({
      mealLibrary: [meal("A"), meal("B")],
      allMeals: { [W]: { Mon: "A" } },
      planDager: tre.slice(0, 2),
    });
    expect(forslag[planPeriodeNoekkel(W, "Tue")]).toBe("B");
  });

  it("flere uker: planlagt neste uke i perioden reserveres, også mot tag-overlapp", () => {
    const W2 = "2026-W38";
    const forslag = gen({
      planDager: [
        dag("2026-09-07", W, "Mon"),
        dag("2026-09-08", W, "Tue"),
        dag("2026-09-14", W2, "Mon"),
      ],
      mealLibrary: [
        meal("Fisk", { variationTags: ["X"] }),
        meal("A", { variationTags: ["Y"] }),
        meal("B", { variationTags: ["X"] }),
      ],
      allMeals: { [W]: { Mon: "Fisk" }, [W2]: { Mon: "A" } },
    });
    expect(forslag).toEqual({ [planPeriodeNoekkel(W, "Tue")]: "B" });
  });

  it("navnecasing og rettobjekt uten bibliotekskobling regnes som samme middag", () => {
    const forslag = gen({
      mealLibrary: [meal("Taco"), meal("Pizza")],
      allMeals: { [W]: { Wed: { type: "recipe", name: "taco", recipeId: null } } },
      planDager: tre.slice(1),
    });
    expect(forslag[planPeriodeNoekkel(W, "Tue")]).toBe("Pizza");
  });

  it("en hendelse reserverer ingen middag, selv med samme tekst", () => {
    // Mon fast (tag X), Tue åpent, Wed hendelse «Pizza». Taco overlapper Mon;
    // Pizza gjør ikke det. Var hendelsen reservert, ville Taco vunnet.
    const forslag = gen({
      mealLibrary: [
        meal("Fisk", { variationTags: ["X"] }),
        meal("Taco", { variationTags: ["X"] }),
        meal("Pizza", { variationTags: ["Y"] }),
      ],
      allMeals: { [W]: { Mon: "Fisk", Wed: { type: "event", name: "Pizza" } } },
    });
    expect(forslag).toEqual({ [planPeriodeNoekkel(W, "Tue")]: "Pizza" });
  });

  it("middag utenfor perioden reserveres ikke (bare myk historikkvekting)", () => {
    // A står uken etter perioden; A er da «nyligere» enn B i historikken,
    // men ikke reservert. B (aldri planlagt) vinner fortsatt på historikk.
    const forslag = gen({
      planDager: [dag("2026-09-08", W, "Tue")],
      mealLibrary: [meal("A"), meal("B")],
      allMeals: { "2026-W38": { Mon: "A" }, "2026-W30": { Mon: "B" } },
    });
    expect(forslag[planPeriodeNoekkel(W, "Tue")]).toBe("B");
    // Uten at noe er planlagt i perioden kan en middag utenfor perioden foreslås.
    const bareA = gen({
      planDager: [dag("2026-09-08", W, "Tue")],
      mealLibrary: [meal("A")],
      allMeals: { "2026-W38": { Mon: "A" } },
    });
    expect(bareA[planPeriodeNoekkel(W, "Tue")]).toBe("A");
  });

  it("lite bibliotek: alt er planlagt i perioden, kandidater gjenbrukes som før", () => {
    const forslag = gen({
      mealLibrary: [meal("A")],
      allMeals: { [W]: { Mon: "A" } },
      planDager: tre.slice(0, 2),
    });
    expect(forslag[planPeriodeNoekkel(W, "Tue")]).toBe("A");
  });

  it("lettvint med degradering og pauset rett er uendret", () => {
    const allFeedback = {
      "2026-W30": { Mon: { feedback: { paused: true as boolean }, recordedAt: 1 } },
    };
    const forslag = gen({
      mealLibrary: [meal("Rask", { lettvint: true }), meal("Gryte"), meal("Pauset")],
      allMeals: { [W]: { Wed: "Rask" }, "2026-W30": { Mon: "Pauset" } },
      allFeedback,
      lettvintDager: new Set([planPeriodeNoekkel(W, "Tue")]),
      planDager: tre.slice(1),
    });
    // Eneste lettvint-rett er allerede planlagt: gjenbrukes heller enn at dagen står tom.
    expect(forslag[planPeriodeNoekkel(W, "Tue")]).toBe("Rask");
    const uten = gen({
      mealLibrary: [meal("Gryte"), meal("Pauset")],
      allMeals: { "2026-W30": { Mon: "Pauset" } },
      allFeedback,
      planDager: [dag("2026-09-08", W, "Tue")],
    });
    expect(uten[planPeriodeNoekkel(W, "Tue")]).toBe("Gryte");
  });

  it("eksisterende dager røres aldri, og resultatet er deterministisk", () => {
    const input = {
      mealLibrary: [meal("A"), meal("B"), meal("C")],
      allMeals: { [W]: { Mon: "C", Wed: { type: "event" as const, name: "Bursdag" } } },
    };
    const f1 = gen(input);
    expect(Object.keys(f1)).toEqual([planPeriodeNoekkel(W, "Tue")]);
    expect(f1[planPeriodeNoekkel(W, "Tue")]).not.toBe("C");
    expect(gen(input)).toEqual(f1);
  });
});
