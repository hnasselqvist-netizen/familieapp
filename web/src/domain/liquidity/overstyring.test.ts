/**
 * Funn E (#59, ordre 6658205196): en manuelt overstyrt generert
 * månedsforekomst har forrang for samme kilde/type/år/måned, også når
 * forfallsdagen senere endres — generatoren lager ingen ekstra post.
 * Kalenderforventninger, så testene gjelder i både UTC og Europe/Oslo.
 * Syntetiske data.
 */
import { describe, expect, it } from "vitest";
import type { ForecastGroup, LiquidityPost } from "@app-types/liquidity";
import { generateForecastPosts, generertForekomst } from "./liquidity";

const tolv = (b: number) => Array.from({ length: 12 }, () => ({ budget: b, spent: 0 }));
const kilde = (id: string, dag: string, b = 100) => ({
  id,
  name: id,
  meta: { automatisk: true, forfallsdag: dag, oppforsel: "fast" },
  months: tolv(b),
});
const g = (...items: ReturnType<typeof kilde>[]) =>
  [{ id: "grp", label: "Grp", items }] as unknown as ForecastGroup[];

type Type = "kostnader" | "sparing" | "inntekter";
/** En overstyrt post slik generatoren lager den, med brukerens beløp/dato. */
function overstyrt(
  type: Type,
  id: string,
  aar: number,
  maaned: number,
  dag: number,
  o: Partial<LiquidityPost> = {},
): LiquidityPost {
  const prefiks = type === "kostnader" ? id : type === "sparing" ? `spar_${id}` : `inc_${id}`;
  const felt =
    type === "kostnader"
      ? { sourceBudgetItemId: id }
      : type === "sparing"
        ? { sourceSparingItemId: id, sourceId: id }
        : { sourceItemId: id };
  return {
    id: `o-${type}-${id}-${aar}-${maaned}-${dag}`,
    name: id,
    amount: 150,
    direction: type === "inntekter" ? "in" : "out",
    date: `${aar}-${String(maaned + 1).padStart(2, "0")}-${String(dag).padStart(2, "0")}`,
    kilde: "generator",
    manueltOverstyrt: true,
    sourceType: type,
    _genKey: `${prefiks}_${aar}_${maaned}_${dag}`,
    ...felt,
    ...o,
  } as LiquidityPost;
}
let n = 0;
const nyId = () => `n${++n}`;
function generer(
  finnes: LiquidityPost[],
  grupper: { kost?: ForecastGroup[]; inn?: ForecastGroup[]; spar?: ForecastGroup[] },
  fra = new Date(2026, 10, 1),
  til = new Date(2026, 11, 31),
) {
  return Object.values(
    generateForecastPosts(
      grupper.kost ?? [],
      Object.fromEntries(finnes.map((p) => [p.id, p])),
      fra,
      til,
      grupper.inn ?? [],
      grupper.spar ?? [],
      nyId,
    ),
  );
}
const kort = (p: LiquidityPost[]) =>
  p.map((x) => `${x.date} ${x.amount}${x.manueltOverstyrt ? " overstyrt" : ""}`).sort();

describe("forfall 20 → 25 med overstyrt 150 i november", () => {
  it.each<[Type, "kost" | "inn" | "spar"]>([
    ["kostnader", "kost"],
    ["sparing", "spar"],
    ["inntekter", "inn"],
  ])("%s: bare bevart 150 i november; desember får standard 100 på den 25.", (type, gr) => {
    const o = overstyrt(type, "k", 2026, 10, 20);
    const p = generer([o], { [gr]: g(kilde("k", "25")) });
    expect(kort(p)).toEqual(["2026-11-20 150 overstyrt", "2026-12-25 100"]);
    expect(p.find((x) => x.id === o.id)).toEqual(o); // ID, nøkkel, dato, beløp og metadata uendret
  });
});

describe("identitet: ingen kollisjon mellom domener eller prefikser", () => {
  it("overstyrt sparepost «x» undertrykker ikke kostnadsposten «spar_x» eller inntekten «x»", () => {
    const o = overstyrt("sparing", "x", 2026, 10, 20);
    const p = generer([o], {
      kost: g(kilde("spar_x", "25"), kilde("x", "25")),
      inn: g(kilde("x", "25")),
      spar: g(kilde("x", "25")),
    });
    const keys = p.map((x) => x._genKey).sort();
    expect(keys).toContain("spar_x_2026_10_25"); // kostnad «spar_x», november
    expect(keys).toContain("x_2026_10_25"); // kostnad «x», november
    expect(keys).toContain("inc_x_2026_10_25"); // inntekt «x», november
    expect(keys).not.toContain("spar_spar_x_2026_10_25"); // ingen sparekilde «spar_x»
    expect(p.filter((x) => x.sourceType === "sparing" && x.date?.startsWith("2026-11"))).toEqual([
      o,
    ]);
  });

  it("kilde-ID med understreker tolkes riktig", () => {
    const o = overstyrt("kostnader", "a_b_c", 2026, 10, 20);
    expect(generertForekomst(o)).toBe(JSON.stringify(["kostnader", "a_b_c", 2026, 10]));
    const p = generer([o], { kost: g(kilde("a_b_c", "25")) });
    expect(kort(p)).toEqual(["2026-11-20 150 overstyrt", "2026-12-25 100"]);
  });
});

