import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handlelisteDuplikaterAktiv } from "@hooks/handlelisteDuplikaterAktivering";
import { useItems } from "@hooks/useItems";
import { useShoppingList } from "@hooks/useShoppingList";
import { useStaples } from "@hooks/useStaples";
import { loaded, loading } from "@app-types/status";
import type { ShoppingItem, Staples } from "@app-types/shopping";
import { HandlelisteScreen } from "./HandlelisteScreen";

/**
 * Tilbakerulling (ADR 0003, #77 review 6355434985 pkt. 1): med porten for
 * nye sammenslåinger AV skal eksisterende sammenslåinger fortsatt kunne
 * angres fra handlelisten.
 */

vi.mock("@hooks/handlelisteDuplikaterAktivering", () => ({ handlelisteDuplikaterAktiv: vi.fn() }));
vi.mock("@hooks/useShoppingList", () => ({ useShoppingList: vi.fn() }));
vi.mock("@hooks/useItems", () => ({ useItems: vi.fn() }));
vi.mock("@hooks/useStaples", () => ({ useStaples: vi.fn() }));

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
const SAMMENSLATT = rad("a", {
  amount: "3",
  sammenslaing: { opId: "op-1", tidspunkt: "t", antallKilder: 1 },
});

const angreSammenslaing = vi.fn().mockResolvedValue({ utfall: "anvendt" });
const slaaSammen = vi.fn();

