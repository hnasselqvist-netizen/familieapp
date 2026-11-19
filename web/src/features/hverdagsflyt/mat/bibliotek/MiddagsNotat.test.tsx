import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotatOppfolging, NotatUtfall } from "@domain/mealLibrary/notat";
import type { MealLibraryEntry } from "@app-types/shopping";
import { MiddagsNotat } from "./MiddagsNotat";

/**
 * Notat på bibliotekmiddag (Mat #20, ordre 6998241717): visning med
 * linjeskift, utkast bundet til kilden, eksplisitt «Lagre notat», synlig
 * konflikt med beholdt utkast, og skrivefri oppfølging etter tapt svar.
 */

const lagreNotat =
  vi.fn<(mealId: string, kilde: string | undefined, utkast: string) => Promise<NotatUtfall>>();
const sjekkNotat =
  vi.fn<
    (
      mealId: string,
      kilde: string | undefined,
      utkast: string,
    ) => Promise<NotatOppfolging | "avvist" | "byttet" | "ikkeLest">
  >();

const TACO: MealLibraryEntry = { id: "m1", name: "Taco", notat: "Husk lime\nOg koriander" };
const PIZZA: MealLibraryEntry = { id: "m2", name: "Pizza" };

const vis = (entry: MealLibraryEntry) =>
  render(
    <MiddagsNotat key={entry.id} entry={entry} lagreNotat={lagreNotat} sjekkNotat={sjekkNotat} />,
  );
const felt = () => screen.getByRole("textbox", { name: /Notat for/ });
const lagreKnapp = () => screen.getByRole("button", { name: "Lagre notat" });

function utsatt<T>() {
  let svar!: (v: T) => void;
  const promise = new Promise<T>((r) => (svar = r));
  return { promise, svar };
}

beforeEach(() => {
  lagreNotat.mockReset();
  sjekkNotat.mockReset();
});

