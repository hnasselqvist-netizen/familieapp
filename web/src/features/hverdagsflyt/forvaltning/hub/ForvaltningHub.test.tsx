import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { Okonomibilde } from "@domain/budsjettfamilie/okonomi";
import type { Oppmerksomhet } from "@domain/forsoning/oppmerksomhet";
import type { SpilleromOversikt } from "@domain/liquidity/oversikt";
import { ForvaltningHub } from "./ForvaltningHub";
import { ForvaltningOversiktView } from "./ForvaltningOversiktView";
import { beregnRunde } from "@domain/lonnsdagsrunde/lonnsdagsrunde";

const gate = vi.hoisted(() => ({ aktiv: false }));
vi.mock("@hooks/forsoningAktivering", () => ({ forsoningSkrivingAktiv: () => gate.aktiv }));
vi.mock("@hooks/useForvaltningOversikt", () => ({
  useForvaltningOversikt: () => ({ status: "loading", data: undefined, error: undefined }),
}));

const spillerom: SpilleromOversikt = {
  saldo: 52000,
  harSaldo: true,
  harPoster: true,
  bundet: 31000,
  innbetalinger: 0,
  utbetalinger: 31000,
  spillerom: 21000,
  muligheter: [],
};

const ingenting: Oppmerksomhet = {
  transaksjonerAVurdere: 0,
  forslagTilMatch: 0,
  kvitteringer: 0,
  kvitteringerMedForslag: 0,
  paaVent: 0,
  antallHandlinger: 0,
};

const okonomi: Okonomibilde = {
  inntekter: {
    budsjett: 75000,
    faktisk: 40000,
    grupper: [{ id: "lonn", label: "Lønn", budsjett: 75000, faktisk: 40000 }],
  },
  kostnader: {
    budsjett: 26000,
    faktisk: 21100,
    grupper: [
      { id: "bolig", label: "Bolig", budsjett: 17000, faktisk: 16800 },
      { id: "mat", label: "Mat", budsjett: 9000, faktisk: 4300 },
    ],
  },
  sparing: { budsjett: 2500, faktisk: 2500, grupper: [] },
  igjen: { budsjett: 46500, faktisk: 16400 },
};

const vis = (o: Partial<Oppmerksomhet> = {}, s: SpilleromOversikt = spillerom) =>
  render(
    <MemoryRouter>
      <ForvaltningOversiktView
        spillerom={s}
        oppmerksomhet={{ ...ingenting, ...o }}
        okonomi={okonomi}
        month={9}
      />
    </MemoryRouter>,
  );

const tall = (tekst: string) => tekst.replace(/\s/g, " ");

describe("ForvaltningHub", () => {
  it("porten av (rollback): uendret bro til dagens app", () => {
    gate.aktiv = false;
    render(
      <MemoryRouter>
        <ForvaltningHub />
      </MemoryRouter>,
    );
    expect(screen.getByText(/er ikke migrert til den nye grunnmuren ennå/)).toBeInTheDocument();
  });

  it("porten på: forsiden, ikke modulmenyen", () => {
    gate.aktiv = true;
    render(
      <MemoryRouter>
        <ForvaltningHub />
      </MemoryRouter>,
    );
    expect(screen.getByText("Laster…")).toBeInTheDocument();
    expect(screen.queryByText(/ikke migrert/)).toBeNull();
  });
});

