/**
 * Kompakt PC-avstemming (#59, AV-1, 6572970205). Syntetiske data; status
 * utledes av den felles modellen, og alle handlinger går gjennom de samme
 * skriveveiene som mobil (her: mocks). Mobil er uendret i AV-1; paritet i
 * tall og status mellom flatene låses her.
 */
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SaldoKontroll } from "@app-types/avstemming";
import type { TransaksjonRecord } from "@app-types/forsoning";
import { avstemmingsoversikt, sisteDagIMaaned } from "@domain/avstemming/saldoavstemming";
import { BRED_FLATE } from "@hooks/useMediaQuery";
import { AvstemmingView } from "./AvstemmingView";

let bred = true;
const lyttere = new Set<() => void>();
beforeEach(() => {
  bred = true;
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

const IDAG = new Date(2026, 9, 8); // siste avsluttede måned: september 2026
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
const kontroll = (
  konto: string,
  maaned: string,
  faktiskSaldo: number,
  grunnlag?: SaldoKontroll["grunnlag"],
): SaldoKontroll => ({
  konto,
  maaned,
  dato: sisteDagIMaaned(maaned),
  faktiskSaldo,
  registrert: "2026-10-01T00:00:00Z",
  oppdatert: "2026-10-01T00:00:00Z",
  ...(grunnlag ? { grunnlag } : {}),
});

function vis(
  transaksjoner: TransaksjonRecord[],
  kontroller: SaldoKontroll[],
  fra = "2026-09",
  onLagre = vi.fn().mockResolvedValue(undefined),
) {
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
  const lag = (t: TransaksjonRecord[], k: SaldoKontroll[]) => (
    <MemoryRouter>
      <AvstemmingView
        oversikt={avstemmingsoversikt(t, k, IDAG, { fra })}
        onLagre={onLagre}
        onAvklarIgnorert={onAvklarIgnorert}
        transaksjoner={t}
        korrigering={korrigering}
      />
    </MemoryRouter>
  );
  const r = render(lag(transaksjoner, kontroller));
  return {
    onLagre,
    onAvklarIgnorert,
    korrigering,
    user: userEvent.setup(),
    oppdater: (t: TransaksjonRecord[], k: SaldoKontroll[]) => r.rerender(lag(t, k)),
  };
}

const tabell = () => screen.getByRole("table", { name: /^Kontoer i / });
const rad = (navn: string) =>
  within(tabell()).getByRole("button", { name: navn }).closest("tr") as HTMLElement;
const celler = (navn: string) =>
  within(rad(navn))
    .getAllByRole("cell")
    .map((c) => c.textContent?.replace(/\u00a0/g, " "));
const panel = (navn: string) => screen.getByRole("region", { name: navn });

describe("PC-avstemming: tabell og samlet status", () => {
  it("én rad per konto med inngående, inn, ut, beregnet, faktisk, differanse og status/handling", () => {
    vis(
      [
        tx({ dato: "2026-09-05", belop: 42000.5, retning: "inn" }),
        tx({ dato: "2026-09-12", belop: 2000.25 }),
        tx({ konto: "MC", dato: "2026-09-14", belop: 3000 }),
        tx({ konto: "MC", dato: "2026-09-20", belop: 7000, retning: "inn" }),
      ],
      [
        kontroll("felleskonto", "2026-08", 1000),
        kontroll("felleskonto", "2026-09", 41000.25),
        kontroll("MC", "2026-08", -7000),
        kontroll("MC", "2026-09", -3100),
      ],
    );
    expect(
      within(tabell())
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual([
      "Konto",
      "Inngående",
      "Inn",
      "Ut",
      "Beregnet utgående",
      "Faktisk utgående",
      "Differanse",
      "Status / handling",
    ]);
    expect(celler("Felleskonto")).toEqual([
      "1 000,00 kr",
      "42 000,50 kr",
      "2 000,25 kr",
      "41 000,25 kr",
      "41 000,25 kr",
      "0,00 kr",
      "Avstemt",
    ]);
    // MC: gjeld er negativ saldo; mer gjeld enn beregnet = mindre i banken.
    expect(celler("MC")).toEqual([
      "−7 000,00 kr",
      "7 000,00 kr",
      "3 000,00 kr",
      "−3 000,00 kr",
      "−3 100,00 kr",
      "−100,00 kr",
      "AvvikFinn avviket",
    ]);
    // Konfigurert konto uten data vises, men er ikke «ferdig».
    expect(celler("Krav")).toEqual(["mangler", "—", "—", "—", "mangler", "—", "Ingen data"]);
    expect(screen.getByRole("region", { name: "Samlet status" })).toHaveTextContent(
      "september 2026: 1 av 2 kontoer bankavstemt · 1 med avvik eller usikker",
    );
  });

  it("manglende saldo vises som «mangler», og ukjent konto får egen rad uten kontorad", () => {
    vis([tx({ konto: "helen", dato: "2026-09-03" }), tx({ konto: "", dato: "2026-09-04" })], []);
    expect(celler("Helen")).toEqual([
      "mangler",
      "0,00 kr",
      "100,00 kr",
      "—",
      "mangler",
      "—",
      "Mangler saldoRegistrer saldo",
    ]);
    const ukjent = within(tabell()).getByRole("rowheader", { name: "Ukjent konto" }).closest("tr")!;
    expect(ukjent).toHaveTextContent("1 transaksjon i september mangler konto");
    expect(
      within(ukjent).getByRole("link", { name: "Gi dem konto i Transaksjoner" }),
    ).toHaveAttribute("href", "/forvaltning/transaksjoner");
    expect(screen.getByRole("region", { name: "Samlet status" })).toHaveTextContent(
      "1 transaksjoner uten konto",
    );
  });

  it("valgt OK-måned skjuler ikke eldre åpne avvik, og de kan åpnes derfra", async () => {
    const { user } = vis(
      [tx({ dato: "2026-08-10", belop: 100 })],
      [
        kontroll("felleskonto", "2026-07", 1000),
        kontroll("felleskonto", "2026-08", 950),
        kontroll("felleskonto", "2026-09", 950),
      ],
      "2026-08",
    );
    const status = screen.getByRole("region", { name: "Samlet status" });
    expect(status).toHaveTextContent("september 2026: 1 av 1 konto bankavstemt");
    await user.click(within(status).getByRole("button", { name: "august 2026 (1)" }));
    expect(panel("Felleskonto, august 2026")).toHaveTextContent("Finn avviket");
    expect(screen.getByRole("region", { name: "Samlet status" })).toHaveTextContent(
      "Ingen åpne forhold i andre måneder.",
    );
  });
});

describe("PC-avstemming: matrise og detaljpanel", () => {
  it("klikk i matrisen velger både konto og måned; årsak og handling står først, regnestykket er foldet", async () => {
    const { user } = vis(
      [tx({ dato: "2026-08-10" }), tx({ konto: "MC", dato: "2026-09-10" })],
      [kontroll("felleskonto", "2026-07", 0), kontroll("MC", "2026-08", -100)],
      "2026-08",
    );
    const matrise = screen.getByRole("table", { name: "Status per konto og måned i 2026" });
    await user.click(
      within(matrise).getByRole("button", { name: "Felleskonto august 2026: Mangler saldo" }),
    );
    const p = panel("Felleskonto, august 2026");
    const forste = within(p).getByRole("list", { name: "Dette gjenstår" });
    expect(forste).toHaveTextContent(
      "Registrer saldo: Saldo fra banken for 31. aug er ikke registrert.",
    );
    const regnestykke = within(p).getByText("Regnestykket").closest("details")!;
    expect(regnestykke).not.toHaveAttribute("open");
    expect(
      within(matrise).getByRole("button", { name: "Felleskonto august 2026: Mangler saldo" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("table", { name: "Kontoer i august 2026" })).toBeInTheDocument();
  });

  it("tastatur: Enter lagrer og går videre til neste konto som mangler saldo, med fokus", async () => {
    const { user, onLagre } = vis(
      [
        tx({ konto: "MC", dato: "2026-09-03" }),
        tx({ dato: "2026-09-03" }),
        tx({ konto: "helen", dato: "2026-08-03" }),
      ],
      [
        kontroll("MC", "2026-08", -7000),
        kontroll("felleskonto", "2026-08", 1000),
        kontroll("helen", "2026-08", 500),
      ],
    );
    // Standardvalg: første rad med noe å gjøre (MC).
    const mc = panel("MC, september 2026");
    await user.type(within(mc).getByLabelText(/^Skyldig beløp 30\. sep/), "3000{Enter}");
    expect(onLagre).toHaveBeenCalledWith("MC", "2026-09", -3000);
    // MC mangler fortsatt saldo i dataene (mocken skriver ikke), men neste
    // konto som mangler saldo er Felleskonto.
    const felles = await screen.findByRole("region", { name: "Felleskonto, september 2026" });
    expect(within(felles).getByLabelText(/^Faktisk saldo 30\. sep/)).toHaveFocus();
    await user.keyboard("999");
    // Utkastet står når du velger en annen konto og kommer tilbake.
    await user.click(within(tabell()).getByRole("button", { name: "Helen" }));
    await user.click(within(tabell()).getByRole("button", { name: "Felleskonto" }));
    expect(
      within(panel("Felleskonto, september 2026")).getByLabelText(/^Faktisk saldo/),
    ).toHaveValue("999");
  });

  it("standardvalget låses: en lokal lagring som løser MC, flytter ikke panelet midt i arbeidet", async () => {
    const t = [tx({ konto: "MC", dato: "2026-09-03", belop: 300 }), tx({ dato: "2026-09-03" })];
    const k = [kontroll("MC", "2026-08", -1000), kontroll("felleskonto", "2026-08", 0)];
    let svar!: () => void;
    const onLagre = vi.fn().mockReturnValue(new Promise<void>((res) => (svar = res)));
    const { user, oppdater } = vis(t, k, "2026-09", onLagre);
    await user.type(within(panel("MC, september 2026")).getByLabelText(/^Skyldig beløp/), "1300");
    await user.click(within(panel("MC, september 2026")).getByRole("button", { name: "Lagre" }));
    // Databasen viser skrivingen lokalt før bekreftelsen: MC har ikke lenger
    // noe å gjøre, men panelet blir stående på MC og viser «Lagrer…».
    oppdater(t, [...k, kontroll("MC", "2026-09", -1300)]);
    expect(
      within(panel("MC, september 2026")).getByRole("button", { name: "Lagrer…" }),
    ).toBeDisabled();
    expect(celler("MC").at(-1)).toBe("Lagrer…");
    await act(async () => svar());
    expect(celler("MC").at(-1)).toBe("Avstemt");
  });

  it("lagringsfeil: feilen vises, utkastet står, og valget flyttes ikke", async () => {
    const onLagre = vi.fn().mockRejectedValue(new Error("nett"));
    const spion = vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = vis(
      [tx({ dato: "2026-09-03" })],
      [kontroll("felleskonto", "2026-08", 0)],
      "2026-09",
      onLagre,
    );
    const p = panel("Felleskonto, september 2026");
    await user.type(within(p).getByLabelText(/^Faktisk saldo/), "12 345,67{Enter}");
    expect(await within(p).findByRole("alert")).toHaveTextContent("Kunne ikke lagre. Prøv igjen.");
    expect(within(p).getByLabelText(/^Faktisk saldo/)).toHaveValue("12 345,67");
    expect(panel("Felleskonto, september 2026")).toBeInTheDocument();
    expect(within(tabell()).getByRole("button", { name: "Felleskonto" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    spion.mockRestore();
  });

  it("pågående lagring og utkast overlever breddeendring PC → mobil → PC", async () => {
    let svar!: () => void;
    const onLagre = vi.fn().mockReturnValue(new Promise<void>((res) => (svar = res)));
    const { user } = vis(
      [tx({ dato: "2026-09-03" })],
      [kontroll("felleskonto", "2026-08", 0)],
      "2026-09",
      onLagre,
    );
    await user.type(
      within(panel("Felleskonto, september 2026")).getByLabelText(/^Faktisk saldo/),
      "-100",
    );
    await user.click(
      within(panel("Felleskonto, september 2026")).getByRole("button", { name: "Lagre" }),
    );
    expect(
      within(panel("Felleskonto, september 2026")).getByRole("button", { name: "Lagrer…" }),
    ).toBeDisabled();

    settBred(false);
    const kort = screen.getByRole("region", { name: "Felleskonto" });
    expect(within(kort).getByLabelText(/^Faktisk saldo/)).toHaveValue("-100");
    expect(within(kort).getByRole("button", { name: "Lagrer…" })).toBeDisabled();

    settBred(true);
    expect(
      within(panel("Felleskonto, september 2026")).getByLabelText(/^Faktisk saldo/),
    ).toHaveValue("-100");
    await act(async () => svar());
    expect(onLagre).toHaveBeenCalledTimes(1);
    expect(
      within(panel("Felleskonto, september 2026")).getByRole("button", { name: "Lagre" }),
    ).toBeInTheDocument();
  });
});

describe("PC-avstemming: problemer løses bare av ny vurdering", () => {
  it("avklart ignorert: problemet står til nye data sier noe annet, så blir raden OK", async () => {
    const grunn = [
      tx({ id: "lonn", dato: "2026-09-05", belop: 1000, retning: "inn" }),
      tx({ id: "ign", dato: "2026-09-06", tekst: "KAFFE", belop: 200, status: "ignorert" }),
    ];
    const k = [kontroll("felleskonto", "2026-08", 0), kontroll("felleskonto", "2026-09", 1000)];
    const { user, onAvklarIgnorert, oppdater } = vis(grunn, k);
    const p = panel("Felleskonto, september 2026");
    await user.click(within(p).getByRole("button", { name: /KAFFE .* er en dublett/ }));
    expect(onAvklarIgnorert).toHaveBeenCalledWith("ign", "dublett");
    // Ingen lokal «løst»: uten nye data står problemet.
    expect(celler("Felleskonto").at(-1)).toBe("UsikkerAvklar 1 ignorert");
    oppdater(
      grunn.map((t) => (t.id === "ign" ? { ...t, ignorertSom: "dublett" as const } : t)),
      k,
    );
    expect(celler("Felleskonto").at(-1)).toBe("Avstemt");
    expect(panel("Felleskonto, september 2026")).toHaveTextContent(
      "Avstemt mot banken. Ingenting gjenstår",
    );
  });

  it("lokal skriving før bekreftelse: raden viser «Lagrer…», aldri «Avstemt», til lagringen er bekreftet", async () => {
    const grunn = [
      tx({ id: "lonn", dato: "2026-09-05", belop: 1000, retning: "inn" }),
      tx({ id: "ign", dato: "2026-09-06", tekst: "KAFFE", belop: 200, status: "ignorert" }),
    ];
    const k = [kontroll("felleskonto", "2026-08", 0), kontroll("felleskonto", "2026-09", 1000)];
    const { user, onAvklarIgnorert, oppdater } = vis(grunn, k);
    let svar!: () => void;
    onAvklarIgnorert.mockReturnValue(new Promise<void>((res) => (svar = res)));
    await user.click(
      within(panel("Felleskonto, september 2026")).getByRole("button", {
        name: /KAFFE .* er en dublett/,
      }),
    );
    // Databasen viser den lokale skrivingen før serveren har bekreftet den.
    oppdater(
      grunn.map((t) => (t.id === "ign" ? { ...t, ignorertSom: "dublett" as const } : t)),
      k,
    );
    expect(celler("Felleskonto").at(-1)).toBe("Lagrer…");
    expect(panel("Felleskonto, september 2026")).not.toHaveTextContent("Avstemt mot banken");
    await act(async () => svar());
    expect(celler("Felleskonto").at(-1)).toBe("Avstemt");
  });

  it("delvis løst og etterimport: avvik + endret grunnlag; bekreft på nytt bruker samme skrivevei", async () => {
    const t1 = tx({ id: "a", dato: "2026-09-03", belop: 100 });
    const k = [
      kontroll("felleskonto", "2026-08", 1000),
      kontroll("felleskonto", "2026-09", 900, { antall: 1, nettoOre: -10_000 }),
    ];
    const { user, onLagre, oppdater } = vis([t1], k);
    expect(celler("Felleskonto").at(-1)).toBe("Avstemt");
    // Etterimport av en glemt linje gjenåpner måneden.
    const t2 = tx({ id: "b", dato: "2026-09-28", belop: 250 });
    oppdater([t1, t2], k);
    expect(celler("Felleskonto").at(-1)).toBe("AvvikFinn avviket (+1)");
    const p = panel("Felleskonto, september 2026");
    const liste = within(p).getByRole("list", { name: "Dette gjenstår" });
    expect(
      within(liste)
        .getAllByRole("listitem")
        .filter((li) => li.parentElement === liste)
        .map((li) => li.querySelector("strong")?.textContent),
    ).toEqual(["Finn avviket:", "Bekreft saldoen på nytt:"]);
    // Riktig saldo fra banken registreres: avviket er borte, men grunnlaget
    // er fortsatt eldre enn transaksjonene — delvis løst er ikke OK.
    oppdater(
      [t1, t2],
      [k[0]!, kontroll("felleskonto", "2026-09", 650, { antall: 1, nettoOre: -10_000 })],
    );
    expect(celler("Felleskonto").at(-1)).toBe("Avstemt, med åpne forholdBekreft saldoen på nytt");
    await user.click(
      within(panel("Felleskonto, september 2026")).getByRole("button", {
        name: "Bekreft 650,00 kr mot dagens grunnlag",
      }),
    );
    expect(onLagre).toHaveBeenCalledWith("felleskonto", "2026-09", 650);
  });

  it("«Ikke dublett» er tilgjengelig i historikken også når måneden er avstemt", async () => {
    const { user } = vis(
      [
        tx({
          id: "d",
          dato: "2026-09-04",
          tekst: "DOBBEL",
          belop: 50,
          status: "ignorert",
          ignorertSom: "dublett",
        }),
      ],
      [kontroll("felleskonto", "2026-08", 0), kontroll("felleskonto", "2026-09", 0)],
    );
    const p = panel("Felleskonto, september 2026");
    expect(p).toHaveTextContent("Avstemt mot banken");
    await user.click(within(p).getByText("Historikk og angring"));
    expect(
      within(p).getByRole("group", { name: "Holdt utenfor som dublett i september" }),
    ).toHaveTextContent("DOBBEL");
  });
});

describe("paritet mobil ↔ PC", () => {
  it("samme tall og status på begge flater fra samme syntetiske grunnlag", () => {
    const t = [
      tx({ dato: "2026-09-05", belop: 1234.56, retning: "inn" }),
      tx({ dato: "2026-09-06", belop: 34.5 }),
      tx({ konto: "MC", dato: "2026-09-14", belop: 300 }),
      tx({ konto: "helen", dato: "2026-09-02", belop: 20 }),
    ];
    const k = [
      kontroll("felleskonto", "2026-08", 100),
      kontroll("felleskonto", "2026-09", 1300),
      kontroll("MC", "2026-08", -1000),
      kontroll("MC", "2026-09", -1300),
    ];
    vis(t, k);
    const pc = {
      felles: celler("Felleskonto"),
      mc: celler("MC"),
      helen: celler("Helen"),
    };
    settBred(false);
    const mobil = (navn: string) => {
      const kort = screen.getByRole("region", { name: navn });
      const verdi = (re: RegExp) =>
        within(kort)
          .getByText(re, { selector: "dt" })
          .nextSibling?.textContent?.replace(/\u00a0/g, " ");
      return {
        inngaaende: verdi(/^Saldo 31\. aug/),
        inn: verdi(/^\+ Inn i/),
        ut: verdi(/^− Ut i/),
        beregnet: verdi(/^= Beregnet/),
        faktisk: verdi(/^Faktisk 30\. sep/),
        status: kort.querySelector("header span")?.textContent,
      };
    };
    for (const [navn, rad] of [
      ["Felleskonto", pc.felles],
      ["MC", pc.mc],
      ["Helen", pc.helen],
    ] as const) {
      const m = mobil(navn);
      expect([m.inngaaende, m.inn, m.ut, m.beregnet, m.faktisk]).toEqual([
        rad[0],
        rad[1],
        rad[2],
        rad[3] === "—" ? "—" : rad[3],
        rad[4] === "mangler" ? "ikke registrert" : rad[4],
      ]);
      expect(rad[6]?.startsWith(m.status!)).toBe(true);
    }
  });
});
