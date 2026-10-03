import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import { ImportPanel } from "./ImportPanel";
import { ManuellRegistreringPanel } from "./ManuellRegistreringPanel";

/**
 * Komponenttester for import og manuell registrering (§Issue #34 R3b-2),
 * med forsoningsporten PÅ. Logikken er differensielt testet mot legacy i
 * `bankimport.legacy.test.ts`; her anvendes endringen fra brukerens valg på
 * fixturene, så testene sjekker resultatet.
 */
const eksisterende: TransaksjonRecord[] = [
  {
    id: "t-gammel",
    dato: "2026-09-10",
    tekst: "REMA 1000 GRUNERLOKKA",
    belop: 250.5,
    retning: "ut",
    konto: "Felleskonto",
    status: "ny",
  },
];
const rules: RegelRecord[] = [
  {
    id: "r-lonn",
    pattern: "lønn",
    normalizedPattern: "lønn",
    matchType: "starter_med",
    targetType: "income",
    targetId: "lonnHelen",
    targetName: "Lønn Helen",
    mode: "auto",
  },
];
const CSV =
  "Dato;Beskrivelse;Inn;Ut;Konto\n10.09.2026;REMA 1000 GRUNERLOKKA;;-250,50;Felleskonto\n11.09.2026;Lønn;42 000,00;;Helen\n12.09.2026;KIWI 505;;-99,00;\n";
const fil = (innhold: string, navn = "bank.csv") => new File([innhold], navn, { type: "text/csv" });

function anvend(onUtfor: ReturnType<typeof vi.fn>, start: TransaksjonRecord[] = eksisterende) {
  const e = onUtfor.mock.calls.at(-1)![0] as Beslutningsendring;
  return {
    transaksjoner: e.transaksjoner ? e.transaksjoner(start) : start,
    hendelser: e.hendelser ? e.hendelser([] as HendelseRecord[]) : [],
  };
}

describe("ImportPanel (porten på)", () => {
  it("forhåndsviser, krever konto for rader uten, og importerer nye rader", async () => {
    const user = userEvent.setup();
    const onUtfor = vi.fn().mockResolvedValue(undefined);
    const onFerdig = vi.fn();
    render(
      <ImportPanel
        transaksjoner={eksisterende}
        rules={rules}
        liquidityPosts={[]}
        onUtfor={onUtfor}
        onFerdig={onFerdig}
      />,
    );
    await user.upload(screen.getByLabelText("Bankfil"), fil(CSV));

    expect(await screen.findByText("2 nye")).toBeInTheDocument();
    expect(screen.getByText(/1 duplikater hoppes over/)).toBeInTheDocument();
    const liste = screen.getByRole("list", { name: "Forhåndsvisning" });
    expect(within(liste).getByText("dup")).toBeInTheDocument();
    expect(within(liste).getByText("auto")).toBeInTheDocument(); // lønnsregelen
    expect(within(liste).getByText("mangler konto")).toBeInTheDocument();

    const importer = screen.getByRole("button", { name: "Importer 2 transaksjoner" });
    expect(importer).toBeDisabled();
    await user.click(
      within(screen.getByRole("group", { name: "Konto for importen" })).getByRole("button", {
        name: "MC",
      }),
    );
    expect(importer).toBeEnabled();
    await user.click(importer);

    const r = anvend(onUtfor);
    expect(r.transaksjoner.map((t) => [t.tekst, t.konto, t.importkilde])).toEqual([
      ["REMA 1000 GRUNERLOKKA", "Felleskonto", undefined],
      ["Lønn", "Helen", "sparebank1"],
      ["KIWI 505", "MC", "sparebank1"],
    ]);
    expect(r.hendelser).toHaveLength(1);
    expect(r.hendelser[0]).toMatchObject({ status: "ferdig", regelId: "r-lonn" });
    expect(onFerdig).toHaveBeenCalled();
  });

  it("avviser Excel med en forklaring (kun CSV/TXT i R3b-2)", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(
      <ImportPanel
        transaksjoner={[]}
        rules={[]}
        liquidityPosts={[]}
        onUtfor={vi.fn()}
        onFerdig={vi.fn()}
      />,
    );
    await user.upload(screen.getByLabelText("Bankfil"), fil("x", "dnb.xlsx"));
    expect(await screen.findByText(/Støtter foreløpig kun CSV og TXT/)).toBeInTheDocument();
  });
});

describe("ManuellRegistreringPanel (porten på)", () => {
  const mnd = Array.from({ length: 12 }, () => ({ budget: 0, spent: 0 }));
  const budgetGroups: BudsjettGruppe[] = [
    { id: "mat", label: "Mat", items: [{ id: "dagligvarer", name: "Dagligvarer", months: mnd }] },
  ];
  const sparingGroups: BudsjettGruppe[] = [
    {
      id: "spar",
      label: "Buffer",
      items: [{ id: "bufferkonto", name: "Bufferkonto", months: mnd }],
    },
  ];

  it("lager en manuell hendelse med post, beløp, eier og kommentar", async () => {
    const user = userEvent.setup();
    const onUtfor = vi.fn().mockResolvedValue(undefined);
    const onLukk = vi.fn();
    render(
      <ManuellRegistreringPanel
        budgetGroups={budgetGroups}
        incomeGroups={[]}
        sparingGroups={sparingGroups}
        onUtfor={onUtfor}
        onLukk={onLukk}
      />,
    );
    const lagre = screen.getByRole("button", { name: "Lagre" });
    expect(lagre).toBeDisabled();

    // Sparing viser bare spareposter.
    await user.click(screen.getByRole("button", { name: "Sparing" }));
    await user.type(screen.getByRole("searchbox", { name: "Søk etter post" }), "a");
    expect(screen.queryByRole("button", { name: /Dagligvarer/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Kostnad" }));

    await user.type(screen.getByRole("searchbox", { name: "Søk etter post" }), "dagl");
    await user.click(screen.getByRole("button", { name: /Dagligvarer/ }));
    await user.type(screen.getByRole("spinbutton", { name: "Beløp" }), "-120");
    await user.click(
      within(screen.getByRole("group", { name: "Eier" })).getByRole("button", { name: "Helen" }),
    );
    await user.type(screen.getByRole("textbox", { name: "Kommentar" }), "gavekort");
    await user.click(lagre);

    const e = onUtfor.mock.calls[0]![0] as Beslutningsendring;
    expect(Object.keys(e)).toEqual(["hendelser"]);
    const [h] = e.hendelser!([]);
    expect(h).toMatchObject({
      status: "ferdig",
      transaksjonId: null,
      kilde: "manuell",
      kommentar: "gavekort",
      fordelinger: [
        expect.objectContaining({
          plasseringId: "dagligvarer",
          belop: -120,
          eiere: [
            { person: "Felles", prosent: 50 },
            { person: "Helen", prosent: 50 },
          ],
        }),
      ],
    });
    expect(onLukk).toHaveBeenCalled();
  });
});