describe("ForvaltningOversiktView — handlingsflate", () => {
  it("Spillerom øverst som situasjonsbilde, med vei til detaljene", () => {
    vis();
    const kort = screen.getByRole("link", { name: "Spillerom, se detaljer" });
    expect(kort).toHaveAttribute("href", "/forvaltning/spillerom");
    expect(tall(kort.textContent ?? "")).toContain("21 000");
    expect(tall(kort.textContent ?? "")).toContain("Disponibelt 52 000 kr · ut 31 000 kr");
  });

  it("Spillerom-kortet viser inn og ut hver for seg, aldri en negativ «bundet»", () => {
    vis({}, { ...spillerom, innbetalinger: 38000, utbetalinger: 17200, bundet: -20800 });
    const kort = screen.getByRole("link", { name: "Spillerom, se detaljer" });
    expect(tall(kort.textContent ?? "")).toContain(
      "Disponibelt 52 000 kr · inn 38 000 kr · ut 17 200 kr",
    );
    expect(kort.textContent).not.toMatch(/bundet/);
  });

  it("uten saldo: inviterer til å sette den i stedet for å vise et tall", () => {
    vis({}, { ...spillerom, harSaldo: false, saldo: 0 });
    expect(screen.getByText("Sett disponibelt beløp for å se spillerommet.")).toBeInTheDocument();
  });

  it("ingenting å gjøre: én rolig linje, ingen køliste", () => {
    vis();
    const seksjon = screen.getByRole("region", { name: "Trenger oppmerksomhet" });
    expect(within(seksjon).getByText("Ingenting venter på deg.")).toBeInTheDocument();
    expect(within(seksjon).queryByRole("heading")).toBeNull();
    expect(within(seksjon).queryAllByRole("link")).toHaveLength(0);
  });

  it("viser bare køer med noe i, med direkte inngang til riktig kø", () => {
    vis({
      transaksjonerAVurdere: 3,
      forslagTilMatch: 0,
      kvitteringer: 2,
      kvitteringerMedForslag: 1,
      paaVent: 1,
      antallHandlinger: 5,
    });
    const seksjon = screen.getByRole("region", { name: "Trenger oppmerksomhet" });
    const lenker = within(seksjon).getAllByRole("link");
    expect(lenker.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["3 transaksjoner å vurdere", "/forvaltning/transaksjoner?ko=vurdering"],
      ["2 kvitteringer å behandle1 med forslag klart", "/forvaltning/kvitteringer"],
      ["1 transaksjon på vent", "/forvaltning/transaksjoner?ko=paavent"],
    ]);
    expect(within(seksjon).queryByText(/forslag å bekrefte/)).toBeNull();
  });

  it("forslag til match får egen inngang til forslagskøen", () => {
    vis({ forslagTilMatch: 1, antallHandlinger: 1 });
    expect(screen.getByRole("link", { name: "1 forslag å bekrefte" })).toHaveAttribute(
      "href",
      "/forvaltning/transaksjoner?ko=forslag",
    );
  });

  it("økonomien som ett bilde: inntekter, kostnader, sparing og netto for samme måned", async () => {
    const user = userEvent.setup();
    vis();
    const seksjon = screen.getByRole("region", { name: "Økonomien i oktober" });
    const rader = within(seksjon).getAllByRole("button");
    expect(rader.map((r) => tall(r.textContent ?? ""))).toEqual([
      "Inntekter40 000 kr75 000 kr",
      "Kostnader21 100 kr26 000 kr",
      "Sparing2 500 kr2 500 kr",
    ]);
    expect(tall(seksjon.textContent ?? "")).toContain("Netto16 400 kr46 500 kr");

    // Gruppesummer ved behov, og vei til detaljene.
    expect(within(seksjon).queryByText("Bolig")).toBeNull();
    await user.click(rader[1]!);
    expect(rader[1]).toHaveAttribute("aria-expanded", "true");
    expect(within(seksjon).getByText("Bolig")).toBeInTheDocument();
    expect(within(seksjon).getByText("Mat")).toBeInTheDocument();
    expect(within(seksjon).getByRole("link", { name: "Åpne kostnader →" })).toHaveAttribute(
      "href",
      "/forvaltning/okonomi?omrade=kostnader",
    );
  });

  it("Regelsenter og Årsbudsjett ligger som rolig oppsett, ikke i hovedflaten", () => {
    vis();
    const oppsett = screen.getByRole("navigation", { name: "Oppsett" });
    expect(
      within(oppsett)
        .getAllByRole("link")
        .map((a) => a.getAttribute("href")),
    ).toEqual(["/forvaltning/regelsenter", "/forvaltning/arsbudsjett"]);
    // Den gamle 8-radersmenyen finnes ikke lenger.
    expect(screen.queryByRole("navigation", { name: "Forvaltning" })).toBeNull();
  });
});

describe("ForvaltningOversiktView — Lønnsdagsrunden", () => {
  const runde = (gjenstar: number) =>
    beregnRunde(
      {
        lonnDay: 20,
        sisteImport: gjenstar > 0 ? null : "2026-09-22",
        aVurdere: 0,
        kvitteringer: 0,
        saldoOppdatert: new Date(2026, 8, 21).getTime(),
        prognosedatoPassert: false,
        trengerAvklaring: 0,
      },
      new Date(2026, 9, 7),
    );

  const visMedRunde = (r: ReturnType<typeof runde>) =>
    render(
      <MemoryRouter>
        <ForvaltningOversiktView
          spillerom={spillerom}
          oppmerksomhet={ingenting}
          okonomi={okonomi}
          month={9}
          runde={r}
        />
      </MemoryRouter>,
    );

  it("viser fremdrift og neste steg, med inngang til runden", () => {
    visMedRunde(runde(1));
    const kort = screen.getByRole("region", { name: "Lønnsdagsrunden" });
    const lenke = within(kort).getByRole("link");
    expect(lenke).toHaveAttribute("href", "/forvaltning/runde");
    expect(lenke).toHaveTextContent("3 av 4 steg gjort · Neste: importer bankfilen");
  });

  it("ferdig runde krymper til én rolig linje", () => {
    visMedRunde(runde(0));
    expect(screen.queryByRole("region", { name: "Lønnsdagsrunden" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Lønnsdagsrunden er ferdig for denne perioden." }),
    ).toHaveAttribute("href", "/forvaltning/runde");
  });
});

describe("ForvaltningOversiktView — saldoavstemming (#59)", () => {
  it("én rolig linje for forrige kalendermåned, med vei til avstemmingen", () => {
    render(
      <MemoryRouter>
        <ForvaltningOversiktView
          spillerom={spillerom}
          oppmerksomhet={ingenting}
          okonomi={okonomi}
          month={9}
          maanedskontroll={{ maaned: "2026-09", avstemte: 2, totalt: 4, avvik: 1, usikre: 0 }}
        />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole("link", {
        name: "Månedskontroll september: 2 av 4 kontoer avstemt · 1 med avvik",
      }),
    ).toHaveAttribute("href", "/forvaltning/avstemming");
  });
});
