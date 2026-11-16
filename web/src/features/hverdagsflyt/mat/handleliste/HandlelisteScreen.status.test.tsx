import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InnleggingsSkriveutfall, LeseAvslag } from "@data/shopping.repository";
import type { StatusLesing, StatusPlan } from "@domain/shopping/handlelisteStatus";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import { loaded } from "@app-types/status";
import type { ShoppingItem } from "@app-types/shopping";
import { HandlelisteScreen } from "./HandlelisteScreen";

/**
 * «Merk som fullført»/«Merk som ikke fullført» (Mat #20, ordre 6908431056):
 * den valgte målstatusen sendes, dobbeltklikk sender én gang, avslag,
 * konflikt og ukjent utfall vises tydelig, og kontrollen er skrivefri.
 */

vi.mock("@hooks/handlelisteDuplikaterAktivering", () => ({ handlelisteDuplikaterAktiv: vi.fn() }));
vi.mock("@hooks/useShoppingList", () => ({ useShoppingList: vi.fn() }));
vi.mock("@hooks/useItems", () => ({ useItems: vi.fn() }));
vi.mock("@hooks/useStaples", () => ({ useStaples: vi.fn() }));

const settStatus = vi.fn<(plan: StatusPlan) => Promise<InnleggingsSkriveutfall>>();
const sjekkStatus = vi.fn<(plan: StatusPlan) => Promise<StatusLesing | LeseAvslag>>();
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
    settStatus,
    sjekkStatus,
    settMengde: vi.fn(),
    sjekkMengde: vi.fn(),
    updateField: vi.fn(),
    fjernRad: vi.fn(),
    sjekkFjerning: vi.fn(),
    fjernFullforte: vi.fn(),
    sjekkFjernFullforte: vi.fn(),
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
  let svar!: (u: InnleggingsSkriveutfall) => void;
  const promise = new Promise<InnleggingsSkriveutfall>((r) => (svar = r));
  return { promise, svar };
}
const merkFullfort = (navn: string) =>
  screen.getByRole("button", { name: `Merk ${navn} som fullført` });
const merkIkkeFullfort = (navn: string) =>
  screen.getByRole("button", { name: `Merk ${navn} som ikke fullført` });
const melding = () => screen.getByRole("alert", { name: "Status" });
const visFullforte = () => userEvent.click(screen.getByRole("button", { name: /1 FULLFØRT/ }));

