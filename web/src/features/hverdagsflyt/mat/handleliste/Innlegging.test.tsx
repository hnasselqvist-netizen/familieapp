import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import type { InnleggingsSkriveutfall } from "@data/shopping.repository";
import { loaded } from "@app-types/status";
import type { ShoppingItem } from "@app-types/shopping";
import type { Vare } from "@app-types/vare";
import { HandlelisteScreen } from "./HandlelisteScreen";

/**
 * Varsel ved manuell innlegging av en aktiv vare (Mat #20, ordre
 * 6830803229). Hooken er mocket; den atomiske kontrollen er dekket av
 * domenetestene og emulatortesten `shoppingInnlegging.repository`.
 */

vi.mock("@hooks/handlelisteDuplikaterAktivering", () => ({ handlelisteDuplikaterAktiv: vi.fn() }));
vi.mock("@hooks/useShoppingList", () => ({ useShoppingList: vi.fn() }));
vi.mock("@hooks/useItems", () => ({ useItems: vi.fn() }));
vi.mock("@hooks/useStaples", () => ({ useStaples: vi.fn() }));

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
const VARER: Vare[] = [
  { id: "v-melk", name: "Melk", cat: "Ost og meieri" },
  { id: "v-egg", name: "Egg", cat: "Ost og meieri" },
];

type Skriv = ReturnType<typeof vi.fn<(...a: unknown[]) => Promise<InnleggingsSkriveutfall>>>;
let leggTilNyRad: Skriv;
let okAntall: Skriv;
let addItem: ReturnType<typeof vi.fn>;
let findOrCreateItem: ReturnType<typeof vi.fn>;

function vis(rader: ShoppingItem[]) {
  vi.mocked(useShoppingList).mockReturnValue({
    shopping: loaded(rader),
    addItem,
    toggleDone: vi.fn(),
    updateField: vi.fn(),
    removeItem: vi.fn(),
    clearDone: vi.fn(),
    slaaSammen: vi.fn(),
    angreSammenslaing: vi.fn(),
    leggTilNyRad,
    okAntall,
  } as unknown as ReturnType<typeof useShoppingList>);
  return render(
    <MemoryRouter>
      <HandlelisteScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  leggTilNyRad = vi.fn().mockResolvedValue({ utfall: "anvendt" });
  okAntall = vi.fn().mockResolvedValue({ utfall: "anvendt" });
  addItem = vi.fn();
  findOrCreateItem = vi.fn(async (name: string) => {
    const v = VARER.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    return v ?? { id: "v-ny", name: name.trim(), cat: "Diverse" };
  });
  vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
  vi.mocked(useStaples).mockReturnValue({
    staples: loaded({}),
    markAsStaple: vi.fn(),
    unmarkStaple: vi.fn(),
  });
  vi.mocked(useItems).mockReturnValue({
    items: loaded(VARER),
    findOrCreateItem,
  } as unknown as ReturnType<typeof useItems>);
});

const navnFelt = () => screen.getByPlaceholderText("Hva trenger du?");
const mengdeFelt = () => screen.getByRole("textbox", { name: "Mengde" });
async function skriv(navn: string, mengde: string) {
  await userEvent.type(navnFelt(), navn);
  if (mengde) await userEvent.type(mengdeFelt(), mengde);
}
const leggTilKnapp = () => screen.getByRole("button", { name: "Legg til" });
const okKnapp = () => screen.getByRole("button", { name: "Øk antallet" });
const ingenSkriving = () => {
  expect(leggTilNyRad).not.toHaveBeenCalled();
  expect(okAntall).not.toHaveBeenCalled();
  expect(findOrCreateItem).not.toHaveBeenCalled();
  expect(addItem).not.toHaveBeenCalled();
};

