import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InnleggingsSkriveutfall, PosterSjekk } from "@data/shopping.repository";
import type {
  FjernFullfortePlan,
  FullforteOppsummering,
} from "@domain/shopping/handlelisteFjernFullforte";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import { loaded } from "@app-types/status";
import type { ShoppingItem } from "@app-types/shopping";
import { HandlelisteScreen } from "./HandlelisteScreen";

/**
 * «Fjern fullførte» (Mat #20, ordre 6905636191): planen er de fullførte
 * radene slik de vises, dobbeltklikk sender én gang, utfallet skiller
 * fjernet/beholdt/borte, og ukjent utfall følges opp skrivefritt.
 */

vi.mock("@hooks/handlelisteDuplikaterAktivering", () => ({ handlelisteDuplikaterAktiv: vi.fn() }));
vi.mock("@hooks/useShoppingList", () => ({ useShoppingList: vi.fn() }));
vi.mock("@hooks/useItems", () => ({ useItems: vi.fn() }));
vi.mock("@hooks/useStaples", () => ({ useStaples: vi.fn() }));

type Utfall = InnleggingsSkriveutfall & { detaljer?: FullforteOppsummering };
const fjernFullforte = vi.fn<(plan: FjernFullfortePlan) => Promise<Utfall>>();
const sjekkFjernFullforte = vi.fn<(plan: FjernFullfortePlan) => Promise<PosterSjekk>>();
const fjernRad = vi.fn();
const MELK: ShoppingItem = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};
const BROD: ShoppingItem = {
  id: "b",
  itemId: "v-brod",
  name: "Brød",
  amount: "1",
  cat: "Brød og bakst",
  done: true,
};

function liste(rader: ShoppingItem[]) {
  vi.mocked(useShoppingList).mockReturnValue({
    shopping: loaded(rader),
    settStatus: vi.fn(),
    settMengde: vi.fn(),
    sjekkMengde: vi.fn(),
    settFelt: vi.fn(),
    sjekkFelt: vi.fn(),
    sjekkStatus: vi.fn(),
    updateField: vi.fn(),
    fjernRad,
    sjekkFjerning: vi.fn(),
    fjernFullforte,
    sjekkFjernFullforte,
    slaaSammen: vi.fn(),
    angreSammenslaing: vi.fn(),
  } as unknown as ReturnType<typeof useShoppingList>);
}
const skjerm = () => (
  <MemoryRouter>
    <HandlelisteScreen />
  </MemoryRouter>
);
function utsatt() {
  let svar!: (u: Utfall) => void;
  const promise = new Promise<Utfall>((r) => (svar = r));
  return { promise, svar };
}
const knapp = () => screen.getByRole("button", { name: /Fjern fullførte/ });
const melding = () => screen.getByRole("alert", { name: "Fjern fullførte" });
const FLOTE: ShoppingItem = { ...MELK, id: "f", name: "Fløte", done: true, raaGrunnlag: "raa-f" };

beforeEach(() => {
  fjernRad.mockReset();
  fjernFullforte.mockReset();
  sjekkFjernFullforte.mockReset();
  vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
  vi.mocked(useStaples).mockReturnValue({
    staples: loaded({}),
    markAsStaple: vi.fn(),
    unmarkStaple: vi.fn(),
  });
  vi.mocked(useItems).mockReturnValue({
    items: loaded([]),
    findOrCreateItem: vi.fn(),
  } as unknown as ReturnType<typeof useItems>);
});

