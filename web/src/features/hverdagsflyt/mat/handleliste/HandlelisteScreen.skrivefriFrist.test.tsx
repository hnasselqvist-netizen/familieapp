import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useStaples } from "@hooks/useStaples";
import { loaded } from "@app-types/status";
import { HandlelisteScreen } from "./HandlelisteScreen";

/**
 * Avgrenset ventetid i handlelistens SKRIVEFRIE kontroller (Mat #20, ordre
 * 6966670122). EKTE `useShoppingList` og EKTE `shopping.repository`; bare
 * transporten er byttet ut: innlogging, REST-adresse, abonnement og `fetch`.
 * Kontrollens GET henger og ignorerer avbruddet (slik et nett uten svar kan
 * gjøre); testen slipper den først etter at en NY kontroll har avklart
 * utfallet, med et utdatert svar. Klokken spoles forbi fristen.
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
const abonnement = vi.hoisted(() => ({ node: {} as Record<string, unknown> }));
vi.mock("firebase/database", async (orig) => ({
  ...(await orig<typeof import("firebase/database")>()),
  ref: () => ({}),
  onValue: (_r: unknown, cb: (s: unknown) => void) => {
    const v = abonnement.node;
    cb({
      exists: () => Object.keys(v).length > 0,
      val: () => v,
      child: (id: string) => ({ exportVal: () => v[id] }),
    });
    return () => {};
  },
}));
vi.mock("@hooks/handlelisteDuplikaterAktivering", () => ({ handlelisteDuplikaterAktiv: vi.fn() }));
vi.mock("@hooks/useItems", () => ({ useItems: vi.fn() }));
vi.mock("@hooks/useStaples", () => ({ useStaples: vi.fn() }));

const MELK = { id: "m", itemId: "v-melk", name: "Melk", amount: "2", cat: "Ost og meieri" };
const BROD = { id: "b", itemId: "v-brod", name: "Brød", amount: "1", cat: "Brød og bakst" };

/** Svar som aldri kommer; avvises når kjernen avbryter (som ekte `fetch`). */
const henger = (init?: RequestInit) =>
  new Promise<Response>((_, avvis) =>
    init?.signal?.addEventListener("abort", () => avvis(new DOMException("aborted", "AbortError"))),
  );
