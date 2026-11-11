/**
 * Funn F (#59, ordre 6665182330): generatorens tolkning av lagret
 * forfallsdag er uendret fra før F og lik legacy `generateForecastPosts`
 * (ordrett fra `index.html`). Diagnostikkens «utelatt»/«tolket» bygger på
 * `generatorForfallsdag`, så Spillerom aldri påstår noe annet enn det begge
 * klientene faktisk gjør. Syntetiske data; kjøres i både UTC og Europe/Oslo.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ForecastGroup, LiquidityPost } from "@app-types/liquidity";
import { idSequence, loadLegacy } from "../../test/legacy";
import { type PrognoseKildeType, generatorForfallsdag } from "./forfallsdag";
import { generateForecastPosts } from "./liquidity";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 5, 9));
});
afterAll(() => vi.useRealTimers());

type AnyFn = (...args: unknown[]) => unknown;
const lagLegacy = () =>
  loadLegacy<Record<string, AnyFn>>({
    functions: [
      "lokalKalenderdato",
      "forfallIMaaned",
      "kildeFelter",
      "bevisbarForekomst",
      "generertForekomst",
      "forekomstNokkel",
      "overstyringGjelder",
      "maanederIPeriode",
      "generateForecastPosts",
    ],
    globals: { uid: idSequence("id") },
  });

const tolv = (b: number) => Array.from({ length: 12 }, () => ({ budget: b, spent: 0 }));
const kilde = (id: string, forfallsdag: unknown, automatisk = true) => ({
  id,
  name: `Post ${id}`,
  meta: { automatisk, forfallsdag, oppforsel: "fast" },
  months: tolv(100),
});
const gr = (id: string, ...items: ReturnType<typeof kilde>[]) =>
  ({ id, label: id, items }) as unknown as ForecastGroup;
const form = (posts: Record<string, LiquidityPost>) =>
  Object.values(posts)
    .map((p) => ({ ...p, id: undefined, generatedAt: undefined }))
    .sort((a, b) => String(a._genKey).localeCompare(String(b._genKey)));

const VERDIER: unknown[] = ["", "0", "1", "31", "32", "1.5", "15abc", "abc", " 7", undefined];

describe("generatorForfallsdag speiler generatoren (web = legacy, uendret fra før F)", () => {
  const items = VERDIER.map((v, i) => kilde(`k${i}`, v));
  const grupper = [gr("bolig", ...items)];

  it.each<[PrognoseKildeType, "kost" | "inn" | "spar"]>([
    ["kostnader", "kost"],
    ["inntekter", "inn"],
    ["sparing", "spar"],
  ])("%s: samme poster som legacy, og «utelatt» ⇔ ingen poster", (type, hvor) => {
    const fra = new Date(2026, 10, 1);
    const til = new Date(2026, 11, 31);
    const kost = hvor === "kost" ? grupper : [];
    const inn = hvor === "inn" ? grupper : [];
    const spar = hvor === "spar" ? grupper : [];
    const w = generateForecastPosts(kost, {}, fra, til, inn, spar, idSequence("w"));
    const l = lagLegacy().generateForecastPosts!(
      kost,
      {},
      fra,
      til,
      undefined,
      inn,
      spar,
    ) as Record<string, LiquidityPost>;
    expect(form(w)).toEqual(form(l));
    for (const item of items) {
      const lagd = Object.values(w).some(
        (p) =>
          p.sourceBudgetItemId === item.id ||
          p.sourceSparingItemId === item.id ||
          p.sourceItemId === item.id,
      );
      const dag = generatorForfallsdag(type, item.meta.forfallsdag);
      expect({ id: item.id, lagd }).toEqual({ id: item.id, lagd: dag !== null });
    }
  });

  it("dokumentert forskjell for eldre ugyldige verdier (tolkes, ikke rettes)", () => {
    expect(generatorForfallsdag("kostnader", "15abc")).toBe(15);
    expect(generatorForfallsdag("kostnader", "1.5")).toBe(1);
    expect(generatorForfallsdag("kostnader", "32")).toBe(32); // klemmes til siste dag
    expect(generatorForfallsdag("kostnader", "0")).toBe(0); // siste dag i forrige måned
    expect(generatorForfallsdag("sparing", "0")).toBe(0);
    expect(generatorForfallsdag("inntekter", "0")).toBeNull();
    expect(generatorForfallsdag("kostnader", "")).toBeNull();
    expect(generatorForfallsdag("inntekter", "abc")).toBeNull();
    expect(generatorForfallsdag("sparing", undefined)).toBeNull();
  });
});
