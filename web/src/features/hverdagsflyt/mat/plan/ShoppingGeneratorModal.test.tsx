import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratorPlan } from "@domain/shopping/handlelisteGenerator";
import type { InnleggingsSkriveutfall } from "@data/shopping.repository";
import type { MergedShoppingItem, ShoppingItem } from "@app-types/shopping";
import { loaded } from "@app-types/status";
import { ShoppingGeneratorModal } from "./ShoppingGeneratorModal";

/**
 * «Legg til N varer» (Mat #20, ordre 6843084184): lås mot dobbeltklikk,
 * stabil plan og `opId` ved oppfølging, skjemaet lukkes bare ved bekreftet
 * lagring eller Helens valg, og avslag beholder utkastet.
 */

const leggTilFraGenerator =
  vi.fn<(plan: GeneratorPlan, gjentak?: boolean) => Promise<InnleggingsSkriveutfall>>();
const LISTE: ShoppingItem[] = [
  { id: "m", itemId: "v-melk", name: "Melk", amount: "2", cat: "Ost og meieri", done: false },
];
const VARER: MergedShoppingItem[] = [
  {
    key: "melk",
    itemId: "v-melk",
    name: "Melk",
    amount: "3",
    unit: "",
    cat: "Ost og meieri",
    fromRecipes: ["Grøt"],
    isStaple: false,
  },
  {
    key: "egg",
    itemId: "v-egg",
    name: "Egg",
    amount: "6",
    unit: "stk",
    cat: "Ost og meieri",
    fromRecipes: ["Grøt"],
    isStaple: false,
  },
];
const ALLE_DAGER = {
  Mon: "Grøt",
  Tue: "Grøt",
  Wed: "Grøt",
  Thu: "Grøt",
  Fri: "Grøt",
  Sat: "Grøt",
  Sun: "Grøt",
};

vi.mock("@hooks/useMeals", () => ({ useMeals: () => ({ meals: loaded(ALLE_DAGER) }) }));
vi.mock("@hooks/useRecipes", () => ({ useRecipes: () => ({ recipes: loaded([]) }) }));
vi.mock("@hooks/useMealLibrary", () => ({ useMealLibrary: () => ({ mealLibrary: loaded([]) }) }));
vi.mock("@hooks/useItemHistory", () => ({ useItemHistory: () => ({ itemHistory: loaded({}) }) }));
vi.mock("@hooks/useStaples", () => ({
  useStaples: () => ({ staples: loaded([]), markAsStaple: vi.fn() }),
}));
vi.mock("@hooks/useFreezer", () => ({ useFreezer: () => ({ freezer: loaded([]) }) }));
vi.mock("@hooks/useShoppingList", () => ({
  useShoppingList: () => ({ shopping: loaded(LISTE), leggTilFraGenerator }),
}));
vi.mock("@generators/shopping/shopping", async (orig) => ({
  ...(await orig<typeof import("@generators/shopping/shopping")>()),
  buildShoppingItems: () => [],
  mergeShoppingItems: () => VARER,
}));

/** Et svar testen selv bestemmer når kommer. */
function utsatt() {
  let svar!: (u: InnleggingsSkriveutfall) => void;
  const promise = new Promise<InnleggingsSkriveutfall>((r) => (svar = r));
  return { promise, svar };
}

async function tilGjennomgang() {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<ShoppingGeneratorModal weekKey="2026-W47" onClose={onClose} />);
  await user.click(screen.getByRole("button", { name: /Hent ingredienser/ }));
  return { user, onClose, leggTil: () => screen.getByRole("button", { name: /Legg til 2 varer/ }) };
}

const planer = () => leggTilFraGenerator.mock.calls.map(([p, g]) => ({ opId: p.opId, gjentak: g }));

beforeEach(() => {
  leggTilFraGenerator.mockReset();
});

