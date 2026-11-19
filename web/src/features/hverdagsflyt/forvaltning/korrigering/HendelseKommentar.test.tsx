import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  KommentarForsok,
  KommentarKontroll,
  KommentarMaal,
  KommentarUtfall,
} from "@domain/forsoning/hendelseKommentar";
import type { HendelseRecord } from "@app-types/forsoning";
import { HendelseKommentar } from "./HendelseKommentar";
import { KorrigerHendelseModal } from "./KorrigerHendelseModal";

/**
 * Kommentar på manuell hendelse (#59, ordre 7002365160, #141): egen
 * handling, utkast bundet til kilden, konflikt med beholdt utkast, frosset
 * forsøk etter tapt svar, retry som ikke avgjør tidligere forsøk, og svar
 * etter kontekstbytte som ikke anvendes. Syntetiske hendelser.
 */
const lagre = vi.fn<(k: string, maal: KommentarMaal, tekst: string) => Promise<KommentarUtfall>>();
const sjekk = vi.fn<(f: KommentarForsok) => Promise<KommentarKontroll>>();

const KONTEKST = "familie1|sesjon-1";
let gjeldendeKontekst = KONTEKST;
const erGjeldende = (k: string) => k === gjeldendeKontekst;

const MANUELL: HendelseRecord = {
  id: "h1",
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [
    {
      plasseringId: "dagligvarer",
      plasseringType: "budget",
      plasseringNavn: "Dagligvarer",
      belop: 250,
      eiere: [{ person: "Felles", prosent: 100 }],
    },
  ],
  dato: "2026-11-01",
  regelId: null,
  kilde: "manuell",
  kommentar: "Middag med\nbesteforeldre",
  opprettet: "2026-11-01T10:00:00.000Z",
  oppdatert: "2026-11-01T10:00:00.000Z",
};

type Liste = Record<string, readonly KommentarForsok[]>;
let lager: Liste = {};

function Skjerm({
  hendelse = MANUELL,
  kontekst = KONTEKST,
}: {
  hendelse?: HendelseRecord;
  kontekst?: string;
}) {
  const [forsok, setForsok] = useState<Liste>({});
  lager = forsok;
  return (
    <HendelseKommentar
      key={`${kontekst}-${hendelse.id}`}
      hendelse={hendelse}
      kontekst={kontekst}
      erGjeldende={erGjeldende}
      lagre={lagre}
      sjekk={sjekk}
      forsok={forsok[`${kontekst}/${hendelse.id}`] ?? []}
      oppdaterForsok={(k, id, endre) =>
        setForsok((f) => {
          const n = { ...f };
          const l = endre(f[`${k}/${id}`] ?? []);
          if (l.length) n[`${k}/${id}`] = l;
          else delete n[`${k}/${id}`];
          return n;
        })
      }
    />
  );
}

const felt = () => screen.getByRole("textbox", { name: "Kommentar på hendelsen" });
const lagreKnapp = () => screen.getByRole("button", { name: "Lagre kommentar" });
const sjekkKnapp = () => screen.getByRole("button", { name: "Sjekk om kommentaren ble lagret" });
function utsatt<T>() {
  let svar!: (v: T) => void;
  const promise = new Promise<T>((r) => (svar = r));
  return { promise, svar };
}
const FORSOK_A: KommentarForsok = {
  kontekst: KONTEKST,
  hendelseId: "h1",
  kilde: "Middag med\nbesteforeldre",
  sendt: "Middag med\nbesteforeldre!",
};
async function ukjentForsok(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Rediger kommentar" }));
  await user.type(felt(), "!");
  lagre.mockResolvedValueOnce("ukjent");
  await user.click(lagreKnapp());
  await screen.findByText("Sendt, ikke avklart:");
}

beforeEach(() => {
  lagre.mockReset();
  sjekk.mockReset();
  gjeldendeKontekst = KONTEKST;
  lager = {};
});

