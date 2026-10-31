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
}: {
  kanBehandle?: boolean;
  onKorriger?: (id: string) => void;
}) {
  const [filter, setFilter] = useState<KontrollFilter>(TOMT_FILTER);
  const [sortering, setSortering] = useState<Sortering>(STANDARD_SORTERING);
  return (
    <KontrollOversikt
      rader={rader}
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
    />
  );
}

/** Teksten per rad, uavhengig av layout: dato, tekst, beløp og eiere. */
function radTekster(): string[] {
  const tabell = screen.queryByRole("table");
  const elementer = tabell
    ? within(tabell).getAllByRole("row").slice(1)
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
    ).toEqual(["Dato▼", "Tekst", "Konto", "Beløp", "Post", "Kostnadseier", "Status", "Handling"]);
    expect(within(tabell).getByRole("columnheader", { name: /Dato/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    const [, forste, andre] = within(tabell).getAllByRole("row");
    expect(forste).toHaveTextContent("12.09.2026");
    expect(forste).toHaveTextContent(/-123,45 kr/);
    expect(forste).toHaveTextContent("helen");
    expect(forste).toHaveTextContent("Felles");
    expect(andre).toHaveTextContent("Helen 50 %, Eivind 50 %");
    expect(andre).toHaveTextContent(/Kostnad → Annet · \+20,00 kr/);
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
