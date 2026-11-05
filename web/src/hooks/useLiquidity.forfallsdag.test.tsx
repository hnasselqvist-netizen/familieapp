/**
 * Funn F: `useLiquidity().forfallsdagMangler` via EKTE
 * `data/liquidity.repository` mot en styrbar falsk RTDB. Låser at
 * diagnostikken er `loading` til alle tre kildene har svart, `error` når en
 * lytter avvises, følger live retting, og nullstilles ved familiebytte.
 * Ingen skriving skjer fra diagnostikken. Syntetiske data.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Snap = { val: () => unknown; exists: () => boolean };
type Lytter = { sti: string; cb: (s: Snap) => void; feil?: (e: Error) => void };
const db = vi.hoisted(() => ({
  lyttere: [] as Lytter[],
  skrivinger: [] as string[],
  familie: { id: "familie1" },
}));

vi.mock("@data/firebase", () => ({ getFirebaseDatabase: () => ({}) }));
vi.mock("firebase/database", () => ({
  ref: (_db: unknown, sti: string) => ({ sti }),
  onValue: (r: { sti: string }, cb: Lytter["cb"], feil?: Lytter["feil"]) => {
    const l = { sti: r.sti, cb, feil };
    db.lyttere.push(l);
    return () => {
      db.lyttere = db.lyttere.filter((x) => x !== l);
    };
  },
  set: async (r: { sti: string }) => void db.skrivinger.push(r.sti),
  update: async (r: { sti: string }) => void db.skrivinger.push(r.sti),
  runTransaction: async (r: { sti: string }) => void db.skrivinger.push(r.sti),
}));
vi.mock("./useFamilyId", () => ({ useFamilyId: () => db.familie.id }));

const { useLiquidity } = await import("./useLiquidity");

function lever(sti: string, verdi: unknown) {
  for (const l of db.lyttere.filter((x) => x.sti === sti))
    l.cb({ val: () => verdi, exists: () => verdi !== null });
}
function avvis(sti: string) {
  for (const l of db.lyttere.filter((x) => x.sti === sti)) l.feil?.(new Error("permission_denied"));
}
const post = (forfallsdag: string, automatisk = true) => ({
  name: "Husleie",
  months: { 10: { budget: 100, spent: 0 } },
  meta: { automatisk, forfallsdag },
});

beforeEach(() => {
  db.lyttere = [];
  db.skrivinger = [];
  db.familie.id = "familie1";
});

describe("useLiquidity().forfallsdagMangler", () => {
  it("loading til alle tre kildene har svart; deretter mangler med identitet", () => {
    const { result } = renderHook(() => useLiquidity());
    expect(result.current.forfallsdagMangler.status).toBe("loading");
    act(() => lever("families/familie1/budget", { bolig: { x: post("") } }));
    act(() => lever("families/familie1/incomeGroups", null));
    expect(result.current.forfallsdagMangler.status).toBe("loading");
    act(() => lever("families/familie1/sparingGroups", null));
    expect(result.current.forfallsdagMangler).toMatchObject({
      status: "loaded",
      data: [{ type: "kostnader", gruppeId: "bolig", postId: "x", status: "utelatt" }],
    });
  });

  it("live retting: gyldig dag fjerner varselet; ny feil viser det igjen", () => {
    const { result } = renderHook(() => useLiquidity());
    act(() => {
      lever("families/familie1/budget", { bolig: { x: post("") } });
      lever("families/familie1/incomeGroups", null);
      lever("families/familie1/sparingGroups", null);
    });
    expect(result.current.forfallsdagMangler.data).toHaveLength(1);
    act(() => lever("families/familie1/budget", { bolig: { x: post("25") } }));
    expect(result.current.forfallsdagMangler).toMatchObject({ status: "loaded", data: [] });
    act(() => lever("families/familie1/budget", { bolig: { x: post("32") } }));
    expect(result.current.forfallsdagMangler.data?.[0]).toMatchObject({ verdi: "32" });
  });

  it("avvist lytter gir error, også om de andre har svart", () => {
    const { result } = renderHook(() => useLiquidity());
    act(() => {
      lever("families/familie1/budget", null);
      lever("families/familie1/incomeGroups", null);
      avvis("families/familie1/sparingGroups");
    });
    expect(result.current.forfallsdagMangler.status).toBe("error");
    act(() => lever("families/familie1/budget", { bolig: { x: post("") } }));
    expect(result.current.forfallsdagMangler.status).toBe("error");
  });

  it("familiebytte: nullstilles til loading, og gamle mangler vises ikke", () => {
    const { result, rerender } = renderHook(() => useLiquidity());
    act(() => {
      lever("families/familie1/budget", { bolig: { x: post("") } });
      lever("families/familie1/incomeGroups", null);
      lever("families/familie1/sparingGroups", null);
    });
    expect(result.current.forfallsdagMangler.data).toHaveLength(1);
    db.familie.id = "familie2";
    rerender();
    expect(result.current.forfallsdagMangler.status).toBe("loading");
    expect(db.lyttere.some((l) => l.sti.startsWith("families/familie1/"))).toBe(false);
    act(() => {
      lever("families/familie2/budget", null);
      lever("families/familie2/incomeGroups", null);
      lever("families/familie2/sparingGroups", null);
    });
    expect(result.current.forfallsdagMangler).toMatchObject({ status: "loaded", data: [] });
  });

  it("diagnostikken skriver ingenting (liquidity ikke lastet → ingen regenerering)", () => {
    renderHook(() => useLiquidity());
    act(() => {
      lever("families/familie1/budget", { bolig: { x: post("") } });
      lever("families/familie1/incomeGroups", null);
      lever("families/familie1/sparingGroups", null);
    });
    expect(db.skrivinger).toEqual([]);
  });
});
