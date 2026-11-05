/**
 * Legacy-paritet for prognosedatoer (#59, ordre 6655518240): legacy sin
 * `generateForecastPosts`/`beregnStandardPrognosisDate` trekkes ut ORDRETT
 * fra `index.html` og kjøres side om side med web-porten på de samme
 * syntetiske datoeksemplene (dag 20, dag 29–31, februar/skuddår,
 * desember–januar, sommertid). Kjøres i både `TZ=UTC` og `TZ=Europe/Oslo`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ForecastGroup, LiquidityPost } from "@app-types/liquidity";
import { idSequence, loadLegacy } from "../../test/legacy";
import { beregnStandardPrognosisDate, generateForecastPosts } from "./liquidity";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 5, 9));
});
afterAll(() => vi.useRealTimers());

type AnyFn = (...args: unknown[]) => unknown;
const lagLegacy = () =>
  loadLegacy<Record<string, AnyFn>>({
    functions: [
      "beregnStandardPrognosisDate",
      "lokalKalenderdato",
      "forfallIMaaned",
      "generertForekomst",
      "forekomstNokkel",
      "maanederIPeriode",
      "generateForecastPosts",
    ],
    globals: { uid: idSequence("id") },
  });

const tolv = (b: number) => Array.from({ length: 12 }, () => ({ budget: b, spent: 0 }));
const post = (id: string, dag: string) => ({
  id,
  name: id,
  meta: { automatisk: true, forfallsdag: dag, oppforsel: "fast" },
  months: tolv(1000),
});
const g = (...items: ReturnType<typeof post>[]) =>
  [{ id: "g", label: "G", items }] as unknown as ForecastGroup[];

/** Sammenlignbar form: id og tidsstempel er ikke en del av datosemantikken. */
const form = (posts: Record<string, LiquidityPost>) =>
  Object.values(posts)
    .map((p) => ({ ...p, id: undefined, generatedAt: undefined }))
    .sort((a, b) => String(a._genKey).localeCompare(String(b._genKey)));

const EKSEMPLER: [string, Date, Date][] = [
  ["november, dag 20", new Date(2026, 10, 1), new Date(2026, 10, 30)],
  ["februar–april, dag 29–31", new Date(2026, 1, 1), new Date(2026, 3, 30)],
  ["skuddår februar 2028", new Date(2028, 1, 1), new Date(2028, 1, 29)],
  ["desember–januar", new Date(2026, 11, 1), new Date(2027, 0, 31)],
  ["sommertid mars–oktober", new Date(2026, 2, 1), new Date(2026, 9, 31)],
];
const KOST = g(post("k20", "20"), post("k31", "31"), post("k29", "29"));
const INN = g(post("i30", "30"), post("i20", "20"));
const SPAR = g(post("s31", "31"));

describe("legacy og web gir samme prognoseposter", () => {
  it.each(EKSEMPLER)("%s", (_navn, fra, til) => {
    const legacy = lagLegacy();
    const l = legacy.generateForecastPosts!(KOST, {}, fra, til, undefined, INN, SPAR) as Record<
      string,
      LiquidityPost
    >;
    const w = generateForecastPosts(KOST, {}, fra, til, INN, SPAR, idSequence("w"));
    expect(form(w)).toEqual(form(l));
    // Og datoene er i riktig måned (ingen overflyt): måneden i datoen = måneden i nøkkelen.
    for (const p of Object.values(w)) {
      const [aar, maaned] = p._genKey!.split("_").slice(-3, -1).map(Number) as [number, number];
      expect(p.date!.slice(0, 7), p._genKey).toBe(`${aar}-${String(maaned + 1).padStart(2, "0")}`);
    }
  });

  it("standard prognosedato er lik, også over årsskiftet og rett etter midnatt", () => {
    const legacy = lagLegacy();
    for (const naa of [
      new Date(2026, 5, 3, 9),
      new Date(2026, 5, 20, 9),
      new Date(2026, 11, 24, 9),
      new Date(2026, 9, 1, 0, 30),
    ]) {
      expect(legacy.beregnStandardPrognosisDate!(naa)).toBe(beregnStandardPrognosisDate(naa));
    }
    expect(legacy.beregnStandardPrognosisDate!(new Date(2026, 9, 1, 0, 30))).toBe("2026-10-20");
  });
});

describe("funn E: legacy og web håndterer overstyrte forekomster likt", () => {
  const ov = (o: Record<string, unknown>) =>
    ({
      kilde: "generator",
      manueltOverstyrt: true,
      amount: 150,
      direction: "out",
      ...o,
    }) as LiquidityPost;
  const FINNES: Record<string, LiquidityPost> = {
    a: ov({
      id: "a",
      name: "k20",
      date: "2026-11-20",
      _genKey: "k20_2026_10_20",
      sourceType: "kostnader",
      sourceBudgetItemId: "k20",
    }),
    b: ov({
      id: "b",
      name: "s31",
      date: "2026-12-05",
      _genKey: "spar_s31_2026_10_31",
      sourceType: "sparing",
      sourceSparingItemId: "s31",
    }),
    c: ov({
      id: "c",
      name: "i20",
      date: "2026-11-20",
      _genKey: "inc_i20_2026_10_20",
      sourceType: "inntekter",
      sourceItemId: "i20",
      direction: "in",
    }),
    d: ov({ id: "d", name: "k31", date: "2026-11-30", _genKey: "k31_2026_10_31" }), // uten kildefelt
  };
  // Endret forfallsdag for alle kilder etter at forekomstene ble overstyrt.
  const kost = g(post("k20", "25"), post("k31", "15"));
  const inn = g(post("i20", "25"));
  const spar = g(post("s31", "10"));

  it("november–desember med endret forfallsdag", () => {
    const fra = new Date(2026, 10, 1);
    const til = new Date(2026, 11, 31);
    const l = lagLegacy().generateForecastPosts!(
      kost,
      FINNES,
      fra,
      til,
      undefined,
      inn,
      spar,
    ) as Record<string, LiquidityPost>;
    const w = generateForecastPosts(kost, FINNES, fra, til, inn, spar, idSequence("w"));
    expect(form(w)).toEqual(form(l));
    // De overstyrte forekomstene med bevisbar identitet får ingen ekstra novemberpost.
    const nov = (navn: string) =>
      Object.values(w).filter((p) => p.name === navn && p._genKey?.includes("_2026_10_"));
    expect(nov("k20")).toEqual([FINNES.a]);
    expect(nov("s31")).toEqual([FINNES.b]);
    expect(nov("i20")).toEqual([FINNES.c]);
    // Uten kildefelt: dagens oppførsel (overstyrt bevart + ny standardpost).
    expect(
      nov("k31")
        .map((p) => p._genKey)
        .sort(),
    ).toEqual(["k31_2026_10_15", "k31_2026_10_31"]);
  });
});
