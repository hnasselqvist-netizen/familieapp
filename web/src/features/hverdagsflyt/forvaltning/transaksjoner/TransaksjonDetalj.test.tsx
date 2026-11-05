/**
 * PC-2 (#59, ordre 6647608110): detaljpanel og URL-tilstand i
 * Transaksjoner. Tester skjermen med ekte ruter-URL (minne-dataruter) og
 * mocket datalag. Syntetiske data.
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { TransaksjonsoversiktScreen } from "./TransaksjonsoversiktScreen";

// Bredde i CSS-px; media queries i rem regnes med 16 px.
let bredde = 390;
const lyttere = new Set<() => void>();
beforeEach(() => {
  bredde = 390;
  lyttere.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      get matches() {
        const m = /min-width:\s*([\d.]+)rem/.exec(q);
        return m ? bredde >= Number(m[1]) * 16 : false;
      },
      media: q,
      addEventListener: (_: string, fn: () => void) => lyttere.add(fn),
      removeEventListener: (_: string, fn: () => void) => lyttere.delete(fn),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());
const settBredde = (px: number) =>
  act(() => {
    bredde = px;
    lyttere.forEach((fn) => fn());
  });

const t = (id: string, felt: Partial<TransaksjonRecord>): TransaksjonRecord => ({
  id,
  dato: "2026-09-10",
  tekst: "REMA 1000",
  belop: 250,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...felt,
});
const h = (id: string, felt: Partial<HendelseRecord>): HendelseRecord => ({
  id,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [],
  dato: "2026-09-10",
  regelId: null,
  opprettet: "",
  oppdatert: "",
  ...felt,
});
const fordeling = (navn: string, belop: number, person = "Felles") => ({
  plasseringId: "b-mat",
  plasseringType: "budget" as const,
  plasseringNavn: navn,
  belop,
  eiere: [{ person, prosent: 100 }],
});

const TRANSAKSJONER = [
  t("t-rema", { tekst: "REMA 1000", dato: "2026-09-10" }),
  t("t-lonn", { tekst: "LØNN", retning: "inn", belop: 30000, dato: "2026-09-25" }),
  t("t-vipps", { tekst: "VIPPS OLA", dato: "2026-09-05" }),
  t("t-kiwi", { tekst: "KIWI", dato: "2026-09-03", belop: 99.5 }),
];
const HENDELSER = [
  h("h-rema", {
    transaksjonId: "t-rema",
    regelId: "r-rema",
    fordelinger: [fordeling("Dagligvarer", 250)],
  }),
  h("h-lonn", {
    transaksjonId: "t-lonn",
    fordelinger: [
      {
        plasseringId: "i-lonn",
        plasseringType: "income",
        plasseringNavn: "Lønn Helen",
        belop: 30000,
        eiere: [{ person: "Helen", prosent: 100 }],
      },
    ],
  }),
  h("h-vipps", {
    transaksjonId: "t-vipps",
    receiptId: "k1",
    regelId: "r-slettet",
    fordelinger: [fordeling("Dagligvarer", 250, "Eivind")],
  }),
];
const RECEIPTS = [
  { id: "k1", merchant: "Vipps-butikken", purchaseDate: "2026-09-05", total: 250 },
  { id: "k2", merchant: "Kopi", transactionId: "t-vipps" },
  { id: "k3", merchant: "Forkastet", transactionId: "t-vipps", forkastet: true },
] as unknown as KvitteringRecord[];
const RULES = [
  { id: "r-rema", pattern: "REMA", targetName: "Dagligvarer" },
] as unknown as RegelRecord[];
const BUDGET: BudsjettGruppe[] = [
  { id: "mat", label: "Mat", items: [{ id: "b-mat", name: "Dagligvarer", months: [] }] },
];

const data = {
  transaksjoner: { status: "loaded" as const, data: TRANSAKSJONER },
  hendelser: HENDELSER,
  receipts: RECEIPTS,
  rules: RULES,
  budgetGroups: BUDGET,
  incomeGroups: [] as BudsjettGruppe[],
  sparingGroups: [] as BudsjettGruppe[],
  liquidityPosts: [],
  skrivingAktiv: true,
  utfor: vi.fn().mockResolvedValue(undefined),
  kontroller: new Map(),
  settKvalitetssikring: vi.fn().mockResolvedValue(undefined),
};
// Datalaget som et lite abonnement: `endreData` gir en ny live-verdi.
const lyttereData = new Set<() => void>();
const endreData = (fn: () => void) =>
  act(() => {
    fn();
    lyttereData.forEach((l) => l());
  });
vi.mock("@hooks/useTransaksjonsoversikt", async () => {
  const { useEffect, useReducer } = await import("react");
  return {
    useTransaksjonsoversikt: () => {
      const [, tving] = useReducer((n: number) => n + 1, 0);
      useEffect(() => {
        lyttereData.add(tving);
        return () => void lyttereData.delete(tving);
      }, []);
      return data;
    },
  };
});

let ruter: ReturnType<typeof createMemoryRouter>;
const gaa = (steg: number) => ruter.navigate(steg);
function Url() {
  return <output data-testid="url">{useLocation().search}</output>;
}
function vis(url: string) {
  data.transaksjoner = { status: "loaded", data: TRANSAKSJONER };
  data.hendelser = HENDELSER;
  data.utfor = vi.fn().mockResolvedValue(undefined);
  ruter = createMemoryRouter(
    [
      {
        path: "/forvaltning/transaksjoner",
        element: (
          <>
            <TransaksjonsoversiktScreen />
            <Url />
          </>
        ),
      },
      { path: "/annet", element: <p>Annen side</p> },
    ],
    { initialEntries: [`/forvaltning/transaksjoner${url}`] },
  );
  const r = render(<RouterProvider router={ruter} />);
  return { ...r, user: userEvent.setup() };
}
const url = () => new URLSearchParams(screen.getByTestId("url").textContent ?? "");
const detalj = () => document.querySelector<HTMLElement>("[data-detaljpanel]");
const panel = () => detalj() as HTMLElement;

describe("URL-tilstand", () => {
  it("dyplenke åpner riktig transaksjon; andre parametre står", () => {
    vis("?ko=forslag&visning=alle&valgt=t-lonn");
    expect(within(panel()).getByRole("heading", { name: "LØNN" })).toHaveFocus();
    expect(panel()).toHaveTextContent("Lønn Helen");
    expect(panel()).toHaveTextContent("+30 000,00 kr (inn)");
    expect(url().get("ko")).toBe("forslag");
  });

  it("valg skriver ID-en til URL-en; Escape lukker og gir fokus tilbake til raden", async () => {
    const v = vis("?visning=alle");
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: REMA 1000" }));
    expect(url().get("valgt")).toBe("t-rema");
    expect(within(panel()).getByRole("heading", { name: "REMA 1000" })).toHaveFocus();
    await v.user.keyboard("{Escape}");
    expect(url().get("valgt")).toBeNull();
    expect(detalj()).toBeNull();
    expect(screen.getByRole("button", { name: "Vis detaljer: REMA 1000" })).toHaveFocus();
  });

  it("tilbake og frem gir samme valg", async () => {
    const v = vis("?visning=alle");
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: KIWI" }));
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: LØNN" }));
    await act(() => gaa(-1));
    expect(within(panel()).getByRole("heading", { name: "KIWI" })).toBeInTheDocument();
    await act(() => gaa(-1));
    expect(detalj()).toBeNull();
    await act(() => gaa(1));
    expect(within(panel()).getByRole("heading", { name: "KIWI" })).toBeInTheDocument();
  });

  it("filtre og sortering i URL-en; søk erstatter historikk", async () => {
    const v = vis("?visning=alle&konto=felleskonto&sorter=tekst");
    // Sortert på tekst, stigende — også i kortvisningen.
    expect(
      screen
        .getAllByRole("button", { name: /^Vis detaljer: / })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      "Vis detaljer: KIWI",
      "Vis detaljer: LØNN",
      "Vis detaljer: REMA 1000",
      "Vis detaljer: VIPPS OLA",
    ]);
    await v.user.type(screen.getByRole("searchbox", { name: "Søk i tekst" }), "rem");
    expect(url().get("sok")).toBe("rem");
    expect(url().get("konto")).toBe("felleskonto");
    expect(url().get("sorter")).toBe("tekst");
    // Hele søket er én historikkoppføring: tilbake går til før søket.
    await act(() => gaa(-1));
    expect(url().get("sok")).toBeNull();
    expect(url().get("sorter")).toBe("tekst");
    await act(() => gaa(1));
    expect(url().get("sok")).toBe("rem");
  });

  it("ugyldig eller slettet ID: synlig melding, ingen annen rad åpnes", () => {
    vis("?visning=alle&valgt=finnes-ikke");
    expect(panel()).toHaveTextContent("Transaksjonen finnes ikke lenger");
    expect(
      screen
        .getAllByRole("button", { pressed: true })
        .filter((b) => b.getAttribute("aria-label")?.startsWith("Vis detaljer")),
    ).toHaveLength(0);
  });

  it("utfiltrert valg står med forklaring; array-endring åpner aldri en annen rad", () => {
    vis("?visning=alle&sok=LØNN&valgt=t-rema");
    expect(within(panel()).getByRole("heading", { name: "REMA 1000" })).toBeInTheDocument();
    expect(panel()).toHaveTextContent("Filteret skjuler denne transaksjonen");
    endreData(() => {
      data.transaksjoner = {
        status: "loaded",
        data: [t("t-ny", { tekst: "NY FØRST" }), ...TRANSAKSJONER.slice().reverse()],
      };
    });
    expect(screen.getByText(/1 av 5 transaksjoner/)).toBeInTheDocument();
    expect(within(panel()).getByRole("heading", { name: "REMA 1000" })).toBeInTheDocument();
  });
});

describe("innhold i panelet", () => {
  it("nåværende regel er merket som nåværende; slettet regel vises som slettet", async () => {
    const v = vis("?visning=alle&valgt=t-rema");
    expect(panel()).toHaveTextContent("«REMA» → Dagligvarer");
    expect(panel()).toHaveTextContent("Viser regelen slik den er nå");
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: VIPPS OLA" }));
    expect(panel()).toHaveTextContent("Plassert av en regel som ikke finnes lenger.");
  });

  it("alle koblingsveier for kvitteringer; flere vises; forkastet gjenopplives ikke", () => {
    vis("?visning=alle&valgt=t-vipps");
    expect(panel()).toHaveTextContent("2 kvitteringer er koblet til denne transaksjonen.");
    expect(panel()).toHaveTextContent("Vipps-butikken");
    expect(panel()).toHaveTextContent("koblet fra hendelsen");
    expect(panel()).toHaveTextContent("Kopi");
    expect(panel()).toHaveTextContent("lastet opp på transaksjonen");
    expect(panel()).not.toHaveTextContent("Forkastet");
    expect(panel()).toHaveTextContent("1 forkastet kvittering vises ikke.");
  });

  it("splitt, eier, eksakt beløp og separat kontrollstatus", () => {
    vis("?visning=alle&valgt=t-vipps");
    expect(panel()).toHaveTextContent("-250,00 kr (ut)");
    expect(panel()).toHaveTextContent("Eivind");
    expect(panel()).toHaveTextContent("Ikke kontrollert");
  });
});

describe("layout og korrigering i panelet", () => {
  it("sidepanel ved 1280 px, ark (dialog) ved 1024 px; tabellen står", () => {
    bredde = 1280;
    vis("?visning=alle&valgt=t-rema");
    expect(screen.getByRole("region", { name: "REMA 1000" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    settBredde(1024);
    expect(screen.getByRole("dialog", { name: "REMA 1000" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("korrigerer riktig hendelse; utkastet står over breddeskift", async () => {
    bredde = 1280;
    const v = vis("?visning=alle&valgt=t-rema");
    await v.user.click(within(panel()).getByRole("button", { name: "Korriger kobling" }));
    const skjema = () => within(panel()).getByRole("region", { name: "Korriger kobling" });
    await v.user.click(within(skjema()).getByRole("button", { name: "Sett på vent" }));
    settBredde(800);
    expect(within(skjema()).getByRole("button", { name: "Sett på vent" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await v.user.click(within(skjema()).getByRole("button", { name: /venter på kvittering/i }));
    await v.user.click(within(skjema()).getByRole("button", { name: "Lagre korrigering" }));
    expect(data.utfor).toHaveBeenCalledTimes(1);
    const endring = data.utfor.mock.calls[0]![0] as {
      hendelser: (h: HendelseRecord[]) => HendelseRecord[];
    };
    const etter = endring.hendelser(HENDELSER);
    expect(etter.find((x) => x.id === "h-rema")).toMatchObject({ status: "pa_vent" });
    expect(etter.find((x) => x.id === "h-lonn")).toEqual(HENDELSER[1]);
  });

  it("tilbake/frem eller annen side under korrigering holdes igjen; søk går fritt", async () => {
    bredde = 1280;
    const v = vis("?visning=alle");
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: KIWI" }));
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: REMA 1000" }));
    await v.user.click(within(panel()).getByRole("button", { name: "Korriger kobling" }));
    const skjema = () => within(panel()).getByRole("region", { name: "Korriger kobling" });
    await v.user.click(within(skjema()).getByRole("button", { name: "Sett på vent" }));
    // Søk endrer ikke valget: ingen sperre, utkastet står.
    await v.user.type(screen.getByRole("searchbox", { name: "Søk i tekst" }), "re");
    expect(url().get("sok")).toBe("re");
    expect(within(skjema()).getByRole("button", { name: "Sett på vent" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Første «tilbake» fjerner bare søket — samme valg, ingen sperre.
    await act(() => gaa(-1));
    expect(url().get("sok")).toBeNull();
    expect(within(panel()).queryByRole("alert")).toBeNull();
    // Neste ville byttet valg: holdes igjen med synlig valg.
    await act(() => gaa(-1));
    expect(url().get("valgt")).toBe("t-rema");
    expect(within(panel()).getByRole("alert")).toHaveTextContent("forkaste den og gå videre");
    await v.user.click(within(panel()).getByRole("button", { name: "Fortsett korrigering" }));
    expect(within(skjema()).getByRole("button", { name: "Sett på vent" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Annen side: også holdt igjen; «Forkast» slipper navigasjonen gjennom.
    await act(() => ruter.navigate("/annet"));
    expect(screen.queryByText("Annen side")).toBeNull();
    await v.user.click(within(panel()).getByRole("button", { name: "Forkast utkastet" }));
    expect(await screen.findByText("Annen side")).toBeInTheDocument();
    expect(data.utfor).not.toHaveBeenCalled();
  });

  it("hendelsen slettet under korrigering: synlig melding, ingen forkastvalg eller sperre", async () => {
    bredde = 1280;
    const v = vis("?visning=alle&valgt=t-rema");
    await v.user.click(within(panel()).getByRole("button", { name: "Korriger kobling" }));
    endreData(() => {
      data.hendelser = HENDELSER.filter((x) => x.id !== "h-rema");
    });
    expect(panel()).toHaveTextContent("Hendelsen finnes ikke lenger");
    await act(() => ruter.navigate("/annet"));
    expect(await screen.findByText("Annen side")).toBeInTheDocument();
  });

  it("bytte til «Til behandling» under korrigering krever også et valg", async () => {
    bredde = 1280;
    const v = vis("?visning=alle&valgt=t-rema");
    await v.user.click(within(panel()).getByRole("button", { name: "Korriger kobling" }));
    await v.user.click(screen.getByRole("button", { name: "Til behandling" }));
    expect(url().get("visning")).toBe("alle");
    expect(within(panel()).getByRole("alert")).toBeInTheDocument();
    await v.user.click(within(panel()).getByRole("button", { name: "Forkast utkastet" }));
    expect(url().get("visning")).toBeNull();
    expect(detalj()).toBeNull();
  });

  it("radbytte og lukking under korrigering krever et synlig valg; ingenting forkastes i stillhet", async () => {
    bredde = 1280; // radbytte skjer fra tabellen ved siden av panelet
    const v = vis("?visning=alle&valgt=t-rema");
    await v.user.click(within(panel()).getByRole("button", { name: "Korriger kobling" }));
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: KIWI" }));
    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Du har en ulagret korrigering. Vil du forkaste den og åpne «KIWI»?",
    );
    expect(url().get("valgt")).toBe("t-rema");
    expect(within(panel()).getByRole("button", { name: "Fortsett korrigering" })).toHaveFocus();
    await v.user.click(within(panel()).getByRole("button", { name: "Fortsett korrigering" }));
    expect(within(panel()).getByRole("region", { name: "Korriger kobling" })).toBeInTheDocument();
    expect(panel()).toContainElement(document.activeElement as HTMLElement);
    await v.user.keyboard("{Escape}");
    expect(within(panel()).getByRole("alert")).toHaveTextContent("forkaste den og lukke");
    await v.user.click(within(panel()).getByRole("button", { name: "Forkast utkastet" }));
    expect(detalj()).toBeNull();
    expect(data.utfor).not.toHaveBeenCalled();
  });
});

describe("review 5779763655: korrigeringssesjon og grunnlag", () => {
  /** Utsatt `onUtfor`: testen bestemmer når og hvordan lagringen ender. */
  function utsattUtfor() {
    const kall: { fullfor: () => void; avvis: (e: Error) => void }[] = [];
    endreData(() => {
      data.utfor = vi.fn(
        () =>
          new Promise<undefined>((res, rej) =>
            kall.push({ fullfor: () => res(undefined), avvis: rej }),
          ),
      );
    });
    return kall;
  }
  const skjema = () => within(panel()).getByRole("region", { name: "Korriger kobling" });
  const lagreKnapp = () =>
    within(skjema()).getByRole("button", { name: /Lagre korrigering|Lagrer/ });
  async function settPaaVent(v: ReturnType<typeof vis>) {
    await v.user.click(within(panel()).getByRole("button", { name: "Korriger kobling" }));
    await v.user.click(within(skjema()).getByRole("button", { name: "Sett på vent" }));
    await v.user.click(
      within(within(skjema()).getByRole("group", { name: "Årsak" })).getAllByRole("button")[0]!,
    );
  }
  const settPaaVentTrykket = () =>
    within(skjema()).getByRole("button", { name: "Sett på vent" }).getAttribute("aria-pressed");

  beforeEach(() => {
    bredde = 1280;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("radbytte under lagring venter (ingen «Forkast»); resolve åpner neste rad og viser utfallet", async () => {
    const v = vis("?visning=alle&valgt=t-rema");
    const kall = utsattUtfor();
    await settPaaVent(v);
    await v.user.dblClick(lagreKnapp());
    expect(data.utfor).toHaveBeenCalledTimes(1);
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: LØNN" }));
    const varsel = within(panel()).getByRole("alert");
    expect(varsel).toHaveTextContent("Korrigeringen lagres. «LØNN» åpnes når lagringen er ferdig.");
    expect(within(varsel).queryByRole("button", { name: "Forkast utkastet" })).toBeNull();
    expect(url().get("valgt")).toBe("t-rema");
    // «Bli her» avbryter bare byttet, ikke lagringen.
    await v.user.click(within(varsel).getByRole("button", { name: "Bli her" }));
    expect(within(panel()).queryByRole("alert")).toBeNull();
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: LØNN" }));
    await act(async () => kall[0]!.fullfor());
    expect(url().get("valgt")).toBe("t-lonn");
    expect(within(panel()).getByRole("heading", { name: "LØNN" })).toBeInTheDocument();
    expect(panel()).toHaveTextContent("Korrigeringen av «REMA 1000» er lagret.");
  });

  it("gammel lagring kan aldri lukke eller endre et nytt utkast på en annen rad", async () => {
    const v = vis("?visning=alle&valgt=t-rema");
    const kall = utsattUtfor();
    await settPaaVent(v);
    await v.user.click(lagreKnapp());
    // Avvist lagring: utkastet står, og en ny korrigering på en annen rad
    // startes etter et synlig forkastvalg.
    await act(async () => kall[0]!.avvis(new Error("nett")));
    expect(settPaaVentTrykket()).toBe("true");
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: VIPPS OLA" }));
    await v.user.click(within(panel()).getByRole("button", { name: "Forkast utkastet" }));
    await v.user.click(within(panel()).getByRole("button", { name: "Korriger kobling" }));
    await v.user.click(within(skjema()).getByRole("button", { name: "Sett på vent" }));
    // En sen callback fra den gamle sesjonen (resolve etter avvis) virker ikke.
    await act(async () => kall[0]!.fullfor());
    expect(within(panel()).getByRole("heading", { name: "VIPPS OLA" })).toBeInTheDocument();
    expect(settPaaVentTrykket()).toBe("true");
  });

  it("avvist lagring: utkast og feil står, ventende bytte avbrytes synlig", async () => {
    const v = vis("?visning=alle&valgt=t-rema");
    const kall = utsattUtfor();
    await settPaaVent(v);
    await v.user.click(lagreKnapp());
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: KIWI" }));
    await act(async () => kall[0]!.avvis(new Error("nett")));
    expect(url().get("valgt")).toBe("t-rema");
    expect(panel()).toHaveTextContent(
      "Lagringen av korrigeringen av «REMA 1000» feilet. Utkastet står, og byttet ble ikke gjort.",
    );
    expect(within(skjema()).getByRole("alert")).toHaveTextContent("Noe gikk galt");
    expect(settPaaVentTrykket()).toBe("true");
    // Nytt forsøk lykkes.
    await v.user.click(lagreKnapp());
    await act(async () => kall[1]!.fullfor());
    expect(panel()).toHaveTextContent("Korrigeringen av «REMA 1000» er lagret.");
  });

  it("Escape og tilbake under lagring venter på utfallet", async () => {
    const v = vis("?visning=alle");
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: KIWI" }));
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: REMA 1000" }));
    const kall = utsattUtfor();
    await settPaaVent(v);
    await v.user.click(lagreKnapp());
    await v.user.keyboard("{Escape}");
    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Detaljene lukkes når lagringen er ferdig.",
    );
    await v.user.click(within(panel()).getByRole("button", { name: "Bli her" }));
    await act(() => gaa(-1));
    expect(url().get("valgt")).toBe("t-rema");
    expect(within(panel()).getByRole("alert")).toHaveTextContent(
      "Du går videre når lagringen er ferdig.",
    );
    await act(async () => kall[0]!.fullfor());
    expect(url().get("valgt")).toBe("t-kiwi");
    expect(panel()).toHaveTextContent("Korrigeringen av «REMA 1000» er lagret.");
  });

  it("annen hendelses-ID under samme transaksjon: utkastet står, konflikt vises, lagring sperret; også over layoutbytte", async () => {
    const v = vis("?visning=alle&valgt=t-rema");
    await v.user.click(within(panel()).getByRole("button", { name: "Korriger kobling" }));
    await v.user.click(within(skjema()).getByRole("button", { name: "Sett på vent" }));
    endreData(() => {
      data.hendelser = HENDELSER.map((x) => (x.id === "h-rema" ? { ...x, id: "h-rema-ny" } : x));
    });
    expect(settPaaVentTrykket()).toBe("true");
    expect(within(skjema()).getByRole("alert")).toHaveTextContent(
      "Transaksjonen har fått en annen hendelse",
    );
    await v.user.click(
      within(within(skjema()).getByRole("group", { name: "Årsak" })).getAllByRole("button")[0]!,
    );
    expect(lagreKnapp()).toBeDisabled();
    settBredde(1024);
    expect(screen.getByRole("dialog", { name: "REMA 1000" })).toBeInTheDocument();
    expect(settPaaVentTrykket()).toBe("true");
    expect(within(skjema()).getByRole("alert")).toBeInTheDocument();
    // Radbytte vernes fortsatt.
    settBredde(1280);
    await v.user.click(screen.getByRole("button", { name: "Vis detaljer: KIWI" }));
    expect(within(panel()).getAllByRole("alert")[0]).toHaveTextContent(
      "forkaste den og åpne «KIWI»",
    );
    await v.user.click(within(panel()).getByRole("button", { name: "Fortsett korrigering" }));
    // Brukeren velger å starte på nytt fra den gjeldende hendelsen.
    await v.user.click(
      within(skjema()).getByRole("button", { name: "Start på nytt fra gjeldende" }),
    );
    expect(within(skjema()).queryByRole("alert")).toBeNull();
    expect(settPaaVentTrykket()).toBe("false");
    await v.user.click(within(skjema()).getByRole("button", { name: "Sett på vent" }));
    await v.user.click(
      within(within(skjema()).getByRole("group", { name: "Årsak" })).getAllByRole("button")[0]!,
    );
    await v.user.click(lagreKnapp());
    const endring = data.utfor.mock.calls[0]![0] as {
      hendelser: (h: HendelseRecord[]) => HendelseRecord[];
    };
    const etter = endring.hendelser(data.hendelser);
    expect(etter.filter((x) => x.transaksjonId === "t-rema").map((x) => [x.id, x.status])).toEqual([
      ["h-rema-ny", "pa_vent"],
    ]);
  });

  it("slettet → ny hendelse og samme ID med endret grunnlag gir konflikt; ingen stille remontering", async () => {
    const v = vis("?visning=alle&valgt=t-rema");
    await v.user.click(within(panel()).getByRole("button", { name: "Korriger kobling" }));
    await v.user.click(within(skjema()).getByRole("button", { name: "Sett på vent" }));
    endreData(() => {
      data.hendelser = HENDELSER.filter((x) => x.id !== "h-rema");
    });
    expect(within(skjema()).getByRole("alert")).toHaveTextContent("Hendelsen finnes ikke lenger");
    expect(settPaaVentTrykket()).toBe("true");
    endreData(() => {
      data.hendelser = [
        ...HENDELSER.filter((x) => x.id !== "h-rema"),
        h("h-rema-2", { transaksjonId: "t-rema" }),
      ];
    });
    expect(within(skjema()).getByRole("alert")).toHaveTextContent("annen hendelse");
    expect(settPaaVentTrykket()).toBe("true");
    // Samme ID, endret innhold.
    await v.user.click(within(skjema()).getByRole("button", { name: "Forkast utkastet" }));
    endreData(() => {
      data.hendelser = HENDELSER;
    });
    await v.user.click(within(panel()).getByRole("button", { name: "Korriger kobling" }));
    await v.user.click(within(skjema()).getByRole("button", { name: "Sett på vent" }));
    endreData(() => {
      data.hendelser = HENDELSER.map((x) =>
        x.id === "h-rema" ? { ...x, oppdatert: "2026-09-11T00:00:00Z" } : x,
      );
    });
    expect(within(skjema()).getByRole("alert")).toHaveTextContent(
      "Hendelsen er endret et annet sted",
    );
    expect(settPaaVentTrykket()).toBe("true");
    expect(lagreKnapp()).toBeDisabled();
    expect(data.utfor).not.toHaveBeenCalled();
  });
});
