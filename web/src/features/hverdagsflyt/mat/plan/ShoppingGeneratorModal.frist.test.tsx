import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MergedShoppingItem } from "@app-types/shopping";
import { loaded } from "@app-types/status";
import { ShoppingGeneratorModal } from "./ShoppingGeneratorModal";

/**
 * Avgrenset ventetid i den faktiske React-generatoren (Mat #20, ordre
 * 6962110764). EKTE `useStaples` og EKTE `staples.repository` (ETag-kjernen);
 * bare transporten er byttet ut: innlogging, REST-adresse, abonnement og
 * `fetch`. En forespørsel som henger, avvises først når kjernen avbryter den
 * (slik ekte `fetch` gjør). Klokken spoles forbi fristen.
 */

// Én stabil innlogging (skriveforsøk er bundet til sesjonen som startet dem).
const auth = vi.hoisted(() => ({
  currentUser: { getIdToken: () => Promise.resolve("token") } as unknown,
}));
vi.mock("@data/firebase", () => ({
  getFirebaseAuth: () => auth,
  getFirebaseDatabase: () => ({}),
  databaseRestUrl: (sti: string) => new URL(`https://db.test/${sti}.json`),
}));
vi.mock("firebase/database", () => ({
  ref: () => ({}),
  onValue: (_r: unknown, cb: (s: { exists: () => boolean }) => void) => {
    cb({ exists: () => false });
    return () => {};
  },
}));
const ytre = vi.hoisted(() => ({ leggTil: vi.fn() }));
vi.mock("@hooks/useMeals", () => ({ useMeals: () => ({ meals: loaded({ Mon: "Grøt" }) }) }));
vi.mock("@hooks/useRecipes", () => ({ useRecipes: () => ({ recipes: loaded([]) }) }));
vi.mock("@hooks/useMealLibrary", () => ({ useMealLibrary: () => ({ mealLibrary: loaded([]) }) }));
vi.mock("@hooks/useItemHistory", () => ({ useItemHistory: () => ({ itemHistory: loaded({}) }) }));
vi.mock("@hooks/useFreezer", () => ({ useFreezer: () => ({ freezer: loaded([]) }) }));
vi.mock("@hooks/useShoppingList", () => ({
  useShoppingList: () => ({ shopping: loaded([]), leggTilFraGenerator: ytre.leggTil }),
}));
const vare = (name: string): MergedShoppingItem => ({
  key: name.toLowerCase(),
  itemId: null,
  name,
  amount: "1",
  unit: "",
  cat: "Ost og meieri",
  fromRecipes: ["Grøt"],
  isStaple: false,
});
vi.mock("@generators/shopping/shopping", async (orig) => ({
  ...(await orig<typeof import("@generators/shopping/shopping")>()),
  buildShoppingItems: () => [],
  mergeShoppingItems: () => [vare("Rømme"), vare("Egg")],
}));

/** Svar som aldri kommer; avvises når kjernen avbryter (som ekte `fetch`). */
const henger = (init?: RequestInit) =>
  new Promise<Response>((_, avvis) =>
    init?.signal?.addEventListener("abort", () => avvis(new DOMException("aborted", "AbortError"))),
  );
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let kall: { metode: string; url: string }[] = [];
function brukFetch(svar: (metode: string, init?: RequestInit) => Promise<Response>) {
  kall = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(((input, init) => {
    const metode = init?.method ?? "GET";
    kall.push({ metode, url: String(input) });
    return svar(metode, init);
  }) as Fetch);
}
const tomVerdi = () =>
  Promise.resolve(new Response("null", { status: 200, headers: { ETag: "etag-1" } }));

async function utelatOgMerk() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onClose = vi.fn();
  render(<ShoppingGeneratorModal weekKey="2026-W47" onClose={onClose} />);
  await user.click(screen.getByRole("button", { name: /Hent ingredienser/ }));
  await user.click(screen.getByText("Rømme", { exact: true }));
  await user.click(screen.getByRole("button", { name: "Ja, basisvare" }));
  expect(screen.getByRole("status")).toHaveTextContent("Lagrer «Rømme» som basisvare…");
  expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeDisabled();
  return { user, onClose };
}
const leggTil = () => screen.getByRole("button", { name: /Legg til 1 varer/ });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  ytre.leggTil.mockReset();
  ytre.leggTil.mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ShoppingGeneratorModal — avgrenset ventetid for «Ja, basisvare»", () => {
  it("lesingen henger: etter fristen er ingenting lagret, ingen PUT, og generatoren kan fortsette", async () => {
    brukFetch((_m, init) => henger(init));
    const { user, onClose } = await utelatOgMerk();

    await act(() => vi.advanceTimersByTimeAsync(16_000));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("«Rømme» ble ikke lagret som basisvare");
    expect(alert).toHaveTextContent("Ingenting er lagret.");
    expect(alert).toHaveTextContent("fortsatt utelatt");
    expect(kall.filter((k) => k.metode === "PUT")).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(leggTil()).toBeEnabled();
    await user.click(leggTil());
    expect(ytre.leggTil).toHaveBeenCalledTimes(1);
    const plan = ytre.leggTil.mock.calls[0]![0] as { entries: { name: string }[] };
    expect(plan.entries.map((e) => e.name)).toEqual(["Egg"]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("innloggingen byttes mens lesingen står ute: ingen PUT, tydelig utfall, generatoren kan fortsette (ordre 6984494940)", async () => {
    const forrige = auth.currentUser;
    try {
      let slipp!: () => void;
      const port = new Promise<void>((r) => (slipp = r));
      brukFetch(() => port.then(() => tomVerdi()));
      const { user } = await utelatOgMerk();
      await vi.waitFor(() => expect(kall.map((k) => k.metode)).toEqual(["GET"]));
      auth.currentUser = { getIdToken: () => Promise.resolve("token-b") }; // en annen sesjon
      slipp();
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "Innloggingen ble endret før «Rømme» ble lagret som basisvare. Ingenting ble sendt i dette forsøket.",
      );
      expect(alert).toHaveTextContent("fortsatt utelatt");
      expect(alert).not.toHaveTextContent(/Ingenting er lagret/);
      expect(kall.filter((k) => k.metode === "PUT")).toHaveLength(0);
      await user.click(screen.getByRole("button", { name: "OK" }));
      expect(leggTil()).toBeEnabled();
    } finally {
      auth.currentUser = forrige;
    }
  });

  it("skrivingen henger: etter fristen er utfallet uavklart, låsen frigis, og generatoren kan lukkes", async () => {
    brukFetch((m, init) => (m === "GET" ? tomVerdi() : henger(init)));
    const { user, onClose } = await utelatOgMerk();
    await vi.waitFor(() => expect(kall.some((k) => k.metode === "PUT")).toBe(true));

    await act(() => vi.advanceTimersByTimeAsync(16_000));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("«Rømme» er ikke bekreftet lagret som basisvare.");
    expect(alert).not.toHaveTextContent("Ingenting er lagret");
    expect(kall.filter((k) => k.metode === "PUT")).toHaveLength(1); // ingen automatisk ny skriving

    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(leggTil()).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Lukk" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