describe("manuell innlegging: varsel ved aktiv vare", () => {
  it("treff: viser eksisterende rad og nytt antall; «Øk antallet» øker én målrad", async () => {
    vis([rad("m"), rad("b", { itemId: "v-brod", name: "Brød", amount: "1" })]);
    await skriv("melk", "3");
    await userEvent.click(leggTilKnapp());
    const panel = screen.getByRole("group", { name: "«melk» står allerede på listen" });
    expect(panel).toHaveTextContent("Melk · 2 · Ost og meieri");
    expect(panel).toHaveTextContent("Samme vare");
    expect(panel).toHaveTextContent("Nytt antall: 2 + 3 = 5");
    ingenSkriving(); // ingen vare opprettet, ingen rad før valget
    await userEvent.click(okKnapp());
    expect(okAntall).toHaveBeenCalledTimes(1);
    const [plan, gjentak] = okAntall.mock.calls[0]!;
    expect(gjentak).toBe(false);
    expect(plan).toMatchObject({
      radId: "m",
      tillegg: "3",
      resultat: "5",
      sett: { name: "Melk", amount: "2", cat: "Ost og meieri", itemId: "v-melk", done: false },
    });
    expect(leggTilNyRad).not.toHaveBeenCalled();
    expect(findOrCreateItem).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Økte «Melk» til 5.");
    expect(navnFelt()).toHaveValue("");
    expect(screen.queryByRole("group", { name: /står allerede/ })).toBeNull();
  });

  it("«Avbryt»: ingen skriving, ingen ny rad, utkastet står", async () => {
    vis([rad("m")]);
    await skriv("Melk", "1");
    await userEvent.click(leggTilKnapp());
    await userEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("group", { name: /står allerede/ })).toBeNull();
    ingenSkriving();
    expect(navnFelt()).toHaveValue("Melk");
    expect(mengdeFelt()).toHaveValue("1");
  });

  it("fullført rad blokkerer ikke: ny rad uten varsel", async () => {
    vis([rad("m", { done: true })]);
    await skriv("Melk", "1");
    await userEvent.click(leggTilKnapp());
    expect(screen.queryByRole("group", { name: /står allerede/ })).toBeNull();
    expect(leggTilNyRad).toHaveBeenCalledTimes(1);
    expect(leggTilNyRad.mock.calls[0]![0]).toMatchObject({
      rad: { itemId: "v-melk", name: "Melk", amount: "1", cat: "Ost og meieri", done: false },
    });
    expect(screen.getByRole("status")).toHaveTextContent("La til «Melk».");
    expect(navnFelt()).toHaveValue("");
  });

  it("samme navn, ulike bekreftede vare-id-er: ingen sammenslåing, ny rad", async () => {
    vis([rad("m", { itemId: "v-annen" })]);
    await skriv("Melk", "1");
    await userEvent.click(leggTilKnapp());
    expect(screen.queryByRole("group", { name: /står allerede/ })).toBeNull();
    expect(leggTilNyRad).toHaveBeenCalledTimes(1);
  });

  it("navnekandidat uten bekreftet identitet merkes som mulig annen vare", async () => {
    vis([rad("m", { itemId: null })]);
    await skriv("Melk", "1");
    await userEvent.click(leggTilKnapp());
    expect(screen.getByRole("group", { name: /står allerede/ })).toHaveTextContent(
      "Samme navn, kanskje en annen vare",
    );
    ingenSkriving();
  });

  it("flere treff: målrad må velges før økning", async () => {
    vis([rad("a"), rad("b", { itemId: null, amount: "4" })]);
    await skriv("Melk", "1");
    await userEvent.click(leggTilKnapp());
    expect(screen.getByRole("group", { name: /flere ganger/ })).toHaveTextContent(
      "Velg hvilken rad som skal økes.",
    );
    expect(okKnapp()).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: "Øk Melk (4)" }));
    expect(screen.getByText(/Nytt antall: 4 \+ 1 =/)).toBeInTheDocument();
    await userEvent.click(okKnapp());
    expect(okAntall.mock.calls[0]![0]).toMatchObject({ radId: "b", resultat: "5" });
  });

  it("uklar mengde: ingen økning tilbys, ingen gjetting av tom mengde", async () => {
    vis([rad("m", { amount: "1 l" })]);
    await skriv("Melk", "2");
    await userEvent.click(leggTilKnapp());
    expect(screen.getByText(/enheter eller fritekst/)).toBeInTheDocument();
    expect(okKnapp()).toBeDisabled();
    await userEvent.clear(mengdeFelt());
    expect(screen.getByText(/Skriv hvor mye du vil legge til/)).toBeInTheDocument();
    expect(okKnapp()).toBeDisabled();
    ingenSkriving();
  });

  it("samtidig ny rad fra annen klient: konflikt vises, utkastet beholdes", async () => {
    leggTilNyRad.mockResolvedValue({
      utfall: "konflikt",
      grunn: "Varen står allerede på listen (lagt til i mellomtiden). Ingenting er lagret.",
      treff: true,
    });
    vis([]);
    await skriv("Egg", "6");
    await userEvent.click(leggTilKnapp());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "(lagt til i mellomtiden). Ingenting er lagret. Trykk «Legg til» igjen",
    );
    expect(navnFelt()).toHaveValue("Egg");
    expect(mengdeFelt()).toHaveValue("6");
  });

  it("konflikt i bekreftelsen: vises tydelig, utkastet beholdes, ingen ny rad", async () => {
    okAntall.mockResolvedValue({
      utfall: "konflikt",
      grunn:
        "Raden er endret, huket av eller flyttet siden varselet ble vist. Ingenting er lagret.",
    });
    vis([rad("m")]);
    await skriv("Melk", "1");
    await userEvent.click(leggTilKnapp());
    await userEvent.click(okKnapp());
    expect(screen.getByRole("alert")).toHaveTextContent("Raden er endret");
    expect(leggTilNyRad).not.toHaveBeenCalled();
    expect(navnFelt()).toHaveValue("Melk");
    expect(mengdeFelt()).toHaveValue("1");
  });

  it("tapt svar ved økning: «Prøv igjen» sender samme forsøk som gjentak", async () => {
    okAntall
      .mockResolvedValueOnce({ utfall: "ukjent" })
      .mockResolvedValueOnce({ utfall: "allerede" });
    vis([rad("m")]);
    await skriv("Melk", "1");
    await userEvent.click(leggTilKnapp());
    await userEvent.click(okKnapp());
    const varsel = screen.getByRole("alert");
    expect(varsel).toHaveTextContent("Vi vet ikke om endringen ble lagret.");
    expect(navnFelt()).toHaveValue("Melk");
    await userEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    expect(okAntall).toHaveBeenCalledTimes(2);
    expect(okAntall.mock.calls[1]![0]).toBe(okAntall.mock.calls[0]![0]);
    expect(okAntall.mock.calls[1]![1]).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Var allerede lagret. Ingen ny endring.");
    expect(navnFelt()).toHaveValue("");
  });

  it("tapt svar ved ny rad: «Legg til» med samme utkast gjentar samme opId; ubekreftet holder", async () => {
    leggTilNyRad
      .mockResolvedValueOnce({ utfall: "ukjent" })
      .mockResolvedValueOnce({ utfall: "ubekreftet", grunn: "Fant ingen kvittering." });
    vis([]);
    await skriv("Egg", "6");
    await userEvent.click(leggTilKnapp());
    await userEvent.click(leggTilKnapp());
    expect(leggTilNyRad).toHaveBeenCalledTimes(2);
    expect(leggTilNyRad.mock.calls[1]![0]).toBe(leggTilNyRad.mock.calls[0]![0]);
    expect(leggTilNyRad.mock.calls[1]![1]).toBe(true);
    expect(findOrCreateItem).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Fant ingen kvittering.");
    expect(navnFelt()).toHaveValue("Egg");
    // «Send som ny»: nytt forsøk med ny opId.
    await userEvent.click(screen.getByRole("button", { name: "Send som ny" }));
    expect(leggTilNyRad).toHaveBeenCalledTimes(3);
    const [forste, , tredje] = leggTilNyRad.mock.calls.map((c) => (c[0] as { opId: string }).opId);
    expect(tredje).not.toBe(forste);
    expect(leggTilNyRad.mock.calls[2]![1]).toBe(false);
  });

  it("dobbeltklikk: ett forsøk", async () => {
    let slipp: (u: InnleggingsSkriveutfall) => void = () => undefined;
    leggTilNyRad.mockImplementation(() => new Promise((ok) => (slipp = ok)));
    vis([]);
    await skriv("Egg", "6");
    await userEvent.dblClick(leggTilKnapp());
    expect(findOrCreateItem).toHaveBeenCalledTimes(1);
    expect(leggTilNyRad).toHaveBeenCalledTimes(1);
    await act(async () => slipp({ utfall: "anvendt" }));
    expect(screen.getByRole("status")).toHaveTextContent("La til «Egg».");
  });

  it("utkast endret under lagring tømmes ikke", async () => {
    let slipp: (u: InnleggingsSkriveutfall) => void = () => undefined;
    leggTilNyRad.mockImplementation(() => new Promise((ok) => (slipp = ok)));
    vis([]);
    await skriv("Egg", "6");
    await userEvent.click(leggTilKnapp());
    await userEvent.type(mengdeFelt(), "0");
    await act(async () => slipp({ utfall: "anvendt" }));
    expect(screen.getByRole("status")).toHaveTextContent("La til «Egg».");
    expect(mengdeFelt()).toHaveValue("60");
    expect(navnFelt()).toHaveValue("Egg");
  });
});
