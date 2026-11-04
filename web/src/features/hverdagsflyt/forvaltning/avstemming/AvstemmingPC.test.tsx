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
import {
  angreForventetMotpost,
  kildeavtrykk,
  leggTilForventetMotpost,
} from "@domain/avstemming/saldokorrigering";
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

/**
 * Review 5764883177 (P2 og P3): alle PC-flater viser bekreftet status mens
 * en skriving venter, og et saldosvar kaster aldri nyere tekst.
 */
describe("PC-avstemming: bekreftet status på alle flater (review 5764883177)", () => {
  const grunn = [
    tx({ id: "ign", dato: "2026-09-06", tekst: "KAFFE", belop: 200, status: "ignorert" }),
  ];
  const k = [kontroll("felleskonto", "2026-08", 0), kontroll("felleskonto", "2026-09", 0)];
  const lokal = grunn.map((t) => ({ ...t, ignorertSom: "dublett" as const }));
  const status = () => screen.getByRole("region", { name: "Samlet status" });
  const matriseCelle = (re: RegExp) =>
    within(screen.getByRole("table", { name: /^Status per konto og måned i / })).getByRole(
      "button",
      { name: re },
    );

  async function startAvklaring() {
    const v = vis(grunn, k);
    let svar!: () => void;
    let avvis!: (e: unknown) => void;
    v.onAvklarIgnorert.mockReturnValue(
      new Promise<void>((res, rej) => ((svar = res), (avvis = rej))),
    );
    expect(status()).toHaveTextContent("0 av 1 konto bankavstemt");
    await v.user.click(
      within(panel("Felleskonto, september 2026")).getByRole("button", {
        name: /KAFFE .* er en dublett/,
      }),
    );
    // Databasen viser den lokale skrivingen før serveren har bekreftet den.
    v.oppdater(lokal, k);
    return { ...v, svar: () => svar(), avvis: (e: unknown) => avvis(e) };
  }

  it("samlet status og matrise viser ikke ubekreftet lokal løsning; bekreftelse gir OK", async () => {
    const v = await startAvklaring();
    expect(celler("Felleskonto").at(-1)).toBe("Lagrer…");
    expect(status()).toHaveTextContent("0 av 1 konto bankavstemt");
    expect(status()).toHaveTextContent("1 lagres, venter på bekreftelse");
    expect(matriseCelle(/^Felleskonto september 2026: Usikker \(lagrer\)$/)).toBeInTheDocument();
    await act(async () => v.svar());
    expect(status()).toHaveTextContent("1 av 1 konto bankavstemt");
    expect(status()).not.toHaveTextContent("lagres");
    expect(matriseCelle(/^Felleskonto september 2026: Avstemt$/)).toBeInTheDocument();
  });

  it("avvist: databasen ruller tilbake, og alle flater står uendret", async () => {
    const spion = vi.spyOn(console, "error").mockImplementation(() => {});
    const v = await startAvklaring();
    await act(async () => v.avvis(new Error("nekt")));
    v.oppdater(grunn, k);
    expect(status()).toHaveTextContent("0 av 1 konto bankavstemt");
    expect(status()).not.toHaveTextContent("lagres");
    expect(celler("Felleskonto").at(-1)).toBe("UsikkerAvklar 1 ignorert");
    expect(matriseCelle(/^Felleskonto september 2026: Usikker$/)).toBeInTheDocument();
    spion.mockRestore();
  });

  it("breddebytte midt i ventingen: PC viser fortsatt bekreftet status etter mobil og tilbake", async () => {
    const v = await startAvklaring();
    settBred(false);
    settBred(true);
    expect(celler("Felleskonto").at(-1)).toBe("Lagrer…");
    expect(status()).toHaveTextContent("0 av 1 konto bankavstemt");
    await act(async () => v.svar());
    expect(status()).toHaveTextContent("1 av 1 konto bankavstemt");
  });

  it("andre måneders åpne forhold forsvinner ikke før bekreftelse", async () => {
    const aug = [tx({ id: "a", dato: "2026-08-06", tekst: "TE", belop: 50, status: "ignorert" })];
    const ka = [
      kontroll("felleskonto", "2026-07", 0),
      kontroll("felleskonto", "2026-08", 0),
      kontroll("felleskonto", "2026-09", 0),
    ];
    const v = vis(aug, ka, "2026-08");
    let svar!: () => void;
    v.onAvklarIgnorert.mockReturnValue(new Promise<void>((res) => (svar = res)));
    expect(status()).toHaveTextContent("august 2026 (1)");
    await v.user.click(within(status()).getByRole("button", { name: "august 2026 (1)" }));
    await v.user.click(
      within(panel("Felleskonto, august 2026")).getByRole("button", {
        name: /TE .* er en dublett/,
      }),
    );
    v.oppdater(
      aug.map((t) => ({ ...t, ignorertSom: "dublett" as const })),
      ka,
    );
    await v.user.click(screen.getByRole("button", { name: "september 2026" }));
    expect(status()).toHaveTextContent("august 2026 (1)");
    await act(async () => svar());
    expect(status()).toHaveTextContent("Ingen åpne forhold i andre måneder.");
  });
});

