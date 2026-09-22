/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * Spillerom-motoren i dagens `index.html` (linje 8843–9094), lest og
 * verifisert manuelt mot koden FØR porteringen til liquidity.ts. Ved
 * uenighet om "riktig" oppførsel senere: dette er fasiten.
 */
import { describe, expect, it } from "vitest";
import {
  beregnStandardPrognosisDate,
  calcSpillerom,
  erAktivPrognosepost,
  erPrognosepostIPeriode,
  generateForecastPosts,
  maanederIPeriode,
} from "./liquidity";
import type { ForecastGroup, LiquidityPost } from "@app-types/liquidity";

function post(overrides: Partial<LiquidityPost>): LiquidityPost {
  return {
    id: "p1",
    name: "Test",
    amount: 100,
    direction: "out",
    date: "2026-06-15",
    type: "fast",
    kilde: "manuell",
    ...overrides,
  };
}

describe("erAktivPrognosepost", () => {
  it("regner en post uten status som aktiv (bakoverkompatibelt)", () => {
    expect(erAktivPrognosepost(post({}))).toBe(true);
  });

  it("regner status:aktiv som aktiv", () => {
    expect(erAktivPrognosepost(post({ status: "aktiv" }))).toBe(true);
  });

  it("regner status:oppfylt som IKKE aktiv", () => {
    expect(erAktivPrognosepost(post({ status: "oppfylt" }))).toBe(false);
  });
});

describe("erPrognosepostIPeriode", () => {
  it("false for manglende post", () => {
    expect(erPrognosepostIPeriode(null, "2026-06-01", "2026-06-30")).toBe(false);
  });

  it("false for manglende dato", () => {
    expect(erPrognosepostIPeriode(post({ date: "" }), "2026-06-01", "2026-06-30")).toBe(false);
  });

  it("false for ugyldig dato", () => {
    expect(erPrognosepostIPeriode(post({ date: "ikke-en-dato" }), "2026-06-01", "2026-06-30")).toBe(
      false,
    );
  });

  it("true når datoen ligger innenfor perioden (inklusive grensene)", () => {
    expect(erPrognosepostIPeriode(post({ date: "2026-06-01" }), "2026-06-01", "2026-06-30")).toBe(
      true,
    );
    expect(erPrognosepostIPeriode(post({ date: "2026-06-30" }), "2026-06-01", "2026-06-30")).toBe(
      true,
    );
  });

  it("false når datoen ligger utenfor perioden", () => {
    expect(erPrognosepostIPeriode(post({ date: "2026-05-31" }), "2026-06-01", "2026-06-30")).toBe(
      false,
    );
    expect(erPrognosepostIPeriode(post({ date: "2026-07-01" }), "2026-06-01", "2026-06-30")).toBe(
      false,
    );
  });
});

describe("calcSpillerom", () => {
  it("summerer inn/ut kun for poster innenfor [fraDato, prognosisDate]", () => {
    const posts = [
      post({ id: "a", direction: "in", amount: 1000, date: "2026-06-10" }),
      post({ id: "b", direction: "out", amount: 300, date: "2026-06-20" }),
      post({ id: "c", direction: "out", amount: 999, date: "2026-07-01" }), // utenfor
    ];
    const result = calcSpillerom(5000, posts, "2026-06-30", "2026-06-01");
    expect(result).toEqual({
      disponibelt: 5000,
      innbetalinger: 1000,
      utbetalinger: 300,
      bundet: -700, // 300 - 1000
      spillerom: 5700, // 5000 + 1000 - 300
    });
  });

  it("behandler manglende/ugyldig saldo som 0", () => {
    const result = calcSpillerom(Number.NaN, [], "2026-06-30", "2026-06-01");
    expect(result.disponibelt).toBe(0);
    expect(result.spillerom).toBe(0);
  });

  it("ekskluderer poster uten dato", () => {
    const posts = [post({ direction: "in", amount: 500, date: "" })];
    const result = calcSpillerom(0, posts, "2026-06-30", "2026-06-01");
    expect(result.innbetalinger).toBe(0);
  });
});