describe("HendelseKommentar — visning og lagring", () => {
  it("viser kommentaren med linjeskift, og «Ingen kommentar» uten", () => {
    const r = render(<Skjerm />);
    expect(screen.getByTestId("hendelse-kommentar").textContent).toBe("Middag med\nbesteforeldre");
    r.rerender(<Skjerm hendelse={{ ...MANUELL, kommentar: null }} />);
    expect(screen.getByText("Ingen kommentar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Legg til kommentar" })).toBeInTheDocument();
  });

  it("lagres bare ved «Lagre kommentar», med kilden utkastet startet fra; dobbeltklikk sender én gang", async () => {
    const user = userEvent.setup();
    render(<Skjerm />);
    await user.click(screen.getByRole("button", { name: "Rediger kommentar" }));
    await user.clear(felt());
    await user.type(felt(), "  Ny  ");
    expect(lagre).not.toHaveBeenCalled();
    const d = utsatt<KommentarUtfall>();
    lagre.mockReturnValueOnce(d.promise);
    await user.dblClick(lagreKnapp());
    d.svar("lagret");
    expect(await screen.findByRole("status")).toHaveTextContent("Kommentaren er lagret.");
    expect(lagre).toHaveBeenCalledTimes(1);
    expect(lagre).toHaveBeenCalledWith(
      KONTEKST,
      { id: "h1", kilde: "Middag med\nbesteforeldre" },
      "  Ny  ",
    );
  });

  it("tømming sendes som tom tekst; identisk gir «var allerede slik»", async () => {
    const user = userEvent.setup();
    render(<Skjerm />);
    await user.click(screen.getByRole("button", { name: "Rediger kommentar" }));
    await user.clear(felt());
    lagre.mockResolvedValueOnce("allerede");
    await user.click(lagreKnapp());
    expect(lagre).toHaveBeenCalledWith(KONTEKST, expect.anything(), "");
    expect(await screen.findByRole("status")).toHaveTextContent("allerede slik");
  });

  it("konflikt: utkastet står, gjeldende vises, ny lagring krever eksplisitt nytt grunnlag", async () => {
    const user = userEvent.setup();
    const r = render(<Skjerm />);
    await user.click(screen.getByRole("button", { name: "Rediger kommentar" }));
    await user.type(felt(), " — mitt");
    r.rerender(<Skjerm hendelse={{ ...MANUELL, kommentar: "Annen enhet" }} />);
    lagre.mockResolvedValueOnce("konflikt");
    await user.click(lagreKnapp());
    expect(await screen.findByRole("alert")).toHaveTextContent("Utkastet ditt står");
    expect(felt()).toHaveValue("Middag med\nbesteforeldre — mitt");
    expect(screen.getByText("Annen enhet")).toBeInTheDocument();
    expect(lagreKnapp()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Bruk gjeldende kommentar som grunnlag" }));
    lagre.mockResolvedValueOnce("lagret");
    await user.click(lagreKnapp());
    expect(lagre).toHaveBeenLastCalledWith(
      KONTEKST,
      { id: "h1", kilde: "Annen enhet" },
      "Middag med\nbesteforeldre — mitt",
    );
  });

  it.each(["mangler", "tvetydig", "ikkeBerettiget", "ugyldig"] as const)(
    "%s: utkastet står, lagring sperres",
    async (u) => {
      const user = userEvent.setup();
      render(<Skjerm />);
      await user.click(screen.getByRole("button", { name: "Rediger kommentar" }));
      lagre.mockResolvedValueOnce(u);
      await user.click(lagreKnapp());
      await screen.findByRole("alert");
      expect(felt()).toBeInTheDocument();
      expect(lagreKnapp()).toBeDisabled();
    },
  );

  it("ugyldig lagret form: vises ikke og kan ikke redigeres", () => {
    render(<Skjerm hendelse={{ ...MANUELL, kommentar: 42 as unknown as string }} />);
    expect(screen.getByText(/form appen ikke kan endre trygt/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /kommentar$/ })).toBeNull();
  });
});

