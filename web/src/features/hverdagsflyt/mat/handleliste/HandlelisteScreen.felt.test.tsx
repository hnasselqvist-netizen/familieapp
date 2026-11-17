import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InnleggingsSkriveutfall, LeseAvslag } from "@data/shopping.repository";
import type { FeltLesing, FeltPlan } from "@domain/shopping/handlelisteFelt";
import type { MengdePlan } from "@domain/shopping/handlelisteMengde";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import { loaded } from "@app-types/status";
import type { ShoppingItem } from "@app-types/shopping";
import { HandlelisteScreen } from "./HandlelisteScreen";

/**
 * Navn og kategori (Mat #20, ordre 6921967679): navneutkastet holdes lokalt
 * til Helen lagrer, og kategorien lagres som et eksplisitt valg — begge
 * bundet til radidentiteten og førverdien. Konflikt, avslag og ukjent
 * utfall er tydelige, og kontrollen er skrivefri og identitetsbundet.
 */

vi.mock("@hooks/handlelisteDuplikaterAktivering", () => ({ handlelisteDuplikaterAktiv: vi.fn() }));
vi.mock("@hooks/useShoppingList", () => ({ useShoppingList: vi.fn() }));
vi.mock("@hooks/useItems", () => ({ useItems: vi.fn() }));
vi.mock("@hooks/useStaples", () => ({ useStaples: vi.fn() }));

const settFelt = vi.fn<(plan: FeltPlan) => Promise<InnleggingsSkriveutfall>>();
const sjekkFelt = vi.fn<(plan: FeltPlan) => Promise<FeltLesing | LeseAvslag>>();
const settMengde = vi.fn<(plan: MengdePlan) => Promise<InnleggingsSkriveutfall>>();
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
    sjekkMengde: vi.fn(),
    settFelt,
    sjekkFelt,
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
const navnFelt = (navn = "Melk") => screen.getByRole("textbox", { name: `Navn for ${navn}` });
const mengdeFelt = (navn = "Melk") => screen.getByRole("textbox", { name: `Mengde for ${navn}` });
const kategori = (navn = "Melk") => screen.getByRole("combobox", { name: `Kategori for ${navn}` });
const lagreNavn = () => screen.getByRole("button", { name: "Lagre navn" });
const melding = (felt: "Navn" | "Kategori" = "Navn") => screen.getByRole("alert", { name: felt });
async function aapne(navn = "Melk") {
  await userEvent.click(screen.getByText(navn));
}
async function skrivNavn(tekst: string) {
  await userEvent.clear(navnFelt());
  await userEvent.type(navnFelt(), tekst);
}
const sjekkKnapp = async (felt: "Navn" | "Kategori" = "Navn") =>
  within(await screen.findByRole("alert", { name: felt })).findByRole("button", { name: "Sjekk" });

beforeEach(() => {
  settMengde.mockReset();
  settFelt.mockReset();
  sjekkFelt.mockReset();
  updateField.mockReset();
  vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
  vi.mocked(useStaples).mockReturnValue({
    staples: loaded({}),
    markAsStaple: vi.fn(),
    fjernBasisvare: vi.fn(),
  });
  vi.mocked(useItems).mockReturnValue({
    items: loaded([]),
    findOrCreateItem: vi.fn(),
  } as unknown as ReturnType<typeof useItems>);
});

