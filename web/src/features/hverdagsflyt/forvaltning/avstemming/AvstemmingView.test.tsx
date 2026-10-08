import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { TransaksjonRecord } from "@app-types/forsoning";
import { avstemmingsoversikt, sisteDagIMaaned } from "@domain/avstemming/saldoavstemming";
import { AvstemmingView } from "./AvstemmingView";
import { differanseTekst, maanedskontrollTekst, parseSaldo } from "./avstemmingTekst";

/**
 * Komponenttester for saldoavstemmingen (#59). Regnestykket og statusene
 * er låst i `domain/avstemming`; her låses at skjermen viser dem riktig,
 * og at det som lagres har riktig fortegn (MC-gjeld negativ).
 */
const IDAG = new Date(2026, 9, 8);
let n = 0;
const tx = (o: Partial<TransaksjonRecord>): TransaksjonRecord => ({
  id: `t${++n}`,
  dato: "2026-09-15",
  tekst: "REMA 1000",
  belop: 100,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...o,
});
const kontroll = (konto: string, maaned: string, faktiskSaldo: number): SaldoKontroll => ({
  konto,
  maaned,
  dato: sisteDagIMaaned(maaned),
  faktiskSaldo,
  registrert: "2026-10-01T00:00:00Z",
  oppdatert: "2026-10-01T00:00:00Z",
});

function vis(transaksjoner: TransaksjonRecord[], kontroller: SaldoKontroll[]) {
  const onLagre = vi.fn().mockResolvedValue(undefined);
  const onAvklarIgnorert = vi.fn().mockResolvedValue(undefined);
  render(
    <MemoryRouter>
      <AvstemmingView
        oversikt={avstemmingsoversikt(transaksjoner, kontroller, IDAG, 3)}
        onLagre={onLagre}
        onAvklarIgnorert={onAvklarIgnorert}
      />
    </MemoryRouter>,
  );
  return { onLagre, onAvklarIgnorert, user: userEvent.setup() };
}

const kort = (navn: string) => screen.getByRole("region", { name: navn });