describe("SaldoFelt: svar på en eldre lagring kaster ikke nyere tekst (review 5764883177)", () => {
  const t = [tx({ dato: "2026-09-03" }), tx({ konto: "MC", dato: "2026-09-03" })];
  const k = [kontroll("felleskonto", "2026-08", 0), kontroll("MC", "2026-08", 0)];
  const felt = () => within(panel("Felleskonto, september 2026")).getByLabelText(/^Faktisk saldo/);

  async function lagreOgSkrivVidere(onLagre: Parameters<typeof vis>[3]) {
    const v = vis(t, k, "2026-09", onLagre);
    await v.user.click(within(tabell()).getByRole("button", { name: "Felleskonto" }));
    await v.user.type(felt(), "-100");
    await v.user.click(
      within(panel("Felleskonto, september 2026")).getByRole("button", { name: "Lagre" }),
    );
    await v.user.clear(felt());
    await v.user.type(felt(), "-200");
    return v;
  }

  it("bekreftet: bare -100 er sendt, -200 står, og panelet går ikke videre", async () => {
    let svar!: () => void;
    const onLagre = vi.fn().mockReturnValue(new Promise<void>((res) => (svar = res)));
    await lagreOgSkrivVidere(onLagre);
    await act(async () => svar());
    expect(onLagre).toHaveBeenCalledTimes(1);
    expect(onLagre).toHaveBeenCalledWith("felleskonto", "2026-09", -100);
    expect(felt()).toHaveValue("-200");
    expect(
      within(panel("Felleskonto, september 2026")).getByRole("button", { name: "Lagre" }),
    ).toBeEnabled();
  });

  it("avvist: feilen vises, og -200 står", async () => {
    const spion = vi.spyOn(console, "error").mockImplementation(() => {});
    let avvis!: (e: unknown) => void;
    const onLagre = vi.fn().mockReturnValue(new Promise<void>((_, rej) => (avvis = rej)));
    await lagreOgSkrivVidere(onLagre);
    await act(async () => avvis(new Error("nett")));
    expect(felt()).toHaveValue("-200");
    expect(within(panel("Felleskonto, september 2026")).getByRole("alert")).toHaveTextContent(
      "Kunne ikke lagre",
    );
    spion.mockRestore();
  });

  it("PC → mobil: nyere tekst skrevet på mobil står etter svaret, også tilbake på PC", async () => {
    let svar!: () => void;
    const onLagre = vi.fn().mockReturnValue(new Promise<void>((res) => (svar = res)));
    const v = vis(t, k, "2026-09", onLagre);
    await v.user.click(within(tabell()).getByRole("button", { name: "Felleskonto" }));
    await v.user.type(felt(), "-100");
    await v.user.click(
      within(panel("Felleskonto, september 2026")).getByRole("button", { name: "Lagre" }),
    );
    settBred(false);
    const kort = screen.getByRole("region", { name: "Felleskonto" });
    await v.user.clear(within(kort).getByLabelText(/^Faktisk saldo/));
    await v.user.type(within(kort).getByLabelText(/^Faktisk saldo/), "-300");
    await act(async () => svar());
    expect(within(kort).getByLabelText(/^Faktisk saldo/)).toHaveValue("-300");
    settBred(true);
    expect(felt()).toHaveValue("-300");
    expect(onLagre).toHaveBeenCalledTimes(1);
  });
});

/**
 * Review 5765532045 (P2-rest): angring/avslutning av en avledet motpost
 * berører motpostkontoen og -måneden, ikke bare kilden. Også den raden skal
 * stå ventende med sist bekreftede vurdering til svaret er bekreftet/avvist.
 */