describe("MiddagsNotat", () => {
  it("viser notatet med linjeskift bevart, og «Ingen notat» uten", () => {
    vis(TACO);
    expect(screen.getByTestId("middagsnotat").textContent).toBe("Husk lime\nOg koriander");
    vis(PIZZA);
    expect(screen.getByText("Ingen notat.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Legg til notat" })).toBeInTheDocument();
  });

  it("nytt notat: utkastet lagres bare ved «Lagre notat», med middag og tom kilde; dobbeltklikk sender én gang", async () => {
    const user = userEvent.setup();
    vis(PIZZA);
    await user.click(screen.getByRole("button", { name: "Legg til notat" }));
    await user.type(felt(), "Hjemmelaget bunn{Enter}Steinovn 250");
    expect(lagreNotat).not.toHaveBeenCalled(); // ingen autosave
    const d = utsatt<NotatUtfall>();
    lagreNotat.mockReturnValueOnce(d.promise);
    await user.dblClick(lagreKnapp());
    expect(lagreNotat).toHaveBeenCalledTimes(1);
    expect(lagreNotat).toHaveBeenCalledWith("m2", undefined, "Hjemmelaget bunn\nSteinovn 250");
    d.svar("lagret");
    expect(await screen.findByRole("status")).toHaveTextContent("Notatet på «Pizza» er lagret.");
    expect(screen.queryByRole("textbox", { name: /Notat for/ })).toBeNull();
  });

  it("tømming sendes som tomt utkast med kilden det startet fra", async () => {
    const user = userEvent.setup();
    vis(TACO);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    await user.clear(felt());
    lagreNotat.mockResolvedValueOnce("lagret");
    await user.click(lagreKnapp());
    expect(lagreNotat).toHaveBeenCalledWith("m1", "Husk lime\nOg koriander", "");
  });

  it("utkastet er bundet til kilden: en ny visning av middagen endrer verken utkast eller kilde", async () => {
    const user = userEvent.setup();
    const r = vis(TACO);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    await user.type(felt(), " — mitt");
    r.rerender(
      <MiddagsNotat
        key="m1"
        entry={{ ...TACO, notat: "Fra en annen enhet" }}
        lagreNotat={lagreNotat}
        sjekkNotat={sjekkNotat}
      />,
    );
    expect(felt()).toHaveValue("Husk lime\nOg koriander — mitt");
    lagreNotat.mockResolvedValueOnce("konflikt");
    await user.click(lagreKnapp());
    expect(lagreNotat).toHaveBeenCalledWith(
      "m1",
      "Husk lime\nOg koriander",
      "Husk lime\nOg koriander — mitt",
    );
  });

  it("konflikt: utkastet står, gjeldende notat vises, ny lagring krever eksplisitt nytt grunnlag", async () => {
    const user = userEvent.setup();
    const r = vis(TACO);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    await user.type(felt(), "!");
    r.rerender(
      <MiddagsNotat
        key="m1"
        entry={{ ...TACO, notat: "Annen enhet" }}
        lagreNotat={lagreNotat}
        sjekkNotat={sjekkNotat}
      />,
    );
    lagreNotat.mockResolvedValueOnce("konflikt");
    await user.click(lagreKnapp());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Notatet på «Taco» er endret på en annen enhet siden du begynte. Ingenting er lagret.",
    );
    expect(felt()).toHaveValue("Husk lime\nOg koriander!");
    expect(lagreKnapp()).toBeDisabled();
    expect(screen.getByText("Annen enhet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Bruk gjeldende notat som grunnlag" }));
    expect(lagreKnapp()).toBeEnabled();
    lagreNotat.mockResolvedValueOnce("lagret");
    await user.click(lagreKnapp());
    expect(lagreNotat).toHaveBeenLastCalledWith("m1", "Annen enhet", "Husk lime\nOg koriander!");
  });

  it("tapt svar: «Lagre notat» sperres til en skrivefri kontroll har avklart; «ikkeLagret» åpner for nytt forsøk", async () => {
    const user = userEvent.setup();
    vis(TACO);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    await user.type(felt(), "!");
    lagreNotat.mockResolvedValueOnce("ukjent");
    await user.click(lagreKnapp());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vi vet ikke om notatet på «Taco» ble lagret",
    );
    expect(lagreKnapp()).toBeDisabled();

    sjekkNotat.mockResolvedValueOnce("ikkeLest");
    await user.click(screen.getByRole("button", { name: "Sjekk om notatet ble lagret" }));
    expect(sjekkNotat).toHaveBeenCalledWith(
      "m1",
      "Husk lime\nOg koriander",
      "Husk lime\nOg koriander!",
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Fortsatt ikke avklart");
    expect(lagreKnapp()).toBeDisabled();

    sjekkNotat.mockResolvedValueOnce("ikkeLagret");
    await user.click(screen.getByRole("button", { name: "Sjekk om notatet ble lagret" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ble ikke lagret. Utkastet ditt står",
    );
    expect(lagreKnapp()).toBeEnabled();
    expect(felt()).toHaveValue("Husk lime\nOg koriander!");
    expect(lagreNotat).toHaveBeenCalledTimes(1); // ingen automatisk ny skriving
  });

  it("tapt svar som viser seg lagret: kontrollen bekrefter og lukker redigeringen", async () => {
    const user = userEvent.setup();
    vis(TACO);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    lagreNotat.mockRejectedValueOnce(new Error("nett"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await user.click(lagreKnapp());
    expect(await screen.findByRole("alert")).toHaveTextContent("Vi vet ikke om notatet");
    sjekkNotat.mockResolvedValueOnce("lagret");
    await user.click(screen.getByRole("button", { name: "Sjekk om notatet ble lagret" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Bekreftet: notatet på «Taco» er lagret.",
    );
    expect(screen.queryByRole("textbox", { name: /Notat for/ })).toBeNull();
  });

  it.each<[NotatUtfall, string]>([
    [
      "mangler",
      "«Taco» er slettet på en annen enhet. Notatet er ikke lagret, og middagen er ikke gjenopprettet.",
    ],
    ["ugyldig", "lagret i en form appen ikke kan endre trygt"],
    ["avvist", "Du har ikke tilgang til å endre notatet. Ingenting er lagret."],
    ["byttet", "Innloggingen ble endret mens notatet ble lagret. Ingenting er lagret."],
    ["ikkeLest", "Kunne ikke kontrollere «Taco» nå. Ingenting er lagret — prøv igjen."],
  ])("utfallet %s vises tydelig, og utkastet står", async (utfall, tekst) => {
    const user = userEvent.setup();
    vis(TACO);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    await user.type(felt(), "!");
    lagreNotat.mockResolvedValueOnce(utfall);
    await user.click(lagreKnapp());
    expect(await screen.findByRole("alert")).toHaveTextContent(tekst);
    expect(felt()).toHaveValue("Husk lime\nOg koriander!");
    if (utfall === "mangler") expect(lagreKnapp()).toBeDisabled();
  });

  it("Avbryt forkaster utkastet uten å lagre", async () => {
    const user = userEvent.setup();
    vis(TACO);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    await user.type(felt(), " endret");
    await user.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(lagreNotat).not.toHaveBeenCalled();
    const seksjon = screen.getByRole("region", { name: "Notat for Taco" });
    expect(within(seksjon).getByTestId("middagsnotat").textContent).toBe("Husk lime\nOg koriander");
  });
});
