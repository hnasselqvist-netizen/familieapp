import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MergedShoppingItem } from "@app-types/shopping";
import { loaded } from "@app-types/status";
import { ShoppingGeneratorModal } from "./ShoppingGeneratorModal";

/**
 * «Legg til N varer» med avgrenset ventetid (Mat #20, ordre 6963830236).
 * EKTE `useShoppingList` og EKTE `shopping.repository` (`kjorVersjonert`);
 * bare transporten er byttet ut: innlogging, REST-adresse, abonnement og
 * `fetch`. En forespørsel som henger, avvises først når kjernen avbryter den
 * (slik ekte `fetch` gjør). Klokken spoles forbi fristen.
 */

vi.mock("@data/firebase", () => ({
  getFirebaseAuth: () => ({ currentUser: { getIdToken: () => Promise.resolve("token") } }),
  getFirebaseDatabase: () => ({}),
  databaseRestUrl: (sti: string) => new URL(`https://db.test/${sti}.json`),
}));
vi.mock("firebase/database", async (orig) => ({
  ...(await orig<typeof import("firebase/database")>()),
  ref: () => ({}),
  onValue: (_r: unknown, cb: (s: { exists: () => boolean }) => void) => {
    cb({ exists: () => false });
    return () => {};
  },
}));
vi.mock("@hooks/useMeals", () => ({ useMeals: () => ({ meals: loaded({ Mon: "Grøt" }) }) }));
vi.mock("@hooks/useRecipes", () => ({ useRecipes: () => ({ recipes: loaded([]) }) }));
vi.mock("@hooks/useMealLibrary", () => ({ useMealLibrary: () => ({ mealLibrary: loaded([]) }) }));
vi.mock("@hooks/useItemHistory", () => ({ useItemHistory: () => ({ itemHistory: loaded({}) }) }));
vi.mock("@hooks/useFreezer", () => ({ useFreezer: () => ({ freezer: loaded([]) }) }));
vi.mock("@hooks/useStaples", () => ({
  useStaples: () => ({
    staples: loaded({}),
    fjernbareBasisvarer: [],
    markAsStaple: vi.fn(),
    fjernBasisvare: vi.fn(),
  }),
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
const svar = (body: unknown, etag: string) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { ETag: etag } }));
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let kall: string[] = [];
function brukFetch(h: (metode: string, init?: RequestInit) => Promise<Response>) {
  kall = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(((_input, init) => {
    const metode = init?.method ?? "GET";
    kall.push(metode);
    return h(metode, init);
  }) as Fetch);
}

async function sendInn() {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onClose = vi.fn();
  render(<ShoppingGeneratorModal weekKey="2026-W47" onClose={onClose} />);
  await user.click(screen.getByRole("button", { name: /Hent ingredienser/ }));
  const leggTil = screen.getByRole("button", { name: /Legg til 2 varer/ });
  await user.click(leggTil);
  expect(screen.getByRole("button", { name: /Legg til 2 varer/ })).toBeDisabled();
  return { user, onClose };
}

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ShoppingGeneratorModal — avgrenset ventetid for «Legg til N varer»", () => {
  it("lesingen henger: etter fristen er ingenting lagt til, ingen PUT, og innsendingen er låst opp", async () => {
    brukFetch((_m, init) => henger(init));
    const { onClose } = await sendInn();

    await act(() => vi.advanceTimersByTimeAsync(16_000));
    expect(
      await screen.findByText("Kunne ikke lese handlelisten. Ingenting er lagt til — prøv igjen."),
    ).toBeInTheDocument();
    expect(kall).toEqual(["GET"]);
    expect(screen.getByRole("button", { name: /Legg til 2 varer/ })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("PUT er sendt og henger: uavklart; «Prøv igjen» sjekker samme kvittering skrivefritt og lukker uten ny PUT", async () => {
    let lagret: unknown = null;
    let serverHarLagret = false;
    brukFetch((m, init) => {
      if (m === "PUT") {
        // Serveren lagrer, men svaret når aldri appen.
        lagret = JSON.parse(String(init?.body));
        serverHarLagret = true;
        return henger(init);
      }
      return serverHarLagret ? svar(lagret, "etag-2") : svar(null, "etag-1");
    });
    const { user, onClose } = await sendInn();
    await vi.waitFor(() => expect(kall).toContain("PUT"));

    await act(() => vi.advanceTimersByTimeAsync(16_000));
    expect(await screen.findByText(/Vi vet ikke om varene ble lagt til/)).toBeInTheDocument();
    expect(kall).toEqual(["GET", "PUT"]); // ingen automatisk ny mutasjon
    const proevIgjen = screen.getByRole("button", { name: "Prøv igjen" });
    expect(proevIgjen).toBeEnabled();

    await user.click(proevIgjen);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(kall).toEqual(["GET", "PUT", "GET"]); // samme opId, avgjort mot kvitteringen
  });
});
