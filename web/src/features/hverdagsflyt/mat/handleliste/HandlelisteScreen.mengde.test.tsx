import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InnleggingsSkriveutfall, LeseAvslag } from "@data/shopping.repository";
import type { MengdeLesing, MengdePlan } from "@domain/shopping/handlelisteMengde";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import { loaded } from "@app-types/status";
import type { ShoppingItem } from "@app-types/shopping";
import { HandlelisteScreen } from "./HandlelisteScreen";

/**
 * Manuell mengde (Mat #20, ordre 6914072575): utkastet holdes lokalt til
 * Helen lagrer, bundet til raden og førverdien; konflikt, avslag og ukjent
 * utfall beholder utkastet, og kontrollen er skrivefri og identitetsbundet.
 */

vi.mock("@hooks/handlelisteDuplikaterAktivering", () => ({ handlelisteDuplikaterAktiv: vi.fn() }));
vi.mock("@hooks/useShoppingList", () => ({ useShoppingList: vi.fn() }));
vi.mock("@hooks/useItems", () => ({ useItems: vi.fn() }));
vi.mock("@hooks/useStaples", () => ({ useStaples: vi.fn() }));

const settMengde = vi.fn<(plan: MengdePlan) => Promise<InnleggingsSkriveutfall>>();
const sjekkMengde = vi.fn<(plan: MengdePlan) => Promise<MengdeLesing | LeseAvslag>>();
const updateField = vi.fn();
const MELK: ShoppingItem = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};

