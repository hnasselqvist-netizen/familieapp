import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { TransaksjonsoversiktView } from "./TransaksjonsoversiktView";

/**
 * Komponenttester for transaksjonsoversikten (§Issue #34 R3-les). Utvalg,
 * filtre, sortering og tilstand er differensielt testet mot legacy i
 * `transaksjonsoversikt.legacy.test.ts`; her låses at skjermen viser dem
 * riktig og er REN VISNING — ingen kontroller som kan skrive.
 */
const t = (id: string, felt: Partial<TransaksjonRecord>): TransaksjonRecord => ({
  id,
  dato: "2026-09-10",
  tekst: "REMA 1000",
  belop: 250,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...felt,
});
const transaksjoner = [
  t("t-ny", { tekst: "REMA 1000", dato: "2026-09-10" }),
  t("t-mc", { tekst: "SPOTIFY", konto: "MC", status: "krever_vurdering", dato: "2026-08-02" }),
  t("t-forslag", { tekst: "KIWI", status: "foresoatt_match" }),
  t("t-vent", { tekst: "VIPPS OLA", dato: "2026-09-05" }),
  t("t-ferdig", { tekst: "LØNN", retning: "inn", belop: 30000, dato: "2026-09-25" }),
  t("t-ignorert", { tekst: "GEBYR", status: "ignorert" }),
];
const hendelse = (id: string, felt: Partial<HendelseRecord>): HendelseRecord => ({
  id,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [],
  dato: "2026-09-10",
  regelId: null,
  opprettet: "",
  oppdatert: "",
  ...felt,
});
const hendelser = [
  hendelse("h-vent", {
    transaksjonId: "t-vent",
    status: "pa_vent",
    paaVentAarsak: "venter_paa_kvittering",
    receiptId: "k1",
  }),
  hendelse("h-ferdig", {
    transaksjonId: "t-ferdig",
    fordelinger: [
      {
        plasseringId: "i-lonn",
        plasseringType: "income",
        plasseringNavn: "Lønn Helen",
        belop: 30000,
        eiere: [{ person: "Helen", prosent: 100 }],
      },
    ],
  }),
];
const receipts = [{ id: "k1", merchant: "Vipps" }] as unknown as KvitteringRecord[];
const rules: RegelRecord[] = [];
const incomeGroups: BudsjettGruppe[] = [
  { id: "gi", label: "Lønn", items: [{ id: "i-lonn", name: "Lønn Helen", months: [] }] },
];

function renderView(liste = transaksjoner) {
  return render(
    <TransaksjonsoversiktView
      transaksjoner={liste}
      hendelser={hendelser}
      receipts={receipts}
      rules={rules}
      budgetGroups={[]}
      incomeGroups={incomeGroups}
      sparingGroups={[]}
    />,
  );
}

