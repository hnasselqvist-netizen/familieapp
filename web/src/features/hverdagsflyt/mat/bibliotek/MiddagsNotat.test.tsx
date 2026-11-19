import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotatForsok, NotatNaatilstand, NotatUtfall } from "@domain/mealLibrary/notat";
import type { MealLibraryEntry } from "@app-types/shopping";
import { MiddagsNotat } from "./MiddagsNotat";

/**
 * Notat på bibliotekmiddag (Mat #20, ordre 6998241717, review 5969230962):
 * visning med linjeskift, utkast bundet til kilden, eksplisitt «Lagre
 * notat», synlig konflikt med beholdt utkast, og et uforanderlig forsøk
 * etter tapt svar som kontrolleres skrivefritt uten å påstå utfallet.
 */

type Kontroll = NotatNaatilstand | "avvist" | "byttet" | "ikkeLest";
const lagreNotat =
  vi.fn<
    (
      kontekst: string,
      mealId: string,
      kilde: string | undefined,
      utkast: string,
    ) => Promise<NotatUtfall>
  >();
const sjekkNotat = vi.fn<(forsok: NotatForsok) => Promise<Kontroll>>();

const TACO: MealLibraryEntry = { id: "m1", name: "Taco", notat: "Husk lime\nOg koriander" };
const PIZZA: MealLibraryEntry = { id: "m2", name: "Pizza" };
const KONTEKST = "familie1|sesjon-1";
/** Konteksten som er gjeldende «akkurat nå» (hookens `erGjeldendeNotatKontekst`). */
let gjeldendeKontekst = KONTEKST;
const erGjeldende = (k: string) => k === gjeldendeKontekst;

type Forsoksliste = Record<string, readonly NotatForsok[]>;
/** Skjermens tilstand, lesbar fra testene. */
let lagret: Forsoksliste = {};

/** Skjermens rolle: eier forsøkene per egen kontekst og middag, nøkler komponenten. */
function Skjerm({ entry, kontekst = KONTEKST }: { entry: MealLibraryEntry; kontekst?: string }) {
  const [forsok, setForsok] = useState<Forsoksliste>({});
  lagret = forsok;
  return (
    <MiddagsNotat
      key={`notat-${kontekst}-${entry.id}`}
      entry={entry}
      kontekst={kontekst}
      erGjeldende={erGjeldende}
      lagreNotat={lagreNotat}
      sjekkNotat={sjekkNotat}
      forsok={forsok[`${kontekst}/${entry.id}`] ?? []}
      oppdaterForsok={(k, mealId, endre) =>
        setForsok((forrige) => {
          const nokkel = `${k}/${mealId}`;
          const neste = { ...forrige };
          const liste = endre(forrige[nokkel] ?? []);
          if (liste.length > 0) neste[nokkel] = liste;
          else delete neste[nokkel];
          return neste;
        })
      }
    />
  );
}

const vis = (entry: MealLibraryEntry) => render(<Skjerm entry={entry} />);
const felt = () => screen.getByRole("textbox", { name: /Notat for/ });
const lagreKnapp = () => screen.getByRole("button", { name: "Lagre notat" });
const sjekkKnapp = () => screen.getByRole("button", { name: "Sjekk om notatet ble lagret" });

function utsatt<T>() {
  let svar!: (v: T) => void;
  const promise = new Promise<T>((r) => (svar = r));
  return { promise, svar };
}

/** Rediger Taco, skriv «!», og få `ukjent` på lagringen. */
async function ukjentForsok(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Rediger notat" }));
  await user.type(felt(), "!");
  lagreNotat.mockResolvedValueOnce("ukjent");
  await user.click(lagreKnapp());
  await screen.findByText("Sendt, ikke avklart:");
}

const FORSOK_A: NotatForsok = {
  kontekst: KONTEKST,
  mealId: "m1",
  kilde: "Husk lime\nOg koriander",
  sendt: "Husk lime\nOg koriander!",
};

beforeEach(() => {
  lagreNotat.mockReset();
  sjekkNotat.mockReset();
  gjeldendeKontekst = KONTEKST;
  lagret = {};
});