describe("HandlelisteScreen: «Fjern fullførte»", () => {
  it("planen er de fullførte radene slik de vises, med rågrunnlag; dobbeltklikk sender én gang; samlet utfall skiller fjernet, beholdt og borte", async () => {
    liste([{ ...MELK, raaGrunnlag: "raa-m" }, BROD, FLOTE, { ...BROD, id: "g", name: "Gulrot" }]);
    render(skjerm());
    const d = utsatt();
    fjernFullforte.mockReturnValueOnce(d.promise);
    await userEvent.dblClick(knapp());
    expect(fjernFullforte).toHaveBeenCalledTimes(1);
    const plan = fjernFullforte.mock.calls[0]![0];
    expect(plan.rader.map((r) => [r.id, r.grunnlag, r.sett.done])).toEqual([
      ["b", undefined, true],
      ["f", "raa-f", true],
      ["g", undefined, true],
    ]);
    expect(knapp()).toBeDisabled();
    d.svar({
      utfall: "anvendt",
      detaljer: {
        fjernet: [{ id: "b", navn: "Brød" }],
        beholdt: [{ id: "f", navn: "Fløte", grunn: "mengde 2 → 3" }],
        borte: [{ id: "g", navn: "Gulrot" }],
      },
    });
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Fjernet 1 fullført vare. Beholdt 1 som er endret siden du så listen: «Fløte» (mengde 2 → 3). 1 var allerede borte: «Gulrot». Et nytt trykk på «Fjern fullførte» gjelder alle fullførte varer som vises nå — også varer som ikke var med i forrige forsøk. Bruk «Fjern» på en rad for å fjerne bare den.",
      ),
    );
    expect(knapp()).toBeEnabled();
    await userEvent.click(within(melding()).getByRole("button", { name: "Lukk" }));
    expect(screen.queryByRole("alert", { name: "Fjern fullførte" })).toBeNull();
  });

  it.each([
    [
      "avvist",
      { utfall: "avvist" },
      "Ingen tilgang til å fjerne fullførte varer. Ingenting er fjernet.",
    ],
    [
      "ikkeLest",
      { utfall: "ikkeLest" },
      "Kunne ikke lese handlelisten. Ingenting er fjernet — prøv igjen.",
    ],
    [
      "konflikt",
      {
        utfall: "konflikt",
        grunn: "Handlelisten endres samtidig på en annen enhet. Ingenting er lagret — prøv igjen.",
      },
      "Handlelisten endres samtidig på en annen enhet. Ingenting er lagret — prøv igjen.",
    ],
  ] as const)("%s: tydelig melding, knappen er ledig igjen", async (_n, u, tekst) => {
    liste([BROD]);
    render(skjerm());
    fjernFullforte.mockResolvedValueOnce(u as Utfall);
    await userEvent.click(knapp());
    await vi.waitFor(() => expect(melding()).toHaveTextContent(tekst));
    expect(knapp()).toBeEnabled();
  });

  it("ukjent utfall: knappen er sperret; oppfølgingen er skrivefri; nektet/feilet etterlesing holder ukjent status; senere lesing viser hva som står, og nytt valg bygger på fersk visning", async () => {
    liste([BROD, FLOTE]);
    const r = render(skjerm());
    fjernFullforte.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(knapp());
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(/Vi vet ikke om de fullførte varene ble fjernet/),
    );
    expect(within(melding()).queryByRole("button", { name: "Lukk" })).toBeNull();
    expect(knapp()).toBeDisabled();
    await userEvent.click(knapp());
    expect(fjernFullforte).toHaveBeenCalledTimes(1);
    const plan = fjernFullforte.mock.calls[0]![0];

    sjekkFjernFullforte.mockResolvedValueOnce({ utfall: "avvist" });
    await userEvent.click(within(melding()).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(/Fortsatt ikke avklart .*ingen tilgang/),
    );
    expect(sjekkFjernFullforte.mock.calls[0]![0]).toBe(plan);
    expect(knapp()).toBeDisabled();

    sjekkFjernFullforte.mockRejectedValueOnce(new Error("nett"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await userEvent.click(within(melding()).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(/Fortsatt ikke avklart .*kunne ikke leses/),
    );
    expect(knapp()).toBeDisabled();

    sjekkFjernFullforte.mockResolvedValueOnce({ utfall: "lest", borte: ["b"], finnes: ["f"] });
    await userEvent.click(within(melding()).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "1 av 2 varer fra forsøket er ikke lenger på listen. Disse fra forsøket står fortsatt på listen: «Fløte». Ingenting er fjernet nå. Et nytt trykk på «Fjern fullførte» gjelder alle fullførte varer som vises nå — også varer som ikke var med i forrige forsøk. Bruk «Fjern» på en rad for å fjerne bare den.",
      ),
    );
    expect(sjekkFjernFullforte.mock.calls[2]![0]).toBe(plan);
    expect(fjernFullforte).toHaveBeenCalledTimes(1); // oppfølgingen sendte aldri en sletting

    // Abonnementet viser fersk tilstand; nytt valg bygger på den.
    liste([{ ...FLOTE, amount: "3", raaGrunnlag: "raa-f-2" }]);
    r.rerender(skjerm());
    expect(knapp()).toBeEnabled();
    fjernFullforte.mockResolvedValueOnce({
      utfall: "anvendt",
      detaljer: { fjernet: [{ id: "f", navn: "Fløte" }], beholdt: [], borte: [] },
    });
    await userEvent.click(knapp());
    expect(fjernFullforte.mock.calls[1]![0].rader).toEqual([
      expect.objectContaining({
        id: "f",
        grunnlag: "raa-f-2",
        sett: expect.objectContaining({ amount: "3" }),
      }),
    ]);
    await vi.waitFor(() => expect(melding()).toHaveTextContent("Fjernet 1 fullført vare."));
  });

  it("alle radene bekreftet borte etter ukjent utfall", async () => {
    liste([BROD]);
    render(skjerm());
    fjernFullforte.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(knapp());
    sjekkFjernFullforte.mockResolvedValueOnce({ utfall: "lest", borte: ["b"], finnes: [] });
    await userEvent.click(
      await within(await screen.findByRole("alert", { name: "Fjern fullførte" })).findByRole(
        "button",
        { name: "Prøv igjen" },
      ),
    );
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Bekreftet: 1 av 1 varer fra forsøket er ikke lenger på listen.",
      ),
    );
  });

  it("ny fullført rad kommer inn mens utfallet er uavklart: oppfølgingen nevner den ikke, tilbyr aldri gjenkjøring av den gamle planen, og sier tydelig at et nytt trykk gjelder alle fullførte som vises nå (review 5914821257)", async () => {
    liste([BROD, FLOTE]);
    const r = render(skjerm());
    fjernFullforte.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(knapp());
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Vi vet ikke/));

    // B fullfører en ny vare og krysser Fløte tilbake mens utfallet er uavklart.
    const NOTTER: ShoppingItem = { ...BROD, id: "n", name: "Nøtter", raaGrunnlag: "raa-n" };
    liste([{ ...FLOTE, done: false }, NOTTER]);
    r.rerender(skjerm());
    sjekkFjernFullforte.mockResolvedValueOnce({ utfall: "lest", borte: ["b"], finnes: ["f"] });
    await userEvent.click(within(melding()).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Disse fra forsøket står fortsatt/));

    // Bare det oppfølgingen faktisk kunne bekrefte om forsøkets rader; Nøtter nevnes ikke.
    expect(melding()).not.toHaveTextContent(/Nøtter/);
    expect(melding()).not.toHaveTextContent(/hvis de skal bort/);
    expect(melding()).toHaveTextContent(
      "gjelder alle fullførte varer som vises nå — også varer som ikke var med i forrige forsøk",
    );
    // Ingen knapp kjører den gamle planen på nytt.
    expect(
      within(melding())
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Lukk"]);
    expect(fjernFullforte).toHaveBeenCalledTimes(1);

    // Et nytt trykk bygger på visningen nå: bare Nøtter er fullført, den tilbakekryssede Fløte er ikke med.
    fjernFullforte.mockResolvedValueOnce({
      utfall: "anvendt",
      detaljer: { fjernet: [{ id: "n", navn: "Nøtter" }], beholdt: [], borte: [] },
    });
    await userEvent.click(knapp());
    expect(fjernFullforte.mock.calls[1]![0].rader.map((x) => [x.id, x.grunnlag])).toEqual([
      ["n", "raa-n"],
    ]);
    // Enkeltpostens «Fjern» er veien for å fjerne bare én rad.
    expect(screen.getByRole("button", { name: "Fjern Fløte" })).toBeEnabled();
  });
});