describe("HandlelisteScreen: navn", () => {
  it("navneutkastet holdes lokalt; «Lagre navn» sender én plan bundet til varekobling og førverdi; dobbeltklikk sender én gang", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skrivNavn("Helmelk");
    expect(updateField).not.toHaveBeenCalled();
    expect(settFelt).not.toHaveBeenCalled();
    const d = utsatt();
    settFelt.mockReturnValueOnce(d.promise);
    await userEvent.dblClick(lagreNavn());
    expect(settFelt).toHaveBeenCalledTimes(1);
    expect(settFelt.mock.calls[0]![0]).toEqual({
      id: "m",
      felt: "name",
      navn: "Melk",
      itemId: "v-melk",
      foer: "Melk",
      ny: "Helmelk",
    });
    expect(navnFelt()).toBeDisabled();
    d.svar({ utfall: "anvendt" });
    liste([{ ...MELK, name: "Helmelk" }]);
    r.rerender(skjerm());
    await vi.waitFor(() => expect(navnFelt("Helmelk")).toBeEnabled());
    expect(navnFelt("Helmelk")).toHaveValue("Helmelk");
    expect(screen.queryByRole("button", { name: "Lagre navn" })).toBeNull();
  });

  it("navnet endres på en annen enhet (samme vare): varsel; lagring fra gammelt grunnlag gir konflikt og beholder utkastet; «Behold utkastet mitt» bygger på nytt navn", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skrivNavn("Helmelk");
    liste([{ ...MELK, name: "Lettmelk" }]);
    r.rerender(skjerm());
    expect(screen.getByRole("alert", { name: "Navn endret for Lettmelk" })).toHaveTextContent(
      "Navnet er endret på en annen enhet fra «Melk» til «Lettmelk» mens du redigerte.",
    );
    expect(navnFelt("Lettmelk")).toHaveValue("Helmelk");
    settFelt.mockResolvedValueOnce({
      utfall: "konflikt",
      grunn:
        "Navnet på «Melk» er endret på en annen enhet («Melk» → «Lettmelk») mens du redigerte. Ingenting er lagret.",
    });
    await userEvent.click(lagreNavn());
    expect(settFelt.mock.calls[0]![0]).toMatchObject({ navn: "Melk", foer: "Melk" });
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/«Melk» → «Lettmelk»/));
    expect(navnFelt("Lettmelk")).toHaveValue("Helmelk");

    await userEvent.click(
      within(screen.getByRole("alert", { name: "Navn endret for Lettmelk" })).getByRole("button", {
        name: "Behold utkastet mitt",
      }),
    );
    settFelt.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.click(lagreNavn());
    expect(settFelt.mock.calls[1]![0]).toMatchObject({
      navn: "Lettmelk",
      foer: "Lettmelk",
      ny: "Helmelk",
    });
  });

  it("raden erstattes med en annen vare: utkastet vises ikke og kan ikke lagres der; eget valg forkaster", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skrivNavn("Helmelk");
    liste([{ ...MELK, name: "Egg", itemId: "v-egg" }]);
    r.rerender(skjerm());
    expect(navnFelt("Egg")).toHaveValue("Egg");
    expect(navnFelt("Egg")).toBeDisabled();
    const varsel = screen.getByRole("alert", { name: "Navneutkast for annen vare på Egg" });
    expect(varsel).toHaveTextContent(
      "Navneutkastet ditt («Helmelk») ble skrevet for «Melk», men raden er nå «Egg». Det kan ikke lagres på denne raden.",
    );
    expect(screen.queryByRole("button", { name: "Lagre navn" })).toBeNull();
    // Panelet er sperret til Helen eksplisitt åpner den nye varen (review 5924881773).
    expect(screen.getByRole("alert", { name: "Raden er byttet ut" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Åpne «Egg»" }));
    await userEvent.click(
      within(screen.getByRole("alert", { name: /for annen vare på Egg/ })).getByRole("button", {
        name: "Forkast utkastet og start på nytt",
      }),
    );
    expect(navnFelt("Egg")).toBeEnabled();
    expect(settFelt).not.toHaveBeenCalled();
  });

  it("rad uten varekobling får nytt navn på en annen enhet: kan være en annen vare — utkastet holdes unna", async () => {
    const uten = { ...MELK, itemId: null };
    liste([uten]);
    const r = render(skjerm());
    await aapne();
    await skrivNavn("Helmelk");
    liste([{ ...uten, name: "Egg" }]);
    r.rerender(skjerm());
    expect(
      screen.getByRole("alert", { name: "Navneutkast for annen vare på Egg" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lagre navn" })).toBeNull();
  });

  it("ukjent utfall: navnet sperret; «Sjekk» er skrivefri; nektet kontroll holder ukjent status; bekreftet verdi fjerner utkastet", async () => {
    liste([MELK]);
    render(skjerm());
    await aapne();
    await skrivNavn("Helmelk");
    settFelt.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreNavn());
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Vi vet ikke om navnet/));
    expect(within(melding()).queryByRole("button", { name: "Lukk" })).toBeNull();
    expect(navnFelt()).toBeDisabled();
    const plan = settFelt.mock.calls[0]![0];

    sjekkFelt.mockResolvedValueOnce({ utfall: "avvist" });
    await userEvent.click(within(melding()).getByRole("button", { name: "Sjekk" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(/Fortsatt ikke avklart .*ingen tilgang/),
    );
    expect(sjekkFelt.mock.calls[0]![0]).toBe(plan);
    expect(navnFelt()).toBeDisabled();

    sjekkFelt.mockResolvedValueOnce({ utfall: "lest", verdi: "Helmelk" });
    await userEvent.click(within(melding()).getByRole("button", { name: "Sjekk" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "Navnet på «Melk» er nå «Helmelk», som utkastet ditt. Kontrollen kan ikke se hvem som skrev det, men det er ingenting mer å lagre.",
      ),
    );
    expect(settFelt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Lagre navn" })).toBeNull();
  });

  it("raden fjernes etter tapt svar: navneutkastet står synlig etter at meldingen er lukket", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skrivNavn("Helmelk");
    settFelt.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreNavn());
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Vi vet ikke/));
    liste([]);
    r.rerender(skjerm());
    sjekkFelt.mockResolvedValueOnce({ utfall: "borte" });
    await userEvent.click(within(melding()).getByRole("button", { name: "Sjekk" }));
    await vi.waitFor(() =>
      expect(melding()).toHaveTextContent(
        "«Melk» er ikke lenger på listen. Det kan ikke avgjøres om utkastet ditt («Helmelk») ble lagret før dette. Ingenting er sendt på nytt.",
      ),
    );
    await userEvent.click(within(melding()).getByRole("button", { name: "Lukk" }));
    const utkast = screen.getByRole("alert", { name: "Navneutkast uten rad: Melk" });
    expect(utkast).toHaveTextContent("Ulagret navneutkast for «Melk»: «Helmelk».");
    await userEvent.click(within(utkast).getByRole("button", { name: "Forkast utkastet" }));
    expect(screen.queryByRole("alert", { name: "Navneutkast uten rad: Melk" })).toBeNull();
  });

  it("Helens eget lagrede navn tar med et mengdeutkast på samme vare", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await userEvent.clear(mengdeFelt());
    await userEvent.type(mengdeFelt(), "25");
    await skrivNavn("Helmelk");
    settFelt.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.click(lagreNavn());
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Lagre navn" })).toBeNull());
    liste([{ ...MELK, name: "Helmelk" }]);
    r.rerender(skjerm());
    expect(mengdeFelt("Helmelk")).toHaveValue("25");
    settMengde.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.click(screen.getByRole("button", { name: "Lagre mengde" }));
    expect(settMengde.mock.calls[0]![0]).toMatchObject({ navn: "Helmelk", ny: "25" });
  });
});

