import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseDrillDownRad } from "@domain/budsjettfamilie/budsjettfamilie";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import { DrilldownModal } from "../budsjettfamilie/DrilldownModal";
import { TransaksjonsoversiktView } from "../transaksjoner/TransaksjonsoversiktView";
import { KorrigerHendelseModal } from "./KorrigerHendelseModal";
import { PostDrilldown } from "./PostDrilldown";

/**
 * Komponenttester for korrigering (§Issue #34 R3b-4). Logikken er
 * differensielt testet mot legacy `KorrigerHendelseModal` i
 * `korrigering.legacy.test.ts`; her anvendes endringen fra brukerens valg
 * på fixturene, og inngangene (transaksjonsoversikt og drilldown fra
 * postdetalj) låses som skjult når forsoningsporten er av.
 */
const mnd = Array.from({ length: 12 }, () => ({ budget: 0, spent: 0 }));
const budgetGroups: BudsjettGruppe[] = [
  {
    id: "mat",
    label: "Mat",
    items: [
      { id: "dagligvarer", name: "Dagligvarer", months: mnd },
      { id: "kantine", name: "Kantine", months: mnd, meta: { eier: "Helen" } as never },
    ],
  },
];
const incomeGroups: BudsjettGruppe[] = [
  { id: "lonn", label: "Lønn", items: [{ id: "lonnHelen", name: "Lønn Helen", months: mnd }] },
];
const sparingGroups: BudsjettGruppe[] = [];
const transaksjoner: TransaksjonRecord[] = [
  {
    id: "t-rema",
    dato: "2026-09-10",
    tekst: "REMA 1000",
    belop: 250,
    retning: "ut",
    konto: "Felleskonto",
    status: "ny",
    hendelseId: "h-rema",
  },
];
const hendelse: HendelseRecord = {
  id: "h-rema",
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: "t-rema",
  receiptId: null,
  fordelinger: [
    {
      plasseringId: "dagligvarer",
      plasseringType: "budget",
      plasseringNavn: "Dagligvarer",
      belop: 250,
      eiere: [{ person: "Felles", prosent: 100 }],
    },
  ],
  dato: "2026-09-10",
  regelId: null,
  opprettet: "2026-09-11T00:00:00Z",
  oppdatert: "2026-09-11T00:00:00Z",
};
const rules: RegelRecord[] = [];

function renderModal(onUtfor = vi.fn().mockResolvedValue(undefined)) {
  const onLagret = vi.fn();
  render(
    <KorrigerHendelseModal
      hendelse={hendelse}
      transaksjoner={transaksjoner}
      rules={rules}
      budgetGroups={budgetGroups}
      incomeGroups={incomeGroups}
      sparingGroups={sparingGroups}
      onUtfor={onUtfor}
      onLagret={onLagret}
      onClose={vi.fn()}
    />,
  );
  return { onUtfor, onLagret };
}
const anvend = (onUtfor: ReturnType<typeof vi.fn>) => {
  const e = onUtfor.mock.calls.at(-1)![0] as Beslutningsendring;
  return {
    noder: Object.keys(e).sort(),
    hendelse: e.hendelser!([hendelse]).at(-1)!,
    rules: e.rules ? e.rules(rules) : rules,
  };
};