describe("ShoppingGeneratorModal — «Legg til N varer»", () => {
  it("dobbeltklikk sender én gang; bekreftet lagring lukker skjemaet", async () => {
    const { user, onClose, leggTil } = await tilGjennomgang();
    const d = utsatt();
    leggTilFraGenerator.mockReturnValueOnce(d.promise);

    await user.dblClick(leggTil());
    expect(leggTilFraGenerator).toHaveBeenCalledTimes(1);
    expect(leggTil()).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    const plan = leggTilFraGenerator.mock.calls[0]![0];
    expect(plan.entries.map((e) => [e.name, e.amount])).toEqual([
      ["Melk", "3"],
      ["Egg", "6 stk"],
    ]);
    expect(plan.effekter.endret).toEqual({ m: expect.objectContaining({ til: "5" }) });

    d.svar({ utfall: "anvendt" });
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("konflikt: ber om ny gjennomgang, skjemaet står; neste innsending er en ny operasjon", async () => {
    const { user, onClose, leggTil } = await tilGjennomgang();
    leggTilFraGenerator.mockResolvedValueOnce({
      utfall: "konflikt",
      grunn:
        "Handlelisten er endret siden forhåndsvisningen. Se gjennom varene på nytt før du legger dem til.",
    });
    await user.click(leggTil());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Ingenting er lagt til\. Handlelisten er endret .* Se gjennom varene på nytt/,
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(leggTil()).toBeEnabled();

    leggTilFraGenerator.mockResolvedValueOnce({ utfall: "anvendt" });
    await user.click(leggTil());
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const [a, b] = planer();
    expect(a!.opId).not.toBe(b!.opId);
    expect(b!.gjentak).toBe(false);
  });

  it("avvist og ikkeLest ved første innsending: tydelig melding, ingen ventende status", async () => {
    const { user, onClose, leggTil } = await tilGjennomgang();
    leggTilFraGenerator.mockResolvedValueOnce({ utfall: "avvist" });
    await user.click(leggTil());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ingen tilgang til å lagre. Ingenting er lagt til.",
    );
    expect(screen.queryByRole("alert", { name: "Ikke bekreftet" })).toBeNull();

    leggTilFraGenerator.mockResolvedValueOnce({ utfall: "ikkeLest" });
    await user.click(leggTil());
    expect(await screen.findByRole("alert")).toHaveTextContent(/Kunne ikke lese handlelisten/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ukjent utfall: ventende panel, «Legg til» og «Tilbake» sperret, lukking krever bekreftelse", async () => {
    const { user, onClose, leggTil } = await tilGjennomgang();
    leggTilFraGenerator.mockResolvedValueOnce({ utfall: "ukjent" });
    await user.click(leggTil());

    const panel = await screen.findByRole("alert", { name: "Ikke bekreftet" });
    expect(panel).toHaveTextContent(/Vi vet ikke om varene ble lagt til/);
    expect(leggTil()).toBeDisabled();
    expect(screen.getByRole("button", { name: "← Tilbake" })).toBeDisabled();

    // Krysset og «Avbryt» lukker ikke direkte — de ber om bekreftelse.
    const kryss = screen.getAllByRole("button", { name: "Lukk" }).find((b) => !panel.contains(b))!;
    await user.click(kryss);
    await user.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(onClose).not.toHaveBeenCalled();
    expect(
      within(panel).getByRole("button", { name: "Jeg har sjekket listen — lukk" }),
    ).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Ikke lukk" }));
    await user.click(within(panel).getByRole("button", { name: "Lukk" }));
    await user.click(within(panel).getByRole("button", { name: "Jeg har sjekket listen — lukk" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("«Prøv igjen» sender samme plan som gjentak; ubekreftet og avslag holder statusen; allerede lukker", async () => {
    const { user, onClose, leggTil } = await tilGjennomgang();
    leggTilFraGenerator.mockResolvedValueOnce({ utfall: "ukjent" });
    await user.click(leggTil());
    const panel = await screen.findByRole("alert", { name: "Ikke bekreftet" });

    leggTilFraGenerator.mockResolvedValueOnce({
      utfall: "ubekreftet",
      grunn: "Fant ingen kvittering for det forrige forsøket, men det kan likevel være lagret.",
    });
    await user.click(within(panel).getByRole("button", { name: "Prøv igjen" }));
    expect(
      await within(panel).findByText(/Fortsatt ikke bekreftet: Fant ingen kvittering/),
    ).toBeVisible();

    leggTilFraGenerator.mockResolvedValueOnce({ utfall: "avvist" });
    await user.click(within(panel).getByRole("button", { name: "Prøv igjen" }));
    expect(
      await within(panel).findByText(/Fortsatt ikke bekreftet: databasen nektet tilgang/),
    ).toBeVisible();
    expect(leggTil()).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    leggTilFraGenerator.mockResolvedValueOnce({ utfall: "allerede" });
    await user.click(within(panel).getByRole("button", { name: "Prøv igjen" }));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    const [første, ...oppfolging] = planer();
    expect(første!.gjentak).toBe(false);
    expect(oppfolging).toEqual(oppfolging.map(() => ({ opId: første!.opId, gjentak: true })));
    const plan = leggTilFraGenerator.mock.calls[0]![0];
    for (const [p] of leggTilFraGenerator.mock.calls) expect(p).toBe(plan);
  });

  it("«Send på nytt» krever bekreftelse, sender samme plan uten gjentak, og konflikt holder statusen", async () => {
    const { user, onClose, leggTil } = await tilGjennomgang();
    leggTilFraGenerator.mockResolvedValueOnce({ utfall: "ukjent" });
    await user.click(leggTil());
    const panel = await screen.findByRole("alert", { name: "Ikke bekreftet" });

    await user.click(within(panel).getByRole("button", { name: "Send på nytt" }));
    expect(leggTilFraGenerator).toHaveBeenCalledTimes(1);
    await user.click(within(panel).getByRole("button", { name: "Ikke send" }));
    await user.click(within(panel).getByRole("button", { name: "Send på nytt" }));

    leggTilFraGenerator.mockResolvedValueOnce({
      utfall: "konflikt",
      grunn: "Ingenting er lagret.",
    });
    await user.click(
      within(panel).getByRole("button", { name: "Jeg har sjekket listen — send på nytt" }),
    );
    expect(
      await within(panel).findByText(
        /Fortsatt ikke bekreftet: Det siste forsøket ble stoppet før det skrev noe/,
      ),
    ).toBeVisible();
    expect(panel).not.toHaveTextContent("Ingenting er lagret.");
    expect(onClose).not.toHaveBeenCalled();

    const [første, nytt] = planer();
    expect(nytt).toEqual({ opId: første!.opId, gjentak: false });
  });
});