function liste(rader: ShoppingItem[]) {
  vi.mocked(useShoppingList).mockReturnValue({
    shopping: loaded(rader),
    settStatus: vi.fn(),
    sjekkStatus: vi.fn(),
    settMengde,
    sjekkMengde,
    settFelt: vi.fn(),
    sjekkFelt: vi.fn(),
    updateField,
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
const felt = (navn = "Melk") => screen.getByRole("textbox", { name: `Mengde for ${navn}` });
const lagreKnapp = () => screen.getByRole("button", { name: "Lagre mengde" });
const melding = () => screen.getByRole("alert", { name: "Mengde" });
async function aapne(navn = "Melk") {
  await userEvent.click(screen.getByText(navn));
}
async function skriv(tekst: string) {
  await userEvent.clear(felt());
  if (tekst) await userEvent.type(felt(), tekst);
}

beforeEach(() => {
  settMengde.mockReset();
  sjekkMengde.mockReset();
  updateField.mockReset();
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

describe("HandlelisteScreen: manuell mengde", () => {
  it("utkastet holdes lokalt; «Lagre mengde» sender én plan bundet til raden og førverdien; dobbeltklikk sender én gang", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skriv("25");
    expect(updateField).not.toHaveBeenCalled();
    expect(settMengde).not.toHaveBeenCalled();
    expect(felt()).toHaveValue("25");
    const d = utsatt();
    settMengde.mockReturnValueOnce(d.promise);
    await userEvent.dblClick(lagreKnapp());
    expect(settMengde).toHaveBeenCalledTimes(1);
    expect(settMengde.mock.calls[0]![0]).toEqual({
      id: "m",
      navn: "Melk",
      itemId: "v-melk",
      foer: "2",
      ny: "25",
    });
    expect(felt()).toBeDisabled();
    d.svar({ utfall: "anvendt" });
    liste([{ ...MELK, amount: "25" }]);
    r.rerender(skjerm());
    await vi.waitFor(() => expect(felt()).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Lagre mengde" })).toBeNull();
    expect(felt()).toHaveValue("25");
    expect(screen.queryByRole("alert", { name: "Mengde" })).toBeNull();
  });

  it("Enter lagrer; tom mengde er gyldig; manglende mengde gir tom førverdi", async () => {
    const uten = { ...MELK, amount: undefined as unknown as string };
    liste([uten]);
    render(skjerm());
    await aapne();
    expect(felt()).toHaveValue("");
    settMengde.mockResolvedValue({ utfall: "anvendt" });
    await userEvent.type(felt(), "1{Enter}");
    expect(settMengde.mock.calls[0]![0]).toMatchObject({ foer: "", ny: "1" });

    await skriv("x");
    await userEvent.clear(felt());
    await userEvent.click(lagreKnapp());
    expect(settMengde.mock.calls[1]![0]).toMatchObject({ ny: "" });
  });

  it("B endrer mengden mens A redigerer: tydelig varsel; lagring fra gammelt grunnlag gir konflikt og beholder utkastet; «Behold utkastet mitt» bygger på ny førverdi", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skriv("25");
    liste([{ ...MELK, amount: "3" }]);
    r.rerender(skjerm());
    const varsel = screen.getByRole("alert", { name: "Mengde endret for Melk" });
    expect(varsel).toHaveTextContent(
      "Mengden er endret på en annen enhet til «3» mens du redigerte.",
    );
    expect(felt()).toHaveValue("25");

    settMengde.mockResolvedValueOnce({
      utfall: "konflikt",
      grunn:
        "Mengden på «Melk» er endret på en annen enhet («2» → «3») mens du redigerte. Mengden er ikke lagret — utkastet ditt står.",
    });
    await userEvent.click(lagreKnapp());
    expect(settMengde.mock.calls[0]![0]).toMatchObject({ foer: "2", ny: "25" });
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/«2» → «3».*utkastet ditt står/));
    expect(felt()).toHaveValue("25");

    // Varselet er skjult mens lagringen pågår og vises igjen etterpå.
    await userEvent.click(
      within(screen.getByRole("alert", { name: "Mengde endret for Melk" })).getByRole("button", {
        name: "Behold utkastet mitt",
      }),
    );
    expect(screen.queryByRole("alert", { name: "Mengde endret for Melk" })).toBeNull();
    settMengde.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.click(lagreKnapp());
    expect(settMengde.mock.calls[1]![0]).toMatchObject({ foer: "3", ny: "25" });
  });

  it("«Bruk «3»» forkaster utkastet og viser mengden på listen", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skriv("25");
    liste([{ ...MELK, amount: "3" }]);
    r.rerender(skjerm());
    await userEvent.click(screen.getByRole("button", { name: "Bruk «3»" }));
    expect(felt()).toHaveValue("3");
    expect(screen.queryByRole("button", { name: "Lagre mengde" })).toBeNull();
    expect(settMengde).not.toHaveBeenCalled();
  });

  it.each([
    [
      "avvist",
      { utfall: "avvist" },
      "Ingen tilgang til å lagre mengden på «Melk». Utkastet ditt står.",
    ],
    [
      "ikkeLest",
      { utfall: "ikkeLest" },
      "Kunne ikke lese handlelisten. Mengden på «Melk» er ikke lagret — utkastet ditt står, prøv igjen.",
    ],
    [
      "borte",
      { utfall: "konflikt", grunn: "«Melk» er ikke lenger på listen. Mengden er ikke lagret." },
      "«Melk» er ikke lenger på listen. Mengden er ikke lagret.",
    ],
  ] as const)("%s: tydelig melding, utkastet beholdes", async (_n, u, tekst) => {
    liste([MELK]);
    render(skjerm());
    await aapne();
    await skriv("25");
    settMengde.mockResolvedValueOnce(u as InnleggingsSkriveutfall);
    await userEvent.click(lagreKnapp());
    await vi.waitFor(() => expect(melding()).toHaveTextContent(tekst));
    expect(felt()).toHaveValue("25");
    expect(lagreKnapp()).toBeEnabled();
  });

  it("ukjent utfall: lagring sperret, ingen automatisk ny sending; «Sjekk» er skrivefri; nektet/feilet kontroll holder ukjent status; bekreftet lagring fjerner utkastet", async () => {
    liste([MELK]);
    render(skjerm());
    await aapne();
    await skriv("25");
    settMengde.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreKnapp());
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Vi vet ikke om mengden/));
    expect(within(melding()).queryByRole("button", { name: "Lukk" })).toBeNull();
    expect(felt()).toBeDisabled();
    expect(lagreKnapp()).toBeDisabled();
    const plan = settMengde.mock.calls[0]![0];

    sjekkMengde.mockResolvedValueOnce({ utfall: "avvist" });
    await userEvent.click(within(melding()).getByRole("button", { name: "Sjekk" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(/Fortsatt ikke avklart .*ingen tilgang/),
    );
    expect(sjekkMengde.mock.calls[0]![0]).toBe(plan);
    expect(felt()).toBeDisabled();

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    sjekkMengde.mockRejectedValueOnce(new Error("nett"));
    await userEvent.click(within(melding()).getByRole("button", { name: "Sjekk" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(/Fortsatt ikke avklart .*kunne ikke leses/),
    );

    sjekkMengde.mockResolvedValueOnce({ utfall: "lest", mengde: "25" });
    await userEvent.click(within(melding()).getByRole("button", { name: "Sjekk" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Mengden på «Melk» er nå «25», som utkastet ditt. Kontrollen kan ikke se hvem som skrev den, men det er ingenting mer å lagre.",
      ),
    );
    expect(settMengde).toHaveBeenCalledTimes(1); // aldri sendt på nytt
    expect(screen.queryByRole("button", { name: "Lagre mengde" })).toBeNull();
  });

  it("ukjent utfall → raden erstattet under samme nøkkel: ingen bekreftelse, utkastet står og kan lagres på nytt som eget valg", async () => {
    liste([MELK]);
    render(skjerm());
    await aapne();
    await skriv("25");
    settMengde.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreKnapp());
    sjekkMengde.mockResolvedValueOnce({
      utfall: "erstattet",
      grunn: "«Melk» er endret på en annen enhet (nå «Egg»).",
    });
    await userEvent.click(
      await within(await screen.findByRole("alert", { name: "Mengde" })).findByRole("button", {
        name: "Sjekk",
      }),
    );
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "«Melk» er endret på en annen enhet (nå «Egg»). Det kan ikke avgjøres om utkastet ditt («25») ble lagret før dette. Utkastet er ikke sendt på nytt og flyttes ikke til den nye raden.",
      ),
    );
    expect(felt()).toHaveValue("25");
    expect(lagreKnapp()).toBeEnabled();
    expect(settMengde).toHaveBeenCalledTimes(1);
  });

  it("ukjent utfall → kontrollen finner førverdien: utkastet står ulagret, ingen ny sending", async () => {
    liste([MELK]);
    render(skjerm());
    await aapne();
    await skriv("25");
    settMengde.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreKnapp());
    sjekkMengde.mockResolvedValueOnce({ utfall: "lest", mengde: "2" });
    await userEvent.click(
      await within(await screen.findByRole("alert", { name: "Mengde" })).findByRole("button", {
        name: "Sjekk",
      }),
    );
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Mengden på «Melk» er nå «2». Det kan ikke avgjøres om utkastet ditt («25») ble lagret før dette. Utkastet står og er ikke sendt på nytt — lagre det som et nytt valg hvis det fortsatt skal gjelde.",
      ),
    );
    expect(settMengde).toHaveBeenCalledTimes(1);
    expect(felt()).toHaveValue("25");
  });

  it("utkastets mål er frosset: raden erstattes med «Egg» med samme mengde — utkastet vises ikke på Egg og kan ikke lagres der; eget valg forkaster og starter nytt utkast (review 5919852371 pkt. 1)", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skriv("25");
    liste([{ ...MELK, name: "Egg", itemId: "v-egg" }]);
    r.rerender(skjerm());

    expect(felt("Egg")).toHaveValue("2");
    expect(felt("Egg")).toBeDisabled();
    const varsel = screen.getByRole("alert", { name: "Utkast for annen vare på Egg" });
    expect(varsel).toHaveTextContent(
      "Utkastet ditt («25») ble skrevet for «Melk», men raden er nå «Egg». Det kan ikke lagres på denne raden.",
    );
    expect(screen.queryByRole("button", { name: "Lagre mengde" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Behold utkastet mitt" })).toBeNull();
    expect(settMengde).not.toHaveBeenCalled();

    // Panelet er sperret til Helen eksplisitt åpner den nye varen (review 5924881773).
    expect(screen.getByRole("alert", { name: "Raden er byttet ut" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Åpne «Egg»" }));
    await userEvent.click(
      within(screen.getByRole("alert", { name: /for annen vare på Egg/ })).getByRole("button", {
        name: "Forkast utkastet og start på nytt",
      }),
    );
    expect(felt("Egg")).toBeEnabled();
    await userEvent.clear(felt("Egg"));
    await userEvent.type(felt("Egg"), "12");
    settMengde.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.click(lagreKnapp());
    expect(settMengde.mock.calls[0]![0]).toEqual({
      id: "m",
      navn: "Egg",
      itemId: "v-egg",
      foer: "2",
      ny: "12",
    });
  });

  it("ukjent utfall → skrivefri kontroll → raden erstattet med samme mengde: det gamle utkastet holdes unna den nye varen", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skriv("25");
    settMengde.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreKnapp());
    sjekkMengde.mockResolvedValueOnce({
      utfall: "erstattet",
      grunn: "«Melk» er endret på en annen enhet (nå «Egg»).",
    });
    await userEvent.click(
      await within(await screen.findByRole("alert", { name: "Mengde" })).findByRole("button", {
        name: "Sjekk",
      }),
    );
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/nå «Egg»/));
    liste([{ ...MELK, name: "Egg", itemId: "v-egg" }]);
    r.rerender(skjerm());
    expect(felt("Egg")).toHaveValue("2");
    expect(felt("Egg")).toBeDisabled();
    expect(screen.getByRole("alert", { name: "Utkast for annen vare på Egg" })).toHaveTextContent(
      "«25»",
    );
    expect(screen.queryByRole("button", { name: "Lagre mengde" })).toBeNull();
    expect(settMengde).toHaveBeenCalledTimes(1);
  });

  it("tapt svar etter vellykket skriving → senere endring eller fjerning: kontrollen beskriver bare dagens tilstand og beholder utkastet (review 5919852371 pkt. 2)", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skriv("25");
    settMengde.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreKnapp());
    sjekkMengde.mockResolvedValueOnce({ utfall: "lest", mengde: "3" });
    await userEvent.click(
      await within(await screen.findByRole("alert", { name: "Mengde" })).findByRole("button", {
        name: "Sjekk",
      }),
    );
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Mengden på «Melk» er nå «3». Det kan ikke avgjøres om utkastet ditt («25») ble lagret før dette. Utkastet står og er ikke sendt på nytt — lagre det som et nytt valg hvis det fortsatt skal gjelde.",
      ),
    );
    expect(melding()).not.toHaveTextContent(/ikke lagret\./);
    expect(felt()).toHaveValue("25");

    // Nytt forsøk som også mister svaret; raden fjernes (faktisk listeoppdatering) før kontrollen.
    settMengde.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreKnapp());
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Vi vet ikke/));
    liste([]);
    r.rerender(skjerm());
    expect(screen.queryByRole("textbox", { name: "Mengde for Melk" })).toBeNull();
    sjekkMengde.mockResolvedValueOnce({ utfall: "borte" });
    await userEvent.click(within(melding()).getByRole("button", { name: "Sjekk" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "«Melk» er ikke lenger på listen. Det kan ikke avgjøres om utkastet ditt («25») ble lagret før dette. Utkastet er ikke sendt på nytt.",
      ),
    );
    // Statusmeldingen lukkes; utkastet står fortsatt synlig til det forkastes.
    await userEvent.click(within(melding()).getByRole("button", { name: "Lukk" }));
    expect(screen.queryByRole("alert", { name: "Mengde" })).toBeNull();
    const utkast = screen.getByRole("alert", { name: "Utkast uten rad: Melk" });
    expect(utkast).toHaveTextContent(
      "Ulagret utkast for «Melk»: «25». Raden er ikke lenger på listen, så utkastet kan ikke lagres. Det står her til du forkaster det.",
    );
    expect(
      within(utkast)
        .getAllByRole("button")
        .map((x) => x.textContent),
    ).toEqual(["Forkast utkastet"]);
    await userEvent.click(within(utkast).getByRole("button", { name: "Forkast utkastet" }));
    expect(screen.queryByRole("alert", { name: "Utkast uten rad: Melk" })).toBeNull();
    expect(settMengde).toHaveBeenCalledTimes(2);
    expect(sjekkMengde).toHaveBeenCalledTimes(2);
  });

  it("tapt svar → erstattet rad: begge synlige meldinger holder seg til det som er kjent (review 5922654566)", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skriv("25");
    settMengde.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreKnapp());
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Vi vet ikke/));
    liste([{ ...MELK, name: "Egg", itemId: "v-egg" }]);
    r.rerender(skjerm());
    sjekkMengde.mockResolvedValueOnce({
      utfall: "erstattet",
      grunn: "«Melk» er endret på en annen enhet (nå «Egg»).",
    });
    await userEvent.click(within(melding()).getByRole("button", { name: "Sjekk" }));
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Det kan ikke avgjøres/));
    const felt = screen.getByRole("alert", { name: "Utkast for annen vare på Egg" });
    expect(felt).toHaveTextContent(
      "Utkastet ditt («25») ble skrevet for «Melk», men raden er nå «Egg». Det kan ikke lagres på denne raden.",
    );
    for (const m of [melding(), felt]) {
      expect(m).not.toHaveTextContent(/ikke lagret|er lagret|Bekreftet/);
    }
  });

  it("raden fjernes MENS den skrivefrie kontrollen pågår: utkastet står synlig etter at meldingen er lukket", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skriv("25");
    settMengde.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreKnapp());
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Vi vet ikke/));
    let svar!: (s: MengdeLesing) => void;
    sjekkMengde.mockReturnValueOnce(new Promise<MengdeLesing>((ok) => (svar = ok)));
    await userEvent.click(within(melding()).getByRole("button", { name: "Sjekk" }));
    liste([]);
    r.rerender(skjerm());
    svar({ utfall: "borte" });
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/ikke lenger på listen/));
    await userEvent.click(within(melding()).getByRole("button", { name: "Lukk" }));
    expect(screen.getByRole("alert", { name: "Utkast uten rad: Melk" })).toHaveTextContent("«25»");
    expect(settMengde).toHaveBeenCalledTimes(1);
  });
});
