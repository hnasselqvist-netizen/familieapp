/**
 * Prognosedato i lokal kalender og klemt forfallsdag (#59, ordre
 * 6655518240; funn B og C i docs/arkitektur/forvaltning-praktiske-hull.md).
 * Alle forventninger er kalenderstrenger, så samme test gjelder i både
 * `TZ=UTC` og `TZ=Europe/Oslo` (CI kjører begge, `npm run test:tz-oslo`).
 * Syntetiske data.
 */
import { describe, expect, it } from "vitest";
import type { ForecastGroup, LiquidityPost } from "@app-types/liquidity";
import {
  beregnStandardPrognosisDate,
  calcSpillerom,
  erPrognosepostIPeriode,
  forfallIMaaned,
  generateForecastPosts,
  lokalKalenderdato,
} from "./liquidity";

const tolv = (b: number) => Array.from({ length: 12 }, () => ({ budget: b, spent: 0 }));
const post = (id: string, dag: string, b = 1000) => ({
  id,
  name: id,
  meta: { automatisk: true, forfallsdag: dag, oppforsel: "fast" },
  months: tolv(b),
});
const grupper = (...items: ReturnType<typeof post>[]) =>
  [{ id: "g", label: "G", items }] as unknown as ForecastGroup[];
let n = 0;
const id = () => `p${++n}`;
const generer = (
  fra: Date,
  til: Date,
  kost: ForecastGroup[] = [],
  inn: ForecastGroup[] = [],
  spar: ForecastGroup[] = [],
  finnes: Record<string, LiquidityPost> = {},
) => Object.values(generateForecastPosts(kost, finnes, fra, til, inn, spar, id));
const datoer = (p: LiquidityPost[]) => p.map((x) => [x._genKey, x.date]);

describe("kjøremiljø", () => {
  it.runIf(Intl.DateTimeFormat().resolvedOptions().timeZone === "Europe/Oslo")(
    "Oslo-kjøringen er faktisk norsk tid",
    () => {
      expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(-60);
      expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(-120);
    },
  );
});