describe("HandlelisteScreen: kategori", () => {
  it("kategorivalg sendes som eksplisitt valg med førverdi fra visningen; velgeren er sperret mens det lagres", async () => {
    liste([MELK]);
    render(skjerm());
    await aapne();
    const d = utsatt();
    settFelt.mockReturnValueOnce(d.promise);
    await userEvent.selectOptions(kategori(), "Drikke");
    expect(settFelt.mock.calls[0]![0]).toEqual({
      id: "m",
      felt: "cat",
      navn: "Melk",
      itemId: "v-melk",
      foer: "Ost og meieri",
      ny: "Drikke",
    });
    expect(kategori()).toBeDisabled();
    d.svar({ utfall: "anvendt" });
    await vi.waitFor(() => expect(kategori()).toBeEnabled());
    expect(updateField).not.toHaveBeenCalled();
  });

  it("manglende kategori vises og sendes som «Diverse»", async () => {
    liste([{ ...MELK, cat: undefined as unknown as string }]);
    render(skjerm());
    await aapne();
    expect(kategori()).toHaveValue("Diverse");
    settFelt.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.selectOptions(kategori(), "Drikke");
    expect(settFelt.mock.calls[0]![0]).toMatchObject({ foer: "Diverse", ny: "Drikke" });
  });

  it.each([
    [
      "konflikt",
      {
        utfall: "konflikt",
        grunn:
          "Kategorien på «Melk» er endret på en annen enhet («Ost og meieri» → «Frysevarer») mens du redigerte. Ingenting er lagret.",
      },
      "Kategorien på «Melk» er endret på en annen enhet («Ost og meieri» → «Frysevarer») mens du redigerte. Ingenting er lagret. Valget ditt var «Drikke» — velg på nytt hvis det fortsatt skal gjelde.",
    ],
    [
      "avvist",
      { utfall: "avvist" },
      "Ingen tilgang til å lagre kategorien på «Melk». Ingenting er lagret. Valget ditt var «Drikke» — velg på nytt hvis det fortsatt skal gjelde.",
    ],
    [
      "borte",
      { utfall: "konflikt", grunn: "«Melk» er ikke lenger på listen. Ingenting er lagret." },
      "«Melk» er ikke lenger på listen. Ingenting er lagret. Valget ditt var «Drikke»",
    ],
  ] as const)("%s: tydelig melding som viser valget", async (_n, u, tekst) => {
    liste([MELK]);
    render(skjerm());
    await aapne();
    settFelt.mockResolvedValueOnce(u as InnleggingsSkriveutfall);
    await userEvent.selectOptions(kategori(), "Drikke");
    await vi.waitFor(() => expect(melding("Kategori")).toHaveTextContent(tekst));
    expect(kategori()).toBeEnabled();
  });

  it("ukjent utfall → raden erstattet: kontrollen er skrivefri og påstår ingenting om historikken", async () => {
    liste([MELK]);
    render(skjerm());
    await aapne();
    settFelt.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.selectOptions(kategori(), "Drikke");
    await vi.waitFor(() => expect(kategori()).toBeDisabled());
    sjekkFelt.mockResolvedValueOnce({
      utfall: "erstattet",
      grunn: "«Melk» er endret på en annen enhet (varekoblingen er byttet).",
    });
    await userEvent.click(await sjekkKnapp("Kategori"));
    await vi.waitFor(() =>
      expect(melding("Kategori")).toHaveTextContent(
        "«Melk» er endret på en annen enhet (varekoblingen er byttet). Det kan ikke avgjøres om valget ditt («Drikke») ble lagret før dette. Ingenting er sendt på nytt.",
      ),
    );
    expect(melding("Kategori")).not.toHaveTextContent(/er lagret|ikke lagret\.|som valget ditt/);
    expect(settFelt).toHaveBeenCalledTimes(1);
    expect(kategori()).toBeEnabled();
  });
});

