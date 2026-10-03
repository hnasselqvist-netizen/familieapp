import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import { BeslutningPanel } from "./BeslutningPanel";
import { TransaksjonsoversiktView } from "./TransaksjonsoversiktView";

/**
 * Komponenttester for beslutningspanelet (§Issue #34 R3b-1) — med
 * forsoningsporten PÅ, slik det blir ved cutover. Logikken er differensielt
 * testet mot legacy i `beslutning.legacy.test.ts` og
 * `plasseringsvalg.legacy.test.ts`; her låses at panelet bygger riktig
 * endring fra brukerens valg. Endringen anvendes på fixturene, så testene
 * sjekker resultatet, ikke bare at en funksjon ble kalt.
 */
const mnd = (b: number) => Array.from({ length: 12 }, () => ({ budget: b, spent: 0 }));
const budgetGroups: BudsjettGruppe[] = [
  {
    id: "mat",
    label: "Mat",
    items: [
      { id: "dagligvarer", name: "Dagligvarer REMA", months: mnd(4000) },
      { id: "kantine", name: "Kantine", months: mnd(0), meta: { eier: "Helen" } },
    ],
  },
];
const incomeGroups: BudsjettGruppe[] = [];
const sparingGroups: BudsjettGruppe[] = [
  { id: "spar", label: "Sparing", items: [{ id: "buffer", name: "Bufferkonto", months: [] }] },
];
const tx = (id: string, felt: Partial<TransaksjonRecord> = {}): TransaksjonRecord => ({
  id,
  dato: "2026-09-20",
  tekst: "REMA 1000 GRUNERLOKKA",
  belop: 400,
  retning: "ut",
  konto: "Felleskonto",
  status: "ny",
  ...felt,
});
const transaksjoner = [
  tx("t-1"),
  tx("t-2"), // samme tekst — propageres ved læring
  tx("t-ut", { tekst: "OVERFØRING SPAR", belop: 5000, konto: "Felleskonto" }),
  tx("t-inn", {
    tekst: "OVERFØRING SPAR",
    belop: 5000,
    retning: "inn",
    konto: "Sparekonto",
    dato: "2026-09-21",
  }),
  tx("t-matchet", { tekst: "KIWI", status: "foresoatt_match", matchetMot: "kantine", belop: 99 }),
];
const hendelser: HendelseRecord[] = [];
const rules: RegelRecord[] = [
  {
    id: "r-1",
    pattern: "rema",
    normalizedPattern: "rema",
    matchType: "inneholder",
    targetType: "budget",
    targetId: "dagligvarer",
    targetName: "Dagligvarer REMA",
    mode: "auto",
    timesUsed: 2,
  },
  {
    id: "r-kantine",
    pattern: "rema 2000 sentrum",
    normalizedPattern: "rema 2000 sentrum",
    matchType: "inneholder",
    targetType: "budget",
    targetId: "kantine",
    targetName: "Kantine",
    mode: "auto",
  },
];

function renderPanel(t = transaksjoner[0]!, onUtfor = vi.fn().mockResolvedValue(undefined)) {
  const onLukk = vi.fn();
  render(
    <BeslutningPanel
      t={t}
      transaksjoner={transaksjoner}
      hendelser={hendelser}
      rules={rules}
      budgetGroups={budgetGroups}
      incomeGroups={incomeGroups}
      sparingGroups={sparingGroups}
      onUtfor={onUtfor}
      onLukk={onLukk}
    />,
  );
  /** Anvender den siste endringen på fixturene. */
  const resultat = () => {
    const e = onUtfor.mock.calls.at(-1)![0] as Beslutningsendring;
    return {
      hendelser: e.hendelser ? e.hendelser(hendelser) : hendelser,
      transaksjoner: e.transaksjoner ? e.transaksjoner(transaksjoner) : transaksjoner,
      rules: e.rules ? e.rules(rules) : rules,
      noder: Object.keys(e),
    };
  };
  return { onUtfor, onLukk, resultat, user: userEvent.setup() };
}