describe("lokalKalenderdato og forfallIMaaned", () => {
  it("lokal kalenderdag, uten UTC-forskyvning, også rett etter midnatt", () => {
    expect(lokalKalenderdato(new Date(2026, 10, 20))).toBe("2026-11-20");
    expect(lokalKalenderdato(new Date(2026, 0, 1, 0, 5))).toBe("2026-01-01");
    expect(lokalKalenderdato(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31");
  });

  it("dag 29–31 klemmes til siste dag; gyldige dager er uendret", () => {
    const d = (a: number, m: number, dag: number) => lokalKalenderdato(forfallIMaaned(a, m, dag));
    expect(d(2026, 1, 31)).toBe("2026-02-28");
    expect(d(2026, 1, 29)).toBe("2026-02-28");
    expect(d(2028, 1, 31)).toBe("2028-02-29"); // skuddår
    expect(d(2028, 1, 29)).toBe("2028-02-29");
    expect(d(2026, 3, 31)).toBe("2026-04-30");
    expect(d(2026, 2, 31)).toBe("2026-03-31");
    expect(d(2026, 1, 28)).toBe("2026-02-28");
    expect(d(2026, 10, 1)).toBe("2026-11-01");
  });
});

describe("beregnStandardPrognosisDate: dag 20 i lokal kalender", () => {
  it("før, på og etter den 20., og over årsskiftet", () => {
    expect(beregnStandardPrognosisDate(new Date(2026, 5, 3, 9))).toBe("2026-06-20");
    expect(beregnStandardPrognosisDate(new Date(2026, 5, 20, 9))).toBe("2026-07-20");
    expect(beregnStandardPrognosisDate(new Date(2026, 11, 24, 9))).toBe("2027-01-20");
    // Rett etter midnatt (der toISOString ga «i går» i norsk tid).
    expect(beregnStandardPrognosisDate(new Date(2026, 9, 1, 0, 30))).toBe("2026-10-20");
  });
});

describe("generateForecastPosts: datoer (B) og korte måneder (C)", () => {
  it("kostnad, inntekt og sparing får konfigurert dag, ikke dagen før", () => {
    const p = generer(
      new Date(2026, 10, 1),
      new Date(2026, 10, 30),
      grupper(post("husleie", "20")),
      grupper(post("lonn", "20")),
      grupper(post("spar", "25")),
    );
    expect(datoer(p)).toEqual([
      ["husleie_2026_10_20", "2026-11-20"],
      ["spar_spar_2026_10_25", "2026-11-25"],
      ["inc_lonn_2026_10_20", "2026-11-20"],
    ]);
  });

  it("dag 31 over februar–april: én post per måned, i riktig måned; _genKey har konfigurert dag", () => {
    const p = generer(
      new Date(2026, 1, 1),
      new Date(2026, 3, 30),
      grupper(post("k", "31")),
      grupper(post("i", "30")),
      grupper(post("s", "29")),
    );
    expect(datoer(p)).toEqual([
      ["k_2026_1_31", "2026-02-28"],
      ["k_2026_2_31", "2026-03-31"],
      ["k_2026_3_31", "2026-04-30"],
      ["spar_s_2026_1_29", "2026-02-28"],
      ["spar_s_2026_2_29", "2026-03-29"],
      ["spar_s_2026_3_29", "2026-04-29"],
      ["inc_i_2026_1_30", "2026-02-28"],
      ["inc_i_2026_2_30", "2026-03-30"],
      ["inc_i_2026_3_30", "2026-04-30"],
    ]);
    // Ingen måned har to poster fra samme kilde.
    const perMaaned = p.map(
      (x) => `${x._genKey?.split("_").slice(0, -2).join("_")}:${x.date!.slice(0, 7)}`,
    );
    expect(new Set(perMaaned).size).toBe(perMaaned.length);
  });

  it("skuddår: dag 31 i februar 2028 blir 29.", () => {
    const p = generer(new Date(2028, 1, 1), new Date(2028, 1, 29), grupper(post("k", "31")));
    expect(datoer(p)).toEqual([["k_2028_1_31", "2028-02-29"]]);
  });

  it("desember–januar: hver måned får sin dag; år i nøkkel og dato følger kalenderen", () => {
    const p = generer(new Date(2026, 11, 1), new Date(2027, 0, 31), grupper(post("k", "31")));
    expect(datoer(p)).toEqual([
      ["k_2026_11_31", "2026-12-31"],
      ["k_2027_0_31", "2027-01-31"],
    ]);
  });

  it("sommertid (mars/oktober): dagene rundt skiftet blir riktige", () => {
    const p = generer(
      new Date(2026, 2, 1),
      new Date(2026, 9, 31),
      grupper(post("mars", "29"), post("okt", "25")),
    );
    const d = Object.fromEntries(p.map((x) => [x._genKey, x.date]));
    expect(d["mars_2026_2_29"]).toBe("2026-03-29"); // DST starter 29.03.2026
    expect(d["okt_2026_9_25"]).toBe("2026-10-25"); // DST slutter 25.10.2026
  });

  it("periodegrenser: forfall på fra- og til-dagen er med; dagen etter er ikke", () => {
    const p = generer(
      new Date(2026, 10, 20, 9),
      new Date("2026-12-20"),
      grupper(post("fra", "20"), post("etter", "21")),
    );
    expect(datoer(p)).toEqual([
      ["fra_2026_10_20", "2026-11-20"],
      ["fra_2026_11_20", "2026-12-20"],
      ["etter_2026_10_21", "2026-11-21"],
    ]);
  });

  it("manuelle og overstyrte poster beholdes med lagret dato; overstyrt nøkkel genereres ikke på nytt", () => {
    const manuell = {
      id: "m",
      name: "M",
      amount: 5,
      direction: "out",
      date: "2026-11-19",
      kilde: "manuell",
    } as LiquidityPost;
    const overstyrt = {
      id: "o",
      name: "K",
      amount: 999,
      direction: "out",
      date: "2026-11-19",
      kilde: "generator",
      manueltOverstyrt: true,
      _genKey: "k_2026_10_20",
    } as LiquidityPost;
    const gammelGenerert = {
      ...overstyrt,
      id: "g",
      manueltOverstyrt: false,
      _genKey: "k_2026_10_20",
    };
    const p = generer(
      new Date(2026, 10, 1),
      new Date(2026, 10, 30),
      grupper(post("k", "20")),
      [],
      [],
      { m: manuell, o: overstyrt, g: gammelGenerert },
    );
    expect(p.find((x) => x.id === "m")).toEqual(manuell);
    expect(p.find((x) => x.id === "o")).toEqual(overstyrt);
    expect(p.find((x) => x.id === "g")).toBeUndefined();
    expect(p.filter((x) => x._genKey === "k_2026_10_20")).toEqual([overstyrt]);
  });
});

describe("lesesiden: lagret YYYY-MM-DD tas med på riktig dag", () => {
  const p = (date: string) =>
    ({ id: date, name: date, amount: 100, direction: "out", date }) as LiquidityPost;
  it("i dag og prognosedagen er med, dagen etter er ikke", () => {
    const idag = new Date(2026, 10, 5, 9);
    expect(erPrognosepostIPeriode(p("2026-11-05"), idag, "2026-11-20")).toBe(true);
    expect(erPrognosepostIPeriode(p("2026-11-20"), idag, "2026-11-20")).toBe(true);
    expect(erPrognosepostIPeriode(p("2026-11-21"), idag, "2026-11-20")).toBe(false);
    expect(
      calcSpillerom(1000, [p("2026-11-05"), p("2026-11-20"), p("2026-11-21")], "2026-11-20", idag)
        .utbetalinger,
    ).toBe(200);
  });
});