describe("TransaksjonsoversiktView", () => {
  it("åpner køen forsiden lenker til (`startSeksjon`, fra `?ko=`)", () => {
    render(
      <TransaksjonsoversiktView
        transaksjoner={transaksjoner}
        hendelser={hendelser}
        receipts={receipts}
        rules={rules}
        budgetGroups={[]}
        incomeGroups={incomeGroups}
        sparingGroups={[]}
        startSeksjon="forslag"
      />,
    );
    const faner = screen.getByRole("tablist", { name: "Arbeidskø" });
    expect(within(faner).getByRole("tab", { name: /Forslag til match/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("KIWI")).toBeInTheDocument();
  });

  it("er ren visning: ingen skjema, ingen import/lagre/ignorer/korriger-knapper", () => {
    renderView();
    expect(screen.getByRole("note")).toHaveTextContent("Kun visning");
    for (const navn of [
      /importer/i,
      /lagre/i,
      /ignorer/i,
      /korriger/i,
      /kjør regler/i,
      /registrer/i,
    ]) {
      expect(screen.queryByRole("button", { name: navn })).toBeNull();
    }
    expect(document.querySelector("form, input[type=file]")).toBeNull();
  });

  it("arbeidskøen: tellere per fane, og kontofilter", async () => {
    const user = userEvent.setup();
    renderView();
    const faner = screen.getByRole("tablist", { name: "Arbeidskø" });
    // «Krever vurdering» = uten hendelse og ikke plassert. Fanene er
    // disjunkte (produktfase 1): forslaget (foresoatt_match) telles bare i
    // «Forslag til match», ikke også her som i legacy.
    expect(within(faner).getByRole("tab", { name: /Krever vurdering\s*2/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(faner).getByRole("tab", { name: /Forslag til match\s*1/ })).toBeInTheDocument();
    expect(within(faner).getByRole("tab", { name: /På vent\s*1/ })).toBeInTheDocument();
    expect(screen.getByText("REMA 1000")).toBeInTheDocument();
    expect(screen.getByText("SPOTIFY")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "MC" }));
    expect(screen.queryByText("REMA 1000")).toBeNull();
    expect(screen.getByText("SPOTIFY")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Krav" }));
    expect(screen.getByText("Ingen hendelser i denne kategorien.")).toBeInTheDocument();
  });

  it("på vent-fanen viser merke, venteårsak og kvittering koblet via hendelsen", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("tab", { name: /På vent/ }));
    const rad = screen.getByText("VIPPS OLA").closest("div")!;
    expect(within(rad).getByText("På vent")).toBeInTheDocument();
    expect(within(rad).getByText("Kvittering")).toBeInTheDocument();
    expect(within(rad).getByText(/Venter på kvittering/)).toBeInTheDocument();
  });

  it("«Alle transaksjoner»: tilstand med fordeling, filtre og antall", async () => {
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole("button", { name: "Alle transaksjoner" }));
    expect(screen.getByText("6 av 6 transaksjoner")).toBeInTheDocument();
    expect(screen.getByText("Ferdig")).toBeInTheDocument();
    expect(screen.getByText("Inntekt → Lønn / Lønn Helen")).toBeInTheDocument();
    expect(screen.getByText("Ignorert")).toBeInTheDocument();
    expect(screen.getByText("+30 000 kr")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Måned" }), "august 2026");
    expect(screen.getByText("1 av 6 transaksjoner")).toBeInTheDocument();
    expect(screen.getByText("SPOTIFY")).toBeInTheDocument();

    await user.selectOptions(screen.getByRole("combobox", { name: "Måned" }), "Alle måneder");
    await user.type(screen.getByRole("searchbox", { name: "Søk i tekst" }), "zzz");
    expect(screen.getByText("Ingen transaksjoner matcher filtrene.")).toBeInTheDocument();
  });

  it("en «uplassert» hendelse (kvittering koblet, ikke fordelt) vises i «Krever vurdering»", () => {
    render(
      <TransaksjonsoversiktView
        transaksjoner={[t("t-kv", { tekst: "COOP MEGA", status: "ny" })]}
        hendelser={[
          hendelse("h-kv", { transaksjonId: "t-kv", status: "uplassert", receiptId: "k1" }),
        ]}
        receipts={receipts}
        rules={rules}
        budgetGroups={[]}
        incomeGroups={incomeGroups}
        sparingGroups={[]}
      />,
    );
    // Legacy viser den i ingen kø-fane; her er den i «Krever vurdering».
    expect(screen.getByText("COOP MEGA")).toBeInTheDocument();
    expect(screen.getByText("ikke fordelt")).toBeInTheDocument();
    expect(screen.getByText("Kvittering")).toBeInTheDocument();
  });

  it("tom tilstand uten transaksjoner", () => {
    renderView([]);
    expect(screen.getByText("Ingen transaksjoner importert ennå.")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});

describe("TransaksjonsoversiktView — fra Lønnsdagsrunden", () => {
  const vis = (startMedImport: boolean) =>
    render(
      <TransaksjonsoversiktView
        transaksjoner={transaksjoner}
        hendelser={hendelser}
        receipts={receipts}
        rules={rules}
        budgetGroups={[]}
        incomeGroups={incomeGroups}
        sparingGroups={[]}
        skrivingAktiv
        onUtfor={vi.fn()}
        startMedImport={startMedImport}
      />,
    );

  it("`?verktoy=import` åpner importpanelet direkte", () => {
    vis(true);
    expect(screen.getByRole("group", { name: "Importer bankfil" })).toBeInTheDocument();
  });

  it("uten parameteret er importpanelet lukket som før", () => {
    vis(false);
    expect(screen.queryByRole("group", { name: "Importer bankfil" })).toBeNull();
  });
});

describe("TransaksjonsoversiktView — «På vent» viser mulige dubletter (#66)", () => {
  it("merker en ventende transaksjon med samme dato, beløp og retning som en plassert", async () => {
    const user = userEvent.setup();
    const liste = [
      t("t-vent", { tekst: "VIPPS OLA", dato: "2026-09-05", belop: 120 }),
      t("t-original", { tekst: "Vipps Ola Nordmann", dato: "2026-09-05", belop: 120 }),
    ];
    const hs = [
      hendelse("h-vent", { transaksjonId: "t-vent", status: "pa_vent", paaVentAarsak: "x" }),
      hendelse("h-original", { transaksjonId: "t-original", status: "ferdig" }),
    ];
    render(
      <TransaksjonsoversiktView
        transaksjoner={liste}
        hendelser={hs}
        receipts={[]}
        rules={[]}
        budgetGroups={[]}
        incomeGroups={[]}
        sparingGroups={[]}
      />,
    );
    await user.click(screen.getByRole("tab", { name: /På vent/ }));
    expect(
      screen.getByText(
        "Mulig dublett av «Vipps Ola Nordmann» (plassert). Ignorer den hvis det stemmer.",
      ),
    ).toBeInTheDocument();
  });
});
