import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";
import { MealLibraryScreen } from "./MealLibraryScreen";

/**
 * «Slett middag» med avgrenset ventetid (Mat #20, review 5950868309 P2).
 * EKTE `useMealLibrary` og EKTE `mealLibrary.repository`; bare transporten er
 * byttet ut: innlogging, REST-adresse, abonnement og `fetch`. En forespørsel
 * som henger, ignorerer avbruddet (slik et nett uten svar kan gjøre). Klokken
 * spoles forbi fristen.
 */

vi.mock("@data/firebase", () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken: () => Promise.resolve("token") } }),
  getFirebaseDatabase: () => ({}),
  databaseRestUrl: (sti: string) => new URL(`https://db.test/${sti}.json`),
}));
const NODE = { m1: { name: "Pizza", _mcp: { n: 1 } } };
vi.mock("firebase/database", async (orig) => ({
  ...(await orig<typeof import("firebase/database")>()),
  ref: () => ({}),
  onValue: (_r: unknown, cb: (s: unknown) => void) => {
    cb({
      exists: () => true,
      val: () => NODE,
      child: (id: string) => ({ exportVal: () => NODE[id as keyof typeof NODE] }),
    });
    return () => {};
  },
}));
vi.mock("@hooks/useItems", () => ({
  useItems: () => ({ items: loaded([]), findOrCreateItem: vi.fn() }),
}));
vi.mock("@hooks/useRecipes", () => ({ useRecipes: () => ({ recipes: loaded([]) }) }));

const svar = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ETag: "etag-1" } });
/** Et svar som ignorerer avbruddet og kommer først når testen slipper det. */
function sen() {
  let slipp!: () => void;
  const port = new Promise<void>((r) => (slipp = r));
  return { res: () => port.then(() => svar(NODE.m1)), slipp: () => slipp() };
}
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let kall: string[] = [];
function brukFetch(skript: (() => Promise<Response>)[]) {
  kall = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (_input, init) => {
    kall.push(init?.method ?? "GET");
    const steg = skript[kall.length - 1];
    if (!steg) throw new Error(`uventet kall nr. ${kall.length}`);
    return steg();
  }) as Fetch);
}
async function slett({ venter = true } = {}) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<MealLibraryScreen />);
  await user.click(screen.getByText("Pizza"));
  await user.click(screen.getByRole("button", { name: /Slett middag/ }));
  await user.click(screen.getByRole("button", { name: "Slett" }));
  if (venter) {
    expect(screen.getByRole("status")).toHaveTextContent("Sletter «Pizza» …");
    expect(screen.getByRole("button", { name: "Avbryt" })).toBeDisabled();
  }
  return user;
}
const spol = () => act(() => vi.advanceTimersByTimeAsync(16_000));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("MealLibraryScreen — «Slett middag» med avgrenset ventetid", () => {
  it("lesingen henger: etter fristen er ingenting slettet, låsen frigitt, og en sen lesing starter ingen sletting", async () => {
    const h = sen();
    brukFetch([() => h.res()]);
    const user = await slett();
    await spol();
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Kunne ikke kontrollere «Pizza» nå. Ingenting er slettet — prøv igjen.",
      ),
    );
    h.slipp(); // uendret post: ville ha gitt sletting om den ble tolket
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(kall).toEqual(["GET"]);
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog", { name: /Slett/ })).toBeNull();
  });

  it("slettingen er sendt og henger: uavklart etter fristen, låsen frigitt, ingen automatisk ny sletting", async () => {
    const h = sen();
    brukFetch([() => Promise.resolve(svar(NODE.m1)), () => h.res()]);
    const user = await slett();
    await vi.waitFor(() => expect(kall).toEqual(["GET", "DELETE"]));
    await spol();
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Vi vet ikke om «Pizza» ble slettet — svaret uteble.",
      ),
    );
    expect(screen.queryByRole("button", { name: "Slett" })).toBeNull();
    h.slipp();
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(kall).toEqual(["GET", "DELETE"]);
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("dialog", { name: /Slett/ })).toBeNull();
  });

  it("uten heng: uendret post slettes med én GET og én DELETE (if-match)", async () => {
    const init: RequestInit[] = [];
    kall = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((async (_i, r) => {
      kall.push(r?.method ?? "GET");
      init.push(r ?? {});
      return kall.length === 1 ? svar(NODE.m1) : new Response("null", { status: 200 });
    }) as Fetch);
    await slett({ venter: false });
    await vi.waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("«Pizza» er slettet fra biblioteket."),
    );
    expect(kall).toEqual(["GET", "DELETE"]);
    expect((init[1]!.headers as Record<string, string>)["if-match"]).toBe("etag-1");
  });
});