describe("beregnStandardPrognosisDate", () => {
  it("gir dag 20 i inneværende måned når dagens dato er før den 20.", () => {
    expect(beregnStandardPrognosisDate(new Date(2026, 5, 10))).toBe("2026-06-20");
  });

  it("gir dag 20 i NESTE måned når dagens dato er den 20. eller senere", () => {
    expect(beregnStandardPrognosisDate(new Date(2026, 5, 20))).toBe("2026-07-20");
    expect(beregnStandardPrognosisDate(new Date(2026, 5, 25))).toBe("2026-07-20");
  });

  it("håndterer årsskifte", () => {
    expect(beregnStandardPrognosisDate(new Date(2026, 11, 25))).toBe("2027-01-20");
  });
});

describe("maanederIPeriode", () => {
  it("returnerer én måned når perioden ikke krysser et månedsskifte", () => {
    expect(maanederIPeriode(new Date(2026, 5, 5), new Date(2026, 5, 25))).toEqual([
      { aar: 2026, maaned: 5 },
    ]);
  });

  it("returnerer flere måneder når perioden krysser et skifte", () => {
    expect(maanederIPeriode(new Date(2026, 5, 25), new Date(2026, 7, 5))).toEqual([
      { aar: 2026, maaned: 5 },
      { aar: 2026, maaned: 6 },
      { aar: 2026, maaned: 7 },
    ]);
  });

  it("håndterer årsskifte", () => {
    expect(maanederIPeriode(new Date(2026, 11, 20), new Date(2027, 0, 10))).toEqual([
      { aar: 2026, maaned: 11 },
      { aar: 2027, maaned: 0 },
    ]);
  });
});