describe("KorrigerHendelseModal", () => {
  it("bytter post og lærer koblingen: hendelsen erstattes og en regel opprettes", async () => {
    const user = userEvent.setup();
    const { onUtfor, onLagret } = renderModal();
    expect(screen.getByRole("dialog")).toHaveTextContent("Korriger — REMA 1000");
    await user.click(screen.getByRole("button", { name: "Bytt post Dagligvarer" }));
    await user.type(screen.getByRole("searchbox", { name: "Søk etter post" }), "kant");
    await user.click(screen.getByRole("button", { name: /Kantine/ }));
    await user.click(screen.getByRole("checkbox", { name: "Lær denne koblingen" }));
    await user.click(screen.getByRole("button", { name: "Lagre korrigering" }));

    const r = anvend(onUtfor);
    expect(r.noder).toEqual(["hendelser", "rules"]);
    expect(r.hendelse).toMatchObject({ id: "h-rema", status: "ferdig", regelId: null });
    expect(r.hendelse.fordelinger).toEqual([
      expect.objectContaining({ plasseringId: "kantine", belop: 250 }),
    ]);
    expect(r.rules).toEqual([
      expect.objectContaining({ targetId: "kantine", normalizedPattern: "rema 1000" }),
    ]);
    expect(onLagret).toHaveBeenCalled();
  });

  it("læring med kontovilkår (#59): «Bare fra Felleskonto» gir en sammensatt regel", async () => {
    const user = userEvent.setup();
    const { onUtfor } = renderModal();
    await user.click(screen.getByRole("button", { name: "Bytt post Dagligvarer" }));
    await user.type(screen.getByRole("searchbox", { name: "Søk etter post" }), "kant");
    await user.click(screen.getByRole("button", { name: /Kantine/ }));
    expect(screen.queryByRole("group", { name: /Hvilke betalinger/ })).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Lær denne koblingen" }));
    await user.click(screen.getByRole("radio", { name: "Bare fra Felleskonto" }));
    await user.click(screen.getByRole("button", { name: "Lagre korrigering" }));
    expect(anvend(onUtfor).rules).toEqual([
      expect.objectContaining({ targetId: "kantine", kontoVilkar: "felleskonto" }),
    ]);
  });

  it("del opp: rest på siste linje og ansvar per linje; uten læring røres ikke rules", async () => {
    const user = userEvent.setup();
    const { onUtfor } = renderModal();
    await user.click(screen.getByRole("button", { name: "+ Del opp i flere" }));
    await user.type(screen.getByRole("searchbox", { name: "Søk etter post" }), "lønn");
    await user.click(screen.getByRole("button", { name: /Lønn Helen/ }));
    const belop = screen.getByRole("textbox", { name: "Beløp Dagligvarer" });
    await user.clear(belop);
    await user.type(belop, "100{Enter}");
    expect(screen.getByLabelText("Beløp Lønn Helen")).toHaveTextContent("150");
    expect(screen.queryByRole("checkbox", { name: "Lær denne koblingen" })).toBeNull();
    await user.click(
      within(screen.getByRole("group", { name: "Ansvar Dagligvarer" })).getByRole("button", {
        name: "Helen",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Lagre korrigering" }));

    const r = anvend(onUtfor);
    expect(r.noder).toEqual(["hendelser"]);
    expect(r.hendelse.fordelinger.map((f) => [f.plasseringId, f.belop])).toEqual([
      ["dagligvarer", 100],
      ["lonnHelen", -150], // inntektspost på en utgift → motsatt fortegn
    ]);
    expect(r.hendelse.fordelinger[0]!.eiere).toEqual([
      { person: "Felles", prosent: 50 },
      { person: "Helen", prosent: 50 },
    ]);
  });

  it("setter på vent med årsak", async () => {
    const user = userEvent.setup();
    const { onUtfor } = renderModal();
    await user.click(screen.getByRole("button", { name: "Sett på vent" }));
    await user.click(
      within(screen.getByRole("group", { name: "Årsak" })).getAllByRole("button")[0]!,
    );
    await user.click(screen.getByRole("button", { name: "Lagre korrigering" }));
    expect(anvend(onUtfor).hendelse).toMatchObject({
      status: "pa_vent",
      fordelinger: [],
      paaVentAarsak: expect.any(String),
    });
  });

  it("viser feil og holder modalen åpen når skrivingen feiler", async () => {
    const user = userEvent.setup();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { onLagret } = renderModal(vi.fn().mockRejectedValue(new Error("nett")));
    await user.click(screen.getByRole("button", { name: "Lagre korrigering" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Noe gikk galt");
    expect(onLagret).not.toHaveBeenCalled();
  });
});

describe("«Korriger kobling» i transaksjonsoversikten", () => {
  const vis = (skrivingAktiv: boolean) =>
    render(
      <TransaksjonsoversiktView
        transaksjoner={transaksjoner}
        hendelser={[hendelse]}
        receipts={[]}
        rules={rules}
        budgetGroups={budgetGroups}
        incomeGroups={incomeGroups}
        sparingGroups={sparingGroups}
        skrivingAktiv={skrivingAktiv}
        onUtfor={vi.fn().mockResolvedValue(undefined)}
      />,
    );

  it("vises bare med porten på, og åpner korrigeringen", async () => {
    const user = userEvent.setup();
    const { unmount } = vis(false);
    await user.click(screen.getByRole("button", { name: "Alle transaksjoner" }));
    expect(screen.queryByRole("button", { name: /Korriger kobling/ })).toBeNull();
    unmount();

    vis(true);
    await user.click(screen.getByRole("button", { name: "Alle transaksjoner" }));
    await user.click(screen.getByRole("button", { name: "Korriger kobling REMA 1000" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Korriger — REMA 1000");
  });
});

const rader: HendelseDrillDownRad[] = [
  {
    hendelseId: "h-rema",
    dato: "2026-09-10",
    tekst: "REMA 1000",
    belop: 250,
    plasseringNavn: "Dagligvarer",
    eiere: [],
    erKvittering: false,
    erManuell: false,
    receiptId: null,
  },
  {
    hendelseId: "h-kv",
    dato: "2026-09-11",
    tekst: "Kiwi",
    belop: 99,
    plasseringNavn: "Dagligvarer",
    eiere: [],
    erKvittering: true,
    erManuell: false,
    receiptId: "k1",
  },
];

describe("DrilldownModal", () => {
  it("uten handlinger er radene ren visning (som før R3b-4)", () => {
    render(<DrilldownModal tittel="Hendelser" rader={rader} onClose={vi.fn()} />);
    expect(within(screen.getByRole("dialog")).queryByRole("button", { name: /REMA/ })).toBeNull();
    expect(screen.queryByText(/Trykk for å/)).toBeNull();
  });

  it("med handlinger: bankplassering → korriger, kvittering → rediger (også med tastatur)", async () => {
    const user = userEvent.setup();
    const onVelgHendelse = vi.fn();
    const onVelgKvittering = vi.fn();
    render(
      <DrilldownModal
        tittel="Hendelser"
        rader={rader}
        onClose={vi.fn()}
        onVelgHendelse={onVelgHendelse}
        onVelgKvittering={onVelgKvittering}
      />,
    );
    await user.click(screen.getByRole("button", { name: /REMA 1000.*Trykk for å korrigere/ }));
    expect(onVelgHendelse).toHaveBeenCalledWith("h-rema");
    screen.getByRole("button", { name: /Kiwi.*Trykk for å redigere kvitteringen/ }).focus();
    await user.keyboard("{Enter}");
    expect(onVelgKvittering).toHaveBeenCalledWith("k1");
  });
});

const kor = vi.hoisted(() => ({ aktiv: false, utfor: null as unknown }));
vi.mock("@hooks/useKorrigering", () => ({
  useKorrigering: () => ({
    hendelser: [hendelse],
    transaksjoner,
    receipts: [],
    rules,
    budgetGroups,
    incomeGroups,
    sparingGroups,
    skrivingAktiv: kor.aktiv,
    utfor: kor.utfor,
  }),
}));

describe("PostDrilldown (Budsjett/Inntekter/Sparing)", () => {
  beforeEach(() => {
    kor.utfor = vi.fn().mockResolvedValue(undefined);
  });

  it("porten av: samme rene visning", () => {
    kor.aktiv = false;
    render(<PostDrilldown tittel="Hendelser — Dagligvarer" rader={rader} onClose={vi.fn()} />);
    expect(screen.queryByText(/Trykk for å/)).toBeNull();
  });

  it("porten på: korrigering fra raden lukker også drilldown etter lagring", async () => {
    kor.aktiv = true;
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<PostDrilldown tittel="Hendelser — Dagligvarer" rader={rader} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /REMA 1000.*Trykk for å korrigere/ }));
    await user.click(screen.getByRole("button", { name: "Sett på vent" }));
    await user.click(screen.getByRole("button", { name: "Lagre korrigering" }));
    expect(kor.utfor).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });
});