describe("identiteten følger opprinnelig forekomst, ikke lagret dato", () => {
  it("overstyrt novemberpost flyttet til 5. desember: november undertrykkes, desember får standard", () => {
    const o = overstyrt("kostnader", "k", 2026, 10, 20, { date: "2026-12-05" });
    const p = generer([o], { kost: g(kilde("k", "25")) });
    expect(kort(p)).toEqual(["2026-12-05 150 overstyrt", "2026-12-25 100"]);
  });

  it("desember–januar og korte måneder", () => {
    const des = overstyrt("kostnader", "k", 2026, 11, 20);
    const feb = overstyrt("kostnader", "f", 2027, 1, 31, { date: "2027-02-28" });
    const p = generer(
      [des, feb],
      { kost: g(kilde("k", "5"), kilde("f", "15")) },
      new Date(2026, 11, 1),
      new Date(2027, 2, 31),
    );
    expect(
      p
        .filter((x) => x.name === "k")
        .map((x) => x.date)
        .sort(),
    ).toEqual([
      "2026-12-20", // overstyrt
      "2027-01-05",
      "2027-02-05",
      "2027-03-05",
    ]);
    expect(
      p
        .filter((x) => x.name === "f")
        .map((x) => x.date)
        .sort(),
    ).toEqual([
      "2026-12-15",
      "2027-01-15",
      "2027-02-28", // overstyrt
      "2027-03-15",
    ]);
  });
});

describe("ufullstendig eller flertydig identitet: dagens oppførsel, ingenting fjernes", () => {
  it.each([
    ["mangler sourceType", { sourceType: undefined }],
    ["mangler kilde-ID", { sourceBudgetItemId: undefined }],
    ["kilde-ID motsier _genKey", { sourceBudgetItemId: "annen" }],
    ["feil type for prefiks", { sourceType: "inntekter" as const, sourceItemId: "k" }],
    ["ugyldig _genKey", { _genKey: "k_nov_20" }],
  ])("%s: overstyrt bevares, og ny forfallsdag gir standardpost som før", (_n, o) => {
    const post = overstyrt("kostnader", "k", 2026, 10, 20, o as Partial<LiquidityPost>);
    expect(generertForekomst(post)).toBeNull();
    const p = generer([post], { kost: g(kilde("k", "25")) });
    expect(p.find((x) => x.id === post.id)).toEqual(post);
    expect(p.some((x) => x._genKey === "k_2026_10_25")).toBe(true);
  });

  it("uendret forfallsdag uten bevisbar identitet: eksakt _genKey undertrykker fortsatt", () => {
    const post = overstyrt("kostnader", "k", 2026, 10, 20, { sourceType: undefined });
    const p = generer([post], { kost: g(kilde("k", "20")) });
    expect(kort(p)).toEqual(["2026-11-20 150 overstyrt", "2026-12-20 100"]);
  });
});

describe("flere overstyringer og ikke-overstyrt gjenkjøring", () => {
  it("to overstyringer av samme forekomst bevares begge; ingen standardpost; ingen sammenslåing", () => {
    const a = overstyrt("inntekter", "lonn", 2026, 10, 20);
    const b = overstyrt("inntekter", "lonn", 2026, 10, 22, { amount: 175 });
    const p = generer([a, b], { inn: g(kilde("lonn", "25")) });
    expect(kort(p)).toEqual([
      "2026-11-20 150 overstyrt",
      "2026-11-22 175 overstyrt",
      "2026-12-25 100",
    ]);
  });

  it("ikke-overstyrt generert post med gammel dag erstattes av ny; ingen dobbel", () => {
    const gammel = { ...overstyrt("kostnader", "k", 2026, 10, 20), manueltOverstyrt: false };
    const p = generer([gammel], { kost: g(kilde("k", "25")) });
    expect(kort(p)).toEqual(["2026-11-25 100", "2026-12-25 100"]);
  });

  it("gjenkjøring er stabil: samme utfall andre gang", () => {
    const o = overstyrt("sparing", "s", 2026, 10, 20);
    const forste = generer([o], { spar: g(kilde("s", "25")) });
    const andre = generer(forste, { spar: g(kilde("s", "25")) });
    expect(kort(andre)).toEqual(kort(forste));
  });
});