beforeEach(() => {
  settStatus.mockReset();
  sjekkStatus.mockReset();
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

describe("HandlelisteScreen: eksplisitt målstatus", () => {
  it("«Merk som fullført» sender målet `true`; dobbeltklikk sender én gang; satt status gir ingen melding", async () => {
    liste([MELK, BROD]);
    render(skjerm());
    const d = utsatt();
    settStatus.mockReturnValueOnce(d.promise);
    await userEvent.dblClick(merkFullfort("Melk"));
    expect(settStatus).toHaveBeenCalledTimes(1);
    expect(settStatus.mock.calls[0]![0]).toEqual({
      id: "m",
      navn: "Melk",
      itemId: "v-melk",
      maal: true,
    });
    expect(merkFullfort("Melk")).toBeDisabled();
    d.svar({ utfall: "anvendt" });
    await vi.waitFor(() => expect(merkFullfort("Melk")).toBeEnabled());
    expect(screen.queryByRole("alert", { name: "Status" })).toBeNull();
  });

  it("«Merk som ikke fullført» sender målet `false`; allerede oppnådd mål gir ingen melding", async () => {
    liste([MELK, BROD]);
    render(skjerm());
    settStatus.mockResolvedValueOnce({ utfall: "allerede" });
    await visFullforte();
    await userEvent.click(merkIkkeFullfort("Brød"));
    expect(settStatus.mock.calls[0]![0]).toMatchObject({ id: "b", maal: false });
    await vi.waitFor(() => expect(merkIkkeFullfort("Brød")).toBeEnabled());
    expect(screen.queryByRole("alert", { name: "Status" })).toBeNull();
  });

  it.each([
    ["avvist", { utfall: "avvist" }, "Ingen tilgang til å endre «Melk». Status er ikke endret."],
    [
      "ikkeLest",
      { utfall: "ikkeLest" },
      "Kunne ikke lese handlelisten. «Melk» er ikke merket som fullført — prøv igjen.",
    ],
    [
      "borte",
      { utfall: "konflikt", grunn: "«Melk» er ikke lenger på listen. Ingenting er endret." },
      "«Melk» er ikke lenger på listen. Ingenting er endret.",
    ],
    [
      "konflikt",
      {
        utfall: "konflikt",
        grunn:
          "«Melk» er endret på en annen enhet (nå «Lettmelk»). Status er ikke endret — se raden og velg på nytt.",
      },
      "«Melk» er endret på en annen enhet (nå «Lettmelk»). Status er ikke endret — se raden og velg på nytt.",
    ],
  ] as const)("%s: tydelig melding; raden er ledig igjen", async (_n, u, tekst) => {
    liste([MELK]);
    render(skjerm());
    settStatus.mockResolvedValueOnce(u as InnleggingsSkriveutfall);
    await userEvent.click(merkFullfort("Melk"));
    await vi.waitFor(() => expect(melding()).toHaveTextContent(tekst));
    expect(merkFullfort("Melk")).toBeEnabled();
    await userEvent.click(within(melding()).getByRole("button", { name: "Lukk" }));
    expect(screen.queryByRole("alert", { name: "Status" })).toBeNull();
  });

  it("ukjent utfall: raden er sperret; kontrollen er skrivefri og reverserer aldri; nektet/feilet kontroll holder ukjent status; senere kontroll avklarer", async () => {
    liste([MELK]);
    render(skjerm());
    settStatus.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(merkFullfort("Melk"));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(/Vi vet ikke om «Melk» ble merket som fullført/),
    );
    expect(within(melding()).queryByRole("button", { name: "Lukk" })).toBeNull();
    expect(merkFullfort("Melk")).toBeDisabled();
    await userEvent.click(merkFullfort("Melk"));
    expect(settStatus).toHaveBeenCalledTimes(1);
    const plan = settStatus.mock.calls[0]![0];

    sjekkStatus.mockResolvedValueOnce({ utfall: "avvist" });
    await userEvent.click(within(melding()).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(/Fortsatt ikke avklart .*ingen tilgang/),
    );
    expect(sjekkStatus.mock.calls[0]![0]).toBe(plan);
    expect(merkFullfort("Melk")).toBeDisabled();

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sjekkStatus.mockRejectedValueOnce(new Error("nett"));
    await userEvent.click(within(melding()).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(/Fortsatt ikke avklart .*kunne ikke leses/),
    );
    expect(merkFullfort("Melk")).toBeDisabled();

    sjekkStatus.mockResolvedValueOnce({ utfall: "lest", done: false });
    await userEvent.click(within(melding()).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "«Melk» står som ikke fullført. Ingenting er endret nå — velg på nytt på raden hvis statusen skal endres.",
      ),
    );
    expect(settStatus).toHaveBeenCalledTimes(1); // kontrollen skrev aldri, og reverserte ingenting
    expect(merkFullfort("Melk")).toBeEnabled();
  });

  it("ukjent utfall bekreftes av kontrollen: «Bekreftet»; post som er borte meldes som borte", async () => {
    liste([MELK, { ...BROD, id: "c", name: "Ost", done: false }]);
    render(skjerm());
    settStatus.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(merkFullfort("Melk"));
    sjekkStatus.mockResolvedValueOnce({ utfall: "lest", done: true });
    await userEvent.click(
      await within(await screen.findByRole("alert", { name: "Status" })).findByRole("button", {
        name: "Prøv igjen",
      }),
    );
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent("Bekreftet: «Melk» er merket som fullført."),
    );

    settStatus.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(merkFullfort("Ost"));
    sjekkStatus.mockResolvedValueOnce({ utfall: "borte" });
    const meldinger = await screen.findAllByRole("alert", { name: "Status" });
    await userEvent.click(within(meldinger[1]!).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(screen.getAllByRole("alert", { name: "Status" })[1]).toHaveTextContent(
        "«Ost» er ikke lenger på listen.",
      ),
    );
  });

  it("tapt svar → raden er erstattet under samme nøkkel med samme målstatus: ingen suksessmelding, eget tydelig utfall (review 5916086308)", async () => {
    liste([MELK]);
    const r = render(skjerm());
    settStatus.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(merkFullfort("Melk"));
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Vi vet ikke/));

    // B erstatter raden med «Egg» (fullført) under samme nøkkel.
    liste([{ ...MELK, name: "Egg", itemId: "v-egg", done: true }]);
    r.rerender(skjerm());
    sjekkStatus.mockResolvedValueOnce({
      utfall: "erstattet",
      grunn: "«Melk» er endret på en annen enhet (nå «Egg»).",
    });
    await userEvent.click(within(melding()).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "«Melk» er endret på en annen enhet (nå «Egg»). Statusen for «Melk» kan ikke bekreftes, og ingenting er endret — se listen og velg på nytt på raden hvis statusen skal endres.",
      ),
    );
    expect(melding()).not.toHaveTextContent(/Bekreftet/);
    expect(settStatus).toHaveBeenCalledTimes(1);
  });

  it("uleselig status på målraden: ingen bekreftelse", async () => {
    liste([MELK]);
    render(skjerm());
    settStatus.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(merkFullfort("Melk"));
    sjekkStatus.mockResolvedValueOnce({ utfall: "misformet" });
    await userEvent.click(
      await within(await screen.findByRole("alert", { name: "Status" })).findByRole("button", {
        name: "Prøv igjen",
      }),
    );
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Raden for «Melk» har en uventet form, så statusen kan ikke bekreftes. Ingenting er endret.",
      ),
    );
    expect(melding()).not.toHaveTextContent(/Bekreftet/);
  });
});
