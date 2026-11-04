/**
 * Mobil avstemming (#59, AV-2, 6633102535): handlingskø med ett kort per
 * konto/måned som har noe igjen. Kortene leser den samme viste, bekreftede
 * modellen som PC, og alle handlinger går gjennom de samme skriveveiene
 * (her: mocks). Syntetiske data.
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

const ko = () => screen.getByRole("region", { name: /^Å gjøre i / });
const kort = (navn: string) => within(ko()).getByRole("region", { name: navn });
const ingenKort = (navn: string) => within(ko()).queryByRole("region", { name: navn });
const status = () => screen.getByRole("region", { name: "Samlet status" });
const gjenstaar = (k: HTMLElement) => {
  const liste = within(k).queryByRole("list", { name: "Dette gjenstår" });
  return liste
    ? within(liste)
        .getAllByRole("listitem")
        .filter((li) => li.parentElement === liste)
        .map((li) => li.querySelector("strong")?.textContent)
    : [];
};
const merke = (k: HTMLElement) => k.querySelector("header span")?.textContent;
const visAlleKnapp = () => screen.getByRole("button", { name: /full oversikt/ });
const velgMaaned = (user: ReturnType<typeof userEvent.setup>, m: string) =>
  user.selectOptions(screen.getByLabelText("Måned"), m);
const lovet = () => {
  let svar!: () => void;
  let avvis!: (e: unknown) => void;
  const p = new Promise<void>((res, rej) => ((svar = res), (avvis = rej)));
  return { p, svar: () => svar(), avvis: (e: unknown) => avvis(e) };
};

describe("mobil: kompakt handlingskø", () => {
  it("bare kontoer med noe igjen får kort; ingen matrise eller fulle kontokort som standard", () => {
    vis(
      [tx({ dato: "2026-09-05", belop: 100 }), tx({ konto: "MC", dato: "2026-09-14", belop: 300 })],
      [
        kontroll("felleskonto", "2026-08", 100),
        kontroll("felleskonto", "2026-09", 0),
        kontroll("MC", "2026-08", -1000),
      ],
    );
    expect(screen.getByLabelText("Måned")).toHaveValue("2026-09");
    expect(status()).toHaveTextContent("1 av 2 kontoer bankavstemt");
    expect(ingenKort("Felleskonto, september 2026")).toBeNull();
    const mc = kort("MC, september 2026");
    expect(gjenstaar(mc)).toEqual(["Registrer saldo:"]);
    // Saldofeltet står fremme når saldo mangler; detaljene er foldet.
    expect(within(mc).getByLabelText(/^Skyldig beløp 30\. sep/)).toBeVisible();
    expect(within(mc).getByText("Regnestykket").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("region", { name: "Felleskonto" })).toBeNull();
    expect(visAlleKnapp()).toHaveAttribute("aria-expanded", "false");
  });

  it("alt løst: «Ingenting gjenstår», og historikk med «Ikke dublett» ligger bak full oversikt", async () => {
    const { user, korrigering } = vis(
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
    expect(within(ko()).getByRole("status")).toHaveTextContent("Ingenting gjenstår i september.");
    expect(screen.queryByText("DOBBEL")).toBeNull();
    await user.click(visAlleKnapp());
    expect(visAlleKnapp()).toHaveAttribute("aria-expanded", "true");
    const full = screen.getByRole("region", { name: "Full oversikt" });
    expect(
      within(full).getByText("Felleskonto september 2026: Avstemt", { exact: false }),
    ).toBeInTheDocument();
    const k = within(full).getByRole("region", { name: "Felleskonto" });
    const holdt = within(k).getByRole("group", { name: "Holdt utenfor som dublett i september" });
    expect(holdt).toHaveTextContent("DOBBEL");
    await user.click(
      within(holdt).getByRole("button", { name: /er ikke en dublett, men en ekte bankbevegelse/ }),
    );
    expect(korrigering.omklassifiser).toHaveBeenCalledWith("d", "bankbevegelse");
  });

  it("ukjent konto står øverst i køen med lenke til Transaksjoner", () => {
    vis([tx({ dato: "2026-09-10", konto: null })], []);
    const note = within(ko()).getByRole("note");
    expect(note).toHaveTextContent("1 transaksjon i september mangler konto");
    expect(
      within(note).getByRole("link", { name: "Gi dem konto i Transaksjoner" }),
    ).toHaveAttribute("href", "/forvaltning/transaksjoner");
  });

  it("eldre åpne forhold nås fra en OK-måned via samlet status", async () => {
    const { user } = vis(
      [tx({ id: "a", dato: "2026-08-06", tekst: "TE", belop: 50, status: "ignorert" })],
      [
        kontroll("felleskonto", "2026-07", 0),
        kontroll("felleskonto", "2026-08", 0),
        kontroll("felleskonto", "2026-09", 0),
      ],
      "2026-08",
    );
    expect(within(ko()).getByRole("status")).toHaveTextContent("Ingenting gjenstår i september.");
    await user.click(within(status()).getByRole("button", { name: "august 2026 (1)" }));
    expect(screen.getByLabelText("Måned")).toHaveValue("2026-08");
    expect(gjenstaar(kort("Felleskonto, august 2026"))).toEqual(["Avklar 1 ignorert:"]);
  });

  it("usikkert grunnlag i startmåneden skjules ikke", () => {
    vis(
      [
        tx({ dato: "2026-09-05", belop: 1000, retning: "inn" }),
        tx({ dato: "2026-09-06", tekst: "KAFFE", belop: 49, status: "ignorert" }),
      ],
      [kontroll("felleskonto", "2026-09", 1000)],
    );
    const k = kort("Felleskonto, september 2026");
    expect(merke(k)).not.toBe("Avstemt");
    expect(gjenstaar(k)).toEqual(["Avklar 1 ignorert:"]);
  });

  it("avledet motpost er aldri bankavstemt: kortet står med «Venter på ekte motpost»", () => {
    const NAA = "2026-10-08T12:00:00.000Z";
    const kilde = tx({
      id: "kilde",
      dato: "2026-09-06",
      tekst: "OVERFØRING",
      belop: 100,
      konto: "MC",
      status: "ignorert",
      ignorertSom: "dublett",
    });
    const t = leggTilForventetMotpost(
      "kilde",
      "felleskonto",
      "2026-09-06",
      NAA,
      kildeavtrykk(kilde),
    )([kilde]);
    vis(t, [
      kontroll("MC", "2026-08", 0),
      kontroll("MC", "2026-09", 0),
      kontroll("felleskonto", "2026-08", 0),
      // Stemmer bare fordi den avledede motposten (+100 fra MC) er regnet med.
      kontroll("felleskonto", "2026-09", 100),
    ]);
    const k = kort("Felleskonto, september 2026");
    expect(merke(k)).not.toBe("Avstemt");
    expect(gjenstaar(k)).toContain("Venter på ekte motpost:");
    expect(status()).not.toHaveTextContent("2 av 2 kontoer bankavstemt");
  });
});

describe("mobil: kort forsvinner bare etter bekreftet lagring og ny vurdering", () => {
  it("saldo: «Lagrer…» til bekreftet; den lokale løsningen fjerner ikke kortet før det", async () => {
    const svar = lovet();
    const t = [tx({ dato: "2026-09-03" })];
    const k = [kontroll("felleskonto", "2026-08", 0)];
    const v = vis(t, k, "2026-09", vi.fn().mockReturnValue(svar.p));
    const felles = kort("Felleskonto, september 2026");
    await v.user.type(within(felles).getByLabelText(/^Faktisk saldo/), "-100");
    await v.user.click(within(felles).getByRole("button", { name: "Lagre" }));
    // Databasen viser den lokale skrivingen før serveren har bekreftet den.
    v.oppdater(t, [...k, kontroll("felleskonto", "2026-09", -100)]);
    const venter = kort("Felleskonto, september 2026");
    expect(merke(venter)).toBe("Lagrer…");
    expect(venter).toHaveTextContent("venter på bekreftelse");
    expect(status()).toHaveTextContent("0 av 1 konto bankavstemt");
    expect(status()).toHaveTextContent("1 lagres, venter på bekreftelse");
    await act(async () => svar.svar());
    expect(v.onLagre).toHaveBeenCalledWith("felleskonto", "2026-09", -100);
    expect(ingenKort("Felleskonto, september 2026")).toBeNull();
    expect(status()).toHaveTextContent("1 av 1 konto bankavstemt");
  });

  it("delvis løst: kortet står med det som gjenstår", async () => {
    const t = [
      tx({ dato: "2026-09-05", belop: 1000, retning: "inn" }),
      tx({ dato: "2026-09-06", tekst: "KAFFE", belop: 49, status: "ignorert" }),
    ];
    const k = [kontroll("felleskonto", "2026-08", 0)];
    const v = vis(t, k);
    const felles = kort("Felleskonto, september 2026");
    expect(gjenstaar(felles)).toEqual(["Registrer saldo:", "Avklar 1 ignorert:"]);
    await v.user.type(within(felles).getByLabelText(/^Faktisk saldo/), "1000");
    await v.user.click(within(felles).getByRole("button", { name: "Lagre" }));
    v.oppdater(t, [...k, kontroll("felleskonto", "2026-09", 1000)]);
    expect(gjenstaar(kort("Felleskonto, september 2026"))).toEqual(["Avklar 1 ignorert:"]);
  });

  it("lagringsfeil: kortet, utkastet og feilen står", async () => {
    const t = [tx({ dato: "2026-09-03" })];
    const v = vis(
      t,
      [kontroll("felleskonto", "2026-08", 0)],
      "2026-09",
      vi.fn().mockRejectedValue(new Error("nekt")),
    );
    const felles = kort("Felleskonto, september 2026");
    await v.user.type(within(felles).getByLabelText(/^Faktisk saldo/), "-100");
    await v.user.click(within(felles).getByRole("button", { name: "Lagre" }));
    const etter = kort("Felleskonto, september 2026");
    expect(within(etter).getByRole("alert")).toHaveTextContent("Kunne ikke lagre. Prøv igjen.");
    expect(within(etter).getByLabelText(/^Faktisk saldo/)).toHaveValue("-100");
    expect(gjenstaar(etter)).toEqual(["Registrer saldo:"]);
  });

  it("avklaring: alle mobilflater viser bekreftet status; avvist ruller tilbake og kortet står", async () => {
    const spion = vi.spyOn(console, "error").mockImplementation(() => {});
    const grunn = [
      tx({ id: "ign", dato: "2026-09-06", tekst: "KAFFE", belop: 200, status: "ignorert" }),
    ];
    const k = [kontroll("felleskonto", "2026-08", 0), kontroll("felleskonto", "2026-09", 0)];
    const v = vis(grunn, k);
    const svar = lovet();
    v.onAvklarIgnorert.mockReturnValue(svar.p);
    await v.user.click(
      within(kort("Felleskonto, september 2026")).getByRole("button", {
        name: /KAFFE .* er en dublett/,
      }),
    );
    v.oppdater(
      grunn.map((t) => ({ ...t, ignorertSom: "dublett" as const })),
      k,
    );
    expect(merke(kort("Felleskonto, september 2026"))).toBe("Lagrer…");
    expect(status()).toHaveTextContent("0 av 1 konto bankavstemt");
    await v.user.click(visAlleKnapp());
    const full = screen.getByRole("region", { name: "Full oversikt" });
    expect(
      within(full).getByText("Felleskonto september 2026: Usikker (lagrer)"),
    ).toBeInTheDocument();
    expect(merke(within(full).getByRole("region", { name: "Felleskonto" }))).toBe("Lagrer…");
    await act(async () => svar.avvis(new Error("nekt")));
    v.oppdater(grunn, k);
    const k2 = kort("Felleskonto, september 2026");
    expect(merke(k2)).toBe("Usikker");
    expect(gjenstaar(k2)).toEqual(["Avklar 1 ignorert:"]);
    expect(within(full).getByText("Felleskonto september 2026: Usikker")).toBeInTheDocument();
    spion.mockRestore();
  });

  it("etterimport gjenåpner et løst kort", () => {
    const t1 = tx({ id: "a", dato: "2026-09-03", belop: 100 });
    const k = [
      kontroll("felleskonto", "2026-08", 1000),
      kontroll("felleskonto", "2026-09", 900, { antall: 1, nettoOre: -10_000 }),
    ];
    const v = vis([t1], k);
    expect(ingenKort("Felleskonto, september 2026")).toBeNull();
    v.oppdater([t1, tx({ id: "b", dato: "2026-09-28", belop: 250 })], k);
    expect(gjenstaar(kort("Felleskonto, september 2026"))).toEqual([
      "Finn avviket:",
      "Bekreft saldoen på nytt:",
    ]);
  });

  it("motpost over månedsskiftet: begge måneder venter på bekreftelse også på mobil", async () => {
    const NAA = "2026-10-08T12:00:00.000Z";
    // Kilde 30.08 på MC, avledet motpost 01.09 på felleskonto.
    const kilde = tx({
      id: "kilde",
      dato: "2026-08-30",
      tekst: "OVERFØRING",
      belop: 100,
      konto: "MC",
      status: "ignorert",
      ignorertSom: "dublett",
    });
    const t = leggTilForventetMotpost(
      "kilde",
      "felleskonto",
      "2026-09-01",
      NAA,
      kildeavtrykk(kilde),
    )([kilde]);
    const k = [
      kontroll("MC", "2026-07", 0),
      kontroll("MC", "2026-08", -100),
      kontroll("MC", "2026-09", -100),
      kontroll("felleskonto", "2026-08", 0),
      kontroll("felleskonto", "2026-09", 0),
    ];
    const v = vis(t, k, "2026-08");
    expect(gjenstaar(kort("Felleskonto, september 2026"))).toContain("Finn avviket:");
    const svar = lovet();
    v.korrigering.angreMotpost.mockReturnValue(svar.p);
    await velgMaaned(v.user, "2026-08");
    await v.user.click(visAlleKnapp());
    const mc = within(screen.getByRole("region", { name: "Full oversikt" })).getByRole("region", {
      name: "MC",
    });
    await v.user.click(within(mc).getAllByRole("button", { name: /: angre avledet motpost$/ })[0]!);
    await v.user.click(within(mc).getByRole("button", { name: "Bekreft: angre avledet motpost" }));
    expect(v.korrigering.angreMotpost).toHaveBeenCalledWith("kilde");
    v.oppdater(angreForventetMotpost("kilde", NAA)(t), k);
    // Lokalt er september «løst», men det er ikke bekreftet.
    expect(status()).toHaveTextContent("september 2026 (1)");
    await velgMaaned(v.user, "2026-09");
    expect(merke(kort("Felleskonto, september 2026"))).toBe("Lagrer…");
    await act(async () => svar.svar());
    expect(ingenKort("Felleskonto, september 2026")).toBeNull();
  });
});

describe("mobil: tilstand som står", () => {
  it("utkast står ved levende oppdatering, periodebytte og breddeskift; full oversikt står ved breddeskift", async () => {
    const t = [tx({ dato: "2026-09-03" })];
    const k = [kontroll("felleskonto", "2026-08", 0)];
    const v = vis(t, k, "2026-08");
    const felt = () => within(kort("Felleskonto, september 2026")).getByLabelText(/^Faktisk saldo/);
    await v.user.type(felt(), "-1");
    v.oppdater([...t, tx({ dato: "2026-08-20" })], k);
    expect(felt()).toHaveValue("-1");
    await velgMaaned(v.user, "2026-08");
    await velgMaaned(v.user, "2026-09");
    expect(felt()).toHaveValue("-1");
    await v.user.click(visAlleKnapp());
    settBred(true);
    expect(
      within(screen.getByRole("region", { name: "Felleskonto, september 2026" })).getByLabelText(
        /^Faktisk saldo/,
      ),
    ).toHaveValue("-1");
    settBred(false);
    expect(felt()).toHaveValue("-1");
    expect(visAlleKnapp()).toHaveAttribute("aria-expanded", "true");
  });
});