describe("AvstemmingView", () => {
  it("viser regnestykket og «Avstemt» når saldo 31.08 + september = faktisk 30.09", () => {
    vis(
      [tx({ belop: 42000, retning: "inn" }), tx({ belop: 2000 })],
      [kontroll("felleskonto", "2026-08", 1000), kontroll("felleskonto", "2026-09", 41000)],
    );
    const k = kort("Felleskonto");
    expect(within(k).getByText("Avstemt")).toBeInTheDocument();
    expect(within(k).getByText("Saldo 31. aug").nextSibling).toHaveTextContent("1 000,00 kr");
    expect(within(k).getByText("+ Inn i september").nextSibling).toHaveTextContent("42 000,00 kr");
    expect(within(k).getByText("− Ut i september").nextSibling).toHaveTextContent("2 000,00 kr");
    expect(within(k).getByText("= Beregnet 30. sep").nextSibling).toHaveTextContent("41 000,00 kr");
    expect(within(k).getByRole("status")).toHaveTextContent(
      "Saldoen stemmer med bevegelsene i september.",
    );
    const matrise = screen.getByRole("table", { name: "Status per konto og måned" });
    expect(within(matrise).getByText("Felleskonto september 2026: Avstemt")).toBeInTheDocument();
    expect(within(matrise).getByText("Felleskonto august 2026: Startpunkt")).toBeInTheDocument();
  });

  it("viser avvik med beløp og retning, og mulige forklaringer", () => {
    vis(
      [
        tx({ belop: 49, dato: "2026-09-10" }),
        tx({
          belop: 49,
          dato: "2026-09-10",
          tekst: "REMA 1000 OSLO",
          status: "ignorert",
          ignorertSom: "dublett",
        }),
        tx({ belop: 10, dato: "2026-09-30" }),
      ],
      [kontroll("felleskonto", "2026-08", 1000), kontroll("felleskonto", "2026-09", 951)],
    );
    const k = kort("Felleskonto");
    expect(within(k).getByText("Avvik")).toBeInTheDocument();
    expect(within(k).getByRole("status")).toHaveTextContent("10,00 kr mer i banken enn beregnet.");
    expect(k).toHaveTextContent("1 avklart som dublett, holdt utenfor");
    const forklaring = within(k).getByText("Mulige forklaringer på avviket i september");
    expect(forklaring.closest("details")).toHaveTextContent(
      "1 transaksjon (−49,00 kr) er avklart som dublett og holdt utenfor.",
    );
    expect(forklaring.closest("details")).toHaveTextContent("1 mulig dublett");
    expect(forklaring.closest("details")).toHaveTextContent("1 bevegelse ved månedsskiftet");
  });

  it("uavklarte ignorerte (6062856860): «Usikker», begge tolkninger, og Helen avklarer", async () => {
    const { onAvklarIgnorert, user } = vis(
      [tx({ belop: 100 }), tx({ id: "t-ign", belop: 49, tekst: "KAFFE OSLO", status: "ignorert" })],
      [kontroll("felleskonto", "2026-08", 1000), kontroll("felleskonto", "2026-09", 900)],
    );
    const k = kort("Felleskonto");
    expect(within(k).getByText("Usikker")).toBeInTheDocument();
    expect(within(k).queryByText("Avstemt")).toBeNull();
    expect(within(k).getByText("? Ignorert, ikke avklart (1)").nextSibling).toHaveTextContent(
      "−49,00 kr ikke med",
    );
    const status = within(k).getByRole("status");
    expect(status).toHaveTextContent("Måneden regnes ikke som avstemt før de er avklart.");
    expect(status).toHaveTextContent("Er de dubletter: ingen differanse.");
    expect(status).toHaveTextContent(
      "Er de ekte bankbevegelser: 49,00 kr mer i banken enn beregnet.",
    );
    const avklar = within(k).getByRole("group", { name: "Avklar ignorerte transaksjoner" });
    await user.click(within(avklar).getByRole("button", { name: /KAFFE OSLO .* er en dublett/ }));
    expect(onAvklarIgnorert).toHaveBeenCalledWith("t-ign", "dublett");
    await user.click(
      within(avklar).getByRole("button", { name: /KAFFE OSLO .* er en ekte bankbevegelse/ }),
    );
    expect(onAvklarIgnorert).toHaveBeenLastCalledWith("t-ign", "bankbevegelse");
    const matrise = screen.getByRole("table", { name: "Status per konto og måned" });
    expect(within(matrise).getByText("Felleskonto september 2026: Usikker")).toBeInTheDocument();
  });

  it("første saldo er et startpunkt, og forrige måneds saldo kan legges inn rett fra kortet", async () => {
    const { onLagre, user } = vis([tx({ belop: 100 })], []);
    const k = kort("Felleskonto");
    expect(within(k).getByText("Mangler saldo")).toBeInTheDocument();
    await user.type(within(k).getByLabelText("Saldo 31. aug (startpunkt)"), "12 345,67");
    await user.click(within(k).getAllByRole("button", { name: "Lagre" })[0]!);
    expect(onLagre).toHaveBeenCalledWith("felleskonto", "2026-08", 12345.67);

    await user.type(within(k).getByLabelText("Faktisk saldo 30. sep"), "-250");
    await user.click(within(k).getAllByRole("button", { name: "Lagre" })[1]!);
    expect(onLagre).toHaveBeenLastCalledWith("felleskonto", "2026-09", -250);
  });

  it("MC: «Skyldig beløp» tastes positivt og lagres som negativ saldo", async () => {
    const { onLagre, user } = vis(
      [tx({ konto: "MC", importkilde: "dnb", belop: 3000 })],
      [kontroll("MC", "2026-08", -7000)],
    );
    const k = kort("MC");
    expect(within(k).getByText("Saldo 31. aug").nextSibling).toHaveTextContent("−7 000,00 kr");
    await user.type(within(k).getByLabelText("Skyldig beløp 30. sep"), "10000");
    await user.click(within(k).getByRole("button", { name: "Lagre" }));
    expect(onLagre).toHaveBeenCalledWith("MC", "2026-09", -10000);
  });

  it("et lagret startpunkt er ikke «avstemt», og endret grunnlag forklares", () => {
    vis(
      [tx({ belop: 100 }), tx({ belop: 50 })],
      [
        {
          ...kontroll("felleskonto", "2026-09", 850),
          grunnlag: { antall: 1, nettoOre: -10_000 },
        },
      ],
    );
    const k = kort("Felleskonto");
    expect(within(k).getByText("Startpunkt")).toBeInTheDocument();
    expect(within(k).queryByText("Avstemt")).toBeNull();
    expect(within(k).getByRole("status")).toHaveTextContent(
      "Transaksjonsgrunnlaget er endret siden saldoen ble lagret (+1 transaksjon). Statusen over er regnet på nytt.",
    );
  });

  it("ugyldig tall gir en forståelig feil og lagrer ingenting", async () => {
    const { onLagre, user } = vis([tx({})], [kontroll("felleskonto", "2026-08", 1)]);
    const k = kort("Felleskonto");
    await user.type(within(k).getByLabelText("Faktisk saldo 30. sep"), "tolv");
    await user.click(within(k).getByRole("button", { name: "Lagre" }));
    expect(within(k).getByRole("alert")).toHaveTextContent("Skriv saldoen som et tall");
    expect(onLagre).not.toHaveBeenCalled();
  });

  it("måned velges i matrisen, og transaksjoner uten konto varsles", async () => {
    const { user } = vis([tx({ dato: "2026-08-10" }), tx({ dato: "2026-08-11", konto: null })], []);
    expect(screen.getByRole("heading", { name: "september 2026" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "august 2026" }));
    expect(screen.getByRole("heading", { name: "august 2026" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      "1 transaksjon i august mangler konto og kan ikke avstemmes",
    );
  });
});

describe("avstemmingstekster", () => {
  it("tolker norske tall og avviser tekst", () => {
    expect(parseSaldo("12 345,67")).toBe(12345.67);
    expect(parseSaldo("-500")).toBe(-500);
    expect(parseSaldo("1 000 kr")).toBe(1000);
    expect(parseSaldo("12,345")).toBeNull();
    expect(parseSaldo("abc")).toBeNull();
  });

  it("differanse og månedskontroll i klartekst", () => {
    expect(differanseTekst(-124_000).replace(/\u00a0/g, " ")).toBe(
      "1 240,00 kr mindre i banken enn beregnet",
    );
    expect(differanseTekst(0)).toBe("Ingen differanse");
    expect(
      maanedskontrollTekst({ maaned: "2026-09", avstemte: 2, totalt: 4, avvik: 1, usikre: 0 }),
    ).toBe("Månedskontroll september: 2 av 4 kontoer avstemt · 1 med avvik");
    expect(
      maanedskontrollTekst({ maaned: "2026-09", avstemte: 1, totalt: 3, avvik: 0, usikre: 2 }),
    ).toBe("Månedskontroll september: 1 av 3 kontoer avstemt · 2 usikre");
    expect(
      maanedskontrollTekst({ maaned: "2026-09", avstemte: 3, totalt: 3, avvik: 0, usikre: 0 }),
    ).toBe("Månedskontroll september: alle 3 kontoer avstemt");
  });
});
