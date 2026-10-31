import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type KontrollFilter,
  type KontrollRad,
  STANDARD_SORTERING,
  type Sortering,
  TOMT_FILTER,
} from "@domain/forsoning/kontrollrader";
import { BRED_FLATE } from "@hooks/useMediaQuery";
import { KontrollOversikt } from "./KontrollOversikt";

/**
 * «Alle transaksjoner» (#59, PC-1): tabell på bred flate og kort på smal,
 * fra samme radmodell. Syntetiske rader.
 */
let bred = false;
const lyttere = new Set<() => void>();
beforeEach(() => {
  bred = false;
  lyttere.clear();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      get matches() {
        return q === BRED_FLATE && bred;
      },
      media: q,
      addEventListener: (_: string, fn: () => void) => lyttere.add(fn),
      removeEventListener: (_: string, fn: () => void) => lyttere.delete(fn),
    })),
  );
});
afterEach(() => vi.unstubAllGlobals());
const settBred = (v: boolean) =>
  act(() => {
    bred = v;
    lyttere.forEach((fn) => fn());
  });

const rad = (o: Partial<KontrollRad>): KontrollRad => ({
  id: "x",
  dato: "2026-09-10",
  tekst: "TEKST",
  konto: "felleskonto",
  belopOre: -10000,
  kategori: "ferdig",
  statusTekst: "Ferdig",
  hendelseId: "h",
  fordelinger: [],
  eiere: [],
  kvittering: null,
  kanKorrigeres: true,
  kontroll: { status: "ikke_kontrollert", grunnlag: "g", gjeldende: null },
  ...o,
});
const rader: KontrollRad[] = [
  rad({
    id: "ep1",
    tekst: "EASYPARK",
    konto: "helen",
    dato: "2026-09-12",
    belopOre: -12345,
    hendelseId: "h1",
    fordelinger: [
      {
        plasseringId: "p",
        plasseringType: "budget",
        postTekst: "Kostnad → Bil / Parkering",
        belopOre: 12345,
        eiere: [{ person: "Felles", prosent: 100 }],
      },
    ],
    eiere: ["Felles"],
  }),
  rad({
    id: "ep2",
    tekst: "EasyPark AS",
    dato: "2026-09-11",
    belopOre: -8000,
    hendelseId: "h2",
    kvittering: "koblet",
    fordelinger: [
      {
        plasseringId: "p",
        plasseringType: "budget",
        postTekst: "Kostnad → Bil / Parkering",
        belopOre: 6000,
        eiere: [
          { person: "Helen", prosent: 50 },
          { person: "Eivind", prosent: 50 },
        ],
      },
      {
        plasseringId: "q",
        plasseringType: "budget",
        postTekst: "Kostnad → Annet",
        belopOre: 2000,
        eiere: [{ person: "Eivind", prosent: 100 }],
      },
    ],
    eiere: ["Helen", "Eivind"],
  }),
  rad({
    id: "lonn",
    tekst: "LØNN",
    dato: "2026-08-25",
    belopOre: 3000000,
    kategori: "uferdig",
    statusTekst: "Uferdig – ikke behandlet",
    hendelseId: null,
    kanKorrigeres: false,
  }),
];

function Vert({
  kanBehandle = true,
  onKorriger = vi.fn(),
  onKvalitetssikring,
  liste = rader,
}: {
  kanBehandle?: boolean;
  onKorriger?: (id: string) => void;
  onKvalitetssikring?: (r: KontrollRad, k: boolean) => Promise<void>;
  liste?: KontrollRad[];
}) {
  const [filter, setFilter] = useState<KontrollFilter>(TOMT_FILTER);
  const [sortering, setSortering] = useState<Sortering>(STANDARD_SORTERING);
  return (
    <KontrollOversikt
      rader={liste}
      maaneder={[
        { id: "alle", label: "Alle måneder" },
        { id: "2026-09", label: "september 2026" },
      ]}
      filter={filter}
      onFilter={setFilter}
      sortering={sortering}
      onSortering={setSortering}
      kanBehandle={kanBehandle}
      onKorriger={onKorriger}
      onKvalitetssikring={onKvalitetssikring}
    />
  );
}

/** Teksten per rad, uavhengig av layout: dato, tekst, beløp og eiere. */
function radTekster(): string[] {
  const tabell = screen.queryByRole("table");
  // Tabell: én <tbody> per transaksjon (underrader per splitt). Kort: én .rad.
  const elementer = tabell
    ? [...tabell.querySelectorAll("tbody")]
    : [...document.querySelectorAll("[class*='_rad_']")];
  return elementer.map((e) => e.textContent!.replace(/\s+/g, " "));
}