describe("HendelseKommentar — uavklart forsøk", () => {
  it("ukjent: feltet forsvinner, det sendte vises, og kontrollen gjelder forsøket", async () => {
    const user = userEvent.setup();
    render(<Skjerm />);
    await ukjentForsok(user);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByTestId("sendt-kommentar").textContent).toBe("Middag med\nbesteforeldre!");
    sjekk.mockResolvedValueOnce("likKilde");
    await user.click(sjekkKnapp());
    expect(sjekk).toHaveBeenCalledWith(FORSOK_A);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Om akkurat dette forsøket ble lagret, er fortsatt ikke avklart.",
    );
    expect(lagre).toHaveBeenCalledTimes(1);
  });

  it.each(["ikkeLest", "byttet", "avvist", "konflikt", "mangler", "ikkeBerettiget"] as const)(
    "ukjent → likKilde → «Lagre på nytt» → %s: A står uavklart, retry-resultatet vises for seg",
    async (u) => {
      const user = userEvent.setup();
      render(<Skjerm />);
      await ukjentForsok(user);
      sjekk.mockResolvedValueOnce("likKilde");
      await user.click(sjekkKnapp());
      lagre.mockResolvedValueOnce(u);
      await user.click(screen.getByRole("button", { name: "Lagre på nytt" }));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/^Det nye forsøket er ikke lagret: /);
      expect(alert).toHaveTextContent("Det første forsøket er fortsatt ikke avklart.");
      expect(lager[`${KONTEKST}/h1`]).toEqual([FORSOK_A]);
      expect(screen.getByText("Sendt, ikke avklart:")).toBeInTheDocument();
    },
  );

  it("nytt `ukjent` erstatter ikke A; `lagret` avslutter uten å avklare A", async () => {
    const user = userEvent.setup();
    render(<Skjerm />);
    await ukjentForsok(user);
    sjekk.mockResolvedValue("likKilde");
    await user.click(sjekkKnapp());
    lagre.mockResolvedValueOnce("ukjent");
    await user.click(screen.getByRole("button", { name: "Lagre på nytt" }));
    await screen.findByTestId("antall-forsok");
    expect(lager[`${KONTEKST}/h1`]).toEqual([FORSOK_A, FORSOK_A]);
    await user.click(sjekkKnapp());
    lagre.mockResolvedValueOnce("lagret");
    await user.click(await screen.findByRole("button", { name: "Lagre på nytt" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Om det første forsøket kom frem, er ikke avklart.");
    expect(lager).toEqual({});
  });

  it("`likSendt` avklarer ikke alene: «Godta nåtilstanden» er et eksplisitt valg", async () => {
    const user = userEvent.setup();
    render(<Skjerm />);
    await ukjentForsok(user);
    sjekk.mockResolvedValueOnce("likSendt");
    await user.click(sjekkKnapp());
    await screen.findByRole("alert");
    expect(lager[`${KONTEKST}/h1`]).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Godta nåtilstanden" }));
    expect(lager).toEqual({});
  });

  it("et svar etter sesjonsbytte anvendes ikke, men registreres under forsøkets egen kontekst", async () => {
    const user = userEvent.setup();
    const r = render(<Skjerm />);
    await user.click(screen.getByRole("button", { name: "Rediger kommentar" }));
    await user.type(felt(), "!");
    const d = utsatt<KommentarUtfall>();
    lagre.mockReturnValueOnce(d.promise);
    await user.click(lagreKnapp());
    gjeldendeKontekst = "familie1|sesjon-2";
    r.rerender(<Skjerm kontekst="familie1|sesjon-2" />);
    await act(async () => {
      d.svar("ukjent");
      await d.promise;
    });
    expect(lager[`${KONTEKST}/h1`]).toEqual([FORSOK_A]);
    expect(screen.queryByText("Sendt, ikke avklart:")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("HendelseKommentar — svar fra gammel kontekst før ny tegning", () => {
  it("et lagringssvar anvendes ikke når konteksten er byttet, selv om komponenten står", async () => {
    const user = userEvent.setup();
    render(<Skjerm />);
    await user.click(screen.getByRole("button", { name: "Rediger kommentar" }));
    const d = utsatt<KommentarUtfall>();
    lagre.mockReturnValueOnce(d.promise);
    await user.click(lagreKnapp());
    gjeldendeKontekst = "familie1|sesjon-2"; // byttet før svaret, uten ny tegning
    await act(async () => {
      d.svar("konflikt");
      await d.promise;
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Gjeldende kommentar")).toBeNull();
  });

  it("et kontrollsvar anvendes ikke når konteksten er byttet", async () => {
    const user = userEvent.setup();
    render(<Skjerm />);
    await ukjentForsok(user);
    const d = utsatt<KommentarKontroll>();
    sjekk.mockReturnValueOnce(d.promise);
    await user.click(sjekkKnapp());
    gjeldendeKontekst = "familie1|sesjon-2";
    await act(async () => {
      d.svar("likSendt");
      await d.promise;
    });
    expect(screen.queryByRole("button", { name: "Godta nåtilstanden" })).toBeNull();
  });
});

describe("KorrigerHendelseModal — kommentar bare på vanlig manuell hendelse", () => {
  const kommentar = {
    kontekst: KONTEKST,
    erGjeldende,
    lagre,
    sjekk,
    forsok: [],
    oppdaterForsok: vi.fn(),
  };
  const vis = (hendelse: HendelseRecord) =>
    render(
      <KorrigerHendelseModal
        hendelse={hendelse}
        transaksjoner={[]}
        rules={[]}
        budgetGroups={[]}
        incomeGroups={[]}
        sparingGroups={[]}
        onUtfor={vi.fn()}
        onLagret={vi.fn()}
        onClose={vi.fn()}
        kommentar={kommentar}
      />,
    );

  it("manuell: egen kommentarhandling; lagring skriver ingen økonomisk korrigering", async () => {
    const user = userEvent.setup();
    const onUtfor = vi.fn();
    render(
      <KorrigerHendelseModal
        hendelse={MANUELL}
        transaksjoner={[]}
        rules={[]}
        budgetGroups={[]}
        incomeGroups={[]}
        sparingGroups={[]}
        onUtfor={onUtfor}
        onLagret={vi.fn()}
        onClose={vi.fn()}
        kommentar={kommentar}
      />,
    );
    expect(screen.getByRole("region", { name: "Kommentar" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rediger kommentar" }));
    lagre.mockResolvedValueOnce("lagret");
    await user.click(lagreKnapp());
    await screen.findByRole("status");
    expect(onUtfor).not.toHaveBeenCalled();
  });

  it.each([
    ["bankkoblet", { transaksjonId: "t1", kilde: undefined }],
    ["kvitteringskoblet", { receiptId: "r1" }],
    ["mellomværende", { mellomvaerende: { avtaleId: "a1" } as never }],
  ])("%s: ingen kommentarhandling", (_navn, over) => {
    vis({ ...MANUELL, ...over });
    expect(screen.queryByRole("region", { name: "Kommentar" })).toBeNull();
  });
});
