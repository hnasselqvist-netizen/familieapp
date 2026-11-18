import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";
import { RecipesScreen } from "./RecipesScreen";

/**
 * «Slett» i Kokeboken med avgrenset ventetid (Mat #20, ordre 6970785122).
 * EKTE `useRecipes` og EKTE `recipes.repository`; bare transporten er byttet
 * ut: innlogging, REST-adresse, abonnement og `fetch`. En forespørsel som
 * henger, ignorerer avbruddet (slik et nett uten svar kan gjøre). Klokken
 * spoles forbi fristen.
 */

// Én stabil innlogging (forsøket er bundet til sesjonen som startet det).
const auth = vi.hoisted(() => ({
  currentUser: { getIdToken: () => Promise.resolve("token") } as unknown,
}));
vi.mock("@data/firebase", () => ({
  getFirebaseAuth: () => auth,
  getFirebaseDatabase: () => ({}),
  databaseRestUrl: (sti: string) => new URL(`https://db.test/${sti}.json`),
}));
const TACO = {
  ".priority": 2,
  name: "Taco",
  cat: "Middag",
  time: 20,
  servings: 4,
  createdAt: 0,
  ingredients: [{ name: "Kjøttdeig", amount: "500 g" }],
};
const val = () => {
  const { ".priority": _p, ...v } = TACO;
  void _p;
  return v;
};
vi.mock("firebase/database", async (orig) => ({
  ...(await orig<typeof import("firebase/database")>()),
  ref: () => ({}),
  onValue: (_r: unknown, cb: (s: unknown) => void) => {
    cb({
      exists: () => true,
      val: () => ({ r1: val() }),
      child: () => ({
        exportVal: () => ({ ...TACO, ingredients: { "0": TACO.ingredients[0] } }),
      }),
    });
    return () => {};
  },
}));
vi.mock("@hooks/useItems", () => ({
  useItems: () => ({ items: loaded([]), findOrCreateItem: vi.fn() }),
}));
vi.mock("@hooks/useFreezer", () => ({ useFreezer: () => ({ freezer: loaded([]) }) }));

const svar = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { ETag: "etag-1" } });
/** Et svar som ignorerer avbruddet og kommer først når testen slipper det. */
function sen() {
  let slipp!: () => void;
  const port = new Promise<void>((r) => (slipp = r));
  return { res: () => port.then(() => svar(TACO)), slipp: () => slipp() };
}
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let kall: string[] = [];
let init: RequestInit[] = [];
function brukFetch(skript: (() => Promise<Response>)[]) {
  kall = [];
  init = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (_input, i) => {
    kall.push(i?.method ?? "GET");
    init.push(i ?? {});
    const steg = skript[kall.length - 1];
    if (!steg) throw new Error(`uventet kall nr. ${kall.length}`);
    return steg();
  }) as Fetch);
}
const slettKnapp = () => screen.getByRole("button", { name: /Slett/ }) as HTMLButtonElement;
async function slett() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(
    <MemoryRouter initialEntries={["/mat/kokebok?apne=r1"]}>
      <RecipesScreen />
    </MemoryRouter>,
  );
  await user.click(slettKnapp());
  return user;
}
const spol = () => act(() => vi.advanceTimersByTimeAsync(16_000));

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RecipesScreen — «Slett» med avgrenset ventetid", () => {
  it("lesingen henger: etter fristen er ingenting slettet, knappen frigitt, og et sent svar starter ingen DELETE", async () => {
    const h = sen();
    brukFetch([() => h.res()]);
    await slett();
    expect(slettKnapp().disabled).toBe(true);
    await spol();
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Kunne ikke kontrollere «Taco» nå. Ingenting er slettet — prøv igjen.",
      ),
    );
    expect(slettKnapp().disabled).toBe(false);
    h.slipp(); // uendret oppskrift: ville gitt sletting om svaret ble tolket
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(kall).toEqual(["GET"]);
  });

  it("DELETE er sendt og henger: uavklart etter fristen, knappen frigitt, ingen automatisk ny sletting", async () => {
    const h = sen();
    brukFetch([() => Promise.resolve(svar(TACO)), () => h.res()]);
    await slett();
    await vi.waitFor(() => expect(kall).toEqual(["GET", "DELETE"]));
    await spol();
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/Vi vet ikke om «Taco» ble slettet/),
    );
    expect(slettKnapp().disabled).toBe(false);
    h.slipp();
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(kall).toEqual(["GET", "DELETE"]);
  });

  it("uten heng: uendret oppskrift (REST-liste mot klientens indeksobjekt, med prioritet) slettes med én GET og én DELETE (if-match)", async () => {
    brukFetch([
      () => Promise.resolve(svar(TACO)),
      () => Promise.resolve(new Response("null", { status: 200 })),
    ]);
    await slett();
    await vi.waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("«Taco» er slettet."),
    );
    expect(kall).toEqual(["GET", "DELETE"]);
    expect((init[1]!.headers as Record<string, string>)["if-match"]).toBe("etag-1");
  });

  it("innloggingen byttes mens lesingen står ute: ingen DELETE, tydelig melding, knappen frigitt (review 5952888435)", async () => {
    const forrige = auth.currentUser;
    try {
      let slipp!: () => void;
      const port = new Promise<void>((r) => (slipp = r));
      brukFetch([() => port.then(() => svar(TACO))]);
      await slett();
      await vi.waitFor(() => expect(kall).toEqual(["GET"]));
      auth.currentUser = { getIdToken: () => Promise.resolve("token-b") }; // en annen sesjon
      slipp();
      await vi.waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Innloggingen ble endret mens slettingen pågikk. Ingenting er slettet.",
        ),
      );
      expect(kall).toEqual(["GET"]);
      expect(slettKnapp().disabled).toBe(false);
    } finally {
      auth.currentUser = forrige;
    }
  });

  it("412 mellom lesing og sletting: konflikt, ingen ny runde", async () => {
    brukFetch([
      () => Promise.resolve(svar(TACO)),
      () => Promise.resolve(new Response("{}", { status: 412 })),
    ]);
    await slett();
    await vi.waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/endret på en annen enhet/),
    );
    expect(kall).toEqual(["GET", "DELETE"]);
  });
});
