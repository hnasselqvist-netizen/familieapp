/**
 * Funn H (#59, ordre 6669823460): uten lagret prognosedato bruker hele
 * React-Spillerom samme effektive standarddato som generatoren — hode,
 * periodefilter, totaler, saldoforløp, muligheter, tomtekst og datoknapp.
 * Visningen lagrer ingenting. Syntetiske data; datahook mocket.
 */
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Liquidity, LiquidityPost } from "@app-types/liquidity";
import { loaded, notLoaded } from "@app-types/status";

const kall = vi.hoisted(() => ({
  lagreDato: [] as string[],
  regenerer: 0,
  data: null as Liquidity | null,
}));

vi.mock("@hooks/useLiquidity", () => ({
  useLiquidity: () => ({
    liquidity: kall.data ? loaded(kall.data) : notLoaded,
    saveSaldo: async () => {},
    savePrognosisDate: async (d: string) => void kall.lagreDato.push(d),
    addPost: async () => {},
    removePost: async () => {},
    markFulfilled: async () => {},
    unmarkFulfilled: async () => {},
    editPost: async () => {},
    regenerate: async () => void kall.regenerer++,
    forfallsdagMangler: loaded([]),
  }),
}));
vi.mock("@hooks/useFamilyId", () => ({ useFamilyId: () => "familie1" }));
vi.mock("@data/budsjettfamilie.repository", () => ({ subscribeBudsjettGrupper: () => () => {} }));

const { SpilleromScreen } = await import("./SpilleromScreen");

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 10, 9, 0)); // 10. nov. 2026, lokal tid
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  kall.lagreDato = [];
  kall.regenerer = 0;
});

const post = (id: string, date: string, amount: number, o: Partial<LiquidityPost> = {}) =>
  ({
    id,
    name: id,
    amount,
    direction: "out",
    date,
    type: "fast",
    kilde: "manuell",
    ...o,
  }) as LiquidityPost;

function vis(prognosisDate: string, posts: LiquidityPost[]) {
  kall.data = {
    saldo: 20000,
    saldoUpdated: Date.now(),
    prognosisDate,
    lonnDay: 20,
    posts: Object.fromEntries(posts.map((p) => [p.id, p])),
  };
  return render(
    <MemoryRouter>
      <SpilleromScreen />
    </MemoryRouter>,
  );
}
const tekst = () => (document.body.textContent ?? "").replace(/\s/g, " ");

describe("Spillerom uten lagret prognosedato", () => {
  const POSTER = [
    post("Strøm", "2026-11-15", 1000),
    post("Husleie", "2026-11-20", 5000, { kilde: "generator", manueltOverstyrt: true }),
    post("Etter", "2026-11-21", 9999),
  ];

  it("alle visninger bruker standarddatoen 20. nov.; poster etter grensen er utenfor", () => {
    vis("", POSTER);
    const t = tekst();
    expect(t).toContain("Spillerom til 20. nov.");
    expect(t).toContain("14 000 kr"); // 20 000 − 1 000 − 5 000
    expect(t).toContain("−6 000 kr");
    expect(t).toContain("Strøm");
    expect(t).toContain("Husleie");
    expect(t).not.toContain("Etter");
    expect(t).not.toContain("Velg dato");
    expect(t).not.toContain("Ingen poster i perioden");
    const knapp = screen.getByRole("button", { name: /Endre prognosedato/ });
    expect(knapp).toHaveAccessibleName("Endre prognosedato, nå 20. nov. (standard, ikke lagret)");
    expect(kall.lagreDato).toEqual([]);
  });

  it("tom periode: tomteksten nevner den effektive datoen", () => {
    vis("", [post("Etter", "2026-11-21", 9999)]);
    expect(tekst()).toContain("Ingen poster i perioden frem til 20. nov.");
    expect(kall.lagreDato).toEqual([]);
  });

  it("lagret dato brukes som før, uten standardmerke", () => {
    vis("2026-11-30", POSTER);
    const t = tekst();
    expect(t).toContain("Spillerom til 30. nov.");
    expect(t).toContain("Etter");
    expect(screen.getByRole("button", { name: /Endre prognosedato/ })).toHaveAccessibleName(
      "Endre prognosedato, nå 30. nov.",
    );
  });

  it("passert lagret dato respekteres og vises som passert, ikke rullet", () => {
    vis("2026-10-31", POSTER);
    const knapp = screen.getByRole("button", { name: /Endre prognosedato/ });
    expect(knapp).toHaveTextContent("31. okt. · passert");
    expect(tekst()).toContain("Ingen poster i perioden frem til 31. okt.");
    expect(kall.lagreDato).toEqual([]);
  });
});