describe("KontrollOversikt", () => {
  it("bred flate: semantisk tabell med kolonner, øre, år og eierfordeling per splitt", () => {
    bred = true;
    render(<Vert />);
    const tabell = screen.getByRole("table");
    expect(
      within(tabell)
        .getAllByRole("columnheader")
        .map((c) => c.textContent),
    ).toEqual([
      "Dato▼",
      "Tekst",
      "Konto",
      "Beløp",
      "Post",
      "Kostnadseier",
      "Status",
      "Kontroll",
      "Handling",
    ]);
    expect(within(tabell).getByRole("columnheader", { name: /Dato/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    const [forste, andre] = [...tabell.querySelectorAll("tbody")];
    expect(forste).toHaveTextContent("12.09.2026");
    expect(forste).toHaveTextContent(/-123,45 kr/);
    expect(forste).toHaveTextContent("helen");
    expect(forste).toHaveTextContent("Felles");
    // Splitt: post og kostnadseier for SAMME fordeling står i samme <tr>.
    const underrader = within(andre as HTMLElement).getAllByRole("row");
    expect(underrader).toHaveLength(2);
    expect(underrader[0]).toHaveTextContent(/Kostnad → Bil \/ Parkering · \+60,00 kr/);
    expect(underrader[0]).toHaveTextContent("Helen 50 %, Eivind 50 %");
    expect(underrader[1]).toHaveTextContent(/Kostnad → Annet · \+20,00 kr/);
    expect(underrader[1]).toHaveTextContent("Eivind");
    expect(underrader[1]).not.toHaveTextContent("Helen");
    // Transaksjonsfeltene står én gang og spenner over underradene.
    expect(within(underrader[0]!).getByText("11.09.2026")).toHaveAttribute("rowspan", "2");
    expect(within(underrader[1]!).queryByText("11.09.2026")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Sorter" })).not.toBeInTheDocument();
  });

  it("smal flate: kort med samme data, i samme rekkefølge", async () => {
    bred = true;
    const { unmount } = render(<Vert />);
    const tabellRader = radTekster();
    unmount();
    bred = false;
    render(<Vert />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const kort = radTekster();
    expect(kort).toHaveLength(tabellRader.length);
    for (const [i, tekst] of ["12.09.2026", "11.09.2026", "25.08.2026"].entries()) {
      expect(tabellRader[i]).toContain(tekst);
      expect(kort[i]).toContain(tekst);
    }
    for (const del of ["-123,45 kr", "Helen 50 %, Eivind 50 %", "+30 000,00 kr"]) {
      const norm = (s: string) => s.replace(/\s/g, " ");
      expect(tabellRader.some((x) => norm(x).includes(norm(del)))).toBe(true);
      expect(kort.some((x) => norm(x).includes(norm(del)))).toBe(true);
    }
  });

  it("kombinerte filtre og sum med fortegn; filter og sortering overlever layoutbytte", async () => {
    const user = userEvent.setup();
    bred = true;
    render(<Vert />);
    await user.type(screen.getByRole("searchbox", { name: "Søk i tekst" }), "easypark");
    await user.selectOptions(screen.getByRole("combobox", { name: "Kostnadseier" }), "Eivind");
    expect(screen.getByText("1 av 3 transaksjoner")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/netto -80,00 kr/);

    await user.click(screen.getByRole("button", { name: /Beløp/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Kostnadseier" }), "alle");
    expect(screen.getByRole("columnheader", { name: /Beløp/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(radTekster()[0]).toContain("EASYPARK");

    settBred(false);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Søk i tekst" })).toHaveValue("easypark");
    expect(screen.getByText("2 av 3 transaksjoner")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sorter" })).toHaveValue("belop-opp");
    // Mobil: de sjeldnere filtrene er samlet, og åpne fordi sorteringen er i bruk.
    expect(
      screen.getByText("Flere filtre og sortering (i bruk)").closest("details"),
    ).toHaveAttribute("open");
    expect(screen.getByRole("status")).toHaveTextContent(/ut -203,45 kr · netto -203,45 kr/);
  });

  it("tastatur: sorteringsknappene nås i kolonnerekkefølge og bytter retning", async () => {
    const user = userEvent.setup();
    bred = true;
    render(<Vert />);
    const dato = screen.getByRole("button", { name: /Dato/ });
    dato.focus();
    await user.tab();
    expect(screen.getByRole("button", { name: /Tekst/ })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("columnheader", { name: /Tekst/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    await user.keyboard("{Enter}");
    expect(screen.getByRole("columnheader", { name: /Tekst/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("«Korriger kobling» åpner riktig hendelse, bare når skriving er på og raden har hendelse", async () => {
    const user = userEvent.setup();
    const onKorriger = vi.fn();
    bred = true;
    const { unmount } = render(<Vert onKorriger={onKorriger} />);
    expect(screen.getAllByRole("button", { name: /Korriger kobling/ })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Korriger kobling EasyPark AS" }));
    expect(onKorriger).toHaveBeenCalledWith("h2");
    unmount();

    render(<Vert kanBehandle={false} />);
    expect(screen.queryByRole("button", { name: /Korriger kobling/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Handling" })).not.toBeInTheDocument();
  });

  it("tomt utvalg", async () => {
    const user = userEvent.setup();
    render(<Vert />);
    await user.type(screen.getByRole("searchbox", { name: "Søk i tekst" }), "zzz");
    expect(screen.getByText("Ingen transaksjoner matcher filtrene.")).toBeInTheDocument();
    expect(screen.getByText("0 av 3 transaksjoner")).toBeInTheDocument();
  });
});

describe("KontrollOversikt — kvalitetssikret (#59, 6542594363)", () => {
  const merke = {
    grunnlag: "g1",
    versjon: 1,
    tid: "2026-10-31T11:00:00Z",
    av: "u",
    avNavn: "Helen",
  };
  const kontrollerte = rader.map((r) =>
    r.id === "ep1"
      ? { ...r, kontroll: { status: "kvalitetssikret" as const, grunnlag: "g1", gjeldende: merke } }
      : r.id === "ep2"
        ? {
            ...r,
            kontroll: {
              status: "endret_etter_kontroll" as const,
              grunnlag: "g2",
              gjeldende: merke,
            },
          }
        : r,
  );

  it.each([true, false])(
    "status vises adskilt fra behandlingsstatus, med hvem/når (bred=%s)",
    (b) => {
      bred = b;
      render(<Vert liste={kontrollerte} onKvalitetssikring={vi.fn()} />);
      const tekster = radTekster();
      expect(tekster[0]).toMatch(/Ferdig.*Kvalitetssikret · av Helen 31\.10\.2026/);
      expect(tekster[1]).toMatch(/Ferdig.*Endret etter kontroll · kontrollert Helen 31\.10\.2026/);
      expect(tekster[2]).toMatch(/Ikke kontrollert/);
    },
  );

  it("filter på kontrollstatus gir restlisten", async () => {
    const user = userEvent.setup();
    render(<Vert liste={kontrollerte} onKvalitetssikring={vi.fn()} />);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Kontroll" }),
      "ikke_kontrollert",
    );
    expect(screen.getByText("1 av 3 transaksjoner")).toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Kontroll" }),
      "endret_etter_kontroll",
    );
    expect(radTekster()).toHaveLength(1);
    expect(radTekster()[0]).toContain("EasyPark AS");
  });

  it("riktige handlinger per status; OK vises først etter bekreftet lagring", async () => {
    const user = userEvent.setup();
    bred = true;
    let fullfor!: () => void;
    const onK = vi.fn(() => new Promise<void>((r) => (fullfor = r)));
    render(<Vert liste={kontrollerte} onKvalitetssikring={onK} />);
    expect(screen.getByRole("button", { name: "Merk som kvalitetssikret: LØNN" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Opphev kvalitetssikring: EASYPARK" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Kvalitetssikre på nytt: EasyPark AS" }),
    ).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Merk som kvalitetssikret: EASYPARK" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Merk som kvalitetssikret: LØNN" }));
    expect(onK).toHaveBeenCalledWith(expect.objectContaining({ id: "lonn" }), true);
    // Under lagring: knappen er låst, og raden er fortsatt «Ikke kontrollert».
    const knapp = screen.getByRole("button", { name: "Merk som kvalitetssikret: LØNN" });
    expect(knapp).toBeDisabled();
    expect(knapp).toHaveTextContent("Lagrer…");
    expect(radTekster()[2]).toContain("Ikke kontrollert");
    await act(async () => fullfor());
    expect(screen.getByRole("button", { name: "Merk som kvalitetssikret: LØNN" })).toBeEnabled();
  });

  it("lagringsfeil og samtidig endring vises ærlig, uten grønn status", async () => {
    const user = userEvent.setup();
    bred = true;
    const feil = Object.assign(
      new Error("Kontrollen ble endret et annet sted. Se gjennom raden på nytt."),
      {
        name: "KontrollEndretAvAndre",
      },
    );
    const onK = vi
      .fn()
      .mockRejectedValueOnce(feil)
      .mockRejectedValueOnce(new Error("permission_denied"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Vert liste={kontrollerte} onKvalitetssikring={onK} />);
    await user.click(screen.getByRole("button", { name: "Merk som kvalitetssikret: LØNN" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("endret et annet sted");
    await user.click(screen.getByRole("button", { name: "Merk som kvalitetssikret: LØNN" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ble ikke lagret");
    expect(radTekster()[2]).toContain("Ikke kontrollert");
  });

  it("uten skrivetilgang vises status, men ingen handling", () => {
    bred = true;
    render(<Vert liste={kontrollerte} />);
    expect(screen.queryByRole("button", { name: /kvalitetssikr|Opphev/i })).toBeNull();
    expect(radTekster()[0]).toContain("Kvalitetssikret");
  });
});
