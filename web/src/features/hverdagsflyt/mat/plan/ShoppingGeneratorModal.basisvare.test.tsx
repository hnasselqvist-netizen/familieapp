import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BASISVARE_UGYLDIG_TEKST } from "@domain/shopping/basisvare";
import type { MergedShoppingItem } from "@app-types/shopping";
import { loaded } from "@app-types/status";
import { ShoppingGeneratorModal } from "./ShoppingGeneratorModal";

/**
 * «Ja, basisvare» i React-handlelistegeneratoren (Mat #20, ordre
 * 6944091801). Den ekte `useStaples` brukes, så hookens nøkkelvalidering
 * kjøres; bare adapteren (`merkBasisvareVersjonert`) er byttet ut. Syntetiske navn.
 *
 * - Ugyldig navn: eksisterende brukertekst, ingenting skrives.
 * - Avvist lagring: merkingen vises som ikke bekreftet.
 * - Beskjeden kan lukkes, og varen står utelatt.
 * - Mens skrivingen pågår er bekreftelsen sperret, og målet står synlig.
 */

type Merkeutfall = { utfall: string };
const markItemAsStaple = vi.fn<(familyId: string, nokkel: string) => Promise<Merkeutfall>>();
const varer = vi.hoisted(() => ({ naa: [] as MergedShoppingItem[] }));
const ytre = vi.hoisted(() => ({ onClose: vi.fn(), leggTil: vi.fn() }));

