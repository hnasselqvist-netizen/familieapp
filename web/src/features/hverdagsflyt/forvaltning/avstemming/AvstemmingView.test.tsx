import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { TransaksjonRecord } from "@app-types/forsoning";
import { avstemmingsoversikt, sisteDagIMaaned } from "@domain/avstemming/saldoavstemming";
import {
  kildeavtrykk,
  leggTilForventetMotpost,
  merkSomDublett,
} from "@domain/avstemming/saldokorrigering";
import { AvstemmingView } from "./AvstemmingView";
import { differanseTekst, maanedskontrollTekst, parseSaldo } from "./avstemmingTekst";

/** Slik UI-en bekrefter: mot kilden slik den vises (ferske data). */
const leggTil =
  (id: string, konto: string, dato: string, naa: string) =>
  (prev: TransaksjonRecord[]): TransaksjonRecord[] => {
    const t = prev.find((x) => x.id === id);
    return t ? leggTilForventetMotpost(id, konto, dato, naa, kildeavtrykk(t))(prev) : prev;
  };

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
    leggTilMotpost: vi.fn().mockResolvedValue(undefined),
    angreMotpost: vi.fn().mockResolvedValue(undefined),
    avsluttMotpost: vi.fn().mockResolvedValue(undefined),
    bekreftMotpostPaaNytt: vi.fn().mockResolvedValue(undefined),
    kobleImportert: vi.fn().mockResolvedValue(undefined),
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

  describe("motposten mangler (6097196546)", () => {
    const kilde = () =>
      tx({
        id: "r1",
        dato: "2026-09-20",
        tekst: "DNB BANK ASA",
        belop: 25000,
        konto: "regningskonto",
        status: "ignorert",
        ignorertSom: "dublett",
      });
    const kontroller = [
      kontroll("regningskonto", "2026-08", 60000),
      kontroll("regningskonto", "2026-09", 35000),
      kontroll("MC", "2026-08", -40000),
      kontroll("MC", "2026-09", -15000),
    ];

    it("fra «Holdt utenfor»: velg motkonto og dato, se retning og beløp, og bekreft", async () => {
      const { korrigering, user } = vis([kilde()], kontroller);
      const holdt = within(kort("Regningskonto")).getByRole("group", {
        name: "Holdt utenfor som dublett i september",
      });
      await user.click(
        within(holdt).getByRole("button", {
          name: "DNB BANK ASA 20. sep: intern overføring, motposten mangler",
        }),
      );
      const panel = within(holdt).getByRole("group", {
        name: "DNB BANK ASA 20. sep: intern overføring, motposten mangler",
      });
      const bekreft = within(panel).getByRole("button", {
        name: "Bekreft: intern overføring med avledet motpost",
      });
      expect(bekreft).toBeDisabled();
      const motkonto = within(panel).getByLabelText("Motkonto");
      expect(within(motkonto).queryByRole("option", { name: "Regningskonto" })).toBeNull();
      await user.selectOptions(motkonto, "MC");
      const tekst = panel.textContent?.replace(/\u00a0/g, " ");
      expect(tekst).toContain("Overføring Regningskonto → MC, 25 000,00 kr, 20. sep.");
      expect(tekst).toContain("Den teller da som ekte bevegelse på Regningskonto.");
      expect(tekst).toContain("Motposten er ikke bankimportert.");
      expect(within(panel).getByLabelText("Dato på motkontoen")).toHaveValue("2026-09-20");
      await user.click(bekreft);
      expect(korrigering.leggTilMotpost).toHaveBeenCalledWith("r1", "MC", "2026-09-20", {
        belopOre: 2_500_000,
        retning: "ut",
        konto: "regningskonto",
        dato: "2026-09-20",
      });
    });

    it("MC: «Stemmer med avledet motpost», aldri «Avstemt», med sporbar kilde", () => {
      const l = leggTil("r1", "MC", "2026-09-20", "2026-10-10T12:00:00Z")([kilde()]);
      vis(l, kontroller);
      const mc = kort("MC");
      expect(within(mc).getByText("Stemmer med avledet motpost")).toBeInTheDocument();
      expect(within(mc).queryByText("Avstemt")).toBeNull();
      expect(
        within(mc).getByText("≈ Avledet motpost, ikke bankimportert (1)").nextSibling,
      ).toHaveTextContent("25 000,00 kr");
      expect(within(mc).getByRole("status")).toHaveTextContent(
        /ikke bankverifisert avstemt før de ekte motpostene er importert og koblet/,
      );
      const avledede = within(mc).getByRole("group", { name: "Avledede motposter i september" });
      expect(avledede.textContent?.replace(/\u00a0/g, " ")).toContain(
        "20. sep · +25 000,00 kr · fra Regningskonto: DNB BANK ASA 20. sep",
      );
      const matrise = screen.getByRole("table", { name: "Status per konto og måned i 2026" });
      expect(
        within(matrise).getByText("MC september 2026: Stemmer med avledet motpost"),
      ).toBeInTheDocument();
      expect(
        within(matrise).getByText("Regningskonto september 2026: Avstemt"),
      ).toBeInTheDocument();
      // Kilden kan angres fra sin egen konto.
      const uten = within(kort("Regningskonto")).getByRole("group", {
        name: "Interne overføringer uten motpost i september",
      });
      expect(uten).toHaveTextContent("intern overføring, motpost mangler · avledet på MC 20. sep");
      expect(
        within(uten).getByRole("button", { name: "DNB BANK ASA 20. sep: angre avledet motpost" }),
      ).toBeInTheDocument();
    });

    it("avledet motpost endret i Transaksjoner: vises for seg og kan bare avsluttes eksplisitt", async () => {
      const l = leggTil(
        "r1",
        "MC",
        "2026-09-20",
        "2026-10-10T12:00:00Z",
      )([kilde()]).map((t) => ({ ...t, status: "ny", behandlingstype: undefined }));
      const { korrigering, user } = vis(l, kontroller);
      const regning = kort("Regningskonto");
      expect(
        within(regning).queryByRole("group", {
          name: "Interne overføringer uten motpost i september",
        }),
      ).toBeNull();
      const endret = within(regning).getByRole("group", {
        name: "Avledet motpost endret siden i september",
      });
      expect(
        within(endret).queryByRole("button", {
          name: "DNB BANK ASA 20. sep: angre avledet motpost",
        }),
      ).toBeNull();
      await user.click(
        within(endret).getByRole("button", {
          name: "DNB BANK ASA 20. sep: avslutt avledet motpost",
        }),
      );
      const panel = within(endret).getByRole("group", {
        name: "DNB BANK ASA 20. sep: avslutt avledet motpost",
      });
      expect(panel).toHaveTextContent(/kan ikke angres/);
      expect(panel).toHaveTextContent(/forrige tilstand lagres i korrigeringsloggen/);
      await user.click(
        within(panel).getByRole("button", { name: "Bekreft: avslutt avledet motpost" }),
      );
      expect(korrigering.avsluttMotpost).toHaveBeenCalledWith("r1");
      expect(korrigering.angreMotpost).not.toHaveBeenCalled();
    });

    it("kilden endret etter bekreftelse: MC usikker uten ny effekt, og «Bekreft på nytt» mot kilden slik den er nå", async () => {
      const l = leggTil(
        "r1",
        "MC",
        "2026-09-20",
        "2026-10-10T12:00:00Z",
      )([kilde()]).map((t) => ({ ...t, belop: 25500 }));
      const { korrigering, user } = vis(l, kontroller);
      const mc = kort("MC");
      expect(within(mc).getByText("Usikker")).toBeInTheDocument();
      expect(within(mc).queryByText("Stemmer med avledet motpost")).toBeNull();
      expect(within(mc).getByRole("status")).toHaveTextContent(
        /kilden til 1 avledet motpost er endret etter at du bekreftet\. De telles ikke/,
      );
      expect(
        within(mc).getByText("? Avledet, kilden endret etter bekreftelse (1)").nextSibling,
      ).toHaveTextContent("ikke med");
      const uten = within(kort("Regningskonto")).getByRole("group", {
        name: "Interne overføringer uten motpost i september",
      });
      expect(uten).toHaveTextContent(/teller ikke: Kilden er endret etter bekreftelsen \(beløp\)/);
      await user.click(
        within(uten).getByRole("button", {
          name: "DNB BANK ASA 20. sep: bekreft avledet motpost på nytt",
        }),
      );
      const panel = within(uten).getByRole("group", {
        name: "DNB BANK ASA 20. sep: bekreft avledet motpost på nytt",
      });
      expect(panel.textContent?.replace(/\u00a0/g, " ")).toContain(
        "Overføring Regningskonto → MC, 25 500,00 kr, 20. sep.",
      );
      expect(within(panel).getByLabelText("Motkonto")).toHaveValue("MC");
      await user.click(
        within(panel).getByRole("button", { name: "Bekreft på nytt: avledet motpost" }),
      );
      expect(korrigering.bekreftMotpostPaaNytt).toHaveBeenCalledWith("r1", "MC", "2026-09-20", {
        belopOre: 2_550_000,
        retning: "ut",
        konto: "regningskonto",
        dato: "2026-09-20",
      });
    });

    it("importert kandidat: MC usikker, og «Koble som motpost» erstatter den avledede", async () => {
      const l = [
        ...leggTil("r1", "MC", "2026-09-20", "2026-10-10T12:00:00Z")([kilde()]),
        tx({
          id: "mc1",
          dato: "2026-09-21",
          tekst: "Innbetaling",
          belop: 25000,
          retning: "inn",
          konto: "MC",
        }),
      ];
      const { korrigering, user } = vis(l, kontroller);
      const mc = kort("MC");
      expect(within(mc).getByText("Usikker")).toBeInTheDocument();
      expect(within(mc).getByRole("status")).toHaveTextContent(
        /kan allerede være importert\. De telles ikke, så ingenting telles to ganger/,
      );
      await user.click(
        within(mc).getByRole("button", {
          name: "Koble Innbetaling 21. sep som motpost til DNB BANK ASA",
        }),
      );
      expect(korrigering.kobleImportert).toHaveBeenCalledWith("r1", "mc1");
    });

    it("avvik på MC foreslår kilder på andre kontoer, med MC som forhåndsvalgt motkonto", async () => {
      const { user } = vis([kilde()], kontroller);
      const mc = kort("MC");
      await user.click(within(mc).getByText("Mulige forklaringer på avviket i september"));
      expect(mc).toHaveTextContent(
        /på andre kontoer uten motpost\. Mangler en av dem motposten på MC\?/,
      );
      await user.click(
        within(mc).getByRole("button", {
          name: "DNB BANK ASA 20. sep: intern overføring, motposten mangler",
        }),
      );
      expect(within(mc).getByLabelText("Motkonto")).toHaveValue("MC");
      expect(
        within(mc).getByRole("button", { name: "Bekreft: intern overføring med avledet motpost" }),
      ).toBeEnabled();
    });
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
      maanedskontrollTekst({
        maaned: "2026-09",
        avstemte: 2,
        totalt: 4,
        avvik: 1,
        usikre: 0,
        avledet: 0,
      }),
    ).toBe("Månedskontroll september: 2 av 4 kontoer avstemt · 1 med avvik");
    expect(
      maanedskontrollTekst({
        maaned: "2026-09",
        avstemte: 1,
        totalt: 3,
        avvik: 0,
        usikre: 2,
        avledet: 0,
      }),
    ).toBe("Månedskontroll september: 1 av 3 kontoer avstemt · 2 usikre");
    expect(
      maanedskontrollTekst({
        maaned: "2026-09",
        avstemte: 3,
        totalt: 3,
        avvik: 0,
        usikre: 0,
        avledet: 0,
      }),
    ).toBe("Månedskontroll september: alle 3 kontoer avstemt");
  });
});
