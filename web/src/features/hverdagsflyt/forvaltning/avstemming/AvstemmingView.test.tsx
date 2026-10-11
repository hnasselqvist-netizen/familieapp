import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { TransaksjonRecord } from "@app-types/forsoning";
import { avstemmingsoversikt, sisteDagIMaaned } from "@domain/avstemming/saldoavstemming";
import { merkSomDublett } from "@domain/avstemming/saldokorrigering";
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

function vis(
  transaksjoner: TransaksjonRecord[],
  kontroller: SaldoKontroll[],
  omfang: number | { fra: string } = 3,
  onVisTidligereAar?: () => void,
) {
  const onLagre = vi.fn().mockResolvedValue(undefined);
  const onAvklarIgnorert = vi.fn().mockResolvedValue(undefined);
  const korrigering = {
    merkDublett: vi.fn().mockResolvedValue(undefined),
    angreDublett: vi.fn().mockResolvedValue(undefined),
    omklassifiser: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <MemoryRouter>
      <AvstemmingView
        oversikt={avstemmingsoversikt(transaksjoner, kontroller, IDAG, omfang)}
        onLagre={onLagre}
        onAvklarIgnorert={onAvklarIgnorert}
        transaksjoner={transaksjoner}
        korrigering={korrigering}
        onVisTidligereAar={onVisTidligereAar}
      />
    </MemoryRouter>,
  );
  return { onLagre, onAvklarIgnorert, korrigering, user: userEvent.setup() };
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
    const matrise = screen.getByRole("table", { name: "Status per konto og måned i 2026" });
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
    const matrise = screen.getByRole("table", { name: "Status per konto og måned i 2026" });
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

  it("+26 000 (6097079190): mulig dublett som er intern overføring krever valg for motposten", async () => {
    const intern = (o: Partial<TransaksjonRecord>) =>
      tx({
        dato: "2026-09-07",
        belop: 26000,
        retning: "inn",
        konto: "regningskonto",
        status: "behandlet",
        behandlingstype: "intern_overforing",
        ...o,
      });
    const { korrigering, user } = vis(
      [
        intern({ id: "a1", tekst: "Avtale", motpartTransaksjonId: "f1" }),
        intern({
          id: "f1",
          tekst: "Avtale",
          konto: "Felleskonto",
          retning: "ut",
          motpartTransaksjonId: "a1",
        }),
        intern({ id: "a2", tekst: "Til betaling regninger og mat", motpartTransaksjonId: "f2" }),
        intern({
          id: "f2",
          tekst: "Til betaling regninger og mat",
          konto: "Felleskonto",
          retning: "ut",
          motpartTransaksjonId: "a2",
        }),
      ],
      [
        kontroll("regningskonto", "2026-08", 17096.55),
        kontroll("regningskonto", "2026-09", 43096.55),
      ],
    );
    const k = kort("Regningskonto");
    expect(within(k).getByText("Avvik")).toBeInTheDocument();
    expect(within(k).getByRole("status")).toHaveTextContent(
      "26 000,00 kr mindre i banken enn beregnet",
    );
    await user.click(
      within(k).getByRole("button", {
        name: /Marker Til betaling regninger og mat .* som dublett/,
      }),
    );
    const panel = within(k).getByRole("group", {
      name: /Marker Til betaling regninger og mat .* som dublett/,
    });
    expect(panel).toHaveTextContent(
      "Motpost: 7. sep · Til betaling regninger og mat · −26 000,00 kr · Felleskonto",
    );
    const bekreft = within(panel).getByRole("button", { name: "Bekreft: marker som dublett" });
    expect(bekreft).toBeDisabled();
    await user.click(within(panel).getByLabelText(/Motposten er ekte/));
    await user.click(bekreft);
    expect(korrigering.merkDublett).toHaveBeenCalledWith("a2", "frakoble");
  });

  it("plassert transaksjon kan ikke merkes som dublett herfra, med forklaring", async () => {
    const { korrigering, user } = vis(
      [
        tx({ id: "p1", belop: 50, hendelseId: "h1", status: "behandlet" }),
        tx({ id: "p2", belop: 50 }),
      ],
      [kontroll("felleskonto", "2026-08", 1000), kontroll("felleskonto", "2026-09", 950)],
    );
    const k = kort("Felleskonto");
    await user.click(
      within(k).getAllByRole("button", { name: /Marker REMA 1000 .* som dublett/ })[0]!,
    );
    expect(
      within(k).getByRole("group", { name: /Marker REMA 1000 .* som dublett/ }),
    ).toHaveTextContent("plassert i budsjettet");
    expect(korrigering.merkDublett).not.toHaveBeenCalled();
  });

  it("feilmerket dublett (6097180478) vises under «Holdt utenfor» og blir ekte bevegelse med ett klikk", async () => {
    const { korrigering, user } = vis(
      [
        tx({
          id: "j1",
          tekst: "DNB BANK ASA",
          belop: 25000,
          status: "ignorert",
          ignorertSom: "dublett",
        }),
      ],
      [kontroll("felleskonto", "2026-08", 1000), kontroll("felleskonto", "2026-09", -24000)],
    );
    const k = kort("Felleskonto");
    const holdt = within(k).getByRole("group", { name: "Holdt utenfor som dublett i september" });
    expect(holdt).toHaveTextContent("DNB BANK ASA");
    await user.click(
      within(holdt).getByRole("button", { name: /er ikke en dublett, men en ekte bankbevegelse/ }),
    );
    expect(korrigering.omklassifiser).toHaveBeenCalledWith("j1", "bankbevegelse");
  });

  it("aktiv dublett-merking angres med bekreftelse som viser hva den blir igjen", async () => {
    const { korrigering, user } = vis(
      [
        tx({
          id: "a2",
          belop: 26000,
          retning: "inn",
          status: "ignorert",
          ignorertSom: "dublett",
          saldoKorrigering: {
            type: "dublett",
            tidligere: {
              status: "behandlet",
              behandlingstype: "intern_overforing",
              motpartTransaksjonId: null,
              ignorertSom: null,
            },
            etter: {
              status: "ignorert",
              behandlingstype: null,
              motpartTransaksjonId: null,
              ignorertSom: "dublett",
              hendelseId: null,
              matchetMot: null,
            },
            arsakId: null,
            tidspunkt: "2026-10-10T12:00:00Z",
          },
        }),
      ],
      [kontroll("felleskonto", "2026-08", 1000), kontroll("felleskonto", "2026-09", 1000)],
    );
    const k = kort("Felleskonto");
    expect(within(k).getByText("Avstemt")).toBeInTheDocument();
    await user.click(within(k).getByRole("button", { name: /: ikke dublett$/ }));
    const panel = within(k).getByRole("group", { name: /: ikke dublett$/ });
    expect(panel).toHaveTextContent("Blir intern overføring igjen og teller i saldoen.");
    await user.click(within(panel).getByRole("button", { name: "Bekreft: ikke dublett" }));
    expect(korrigering.angreDublett).toHaveBeenCalledWith("a2");
  });

  it("review #71 (risiko 3): angring tilbys ikke når motposten er endret siden merkingen", async () => {
    const intern = (o: Partial<TransaksjonRecord>) =>
      tx({
        dato: "2026-09-07",
        belop: 26000,
        retning: "inn",
        status: "behandlet",
        behandlingstype: "intern_overforing",
        ...o,
      });
    const merket = merkSomDublett(
      "a2",
      "frakoble",
      "2026-10-10T12:00:00Z",
    )([
      intern({ id: "a2", tekst: "Til betaling", motpartTransaksjonId: "f2" }),
      intern({
        id: "f2",
        tekst: "Til betaling",
        konto: "Regningskonto",
        retning: "ut",
        motpartTransaksjonId: "a2",
      }),
    ]);
    // Motposten plasseres i budsjettet etter merkingen.
    const endret = merket.map((t) => (t.id === "f2" ? { ...t, hendelseId: "h1" } : t));
    const { korrigering, user } = vis(endret, []);
    const k = kort("Felleskonto");
    await user.click(within(k).getByRole("button", { name: /Til betaling .*: ikke dublett$/ }));
    const panel = within(k).getByRole("group", { name: /Til betaling .*: ikke dublett$/ });
    expect(panel).toHaveTextContent("Motposten er endret siden merkingen");
    expect(within(panel).queryByRole("button", { name: "Bekreft: ikke dublett" })).toBeNull();
    expect(korrigering.angreDublett).not.toHaveBeenCalled();
  });

  it("historiske måneder (6097132388): årsvalg, januar 2026 med startsaldo 31.12.2025, senere måneder fortsatt tilgjengelige", async () => {
    const visTidligere = vi.fn();
    const { onLagre, user } = vis(
      [tx({ dato: "2026-01-15", belop: 500 }), tx({ dato: "2025-11-20", belop: 10 })],
      [kontroll("felleskonto", "2026-08", 1000), kontroll("felleskonto", "2026-09", 900)],
      { fra: "2025-11" },
      visTidligere,
    );
    const aar = screen.getByRole("navigation", { name: "Velg år" });
    expect(within(aar).getByRole("button", { name: "2026" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Året før: november og desember 2025 i egen matrise.
    await user.click(within(aar).getByRole("button", { name: "2025" }));
    const m2025 = screen.getByRole("table", { name: "Status per konto og måned i 2025" });
    expect(
      within(m2025)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["nov", "des"]);
    expect(screen.getByRole("heading", { name: "desember 2025" })).toBeInTheDocument();
    // Januar 2026: startsaldo registreres for 31.12.2025 — ingen oppdiktet transaksjon.
    await user.click(within(aar).getByRole("button", { name: "2026" }));
    await user.click(screen.getByRole("button", { name: "januar 2026" }));
    const k = kort("Felleskonto");
    await user.type(within(k).getByLabelText("Saldo 31. des (startpunkt)"), "8000");
    await user.click(within(k).getAllByRole("button", { name: "Lagre" })[0]!);
    expect(onLagre).toHaveBeenCalledWith("felleskonto", "2025-12", 8000);
    // Senere måneders kontroll er urørt og tilgjengelig.
    const m2026 = screen.getByRole("table", { name: "Status per konto og måned i 2026" });
    expect(within(m2026).getAllByRole("button")).toHaveLength(9);
    expect(within(m2026).getByText("Felleskonto september 2026: Avvik")).toBeInTheDocument();
    // Lenger bakover ved behov.
    await user.click(within(aar).getByRole("button", { name: "Vis 2024" }));
    expect(visTidligere).toHaveBeenCalled();
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
