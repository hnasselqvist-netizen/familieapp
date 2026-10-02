import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { aktiveKvitteringer, forslagIMinnet } from "@domain/forsoning/kvitteringsinnboks";
import type { HendelseRecord, KvitteringRecord, TransaksjonRecord } from "@app-types/forsoning";
import { KvitteringsinnboksView } from "./KvitteringsinnboksView";

/**
 * Komponenttester for Kvitteringsinnboksen (§Issue #34 R2). Utvalg,
 * sortering, status og forslag er differensielt testet mot legacy i
 * `kvitteringsinnboks.legacy.test.ts`; her låses at skjermen er REN
 * VISNING — ingen kontroller som kan skrive.
 */
const transaksjoner: TransaksjonRecord[] = [
  {
    id: "t1",
    dato: "2026-09-10",
    tekst: "REMA 1000 OSLO",
    belop: 250,
    retning: "ut",
    konto: "felles",
    status: "ny",
  },
];
const hendelser: HendelseRecord[] = [
  {
    id: "h1",
    status: "ferdig",
    paaVentAarsak: null,
    transaksjonId: "t9",
    receiptId: "k-ferdig",
    fordelinger: [],
    dato: "2026-09-01",
    regelId: null,
    opprettet: "",
    oppdatert: "",
  },
];
const alle: KvitteringRecord[] = [
  {
    id: "k-rema",
    merchant: "Rema 1000",
    purchaseDate: "2026-09-10",
    total: 250,
    matchingStatus: "unmatched",
    allocationMode: "split",
    driveWebViewLink: "https://drive.google.com/file/d/abc/view",
    splits: [
      {
        targetType: "budget",
        targetId: "b1",
        targetName: "Dagligvarer",
        amount: 200,
        description: "Mat",
      },
      {
        targetType: "budget",
        targetId: "b2",
        targetName: "Husholdning",
        amount: 30,
        eiere: [
          { person: "Helen", prosent: 50 },
          { person: "Eivind", prosent: 50 },
        ],
      },
    ],
  },
  { id: "k-ferdig", merchant: "Ferdig AS", purchaseDate: "2026-09-01", total: 10 },
  { id: "k-forkastet", merchant: "Forkastet AS", forkastet: true, total: 5 },
  {
    id: "k-bankimport",
    purchaseDate: "2026-09-05",
    total: 99,
    imageUrl: "data:image/png;base64,AAAA",
  },
];

function renderInnboks(kvitteringer = alle) {
  const medForslag = forslagIMinnet(kvitteringer, transaksjoner, hendelser, "2026-10-02T00:00:00Z");
  render(
    <KvitteringsinnboksView
      alle={kvitteringer}
      aktive={aktiveKvitteringer(medForslag, hendelser)}
      transaksjoner={transaksjoner}
      hendelser={hendelser}
    />,
  );
}

describe("KvitteringsinnboksView — kun visning", () => {
  it("viser aktive kvitteringer (ikke forkastede/ferdige), antall registrert og forslag beregnet i minnet", () => {
    renderInnboks();
    expect(screen.getByText("4 registrert")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Kun visning");
    expect(screen.getByText("Rema 1000")).toBeInTheDocument();
    expect(screen.getByText("(ukjent leverandør)")).toBeInTheDocument();
    expect(screen.queryByText("Ferdig AS")).not.toBeInTheDocument();
    expect(screen.queryByText("Forkastet AS")).not.toBeInTheDocument();
    expect(screen.getByText("Foreslått match")).toBeInTheDocument();
    expect(screen.getByText(/REMA 1000 OSLO/)).toBeInTheDocument();
    expect(screen.getAllByText("Foreslått")).toHaveLength(1);
  });

  it("har ingen kontroller som skriver: ingen ny/koble/forkast/bildeopplasting", async () => {
    renderInnboks();
    for (const navn of [/Ny kvittering/, /Koble/, /Forkast/, /Legg til bilde/, /Registrer/]) {
      expect(screen.queryByRole("button", { name: navn })).not.toBeInTheDocument();
    }
    expect(document.querySelector("input")).toBeNull();
    await userEvent.click(screen.getByText("Rema 1000"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /Forkast/ })).not.toBeInTheDocument();
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
  });

  it("detaljvisningen viser Drive-lenke, fordeling med eiere og splittsum med rest", async () => {
    renderInnboks();
    await userEvent.click(screen.getByText("Rema 1000"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("link", { name: "Åpne bilde i Google Drive" })).toHaveAttribute(
      "href",
      "https://drive.google.com/file/d/abc/view",
    );
    expect(within(dialog).getByText("Splittet på flere poster")).toBeInTheDocument();
    const fordeling = within(dialog).getByRole("list", { name: "Fordeling" });
    expect(within(fordeling).getByText("Dagligvarer")).toBeInTheDocument();
    expect(within(fordeling).getByText("Mat")).toBeInTheDocument();
    expect(within(fordeling).getByText("Felles")).toBeInTheDocument();
    expect(within(fordeling).getByText("Helen 50%, Eivind 50%")).toBeInTheDocument();
    expect(within(dialog).getByText(/Splittsum:/)).toHaveTextContent(/gjenstår/);
  });

  it("tomme tilstander som legacy", () => {
    renderInnboks([]);
    expect(screen.getByText("Ingen kvitteringer registrert ennå.")).toBeInTheDocument();
  });
});