describe("generateForecastPosts", () => {
  const idSequence = (prefix: string) => {
    let n = 0;
    return () => `${prefix}-${(n += 1)}`;
  };

  function budgetGroup(overrides: Partial<ForecastGroup["items"][number]>): ForecastGroup[] {
    return [
      {
        id: "g1",
        label: "Faste utgifter",
        items: [
          {
            id: "i1",
            name: "Strøm",
            meta: {
              automatisk: true,
              forfallsdag: "15",
              oppforsel: "fast",
              eier: "Felles",
              niva: "nodvendig",
            },
            months: Array.from({ length: 12 }, () => ({ budget: 1000, spent: 0 })),
            ...overrides,
          },
        ],
      },
    ];
  }

  it("genererer én kostnadspost per måned i perioden for en automatisk budsjettpost", () => {
    const result = generateForecastPosts(
      budgetGroup({}),
      {},
      new Date(2026, 5, 1),
      new Date(2026, 5, 30),
      undefined,
      undefined,
      idSequence("gen"),
    );
    const posts = Object.values(result);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      name: "Strøm",
      amount: 1000,
      direction: "out",
      date: "2026-06-15",
      kilde: "generator",
      sourceType: "kostnader",
      owner: "Felles",
    });
  });

  it("bruker spent fremfor budget når spent > 0 (faktisk beløp)", () => {
    const result = generateForecastPosts(
      budgetGroup({ months: Array.from({ length: 12 }, () => ({ budget: 1000, spent: 1234 })) }),
      {},
      new Date(2026, 5, 1),
      new Date(2026, 5, 30),
      undefined,
      undefined,
      idSequence("gen"),
    );
    const [p] = Object.values(result);
    if (!p) throw new Error("expected a generated post");
    expect(p.amount).toBe(1234);
    expect(p.erEstimat).toBe(false);
  });

  it("hopper over poster uten meta.automatisk eller uten forfallsdag", () => {
    const noAuto = generateForecastPosts(
      budgetGroup({ meta: { automatisk: false, forfallsdag: "15" } }),
      {},
      new Date(2026, 5, 1),
      new Date(2026, 5, 30),
      undefined,
      undefined,
    );
    expect(Object.keys(noAuto)).toHaveLength(0);

    const noDag = generateForecastPosts(
      budgetGroup({ meta: { automatisk: true } }),
      {},
      new Date(2026, 5, 1),
      new Date(2026, 5, 30),
      undefined,
      undefined,
    );
    expect(Object.keys(noDag)).toHaveLength(0);
  });

  it("beholder manuelle poster uendret og fjerner gamle genererte poster som ikke er overstyrt", () => {
    const existing: Record<string, LiquidityPost> = {
      manuell1: { ...idPost("manuell1"), kilde: "manuell" },
      gammelGen: { ...idPost("gammelGen"), kilde: "generator", _genKey: "utdatert_key" },
    };
    const result = generateForecastPosts(
      budgetGroup({}),
      existing,
      new Date(2026, 5, 1),
      new Date(2026, 5, 30),
      undefined,
      undefined,
      idSequence("gen"),
    );
    expect(result.manuell1).toBeDefined();
    expect(result.gammelGen).toBeUndefined();
  });

  it("beholder en manuelt overstyrt generert post med samme _genKey i stedet for å regenerere den", () => {
    const overstyrtPost: LiquidityPost = {
      ...idPost("overstyrt"),
      kilde: "generator",
      amount: 9999,
      manueltOverstyrt: true,
      _genKey: "i1_2026_5_15",
    };
    const result = generateForecastPosts(
      budgetGroup({}),
      { overstyrt: overstyrtPost },
      new Date(2026, 5, 1),
      new Date(2026, 5, 30),
      undefined,
      undefined,
      idSequence("gen"),
    );
    const posts = Object.values(result);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.amount).toBe(9999);
    expect(posts[0]!.manueltOverstyrt).toBe(true);
  });

  it("tillater et negativt beløp for en sparepost (planlagt uttak) og teller det med motsatt fortegn", () => {
    const sparingGroups: ForecastGroup[] = [
      {
        id: "s1",
        label: "Sparing",
        items: [
          {
            id: "sp1",
            name: "Ferieuttak",
            meta: { automatisk: true, forfallsdag: "10", likviditet: "avsatt" },
            months: Array.from({ length: 12 }, () => ({ budget: -2000, spent: 0 })),
          },
        ],
      },
    ];
    const result = generateForecastPosts(
      [],
      {},
      new Date(2026, 5, 1),
      new Date(2026, 5, 30),
      undefined,
      sparingGroups,
      idSequence("gen"),
    );
    const [p] = Object.values(result);
    if (!p) throw new Error("expected a generated post");
    expect(p.amount).toBe(-2000);
    expect(p.direction).toBe("out");
    expect(p.sourceType).toBe("sparing");
  });

  it("genererer inntektspost med direction:in fra en automatisk inntektspost", () => {
    const incomeGroups: ForecastGroup[] = [
      {
        id: "inc1",
        label: "Inntekter",
        items: [
          {
            id: "lonn",
            name: "Lønn",
            meta: { automatisk: true, forfallsdag: "20" },
            months: Array.from({ length: 12 }, () => ({ budget: 30000, spent: 0 })),
          },
        ],
      },
    ];
    const result = generateForecastPosts(
      [],
      {},
      new Date(2026, 5, 1),
      new Date(2026, 5, 30),
      incomeGroups,
      undefined,
      idSequence("gen"),
    );
    const [p] = Object.values(result);
    if (!p) throw new Error("expected a generated post");
    expect(p.direction).toBe("in");
    expect(p.amount).toBe(30000);
    expect(p.sourceType).toBe("inntekter");
  });

  function idPost(id: string): LiquidityPost {
    return {
      id,
      name: "x",
      amount: 1,
      direction: "out",
      date: "2026-06-01",
      type: "fast",
      kilde: "manuell",
    };
  }
});