describe("MiddagsNotat — visning og lagring", () => {
  it("viser notatet med linjeskift bevart, og «Ingen notat» uten", () => {
    vis(TACO);
    expect(screen.getByTestId("middagsnotat").textContent).toBe("Husk lime\nOg koriander");
    vis(PIZZA);
    expect(screen.getByText("Ingen notat.")).toBeInTheDocument();
  });

  it("nytt notat: lagres bare ved «Lagre notat»; dobbeltklikk sender én gang", async () => {
    const user = userEvent.setup();
    vis(PIZZA);
    await user.click(screen.getByRole("button", { name: "Legg til notat" }));
    await user.type(felt(), "Hjemmelaget bunn{Enter}Steinovn 250");
    expect(lagreNotat).not.toHaveBeenCalled();
    const d = utsatt<NotatUtfall>();
    lagreNotat.mockReturnValueOnce(d.promise);
    await user.dblClick(lagreKnapp());
    expect(lagreNotat).toHaveBeenCalledTimes(1);
    expect(lagreNotat).toHaveBeenCalledWith(
      KONTEKST,
      "m2",
      undefined,
      "Hjemmelaget bunn\nSteinovn 250",
    );
    d.svar("lagret");
    expect(await screen.findByRole("status")).toHaveTextContent("Notatet på «Pizza» er lagret.");
  });

  it("utkastet er bundet til kilden: en ny visning av middagen endrer verken utkast eller kilde", async () => {
    const user = userEvent.setup();
    const r = vis(TACO);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    await user.type(felt(), " — mitt");
    r.rerender(<Skjerm entry={{ ...TACO, notat: "Fra en annen enhet" }} />);
    expect(felt()).toHaveValue("Husk lime\nOg koriander — mitt");
    lagreNotat.mockResolvedValueOnce("konflikt");
    await user.click(lagreKnapp());
    expect(lagreNotat).toHaveBeenCalledWith(
      KONTEKST,
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
    r.rerender(<Skjerm entry={{ ...TACO, notat: "Annen enhet" }} />);
    lagreNotat.mockResolvedValueOnce("konflikt");
    await user.click(lagreKnapp());
    expect(await screen.findByRole("alert")).toHaveTextContent("Ingenting er lagret.");
    expect(felt()).toHaveValue("Husk lime\nOg koriander!");
    expect(lagreKnapp()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Bruk gjeldende notat som grunnlag" }));
    lagreNotat.mockResolvedValueOnce("lagret");
    await user.click(lagreKnapp());
    expect(lagreNotat).toHaveBeenLastCalledWith(
      KONTEKST,
      "m1",
      "Annen enhet",
      "Husk lime\nOg koriander!",
    );
  });

  it.each<[NotatUtfall, string]>([
    ["mangler", "middagen er ikke gjenopprettet"],
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
  });
});

describe("MiddagsNotat — uavklart forsøk (review 5969230962)", () => {
  it("A → ukjent: feltet forsvinner, det sendte vises, og kontrollen gjelder A med kilde og kontekst", async () => {
    const user = userEvent.setup();
    vis(TACO);
    await ukjentForsok(user);
    expect(screen.queryByRole("textbox", { name: /Notat for/ })).toBeNull(); // B kan ikke skrives
    expect(screen.queryByRole("button", { name: "Lagre notat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Avbryt" })).toBeNull();
    expect(screen.getByTestId("sendt-notat").textContent).toBe("Husk lime\nOg koriander!");
    sjekkNotat.mockResolvedValueOnce("ikkeLest");
    await user.click(sjekkKnapp());
    expect(sjekkNotat).toHaveBeenCalledWith(FORSOK_A);
  });

  it("endring av middagen mens kontrollen pågår: kontrollen gjelder fortsatt A, og ingenting påstås lagret eller ikke lagret", async () => {
    const user = userEvent.setup();
    const r = vis(TACO);
    await ukjentForsok(user);
    const d = utsatt<Kontroll>();
    sjekkNotat.mockReturnValueOnce(d.promise);
    await user.click(sjekkKnapp());
    r.rerender(<Skjerm entry={{ ...TACO, notat: "B fra en annen enhet" }} />);
    d.svar("annet");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Om akkurat dette forsøket ble lagret, er fortsatt ikke avklart.",
    );
    expect(sjekkNotat).toHaveBeenCalledWith(FORSOK_A);
    expect(screen.getByTestId("sendt-notat").textContent).toBe("Husk lime\nOg koriander!");
    expect(screen.getByText("B fra en annen enhet")).toBeInTheDocument();
  });

  it("`likKilde` sier ikke «ikke lagret»; forsøket står til brukeren eksplisitt velger «Lagre på nytt» med samme kilde og tekst", async () => {
    const user = userEvent.setup();
    vis(TACO);
    await ukjentForsok(user);
    sjekkNotat.mockResolvedValueOnce("likKilde");
    await user.click(sjekkKnapp());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("står nå som før forsøket");
    expect(alert).toHaveTextContent("kan fortsatt komme frem");
    expect(alert).not.toHaveTextContent(/ble ikke lagret/);
    expect(screen.getByText("Sendt, ikke avklart:")).toBeInTheDocument();
    expect(lagreNotat).toHaveBeenCalledTimes(1); // ingen automatisk ny skriving

    lagreNotat.mockResolvedValueOnce("lagret");
    await user.click(screen.getByRole("button", { name: "Lagre på nytt" }));
    expect(lagreNotat).toHaveBeenLastCalledWith(
      KONTEKST,
      "m1",
      "Husk lime\nOg koriander",
      "Husk lime\nOg koriander!",
    );
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Det nye forsøket er lagret");
    expect(status).toHaveTextContent("Om det første forsøket kom frem, er ikke avklart.");
    expect(screen.queryByText("Sendt, ikke avklart:")).toBeNull();
  });

  it("`likSendt` avklarer ikke forsøket alene: «Godta nåtilstanden» er et eksplisitt valg", async () => {
    const user = userEvent.setup();
    vis(TACO);
    await ukjentForsok(user);
    sjekkNotat.mockResolvedValueOnce("likSendt");
    await user.click(sjekkKnapp());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "står nå slik du ville lagre det. Om akkurat dette forsøket ble lagret, er fortsatt ikke avklart.",
    );
    expect(screen.getByText("Sendt, ikke avklart:")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Godta nåtilstanden" }));
    expect(screen.queryByText("Sendt, ikke avklart:")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("står slik du ville ha det");
  });

  it("`annet`: «Bruk gjeldende notat som grunnlag» gir et nytt utkast med den sendte teksten", async () => {
    const user = userEvent.setup();
    const r = vis(TACO);
    await ukjentForsok(user);
    r.rerender(<Skjerm entry={{ ...TACO, notat: "C" }} />);
    sjekkNotat.mockResolvedValueOnce("annet");
    await user.click(sjekkKnapp());
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Bruk gjeldende notat som grunnlag" }));
    expect(felt()).toHaveValue("Husk lime\nOg koriander!");
    lagreNotat.mockResolvedValueOnce("lagret");
    await user.click(lagreKnapp());
    expect(lagreNotat).toHaveBeenLastCalledWith(KONTEKST, "m1", "C", "Husk lime\nOg koriander!");
  });

  it("lukking og gjenåpning av middagen glemmer ikke forsøket", async () => {
    const user = userEvent.setup();
    function MedLukking() {
      const [apen, setApen] = useState(true);
      const [forsok, setForsok] = useState<readonly NotatForsok[]>([]);
      return (
        <>
          <button type="button" onClick={() => setApen((a) => !a)}>
            Veksle
          </button>
          {apen && (
            <MiddagsNotat
              key={`notat-${KONTEKST}-m1`}
              entry={TACO}
              kontekst={KONTEKST}
              erGjeldende={erGjeldende}
              lagreNotat={lagreNotat}
              sjekkNotat={sjekkNotat}
              forsok={forsok}
              oppdaterForsok={(_k, _m, endre) => setForsok(endre)}
            />
          )}
        </>
      );
    }
    render(<MedLukking />);
    await ukjentForsok(user);
    await user.click(screen.getByRole("button", { name: "Veksle" })); // lukk
    await user.click(screen.getByRole("button", { name: "Veksle" })); // gjenåpne
    expect(screen.getByText("Sendt, ikke avklart:")).toBeInTheDocument();
    sjekkNotat.mockResolvedValueOnce("ikkeLest");
    await user.click(sjekkKnapp());
    expect(sjekkNotat).toHaveBeenCalledWith(FORSOK_A);
  });

  it("ny sesjon eller familie: forsøket og utkastet flyttes ikke til den nye konteksten", async () => {
    const user = userEvent.setup();
    const r = render(<Skjerm entry={TACO} kontekst={KONTEKST} />);
    await ukjentForsok(user);
    gjeldendeKontekst = "familie1|sesjon-2";
    r.rerender(<Skjerm entry={TACO} kontekst="familie1|sesjon-2" />);
    expect(screen.queryByText("Sendt, ikke avklart:")).toBeNull();
    expect(screen.getByRole("button", { name: "Rediger notat" })).toBeInTheDocument();
    gjeldendeKontekst = "familie2|sesjon-2";
    r.rerender(<Skjerm entry={TACO} kontekst="familie2|sesjon-2" />);
    expect(screen.queryByText("Sendt, ikke avklart:")).toBeNull();
    expect(Object.keys(lagret)).toEqual([`${KONTEKST}/m1`]);
  });

  it("et kast fra lagringen gir et uavklart forsøk, aldri «lagret»", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vis(TACO);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    lagreNotat.mockRejectedValueOnce(new Error("nett"));
    await user.click(lagreKnapp());
    expect(await screen.findByRole("alert")).toHaveTextContent("Vi vet ikke om notatet");
    expect(screen.getByText("Sendt, ikke avklart:")).toBeInTheDocument();
  });
});

describe("MiddagsNotat — nytt forsøk avgjør ikke et tidligere (review 5969643874)", () => {
  /** A → ukjent, kontroll gir `likKilde`, og «Lagre på nytt» gir `utfall`. */
  async function retry(user: ReturnType<typeof userEvent.setup>, utfall: NotatUtfall) {
    vis(TACO);
    await ukjentForsok(user);
    sjekkNotat.mockResolvedValueOnce("likKilde");
    await user.click(sjekkKnapp());
    lagreNotat.mockResolvedValueOnce(utfall);
    await user.click(screen.getByRole("button", { name: "Lagre på nytt" }));
  }

  it.each(["ikkeLest", "byttet", "avvist", "konflikt", "mangler", "ugyldig"] as const)(
    "ukjent → likKilde → «Lagre på nytt» → %s: A står uavklart, og retry-resultatet vises for seg",
    async (utfall) => {
      const user = userEvent.setup();
      await retry(user, utfall);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/^Det nye forsøket er ikke lagret: /);
      expect(alert).toHaveTextContent("Det første forsøket er fortsatt ikke avklart.");
      expect(alert).not.toHaveTextContent("Ingenting er lagret");
      expect(screen.getByText("Sendt, ikke avklart:")).toBeInTheDocument();
      expect(screen.getByTestId("sendt-notat").textContent).toBe("Husk lime\nOg koriander!");
      expect(lagret[`${KONTEKST}/m1`]).toEqual([FORSOK_A]);
      // Ingen ny skriving uten nytt valg; kontrollen gjelder fortsatt A.
      expect(lagreNotat).toHaveBeenCalledTimes(2);
      sjekkNotat.mockResolvedValueOnce("likKilde");
      await user.click(sjekkKnapp());
      expect(sjekkNotat).toHaveBeenLastCalledWith(FORSOK_A);
    },
  );

  it("nytt `ukjent` erstatter ikke A: begge står uavklart", async () => {
    const user = userEvent.setup();
    await retry(user, "ukjent");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Svaret på det nye forsøket uteble også. Ingen av forsøkene",
    );
    expect(lagret[`${KONTEKST}/m1`]).toEqual([FORSOK_A, FORSOK_A]);
    expect(screen.getByTestId("antall-forsok")).toHaveTextContent("2 forsøk med denne teksten");
    // Et sikkert avslag deretter fjerner ingen av dem.
    sjekkNotat.mockResolvedValueOnce("likKilde");
    await user.click(sjekkKnapp());
    lagreNotat.mockResolvedValueOnce("ikkeLest");
    await user.click(screen.getByRole("button", { name: "Lagre på nytt" }));
    await screen.findByText(/Det nye forsøket er ikke lagret/);
    expect(lagret[`${KONTEKST}/m1`]).toHaveLength(2);
  });

  it("`allerede` avslutter oppfølgingen uten å påstå hva som skjedde med A", async () => {
    const user = userEvent.setup();
    await retry(user, "allerede");
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("står allerede slik du ville ha det");
    expect(status).toHaveTextContent("Om det første forsøket kom frem, er ikke avklart.");
    expect(status).toHaveTextContent("kan det bare sette notatet til den samme teksten");
    expect(lagret).toEqual({});
  });

  it("et kast fra retry gir et nytt uavklart forsøk ved siden av A", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vis(TACO);
    await ukjentForsok(user);
    sjekkNotat.mockResolvedValueOnce("likKilde");
    await user.click(sjekkKnapp());
    lagreNotat.mockRejectedValueOnce(new Error("nett"));
    await user.click(screen.getByRole("button", { name: "Lagre på nytt" }));
    await screen.findByTestId("antall-forsok");
    expect(lagret[`${KONTEKST}/m1`]).toEqual([FORSOK_A, FORSOK_A]);
  });
});