function vis(rader: ShoppingItem[]) {
  vi.mocked(useShoppingList).mockReturnValue({
    shopping: loaded(rader),
    addItem: vi.fn(),
    toggleDone: vi.fn(),
    updateField: vi.fn(),
    removeItem: vi.fn(),
    clearDone: vi.fn(),
    slaaSammen,
    angreSammenslaing,
  } as unknown as ReturnType<typeof useShoppingList>);
  return render(
    <MemoryRouter>
      <HandlelisteScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
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

describe("HandlelisteScreen: aktiveringsport og angring", () => {
  it("porten AV: ingen nye sammenslåinger, men eksisterende kan angres", async () => {
    vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
    vis([SAMMENSLATT, rad("b", { amount: "2" }), rad("c", { amount: "5" })]);
    expect(screen.queryByText(/Mulige duplikater/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Angre sammenslåing av Melk" }));
    expect(angreSammenslaing).toHaveBeenCalledWith("a", "op-1");
    expect(await screen.findByRole("status")).toHaveTextContent("Sammenslåingen er angret.");
  });

  it("porten AV og ingen sammenslåtte rader: ingenting om duplikater vises", () => {
    vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
    vis([rad("b"), rad("c")]);
    expect(screen.queryByText(/Mulige duplikater/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Sammenslåtte rader" })).not.toBeInTheDocument();
  });

  it("porten PÅ: både forslag og angring", () => {
    vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(true);
    vis([SAMMENSLATT, rad("b"), rad("c")]);
    expect(screen.getByText("Mulige duplikater (1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Angre sammenslåing av Melk" })).toBeInTheDocument();
  });
});

describe("«Merk som basisvare» fra handlelisten (#20, ordre 6651329875)", () => {
  // Basisvarene som et lite abonnement, så en bekreftet skriving kan vises.
  let stapleData: Staples;
  let markAsStaple: ReturnType<typeof vi.fn<(name: string) => Promise<void>>>;
  let liste: ReturnType<typeof useShoppingList>;
  function visMedBasisvarer(rader: ShoppingItem[], start: Staples | null = {}) {
    stapleData = start ?? {};
    markAsStaple = vi.fn<(name: string) => Promise<void>>();
    vi.mocked(useStaples).mockImplementation(() => ({
      staples: start === null ? loading : loaded(stapleData),
      markAsStaple,
      unmarkStaple: vi.fn(),
    }));
    vi.mocked(handlelisteDuplikaterAktiv).mockReturnValue(false);
    const r = vis(rader);
    liste = vi.mocked(useShoppingList).mock.results.at(-1)!.value as ReturnType<
      typeof useShoppingList
    >;
    return r;
  }
  /** Utsatt lagring: testen bestemmer når og hvordan den ender. */
  function utsatt() {
    const kall: { ok: () => void; feil: () => void }[] = [];
    markAsStaple.mockImplementation(
      () =>
        new Promise<void>((ok, feil) =>
          kall.push({ ok: () => ok(), feil: () => feil(new Error("nett")) }),
        ),
    );
    return kall;
  }
  const aapne = (navn: string) => userEvent.click(screen.getByText(navn, { selector: "span" }));
  const knapp = (navn: RegExp | string) => screen.getByRole("button", { name: navn });

  it("laster: ingen handling før status er lest", async () => {
    visMedBasisvarer([rad("a")], null);
    await aapne("Melk");
    expect(screen.getByRole("status")).toHaveTextContent("Sjekker basisvare…");
    expect(screen.queryByRole("button", { name: "Merk som basisvare" })).toBeNull();
  });

  it("allerede basisvare (annen skrivemåte): vises som «Basisvare», ingen ny skriving", async () => {
    visMedBasisvarer([rad("a", { name: "MELK" })], { melk: true });
    await aapne("MELK");
    expect(screen.getByText("Basisvare")).toBeInTheDocument();
    expect(screen.getByText(/Fjernes i Matlager/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merk som basisvare" })).toBeNull();
    expect(markAsStaple).not.toHaveBeenCalled();
  });

  it("lagring: «Lagrer…» til bekreftet, dobbeltklikk skriver én gang, listen er urørt", async () => {
    const r = visMedBasisvarer([rad("a", { itemId: undefined, name: "Gammel vare" })]);
    const kall = utsatt();
    await aapne("Gammel vare");
    expect(screen.getByText(/avhukes automatisk neste gang/)).toBeInTheDocument();
    await userEvent.dblClick(knapp("Merk som basisvare"));
    expect(markAsStaple).toHaveBeenCalledTimes(1);
    expect(markAsStaple).toHaveBeenCalledWith("Gammel vare");
    expect(knapp("Lagrer…")).toBeDisabled();
    // Lokal, optimistisk verdi vises ikke som lagret før bekreftelsen.
    stapleData = { "gammel vare": true };
    r.rerender(
      <MemoryRouter>
        <HandlelisteScreen />
      </MemoryRouter>,
    );
    expect(knapp("Lagrer…")).toBeDisabled();
    await act(async () => kall[0]!.ok());
    expect(screen.getByText("Basisvare")).toBeInTheDocument();
    // Varen står på listen, uendret: ingen avhuking, fjerning, sammenslåing eller felt.
    expect(
      screen.getByRole("button", { name: "Merk Gammel vare som fullført" }),
    ).toBeInTheDocument();
    for (const f of ["toggleDone", "removeItem", "updateField", "addItem", "clearDone"] as const) {
      expect(liste[f], f).not.toHaveBeenCalled();
    }
    expect(slaaSammen).not.toHaveBeenCalled();
  });

  it("feil: synlig, ikke rapportert som lagret; «Prøv igjen» lykkes", async () => {
    visMedBasisvarer([rad("a")]);
    const kall = utsatt();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await aapne("Melk");
    await userEvent.click(knapp("Merk som basisvare"));
    await act(async () => kall[0]!.feil());
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Kunne ikke lagre «Melk» som basisvare. Ingenting er endret.",
    );
    expect(screen.queryByText("Basisvare")).toBeNull();
    await userEvent.click(knapp("Prøv igjen"));
    expect(markAsStaple).toHaveBeenCalledTimes(2);
    expect(knapp("Lagrer…")).toBeDisabled();
  });

  it("utfallet følger varen: radbytte under lagring flytter det ikke til en annen vare", async () => {
    visMedBasisvarer([rad("a"), rad("b", { itemId: "v-egg", name: "Egg" })]);
    const kall = utsatt();
    await aapne("Melk");
    await userEvent.click(knapp("Merk som basisvare"));
    await aapne("Egg");
    expect(knapp("Merk som basisvare")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Lagrer…" })).toBeNull();
    await act(async () => kall[0]!.feil());
    // Feilen gjelder Melk, ikke Egg.
    expect(screen.queryByRole("alert")).toBeNull();
    await aapne("Melk");
    expect(screen.getByRole("alert")).toHaveTextContent("«Melk»");
  });

  it("tastatur og bobling: Enter merker, uten å huke av eller lukke redigeringen", async () => {
    visMedBasisvarer([rad("a")]);
    markAsStaple.mockResolvedValue(undefined);
    await aapne("Melk");
    knapp("Merk som basisvare").focus();
    await userEvent.keyboard("{Enter}");
    expect(markAsStaple).toHaveBeenCalledWith("Melk");
    expect(liste.toggleDone).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toBeInTheDocument(); // redigeringsraden står
  });

  it("navn som ikke kan lagres (skråstrek, forbudte tegn, tomt): forklaring, ingen handling", async () => {
    visMedBasisvarer([
      rad("a", { name: "Salt/pepper" }),
      rad("b", { name: "Olje [ekstra]", itemId: "v2" }),
    ]);
    await aapne("Salt/pepper");
    expect(
      screen.getByText(/inneholder tegn som ikke kan lagres som basisvare/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merk som basisvare" })).toBeNull();
    await aapne("Olje [ekstra]");
    expect(screen.queryByRole("button", { name: "Merk som basisvare" })).toBeNull();
    expect(markAsStaple).not.toHaveBeenCalled();
  });
});