describe("PC-avstemming: motpostkontoen venter også (review 5765532045)", () => {
  const NAA = "2026-10-08T12:00:00.000Z";
  const status = () => screen.getByRole("region", { name: "Samlet status" });
  const matrise = () => screen.getByRole("table", { name: /^Status per konto og måned i / });

  function grunnlag(kildeDato: string, motpostDato: string) {
    const kilde = tx({
      id: "kilde",
      dato: kildeDato,
      tekst: "OVERFØRING",
      belop: 100,
      konto: "MC",
      status: "ignorert",
      ignorertSom: "dublett",
    });
    const t = leggTilForventetMotpost(
      "kilde",
      "felleskonto",
      motpostDato,
      NAA,
      kildeavtrykk(kilde),
    )([kilde]);
    expect(t[0]!.forventetMotpost).toBeTruthy();
    return t;
  }

  async function angre(
    v: ReturnType<typeof vis>,
    t: TransaksjonRecord[],
    k: SaldoKontroll[],
    kildeMaaned: string,
  ) {
    let svar!: () => void;
    let avvis!: (e: unknown) => void;
    v.korrigering.angreMotpost.mockReturnValue(
      new Promise<void>((res, rej) => ((svar = res), (avvis = rej))),
    );
    await v.user.click(
      within(matrise()).getByRole("button", { name: new RegExp(`^MC ${kildeMaaned}: `) }),
    );
    const mc = screen.getByRole("region", { name: new RegExp(`^MC, ${kildeMaaned}$`) });
    await v.user.click(within(mc).getByText("Historikk og angring"));
    await v.user.click(within(mc).getAllByRole("button", { name: /: angre avledet motpost$/ })[0]!);
    await v.user.click(within(mc).getByRole("button", { name: "Bekreft: angre avledet motpost" }));
    expect(v.korrigering.angreMotpost).toHaveBeenCalledWith("kilde");
    // RTDB viser angringen lokalt før serveren har bekreftet den.
    v.oppdater(angreForventetMotpost("kilde", NAA)(t), k);
    return { svar: () => svar(), avvis: (e: unknown) => avvis(e) };
  }

  const k = [
    kontroll("MC", "2026-08", 0),
    kontroll("MC", "2026-09", -100),
    kontroll("felleskonto", "2026-08", 0),
    kontroll("felleskonto", "2026-09", 0),
  ];

  it("reviewens repro: felleskonto står ventende med avvik til angringen er bekreftet", async () => {
    const t = grunnlag("2026-09-06", "2026-09-06");
    const v = vis(t, k);
    expect(celler("Felleskonto").at(-1)).toBe("AvvikFinn avviket");
    expect(status()).toHaveTextContent("1 av 2 kontoer bankavstemt");
    const s = await angre(v, t, k, "september 2026");
    expect(celler("Felleskonto").at(-1)).toBe("Lagrer…");
    expect(celler("MC").at(-1)).toBe("Lagrer…");
    expect(status()).toHaveTextContent("0 av 2 kontoer bankavstemt");
    expect(status()).toHaveTextContent("2 lagres, venter på bekreftelse");
    expect(
      within(matrise()).getByRole("button", {
        name: "Felleskonto september 2026: Avvik (lagrer)",
      }),
    ).toBeInTheDocument();
    await act(async () => s.svar());
    // Bekreftet: felleskonto avstemt; kilden er igjen en dublett som ikke
    // teller, så MC har nå avviket — begge vist først etter bekreftelsen.
    expect(celler("Felleskonto").at(-1)).toBe("Avstemt");
    expect(celler("MC").at(-1)).toMatch(/^Avvik/);
    expect(status()).toHaveTextContent("1 av 2 kontoer bankavstemt");
    expect(status()).not.toHaveTextContent("lagres");
    expect(
      within(matrise()).getByRole("button", { name: "Felleskonto september 2026: Avstemt" }),
    ).toBeInTheDocument();
  });

  it("avvist angring: databasen ruller tilbake, og felleskonto har fortsatt avviket", async () => {
    const spion = vi.spyOn(console, "error").mockImplementation(() => {});
    const t = grunnlag("2026-09-06", "2026-09-06");
    const v = vis(t, k);
    const s = await angre(v, t, k, "september 2026");
    await act(async () => s.avvis(new Error("nekt")));
    v.oppdater(t, k);
    expect(celler("Felleskonto").at(-1)).toBe("AvvikFinn avviket");
    expect(status()).toHaveTextContent("1 av 2 kontoer bankavstemt");
    expect(status()).not.toHaveTextContent("lagres");
    spion.mockRestore();
  });

  it("over månedsskiftet: motpostmåneden står som åpent forhold til angringen er bekreftet", async () => {
    // Kilde 30.08 på MC, avledet motpost 01.09 på felleskonto.
    const t = grunnlag("2026-08-30", "2026-09-01");
    const km = [
      kontroll("MC", "2026-07", 0),
      kontroll("MC", "2026-08", -100),
      kontroll("MC", "2026-09", -100),
      kontroll("felleskonto", "2026-08", 0),
      kontroll("felleskonto", "2026-09", 0),
    ];
    const v = vis(t, km, "2026-08");
    await v.user.click(screen.getByRole("button", { name: "august 2026" }));
    expect(status()).toHaveTextContent("september 2026 (1)");
    const s = await angre(v, t, km, "august 2026");
    // Lokalt er september allerede «løst», men det er ikke bekreftet.
    expect(status()).toHaveTextContent("september 2026 (1)");
    expect(
      within(matrise()).getByRole("button", {
        name: "Felleskonto september 2026: Avvik (lagrer)",
      }),
    ).toBeInTheDocument();
    await act(async () => s.svar());
    expect(status()).toHaveTextContent("Ingen åpne forhold i andre måneder.");
  });
});