const svar = (body: unknown, etag = "etag-1") =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { ETag: etag } }));
/** En lesing som ignorerer avbruddet og svarer først når testen slipper den. */
function sen() {
  let slipp!: (body: unknown) => void;
  const kropp = new Promise<unknown>((r) => (slipp = r));
  return { res: () => kropp.then((b) => svar(b, "etag-sen")), slipp: (b: unknown) => slipp(b) };
}
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
let kall: string[] = [];
/** Ett skript per kall i rekkefølge: hvert steg får `init` og gir svaret. */
function brukFetch(skript: ((init?: RequestInit) => Promise<Response>)[]) {
  kall = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(((_input, init) => {
    kall.push(init?.method ?? "GET");
    const steg = skript[kall.length - 1];
    if (!steg) throw new Error(`uventet kall nr. ${kall.length}`);
    return steg(init);
  }) as Fetch);
}
const skjerm = () => (
  <MemoryRouter>
    <HandlelisteScreen />
  </MemoryRouter>
);
const spol = () => act(() => vi.advanceTimersByTimeAsync(16_000));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
  vi.mocked(useStaples).mockReturnValue({
    staples: loaded({}),
    markAsStaple: vi.fn(),
    fjernbareBasisvarer: [],
    fjernBasisvare: vi.fn(),
  });
  vi.mocked(useItems).mockReturnValue({
    items: loaded([]),
    findOrCreateItem: vi.fn(),
  } as unknown as ReturnType<typeof useItems>);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HandlelisteScreen — frist i skrivefrie kontroller etter uavklart utfall", () => {
  it("«Fjern fullførte»: kontrollens GET henger → `ikkeLest` etter fristen, planen bevart, låsen frigitt; ny kontroll avklarer; sent svar overskriver ikke; aldri PUT fra kontrollen", async () => {
    const node = { m: { ...MELK, done: false }, b: { ...BROD, done: true } };
    abonnement.node = node;
    const hengende = sen();
    brukFetch([
      () => svar(node), // GET i skrivingen
      (init) => henger(init), // PUT: svaret uteble
      () => hengende.res(), // kontrollens GET henger
      () => svar({ m: node.m }), // ny kontroll: «Brød» er borte
    ]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(skjerm());
    const knapp = () => screen.getByRole("button", { name: /Fjern fullførte/ });
    const melding = () => screen.getByRole("alert", { name: "Fjern fullførte" });

    await user.click(knapp());
    await vi.waitFor(() => expect(kall).toEqual(["GET", "PUT"]));
    await spol();
    const proevIgjen = await within(
      await screen.findByRole("alert", { name: "Fjern fullførte" }),
    ).findByRole("button", { name: "Prøv igjen" });
    expect(knapp()).toBeDisabled();

    await user.click(proevIgjen);
    await vi.waitFor(() => expect(kall).toEqual(["GET", "PUT", "GET"]));
    expect(within(melding()).getByRole("button", { name: "Sjekker …" })).toBeDisabled();
    await spol();
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Fortsatt ikke avklart om de fullførte varene ble fjernet: handlelisten kunne ikke leses nå. Ingenting er endret — prøv igjen.",
      ),
    );
    // Uavklart plan bevart: «Fjern fullførte» er fortsatt sperret; ny skrivefri kontroll mulig.
    expect(knapp()).toBeDisabled();
    const igjen = within(melding()).getByRole("button", { name: "Prøv igjen" });
    expect(igjen).toBeEnabled();

    await user.click(igjen);
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Bekreftet: 1 av 1 varer fra forsøket er ikke lenger på listen.",
      ),
    );
    // Det sene svaret (fra før fjerningen) kommer nå — og blir ignorert.
    hengende.slipp(node);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(melding()).toHaveTextContent("Bekreftet: 1 av 1 varer");
    expect(kall).toEqual(["GET", "PUT", "GET", "GET"]);
  });

  it("målstatus: kontrollens GET henger → `ikkeLest` etter fristen, raden fortsatt uavklart; ny kontroll bekrefter; sent svar overskriver ikke; aldri PUT fra kontrollen", async () => {
    const node = { m: { ...MELK, done: false } };
    abonnement.node = node;
    const hengende = sen();
    brukFetch([
      () => svar(node), // GET i skrivingen
      (init) => henger(init), // PUT: svaret uteble
      () => hengende.res(), // kontrollens GET henger
      () => svar({ m: { ...MELK, done: true } }), // ny kontroll: lagret
    ]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(skjerm());
    const melding = () => screen.getByRole("alert", { name: "Status" });

    await user.click(screen.getByRole("button", { name: "Merk Melk som fullført" }));
    await vi.waitFor(() => expect(kall).toEqual(["GET", "PUT"]));
    await spol();
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(/Vi vet ikke om «Melk» ble merket som fullført/),
    );

    await user.click(within(melding()).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() => expect(kall).toEqual(["GET", "PUT", "GET"]));
    await spol();
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Fortsatt ikke avklart om «Melk» ble merket som fullført: handlelisten kunne ikke leses nå. Ingenting er endret — prøv igjen.",
      ),
    );
    const igjen = within(melding()).getByRole("button", { name: "Prøv igjen" });
    expect(igjen).toBeEnabled();

    await user.click(igjen);
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent("Bekreftet: «Melk» er merket som fullført."),
    );
    hengende.slipp(node); // utdatert: `done: false`
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(melding()).toHaveTextContent("Bekreftet: «Melk» er merket som fullført.");
    expect(kall).toEqual(["GET", "PUT", "GET", "GET"]);
  });
});
