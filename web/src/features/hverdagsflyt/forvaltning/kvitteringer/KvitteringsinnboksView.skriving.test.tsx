import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import { aktiveKvitteringer, forslagIMinnet } from "@domain/forsoning/kvitteringsinnboks";
import type {
  HendelseRecord,
  KvitteringRecord,
  MalPost,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { KvitteringsinnboksView } from "./KvitteringsinnboksView";

/**
 * Komponenttester for Kvitteringsinnboksens skrivende handlinger (§Issue
 * #34 R3b-3) med forsoningsporten PÅ. Logikken er differensielt testet mot
 * legacy i `kvitteringSkriving.legacy.test.ts` og
 * `kvitteringUtkast.legacy.test.ts`; her anvendes endringen fra brukerens
 * valg på fixturene, så testene sjekker resultatet.
 */
const tx = (id: string, o: Partial<TransaksjonRecord> = {}): TransaksjonRecord => ({
  id,
  dato: "2026-09-10",
  tekst: "REMA 1000 OSLO",
  belop: 250,
  retning: "ut",
  konto: "felles",
  status: "ny",
  ...o,
});
const transaksjoner = [
  tx("t-rema"),
  tx("t-kiwi", { tekst: "KIWI 505", belop: 99, dato: "2026-09-20", hendelseId: "h-kiwi" }),
];
const hendelse = (id: string, o: Partial<HendelseRecord>): HendelseRecord => ({
  id,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [],
  dato: "2026-09-20",
  regelId: null,
  opprettet: "2026-09-21T00:00:00Z",
  oppdatert: "2026-09-21T00:00:00Z",
  ...o,
});
const hendelser = [
  // Allerede plassert annerledes (kun 50 av 99) → kvitteringen krever et valg.
  hendelse("h-kiwi", {
    transaksjonId: "t-kiwi",
    fordelinger: [
      {
        plasseringId: "kantine",
        plasseringType: "budget",
        plasseringNavn: "Kantine",
        belop: 50,
        eiere: [{ person: "Felles", prosent: 100 }],
      },
    ],
  }),
  hendelse("h-asym", { receiptId: "noe-annet" }),
];
const split = (amount: number, targetId = "dagligvarer", targetName = "Dagligvarer") => ({
  targetType: "budget" as const,
  targetId,
  targetName,
  amount,
});
const alle: KvitteringRecord[] = [
  {
    id: "k-rema",
    merchant: "Rema 1000",
    purchaseDate: "2026-09-10",
    total: 250,
    allocationMode: "split",
    splits: [split(200), split(30, "hus", "Husholdning")], // 230 ≠ 250 → splitt_avvik
    matchingStatus: "unmatched",
  },
  {
    id: "k-kiwi",
    merchant: "Kiwi",
    purchaseDate: "2026-09-20",
    total: 99,
    allocationMode: "single",
    splits: [split(99)],
    matchingStatus: "unmatched",
  },
  {
    id: "k-asym",
    merchant: "Asymmetrisk AS",
    purchaseDate: "2026-08-01",
    total: 10,
    hendelseId: "h-asym",
    matchingStatus: "matched",
  },
];
const poster: MalPost[] = [
  { id: "dagligvarer", name: "Dagligvarer", gruppe: "Mat", targetType: "budget", eier: "Felles" },
  { id: "lonnHelen", name: "Lønn Helen", gruppe: "Lønn", targetType: "income", eier: "Helen" },
];

function renderInnboks(onUtfor = vi.fn().mockResolvedValue(undefined)) {
  const medForslag = forslagIMinnet(alle, transaksjoner, hendelser, "2026-10-03T00:00:00Z");
  render(
    <KvitteringsinnboksView
      alle={alle}
      aktive={aktiveKvitteringer(medForslag, hendelser)}
      transaksjoner={transaksjoner}
      hendelser={hendelser}
      poster={poster}
      skrivingAktiv
      onUtfor={onUtfor}
    />,
  );
  return onUtfor;
}

/** Anvender siste endring i skriverens rekkefølge på fixturene. */
function anvend(onUtfor: ReturnType<typeof vi.fn>) {
  const e = onUtfor.mock.calls.at(-1)![0] as Beslutningsendring;
  return {
    noder: Object.keys(e).sort(),
    hendelser: e.hendelser ? e.hendelser(hendelser) : hendelser,
    transaksjoner: e.transaksjoner ? e.transaksjoner(transaksjoner) : transaksjoner,
    receipts: e.receipts ? e.receipts(alle) : alle,
  };
}

describe("Kvitteringsinnboks med forsoningsporten på", () => {
  it("registrerer en ny, splittet kvittering — rest på siste linje, kun receipts skrives", async () => {
    const user = userEvent.setup();
    const onUtfor = renderInnboks();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "＋ Ny kvittering" }));
    const panel = screen.getByRole("group", { name: "Ny kvittering" });

    await user.type(within(panel).getByLabelText("Leverandør"), "  Obs Bygg ");
    await user.clear(within(panel).getByLabelText("Dato"));
    await user.type(within(panel).getByLabelText("Dato"), "2026-09-30");
    await user.type(within(panel).getByLabelText("Totalbeløp"), "300");
    await user.click(within(panel).getByRole("button", { name: "Må splittes på flere poster" }));
    await user.type(within(panel).getByRole("searchbox", { name: "Søk etter post" }), "dagl");
    await user.click(within(panel).getByRole("button", { name: /Dagligvarer/ }));
    await user.type(within(panel).getByRole("searchbox", { name: "Søk etter post" }), "lønn");
    await user.click(within(panel).getByRole("button", { name: /Lønn Helen/ }));
    const belop = within(panel).getByLabelText("Beløp Dagligvarer");
    await user.clear(belop);
    await user.type(belop, "120,5{Enter}");
    expect(within(panel).getByLabelText("Rest Lønn Helen")).toHaveTextContent("180");

    await user.click(within(panel).getByRole("button", { name: "Registrer kvittering" }));
    const r = anvend(onUtfor);
    expect(r.noder).toEqual(["receipts"]);
    expect(r.receipts.at(-1)).toMatchObject({
      merchant: "Obs Bygg",
      purchaseDate: "2026-09-30",
      total: 300,
      allocationMode: "split",
      matchingStatus: "unmatched",
      hendelseId: null,
      driveFileId: null,
      splits: [
        { targetId: "dagligvarer", amount: 120.5, eiere: [{ person: "Felles", prosent: 100 }] },
        {
          targetId: "lonnHelen",
          targetType: "income",
          amount: 179.5,
          eiere: [{ person: "Helen", prosent: 100 }],
        },
      ],
    });
    expect(screen.queryByRole("group", { name: "Ny kvittering" })).not.toBeInTheDocument();
  });

  it("kobler til foreslått transaksjon; splittavvik gir lenke uten lukking og «Prøv igjen»", async () => {
    const user = userEvent.setup();
    const onUtfor = renderInnboks();
    await user.click(screen.getByRole("button", { name: "Koble Rema 1000" }));

    const r = anvend(onUtfor);
    expect(r.noder).toEqual(["hendelser", "receipts", "transaksjoner"]);
    const ny = r.hendelser.at(-1)!;
    expect(ny).toMatchObject({ status: "uplassert", transaksjonId: "t-rema", receiptId: "k-rema" });
    expect(r.transaksjoner.find((t) => t.id === "t-rema")!.hendelseId).toBe(ny.id);
    expect(r.receipts.find((k) => k.id === "k-rema")).toMatchObject({
      hendelseId: ny.id,
      matchingStatus: "matched",
    });
    expect(await screen.findByText(/Splittsummen stemmer ikke/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prøv igjen" })).toBeInTheDocument();
  });

  it("avvikende eksisterende fordeling: ingen skriving før valget, så kvitteringens fordeling", async () => {
    const user = userEvent.setup();
    const onUtfor = renderInnboks();
    await user.click(screen.getByRole("button", { name: "Koble Kiwi" }));
    expect(onUtfor).not.toHaveBeenCalled();
    expect(screen.getByText(/allerede fordelt annerledes/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Bruk kvitteringens fordeling" }));
    const h = anvend(onUtfor).hendelser.find((x) => x.id === "h-kiwi")!;
    expect(h).toMatchObject({ status: "ferdig", receiptId: "k-kiwi" });
    expect(h.fordelinger.map((f) => [f.plasseringId, f.belop])).toEqual([["dagligvarer", 99]]);
    expect(screen.queryByText(/allerede fordelt annerledes/)).not.toBeInTheDocument();
  });

  it("redigerer og lagrer bare endrede felt; forkasting skriver forkastet", async () => {
    const user = userEvent.setup();
    const onUtfor = renderInnboks();
    await user.click(screen.getByText("Rema 1000"));
    const dialog = screen.getByRole("dialog");
    const lagre = within(dialog).getByRole("button", { name: "Lagre endringer" });
    expect(lagre).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Leverandør"), " Storo");
    await user.click(lagre);
    const k = anvend(onUtfor).receipts.find((x) => x.id === "k-rema")!;
    expect(k).toMatchObject({ merchant: "Rema 1000 Storo", total: 250 });
    expect(k.updatedAt).toEqual(expect.any(String));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByText("Kiwi"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Forkast" }));
    expect(anvend(onUtfor).receipts.find((x) => x.id === "k-kiwi")!.forkastet).toBe(true);
  });

  it("asymmetrisk kobling: feilen vises og ingenting skrives", async () => {
    const user = userEvent.setup();
    const onUtfor = renderInnboks();
    await user.click(screen.getByText("Asymmetrisk AS"));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Forkast" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/asymmetrisk kobling/);
    expect(onUtfor).not.toHaveBeenCalled();
  });

  it("en feilet skriving viser feilen og lar konflikten stå urørt", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderInnboks(vi.fn().mockRejectedValue(new Error("nett")));
    await user.click(screen.getByRole("button", { name: "Koble Rema 1000" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Noe gikk galt");
    expect(screen.queryByText(/Splittsummen stemmer ikke/)).not.toBeInTheDocument();
  });
});