vi.mock("@data/staples.repository", () => ({
  subscribeStaples: (
    _f: string,
    cb: (s: Record<string, boolean>, eksport: Record<string, unknown>) => void,
  ) => {
    cb({}, {});
    return () => {};
  },
  merkBasisvareVersjonert: (f: string, n: string) => markItemAsStaple(f, n),
  fjernBasisvareVersjonert: vi.fn(),
}));
vi.mock("@hooks/useMeals", () => ({
  useMeals: () => ({ meals: loaded({ Mon: "Grøt" }) }),
}));
vi.mock("@hooks/useRecipes", () => ({ useRecipes: () => ({ recipes: loaded([]) }) }));
vi.mock("@hooks/useMealLibrary", () => ({ useMealLibrary: () => ({ mealLibrary: loaded([]) }) }));
vi.mock("@hooks/useItemHistory", () => ({ useItemHistory: () => ({ itemHistory: loaded({}) }) }));
vi.mock("@hooks/useFreezer", () => ({ useFreezer: () => ({ freezer: loaded([]) }) }));
vi.mock("@hooks/useShoppingList", () => ({
  useShoppingList: () => ({ shopping: loaded([]), leggTilFraGenerator: ytre.leggTil }),
}));
vi.mock("@generators/shopping/shopping", async (orig) => ({
  ...(await orig<typeof import("@generators/shopping/shopping")>()),
  buildShoppingItems: () => [],
  mergeShoppingItems: () => varer.naa,
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

/** Åpner gjennomgangen, utelater `navn` og svarer «Ja, basisvare». */
async function utelatOgMerk(navn: string) {
  varer.naa = [vare(navn), vare("Egg")];
  const user = userEvent.setup();
  render(<ShoppingGeneratorModal weekKey="2026-W47" onClose={ytre.onClose} />);
  await user.click(screen.getByRole("button", { name: /Hent ingredienser/ }));
  await user.click(screen.getByText(navn, { exact: true }));
  expect(screen.getByText(`Har du vanligvis «${navn}» hjemme?`)).toBeInTheDocument();
  return user;
}
const ja = () => screen.getByRole("button", { name: "Ja, basisvare" });
const sporsmaal = (navn: string) => screen.queryByText(`Har du vanligvis «${navn}» hjemme?`);

const leggTil = () => screen.getByRole("button", { name: /Legg til 1 varer/ });
const avbryt = () => screen.getByRole("button", { name: "Avbryt" });
/** Generatorens ytre lukkeveier: krysset i Modal og klikk på bakgrunnen. */
async function provYtreLukking(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Lukk" }));
  await user.click(screen.getByRole("dialog").parentElement!);
}

beforeEach(() => {
  markItemAsStaple.mockReset();
  markItemAsStaple.mockResolvedValue({ utfall: "merket" });
  ytre.onClose.mockReset();
  ytre.leggTil.mockReset();
  ytre.leggTil.mockReturnValue(new Promise(() => {}));
});

describe("ShoppingGeneratorModal — «Ja, basisvare»", () => {
  it("ugyldig navn: eksisterende brukertekst, ingenting skrives, beskjeden lukkes og varen står utelatt", async () => {
    const user = await utelatOgMerk("Melk/Lett");
    await user.click(ja());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(BASISVARE_UGYLDIG_TEKST.ugyldige_tegn);
    expect(alert).toHaveTextContent("Ingenting er lagret.");
    expect(alert).toHaveTextContent("fortsatt utelatt");
    expect(markItemAsStaple).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(sporsmaal("Melk/Lett")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeInTheDocument();
    expect(markItemAsStaple).not.toHaveBeenCalled();
  });

  it("avvist lagring: merkingen vises som ikke bekreftet, beskjeden lukkes og varen står utelatt", async () => {
    markItemAsStaple.mockRejectedValueOnce(new Error("PERMISSION_DENIED"));
    const user = await utelatOgMerk("Rømme");
    await user.click(ja());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("«Rømme» er ikke bekreftet lagret som basisvare.");
    expect(alert).toHaveTextContent("fortsatt utelatt");
    expect(markItemAsStaple).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(sporsmaal("Rømme")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeInTheDocument();
    expect(markItemAsStaple).toHaveBeenCalledTimes(1);
  });

  it("vellykket: dobbeltklikk skriver én gang med riktig navn, målet står synlig mens det lagres", async () => {
    let svar!: () => void;
    markItemAsStaple.mockReturnValueOnce(
      new Promise<Merkeutfall>((r) => (svar = () => r({ utfall: "merket" }))),
    );
    const user = await utelatOgMerk("Rømme");

    await user.dblClick(ja());
    expect(markItemAsStaple).toHaveBeenCalledTimes(1);
    expect(markItemAsStaple).toHaveBeenCalledWith("familie1", "rømme");
    expect(sporsmaal("Rømme")).toBeInTheDocument();
    expect(ja()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nei" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Lagrer «Rømme» som basisvare…");

    svar();
    await vi.waitFor(() => expect(sporsmaal("Rømme")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeInTheDocument();
    expect(markItemAsStaple).toHaveBeenCalledTimes(1);
  });

  it("uavklart merking, så nytt forsøk som stoppes av sesjonsbytte: det første forsøket vises fortsatt som uavklart, og varen står utelatt (review 5961783276)", async () => {
    markItemAsStaple.mockResolvedValueOnce({ utfall: "ukjent" });
    markItemAsStaple.mockResolvedValueOnce({ utfall: "byttet" });
    const user = await utelatOgMerk("Rømme");
    await user.click(ja());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "«Rømme» er ikke bekreftet lagret som basisvare.",
    );
    await user.click(screen.getByRole("button", { name: "OK" }));
    // Ta varen med igjen og utelat den på nytt: nytt spørsmål, nytt forsøk.
    await user.click(screen.getByText("Rømme", { exact: true }));
    await user.click(screen.getByText("Rømme", { exact: true }));
    await user.click(ja());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Fortsatt ikke bekreftet om «Rømme» ble lagret som basisvare: innloggingen ble endret før kontrollen ble sendt. Ingen skriving ble sendt i dette forsøket.",
    );
    expect(alert).not.toHaveTextContent(/Ingenting er lagret/);
    expect(markItemAsStaple).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(leggTil()).toBeEnabled();
  });

  it("ukjent → ikkeLest → byttet holder det første forsøket uavklart; bekreftet merking frigjør usikkerheten (re-review 5961928535)", async () => {
    markItemAsStaple
      .mockResolvedValueOnce({ utfall: "ukjent" })
      .mockResolvedValueOnce({ utfall: "ikkeLest" })
      .mockResolvedValueOnce({ utfall: "byttet" })
      .mockResolvedValueOnce({ utfall: "merket" })
      .mockResolvedValueOnce({ utfall: "byttet" });
    const user = await utelatOgMerk("Rømme");
    const igjen = async () => {
      await user.click(screen.getByRole("button", { name: "OK" }));
      await user.click(screen.getByText("Rømme", { exact: true }));
      await user.click(screen.getByText("Rømme", { exact: true }));
      await user.click(ja());
    };
    await user.click(ja());
    expect(await screen.findByRole("alert")).toHaveTextContent("ikke bekreftet lagret");

    await igjen();
    let alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Fortsatt ikke bekreftet om «Rømme» ble lagret som basisvare: basisvarene kunne ikke leses denne gangen.",
    );
    expect(alert).not.toHaveTextContent(/Ingenting er lagret/);

    await igjen();
    alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Fortsatt ikke bekreftet om «Rømme» ble lagret som basisvare: innloggingen ble endret før kontrollen ble sendt. Ingen skriving ble sendt i dette forsøket.",
    );

    // Bekreftet merking lukker og avklarer.
    await igjen();
    await vi.waitFor(() => expect(sporsmaal("Rømme")).toBeNull());
    // Nytt forsøk som stoppes: ingen tidligere usikkerhet å vise.
    await user.click(screen.getByText("Rømme", { exact: true }));
    await user.click(screen.getByText("Rømme", { exact: true }));
    await user.click(ja());
    alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Innloggingen ble endret før «Rømme» ble lagret som basisvare. Ingen skriving ble sendt i dette forsøket.",
    );
    expect(markItemAsStaple).toHaveBeenCalledTimes(5);
  });

  it("«Nei» lukker uten skriving, og varen står utelatt", async () => {
    const user = await utelatOgMerk("Rømme");
    await user.click(screen.getByRole("button", { name: "Nei" }));
    expect(sporsmaal("Rømme")).not.toBeInTheDocument();
    expect(markItemAsStaple).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeInTheDocument();
  });

  it("ytre lukking og «Legg til» under lagring: målet står, ingenting sendes, avvisningen kan leses og lukkes (review 5937603955)", async () => {
    let avvis!: (e: Error) => void;
    markItemAsStaple.mockReturnValueOnce(new Promise<Merkeutfall>((_, r) => (avvis = r)));
    const user = await utelatOgMerk("Rømme");
    await user.click(ja());

    await provYtreLukking(user);
    expect(ytre.onClose).not.toHaveBeenCalled();
    expect(sporsmaal("Rømme")).toBeInTheDocument();
    expect(leggTil()).toBeDisabled();
    expect(avbryt()).toBeDisabled();
    await user.click(leggTil());
    expect(ytre.leggTil).not.toHaveBeenCalled();

    avvis(new Error("PERMISSION_DENIED"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("«Rømme» er ikke bekreftet lagret som basisvare.");
    // Avvisningen står til den er lest og lukket.
    await provYtreLukking(user);
    expect(ytre.onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(leggTil()).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "OK" }));
    expect(leggTil()).toBeEnabled();
    expect(ytre.leggTil).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Lukk" }));
    expect(ytre.onClose).toHaveBeenCalledTimes(1);
  });

  it("etter bekreftet merking kan brukeren fortsette: «Legg til» sender listen uten den utelatte varen", async () => {
    let svar!: () => void;
    markItemAsStaple.mockReturnValueOnce(
      new Promise<Merkeutfall>((r) => (svar = () => r({ utfall: "merket" }))),
    );
    const user = await utelatOgMerk("Rømme");
    await user.click(ja());
    expect(leggTil()).toBeDisabled();

    svar();
    await vi.waitFor(() => expect(sporsmaal("Rømme")).not.toBeInTheDocument());
    expect(leggTil()).toBeEnabled();
    await user.click(leggTil());
    expect(ytre.leggTil).toHaveBeenCalledTimes(1);
    const plan = ytre.leggTil.mock.calls[0]![0] as { entries: { name: string }[] };
    expect(plan.entries.map((e) => e.name)).toEqual(["Egg"]);
  });

  it.each([
    ["konflikt", "«Rømme» har allerede en annen verdi i basisvarene og er ikke endret."],
    ["avvist", "Lagringen av «Rømme» som basisvare ble avvist. Ingenting er lagret."],
    ["ukjent", "«Rømme» er ikke bekreftet lagret som basisvare."],
    ["samtidig", "«Rømme» ble ikke lagret som basisvare — prøv igjen senere. Ingenting er lagret."],
  ])(
    "versjonsbetinget utfall «%s» (ordre 6953147250): forklart, kan lukkes, varen står utelatt",
    async (utfall, tekst) => {
      markItemAsStaple.mockResolvedValueOnce({ utfall });
      const user = await utelatOgMerk("Rømme");
      await user.click(ja());
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(tekst);
      expect(alert).toHaveTextContent("fortsatt utelatt");
      expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "OK" }));
      expect(sporsmaal("Rømme")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeEnabled();
      expect(markItemAsStaple).toHaveBeenCalledTimes(1);
    },
  );

  it("allerede merket (også med prioritet) lukker som bekreftet, uten beskjed", async () => {
    markItemAsStaple.mockResolvedValueOnce({ utfall: "allerede" });
    const user = await utelatOgMerk("Rømme");
    await user.click(ja());
    await vi.waitFor(() => expect(sporsmaal("Rømme")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Legg til 1 varer/ })).toBeEnabled();
  });
});