describe("BeslutningPanel (porten på)", () => {
  it("plassering fra forslag: ferdig hendelse, peker på transaksjonen, panelet lukkes", async () => {
    const { user, resultat, onLukk } = renderPanel();
    const forslag = screen.getByLabelText("Forslag");
    expect(within(forslag).getByText("Dagligvarer REMA")).toBeInTheDocument();
    expect(within(forslag).getByText("Mat · tekst")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lagre" })).toBeDisabled();

    await user.click(within(forslag).getByRole("button", { name: /Dagligvarer REMA/ }));
    await user.click(screen.getByRole("button", { name: "Lagre" }));

    const r = resultat();
    expect(r.noder).toEqual(["hendelser", "transaksjoner"]);
    expect(r.hendelser).toHaveLength(1);
    expect(r.hendelser[0]).toMatchObject({
      status: "ferdig",
      transaksjonId: "t-1",
      regelId: null,
      fordelinger: [
        expect.objectContaining({
          plasseringId: "dagligvarer",
          belop: 400,
          plasseringType: "budget",
        }),
      ],
    });
    expect(r.transaksjoner.find((x) => x.id === "t-1")!.hendelseId).toBe(r.hendelser[0]!.id);
    expect(r.transaksjoner.find((x) => x.id === "t-2")!.status).toBe("ny");
    expect(onLukk).toHaveBeenCalled();
  });

  it("splitt via søk: restbeløp på siste linje, ansvar per linje, «Fordelt»", async () => {
    const { user, resultat } = renderPanel();
    await user.type(screen.getByRole("searchbox", { name: "Søk blant poster" }), "kantine");
    await user.click(screen.getByRole("button", { name: /Kantine/ }));
    await user.click(screen.getByRole("button", { name: "✂️ Del opp i flere plasseringer" }));
    await user.type(screen.getByRole("searchbox", { name: "Søk blant poster" }), "buffer");
    await user.click(screen.getByRole("button", { name: /Bufferkonto/ }));

    const felt = screen.getByRole("textbox", { name: "Beløp for Kantine" });
    await user.clear(felt);
    await user.type(felt, "150,5{Enter}");
    expect(screen.getByText("Fordelt: 400 kr av 400 kr")).toBeInTheDocument();

    // Ansvar: legg Felles til Kantine-linjen (Helen fra posten) → 50/50.
    const ansvar = screen.getByRole("group", { name: "Ansvar for Kantine" });
    await user.click(within(ansvar).getByRole("button", { name: "Felles" }));
    expect(within(ansvar).getByRole("button", { name: "Helen 50%" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Lagre" }));
    const f = resultat().hendelser[0]!.fordelinger;
    expect(f.map((x) => [x.plasseringId, x.belop, x.plasseringType])).toEqual([
      ["kantine", 150.5, "budget"],
      ["buffer", 249.5, "sparing"],
    ]);
    expect(f[0]!.eiere).toEqual([
      { person: "Helen", prosent: 50 },
      { person: "Felles", prosent: 50 },
    ]);
  });

  it("læring: regelen oppdateres og like transaksjoner foreslås; «bruk og utvid» tilbys", async () => {
    const { user, resultat, onUtfor } = renderPanel();
    await user.type(screen.getByRole("searchbox", { name: "Søk blant poster" }), "kantine");
    await user.click(screen.getByRole("button", { name: /Kantine/ }));
    await user.click(screen.getByRole("checkbox", { name: /Lær denne koblingen/ }));

    expect(screen.getByText(/Fins allerede en regel for/)).toHaveTextContent(
      "Utvidet til «rema» vil også treffe 2 observasjoner.",
    );
    await user.click(screen.getByRole("button", { name: "Bruk og utvid eksisterende regel" }));
    expect(resultat().noder).toEqual(["rules"]);
    expect(resultat().rules.find((r) => r.id === "r-kantine")).toMatchObject({
      pattern: "rema",
      matchType: "starter_med",
    });

    await user.click(screen.getByRole("button", { name: "Lagre" }));
    expect(onUtfor).toHaveBeenCalledTimes(2);
    const r = resultat();
    expect(r.noder).toEqual(["hendelser", "transaksjoner", "rules"]);
    expect(r.transaksjoner.find((x) => x.id === "t-2")).toMatchObject({
      status: "foresoatt_match",
      matchetMot: "kantine",
    });
    expect(r.rules).toHaveLength(3); // ny regel for Kantine
  });

  it("på vent med årsak", async () => {
    const { user, resultat } = renderPanel();
    await user.click(screen.getByRole("button", { name: "⏸️ Sett denne på vent i stedet" }));
    expect(screen.getByText("Hva mangler før denne kan plasseres?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "🤔 Må avklares" }));
    await user.click(screen.getByRole("button", { name: "Lagre" }));
    expect(resultat().hendelser[0]).toMatchObject({
      status: "pa_vent",
      paaVentAarsak: "maa_avklares",
      fordelinger: [],
    });
  });

  it("intern overføring: motpart fra forslag markerer begge sider", async () => {
    const { user, resultat } = renderPanel(transaksjoner[2]!);
    await user.click(screen.getByRole("button", { name: "↔️ Registrer som intern overføring" }));
    await user.click(screen.getByRole("button", { name: /OVERFØRING SPAR · 5\s000 kr/ }));
    expect(screen.queryByText(/stemmer ikke med vanlige krav/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Lagre" }));
    const r = resultat();
    expect(r.noder).toEqual(["transaksjoner"]);
    expect(r.transaksjoner.find((x) => x.id === "t-ut")).toMatchObject({
      behandlingstype: "intern_overforing",
      motpartTransaksjonId: "t-inn",
    });
    expect(r.transaksjoner.find((x) => x.id === "t-inn")).toMatchObject({
      motpartTransaksjonId: "t-ut",
    });
  });

  it("intern overføring via søk varsler når kravene ikke stemmer", async () => {
    const { user } = renderPanel(transaksjoner[2]!);
    await user.click(screen.getByRole("button", { name: "↔️ Registrer som intern overføring" }));
    await user.type(screen.getByRole("searchbox", { name: "Søk blant andre hendelser" }), "rema");
    await user.click(screen.getAllByRole("button", { name: /REMA 1000/ })[0]!);
    expect(screen.getByRole("note")).toHaveTextContent("stemmer ikke med vanlige krav");
  });

  it("Ignorer setter status og lukker", async () => {
    const { user, resultat, onLukk } = renderPanel();
    await user.click(screen.getByRole("button", { name: "Ignorer" }));
    expect(resultat().transaksjoner.find((x) => x.id === "t-1")!.status).toBe("ignorert");
    expect(onLukk).toHaveBeenCalled();
  });

  it("forhåndsvelger den gamle matchede posten for et forslag uten hendelse", () => {
    renderPanel(transaksjoner[4]!);
    expect(screen.getByText("Kantine")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lagre" })).toBeEnabled();
  });

  it("feil ved skriving: melding, panelet blir stående", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user, onLukk } = renderPanel(
      transaksjoner[0]!,
      vi.fn().mockRejectedValue(new Error("nett")),
    );
    await user.click(screen.getByRole("button", { name: "Ignorer" }));
    expect(screen.getByText("⚠ Noe gikk galt. Se konsollen for detaljer.")).toBeInTheDocument();
    expect(onLukk).not.toHaveBeenCalled();
  });
});

describe("TransaksjonsoversiktView med beslutninger", () => {
  const props = {
    transaksjoner,
    hendelser,
    receipts: [],
    rules,
    budgetGroups,
    incomeGroups,
    sparingGroups,
  };

  it("porten av: rader kan ikke åpnes, «Kun visning» vises", () => {
    render(<TransaksjonsoversiktView {...props} onUtfor={vi.fn()} />);
    expect(screen.getByRole("note")).toHaveTextContent("Kun visning");
    expect(document.querySelector("[aria-expanded]")).toBeNull();
  });

  it("porten på: en rad åpner og lukker beslutningspanelet", async () => {
    const user = userEvent.setup();
    render(<TransaksjonsoversiktView {...props} skrivingAktiv onUtfor={vi.fn()} />);
    expect(screen.queryByText(/Kun visning/)).toBeNull();
    const rader = document.querySelectorAll("[aria-expanded]");
    expect(rader.length).toBeGreaterThan(0);
    await user.click(rader[0] as HTMLElement);
    expect(screen.getByRole("group", { name: /^Behandle / })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("group", { name: /^Behandle / })).toBeNull();
  });
});