describe("HandlelisteScreen: panelet er bundet til varen som ble åpnet (review 5924881773)", () => {
  const EGG: ShoppingItem = { ...MELK, name: "Egg", itemId: "v-egg" };

  it("kategorivelgeren har fokus når raden erstattes med en annen vare i samme kategori: valget sender ingen plan for den nye varen", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    const velger = kategori();
    velger.focus();
    liste([EGG]);
    r.rerender(skjerm());
    expect(velger).toBe(kategori("Egg")); // samme DOM-velger, samme nøkkel
    expect(screen.getByRole("alert", { name: "Raden er byttet ut" })).toHaveTextContent(
      "Raden du redigerte («Melk») er nå «Egg». Ingenting er endret, og feltene er sperret. Åpne «Egg» hvis du vil redigere den.",
    );
    expect(velger).toBeDisabled();
    fireEvent.change(velger, { target: { value: "Drikke" } });
    expect(settFelt).not.toHaveBeenCalled();
  });

  it("navnefeltet har fokus før første tastetrykk når raden erstattes: tastetrykket gir verken utkast eller plan for den nye varen", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    const felt = navnFelt();
    felt.focus();
    liste([EGG]);
    r.rerender(skjerm());
    expect(felt).toBe(navnFelt("Egg"));
    expect(felt).toBeDisabled();
    fireEvent.change(felt, { target: { value: "Helmelk" } });
    expect(navnFelt("Egg")).toHaveValue("Egg");
    expect(screen.queryByRole("button", { name: "Lagre navn" })).toBeNull();
    fireEvent.change(mengdeFelt("Egg"), { target: { value: "25" } });
    expect(screen.queryByRole("button", { name: "Lagre mengde" })).toBeNull();
    expect(settFelt).not.toHaveBeenCalled();
  });

  it("«Åpne «Egg»» binder panelet til den nye varen eksplisitt; valget bygger da på Egg", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    liste([EGG]);
    r.rerender(skjerm());
    await userEvent.click(screen.getByRole("button", { name: "Åpne «Egg»" }));
    expect(screen.queryByRole("alert", { name: "Raden er byttet ut" })).toBeNull();
    settFelt.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.selectOptions(kategori("Egg"), "Drikke");
    expect(settFelt.mock.calls[0]![0]).toEqual({
      id: "m",
      felt: "cat",
      navn: "Egg",
      itemId: "v-egg",
      foer: "Ost og meieri",
      ny: "Drikke",
    });
  });

  it("eksisterende navneutkast og ukjent-melding står når raden erstattes", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    await skrivNavn("Helmelk");
    settFelt.mockResolvedValueOnce({ utfall: "ukjent" });
    await userEvent.click(lagreNavn());
    await vi.waitFor(() => expect(melding()).toHaveTextContent(/Vi vet ikke om navnet/));
    liste([EGG]);
    r.rerender(skjerm());
    expect(screen.getByRole("alert", { name: "Raden er byttet ut" })).toBeInTheDocument();
    expect(
      screen.getByRole("alert", { name: "Navneutkast for annen vare på Egg" }),
    ).toHaveTextContent("«Helmelk»");
    expect(within(melding()).getByRole("button", { name: "Sjekk" })).toBeInTheDocument();
  });

  it("vanlig kategorivalg med tastatur (change uten klikk) på samme vare sendes som før", async () => {
    liste([MELK]);
    render(skjerm());
    await aapne();
    kategori().focus();
    settFelt.mockResolvedValueOnce({ utfall: "anvendt" });
    fireEvent.change(kategori(), { target: { value: "Frysevarer" } });
    expect(settFelt.mock.calls[0]![0]).toMatchObject({ navn: "Melk", ny: "Frysevarer" });
  });

  it("samme vare får nytt navn på en annen enhet (varekobling): ingen sperre, kategorivalget går", async () => {
    liste([MELK]);
    const r = render(skjerm());
    await aapne();
    liste([{ ...MELK, name: "Lettmelk" }]);
    r.rerender(skjerm());
    expect(screen.queryByRole("alert", { name: "Raden er byttet ut" })).toBeNull();
    settFelt.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.selectOptions(kategori("Lettmelk"), "Drikke");
    expect(settFelt.mock.calls[0]![0]).toMatchObject({ navn: "Lettmelk", itemId: "v-melk" });
  });

  it("Helens eget nye navn på en rad uten varekobling sperrer ikke panelet", async () => {
    const uten = { ...MELK, itemId: null };
    liste([uten]);
    const r = render(skjerm());
    await aapne();
    await skrivNavn("Helmelk");
    settFelt.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.click(lagreNavn());
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Lagre navn" })).toBeNull());
    liste([{ ...uten, name: "Helmelk" }]);
    r.rerender(skjerm());
    expect(screen.queryByRole("alert", { name: "Raden er byttet ut" })).toBeNull();
    expect(kategori("Helmelk")).toBeEnabled();
  });

  it("utsatt navnebekreftelse for rad A endrer ikke panelet for rad B (to like, ukoblede rader) (review 5926171764)", async () => {
    const a: ShoppingItem = { ...MELK, id: "a", itemId: null };
    const b: ShoppingItem = { ...MELK, id: "b", itemId: null };
    liste([a, b]);
    const r = render(skjerm());
    const [radA, radB] = screen.getAllByText("Melk");
    await userEvent.click(radA!);
    await skrivNavn("Helmelk");
    const d = utsatt();
    settFelt.mockReturnValueOnce(d.promise);
    await userEvent.click(lagreNavn());
    expect(settFelt.mock.calls[0]![0]).toMatchObject({ id: "a", ny: "Helmelk" });

    // Åpne B før svaret for A kommer.
    await userEvent.click(radB!);
    d.svar({ utfall: "anvendt" });
    liste([{ ...a, name: "Helmelk" }, b]);
    r.rerender(skjerm());
    await vi.waitFor(() => expect(navnFelt("Melk")).toBeEnabled());

    expect(screen.queryByRole("alert", { name: "Raden er byttet ut" })).toBeNull();
    expect(navnFelt("Melk")).toHaveValue("Melk");
    expect(kategori("Melk")).toBeEnabled();
    expect(kategori("Melk")).toHaveValue("Ost og meieri");
    settFelt.mockResolvedValueOnce({ utfall: "anvendt" });
    await userEvent.selectOptions(kategori("Melk"), "Drikke");
    expect(settFelt.mock.calls[1]![0]).toMatchObject({ id: "b", navn: "Melk", itemId: null });
  });
});