/** Én tegning med fast kontekst: viser hva et sent svar ville gjort uten ny tegning. */
function Samme() {
  const [forsok, setForsok] = useState<readonly NotatForsok[]>([]);
  return (
    <MiddagsNotat
      entry={TACO}
      kontekst={KONTEKST}
      erGjeldende={erGjeldende}
      lagreNotat={lagreNotat}
      sjekkNotat={sjekkNotat}
      forsok={forsok}
      oppdaterForsok={(_k, _m, endre) => setForsok(endre)}
    />
  );
}

describe("MiddagsNotat — svar etter kontekstbytte (review 5969643874)", () => {
  it("et `ukjent` som kommer etter sesjonsbytte, registreres under A-s kontekst og vises ikke i den nye", async () => {
    const user = userEvent.setup();
    const r = vis(TACO);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    await user.type(felt(), "!");
    const d = utsatt<NotatUtfall>();
    lagreNotat.mockReturnValueOnce(d.promise);
    await user.click(lagreKnapp());
    gjeldendeKontekst = "familie1|sesjon-2";
    r.rerender(<Skjerm entry={TACO} kontekst="familie1|sesjon-2" />);
    d.svar("ukjent");
    await vi.waitFor(() => expect(lagret[`${KONTEKST}/m1`]).toEqual([FORSOK_A]));
    expect(screen.queryByText("Sendt, ikke avklart:")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(lagret["familie1|sesjon-2/m1"]).toBeUndefined();
  });

  it("et lagringssvar fra en gammel kontekst anvendes ikke, heller ikke før ny tegning", async () => {
    const user = userEvent.setup();
    render(<Samme />);
    await user.click(screen.getByRole("button", { name: "Rediger notat" }));
    await user.type(felt(), "!");
    const d = utsatt<NotatUtfall>();
    lagreNotat.mockReturnValueOnce(d.promise);
    await user.click(lagreKnapp());
    gjeldendeKontekst = "familie1|sesjon-2";
    await act(async () => {
      d.svar("konflikt");
      await d.promise;
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Gjeldende notat")).toBeNull();
  });

  it("et kontrollsvar fra en gammel kontekst anvendes ikke", async () => {
    const user = userEvent.setup();
    render(<Samme />);
    await ukjentForsok(user);
    const d = utsatt<Kontroll>();
    sjekkNotat.mockReturnValueOnce(d.promise);
    await user.click(sjekkKnapp());
    gjeldendeKontekst = "familie1|sesjon-2"; // byttet før svaret, før ny tegning
    await act(async () => {
      d.svar("likSendt");
      await d.promise;
    });
    expect(screen.queryByRole("button", { name: "Godta nåtilstanden" })).toBeNull();
    expect(screen.queryByText(/står nå slik du ville lagre det/)).toBeNull();
  });
});
