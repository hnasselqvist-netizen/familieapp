import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { RegelRecord } from "@app-types/forsoning";
import type { EndreMalUtfall } from "@domain/forsoning/regelMal";
import { RegelsenterView, type RegelsenterViewProps } from "./RegelsenterView";

/**
 * Komponenttester for RegelSenter (§Issue #34 R1). Logikken (søk,
 * sortering, gruppering, skriveupdatere) er differensielt testet mot
 * legacy i `domain/forsoning/regelsenter.legacy.test.ts`; her låses at
 * skjermen er REN VISNING når aktiveringsporten er av, og at kontrollene
 * kaller riktig handling når den er på.
 */

const regel = (id: string, felt: Partial<RegelRecord> = {}): RegelRecord => ({
  id,
  pattern: id,
  normalizedPattern: id.toLowerCase(),
  targetType: "budget",
  targetId: "b-mat",
  targetName: "Dagligvarer",
  mode: "suggest",
  ...felt,
});

const grupper = {
  budgetGroups: [
    {
      id: "mat",
      label: "Mat",
      items: [{ id: "b-mat", name: "Dagligvarer", meta: { niva: "beskytte" } }],
    },
  ] as unknown as BudsjettGruppe[],
  incomeGroups: [],
  sparingGroups: [
    { id: "buffer", label: "Buffer", items: [{ id: "s-buffer", name: "Bufferkonto" }] },
  ] as unknown as BudsjettGruppe[],
};

const regler = [
  regel("REMA 1000", { timesUsed: 9, mode: "auto" }),
  regel("Kiwi", { timesUsed: 3, mode: "review" }),
  regel("Coop", { active: false }),
  regel("Buffer", { targetId: "s-buffer", targetType: "sparing", targetName: "Bufferkonto" }),
];

function renderView(props: Partial<RegelsenterViewProps> = {}) {
  const handlers = { onOppdater: vi.fn(), onSlett: vi.fn(), onSlaSammen: vi.fn() };
  render(
    <RegelsenterView
      regler={regler}
      grupper={grupper}
      transaksjoner={[{ tekst: "REMA 1000 OSLO" }, { tekst: "Rema 1000 Bergen" }]}
      skrivingAktiv={false}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("RegelsenterView — skriving AV (dagens tilstand, til R3b)", () => {
  it("viser status, nivå- og sparegruppering, og merker skjermen som kun visning", () => {
    renderView();
    expect(screen.getByRole("note")).toHaveTextContent("Kun visning");
    expect(screen.getByText("Totalt").nextSibling).toHaveTextContent("4");
    expect(screen.getByText("Aktive").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Automatiske").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Krever vurdering").nextSibling).toHaveTextContent("1");
    expect(screen.getByRole("heading", { name: /Sparing/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Beskytte/ })).toBeInTheDocument();
  });

  it("sorterer aktive først, så flest bruk", () => {
    renderView();
    const beskytte = screen.getByRole("heading", { name: /Beskytte/ }).closest("section")!;
    const rader = within(beskytte)
      .getAllByRole("button")
      .map((b) => b.textContent ?? "");
    expect(rader.map((t) => t.split("→")[0])).toEqual([
      expect.stringContaining("REMA 1000"),
      expect.stringContaining("Kiwi"),
      expect.stringContaining("Coop"),
    ]);
  });

  it("søk filtrerer på mønster og kobling", async () => {
    renderView();
    await userEvent.type(screen.getByLabelText("Søk i regler"), "kiwi");
    expect(screen.queryByText("REMA 1000")).not.toBeInTheDocument();
    expect(screen.getByText("Kiwi")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Søk i regler"));
    await userEvent.type(screen.getByLabelText("Søk i regler"), "finnes ikke");
    expect(screen.getByText("Ingen regler matcher søket.")).toBeInTheDocument();
  });

  it("detaljvisningen er skrivebeskyttet: ingen redigering, sletting eller sammenslåing", async () => {
    const h = renderView();
    expect(screen.queryByRole("button", { name: "Slå sammen regler" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("REMA 1000"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Treffer i dag").nextSibling).toHaveTextContent(
      "2 observasjoner",
    );
    expect(within(dialog).queryByRole("button", { name: "Slett regel" })).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Mønster")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("slider")).not.toBeInTheDocument();
    expect(h.onOppdater).not.toHaveBeenCalled();
    expect(h.onSlett).not.toHaveBeenCalled();
  });

  it("tom regelliste viser legacy-teksten", () => {
    renderView({ regler: [] });
    expect(screen.getByText(/Ingen regler er lært ennå/)).toBeInTheDocument();
  });
});

describe("RegelsenterView — skriving PÅ (slik R3b-cutover vil aktivere den)", () => {
  it("redigeringskontrollene kaller onOppdater med legacy sine felt", async () => {
    const h = renderView({ skrivingAktiv: true });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    await userEvent.click(screen.getByText("Kiwi"));
    const dialog = screen.getByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Auto" }));
    expect(h.onOppdater).toHaveBeenLastCalledWith("Kiwi", { mode: "auto" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Er lik" }));
    expect(h.onOppdater).toHaveBeenLastCalledWith("Kiwi", { matchType: "er_lik" });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Aktiv/ }));
    expect(h.onOppdater).toHaveBeenLastCalledWith("Kiwi", { active: false });
    await userEvent.click(within(dialog).getByRole("checkbox", { name: /Flerbruk/ }));
    expect(h.onOppdater).toHaveBeenLastCalledWith("Kiwi", { multiUse: true });

    const monster = within(dialog).getByLabelText("Mønster");
    await userEvent.clear(monster);
    await userEvent.type(monster, "Kiwi Ny{Enter}");
    expect(h.onOppdater).toHaveBeenLastCalledWith("Kiwi", {
      pattern: "Kiwi Ny",
      normalizedPattern: "kiwi ny",
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "Slett regel" }));
    expect(h.onSlett).toHaveBeenCalledWith("Kiwi");
  });

  it("kontovilkår (#59): raden og detaljen viser at både tekst og konto må stemme", async () => {
    const h = renderView({
      skrivingAktiv: true,
      regler: [
        regel("REMA 1000", { matchType: "inneholder", kontoVilkar: "helen", mode: "auto" }),
        regel("Kiwi", { mode: "auto" }),
      ],
      transaksjoner: [
        { tekst: "REMA 1000 OSLO", konto: "Helen" },
        { tekst: "REMA 1000 OSLO", konto: "Felleskonto" },
      ],
    });
    expect(screen.getByText("+ bare fra Helen")).toBeInTheDocument();
    expect(screen.getAllByText(/\+ bare fra/)).toHaveLength(1);

    await userEvent.click(screen.getByText("REMA 1000"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Treffer når").nextSibling).toHaveTextContent(
      "Inneholder «rema 1000» og betalt fra HelenBegge vilkårene må stemme.",
    );
    expect(within(dialog).getByText("Treffer i dag").nextSibling).toHaveTextContent(
      "1 observasjon",
    );
    const konto = within(dialog).getByRole("group", { name: "Betalt fra konto" });
    expect(within(konto).getByRole("button", { name: "Helen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(within(konto).getByRole("button", { name: "Eivind" }));
    expect(h.onOppdater).toHaveBeenLastCalledWith("REMA 1000", { kontoVilkar: "eivind" });
    await userEvent.click(within(konto).getByRole("button", { name: "Alle kontoer" }));
    expect(h.onOppdater).toHaveBeenLastCalledWith("REMA 1000", { kontoVilkar: null });
  });

  it("tallregel (#59, 6543702753): eksakt kontonummer, treff i alle skrivemåter, ingen hjelpetekst", async () => {
    renderView({
      regler: [regel("20957976493", { targetId: "b-mat", mode: "auto" })],
      transaksjoner: [
        { tekst: "Til :20957976493" },
        { tekst: "Til : 2095.79.76493" },
        { tekst: "Til :20957976494" },
        { tekst: "Til :" },
      ],
    });
    await userEvent.click(screen.getByText("20957976493"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Treffer når").nextSibling).toHaveTextContent(
      /^Teksten har tallet «20957976493» \(eksakt kontonummer\/KID\)$/,
    );
    expect(within(dialog).getByText("Treffer i dag").nextSibling).toHaveTextContent(
      "2 observasjoner",
    );
    expect(within(dialog).queryByText(/Lange tall fjernes/)).not.toBeInTheDocument();
  });

  it("tallregel med skilletegn (kontrakt B, review 5775285764): vises som sifrene og teller eksakt", async () => {
    renderView({
      regler: [regel("001 234 567", { targetId: "b-mat", mode: "auto" })],
      transaksjoner: [
        { tekst: "KID 001234567" },
        { tekst: "Giro KID: 001234567" },
        { tekst: "KID 01234567" },
        { tekst: "KID 0012345678" },
      ],
    });
    await userEvent.click(screen.getByText("001 234 567"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Treffer når").nextSibling).toHaveTextContent(
      /^Teksten har tallet «001234567» \(eksakt kontonummer\/KID\)$/,
    );
    expect(within(dialog).getByText("Treffer i dag").nextSibling).toHaveTextContent(
      "2 observasjoner",
    );
    expect(within(dialog).queryByText(/Lange tall fjernes/)).not.toBeInTheDocument();
  });

  it("blandet mønster med langt tall får hjelpetekst og treffer ingenting", async () => {
    renderView({
      regler: [regel("Til :20957976493", { mode: "auto" })],
      transaksjoner: [{ tekst: "Til :20957976493" }, { tekst: "Til :12345678903" }],
    });
    await userEvent.click(screen.getByText("Til :20957976493"));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "Lange tall fjernes fra bankteksten før matching. Bruk bare tallet for å treffe en bestemt konto eller KID.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Treffer i dag").nextSibling).toHaveTextContent(
      "0 observasjoner",
    );
  });

  it("en regel uten kontovilkår vises og redigeres som før, med «Alle kontoer» valgt", async () => {
    const h = renderView({ skrivingAktiv: true });
    await userEvent.click(screen.getByText("Kiwi"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Treffer når").nextSibling).toHaveTextContent(
      /^Inneholder «kiwi»$/,
    );
    const konto = within(dialog).getByRole("group", { name: "Betalt fra konto" });
    expect(within(konto).getByRole("button", { name: "Alle kontoer" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await userEvent.click(within(konto).getByRole("button", { name: "Helen" }));
    expect(h.onOppdater).toHaveBeenLastCalledWith("Kiwi", { kontoVilkar: "helen" });
  });

  it("regelstyrt ansvar (#59): raden og detaljen viser ansvaret, og det kan redigeres", async () => {
    const h = renderView({
      skrivingAktiv: true,
      regler: [
        regel("REMA 1000", {
          kontoVilkar: "helen",
          eiere: [{ person: "Helen", prosent: 100 }],
          mode: "auto",
        }),
        regel("Kiwi", { mode: "auto" }),
      ],
    });
    const rema = screen.getByText("REMA 1000").closest("button")!;
    expect(rema).toHaveTextContent("→ Dagligvarer · Helen ·");
    expect(screen.getByText("Kiwi").closest("button")).not.toHaveTextContent("Dagligvarer ·  ·");

    await userEvent.click(screen.getByText("REMA 1000"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Ansvar ved treff").nextSibling).toHaveTextContent(/^Helen$/);
    const ansvar = within(dialog).getByRole("group", { name: "Ansvar" });
    expect(within(ansvar).getByRole("button", { name: "Helen" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Siste valgte kan ikke fjernes — minst én eier.
    await userEvent.click(within(ansvar).getByRole("button", { name: "Helen" }));
    expect(h.onOppdater).not.toHaveBeenCalled();
    await userEvent.click(within(ansvar).getByRole("button", { name: "Felles" }));
    expect(h.onOppdater).toHaveBeenLastCalledWith("REMA 1000", {
      eiere: [
        { person: "Helen", prosent: 50 },
        { person: "Felles", prosent: 50 },
      ],
    });
  });

  it("en regel uten eget ansvar viser «Felles (standard)» og får ansvar ved første valg", async () => {
    const h = renderView({ skrivingAktiv: true });
    await userEvent.click(screen.getByText("Kiwi"));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Ansvar ved treff").nextSibling).toHaveTextContent(
      "Felles (standard)",
    );
    const ansvar = within(dialog).getByRole("group", { name: "Ansvar" });
    for (const p of ["Felles", "Helen", "Eivind"]) {
      expect(within(ansvar).getByRole("button", { name: p })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    }
    await userEvent.click(within(ansvar).getByRole("button", { name: "Eivind" }));
    expect(h.onOppdater).toHaveBeenLastCalledWith("Kiwi", {
      eiere: [{ person: "Eivind", prosent: 100 }],
    });
  });

  it("slå sammen: velg to regler → onSlaSammen", async () => {
    const h = renderView({ skrivingAktiv: true });
    await userEvent.click(screen.getByRole("button", { name: "Slå sammen regler" }));
    await userEvent.click(screen.getByText("REMA 1000"));
    expect(screen.getByText(/Velg 1 regel til/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("Kiwi"));
    await userEvent.click(screen.getByRole("button", { name: "Slå sammen disse 2" }));
    expect(h.onSlaSammen).toHaveBeenCalledWith("REMA 1000", "Kiwi");
  });
});

describe("RegelsenterView — endre målpost (#59, 6643098967)", () => {
  const malGrupper = {
    budgetGroups: [
      {
        id: "mat",
        label: "Mat",
        items: [{ id: "b-mat", name: "Dagligvarer", meta: { niva: "beskytte" } }],
      },
      { id: "bolig", label: "Bolig", items: [{ id: "b-vedl", name: "Vedlikehold" }] },
      {
        id: "fritid",
        label: "Fritid",
        items: [{ id: "b-gammel", name: "Gammel", meta: { arkivert: true } }],
      },
    ] as unknown as BudsjettGruppe[],
    incomeGroups: [
      { id: "lonn", label: "Lønn", items: [{ id: "i-lonn", name: "Lønn Helen" }] },
    ] as unknown as BudsjettGruppe[],
    sparingGroups: [
      { id: "hus", label: "Bolig", items: [{ id: "s-vedl", name: "Vedlikehold" }] },
    ] as unknown as BudsjettGruppe[],
  };
  const R = regel("OPENAI", {
    targetGruppe: "Mat",
    kontoVilkar: "MC",
    eiere: [{ person: "Helen", prosent: 100 }],
    matchType: "starter_med",
  });

  function vis(onEndreMal: RegelsenterViewProps["onEndreMal"], skrivingAktiv = true) {
    const props = {
      regler: [R],
      grupper: malGrupper,
      transaksjoner: [],
      skrivingAktiv,
      onOppdater: vi.fn(),
      onSlett: vi.fn(),
      onSlaSammen: vi.fn(),
      onEndreMal,
    };
    const r = render(<RegelsenterView {...props} />);
    return {
      ...props,
      user: userEvent.setup(),
      oppdater: (regler: RegelRecord[]) =>
        r.rerender(<RegelsenterView {...props} regler={regler} />),
    };
  }
  const apne = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByText("OPENAI"));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Endre målpost" }));
    return dialog;
  };
  const kobletMot = () => within(screen.getByRole("dialog")).getByText("Koblet mot").nextSibling;
  const velger = () => screen.getByRole("region", { name: "Endre målpost" });
  const valg = (re: RegExp) => within(velger()).getByRole("button", { name: re });

  it("skriving AV: målet vises, men kan ikke endres", async () => {
    const v = vis(vi.fn(), false);
    await v.user.click(screen.getByText("OPENAI"));
    expect(kobletMot()).toHaveTextContent("Dagligvarer (Mat · Kostnad)");
    expect(screen.queryByRole("button", { name: "Endre målpost" })).not.toBeInTheDocument();
  });

  it("aktive poster i alle tre typer; like navn skilles med livsområde og type; arkivert er ikke valg", async () => {
    const v = vis(vi.fn());
    await apne(v.user);
    const navn = within(velger())
      .getAllByRole("button", { pressed: false })
      .map((b) => b.textContent);
    expect(navn).toEqual([
      "DagligvarerMat · Kostnad · nå",
      "VedlikeholdBolig · Kostnad",
      "Lønn HelenLønn · Inntekt",
      "VedlikeholdBolig · Sparing",
    ]);
    await v.user.type(within(velger()).getByRole("searchbox"), "sparing");
    expect(within(velger()).getAllByRole("button", { pressed: false })).toHaveLength(1);
  });

  it("lagrer type + id; venter vises, ingen dobbeltskriving, gammelt mål til bekreftet", async () => {
    let svar!: (u: { status: "lagret"; mal: unknown }) => void;
    const onEndreMal = vi.fn(() => new Promise((res) => (svar = res as typeof svar)));
    const v = vis(onEndreMal as unknown as RegelsenterViewProps["onEndreMal"]);
    await apne(v.user);
    await v.user.click(valg(/^VedlikeholdBolig · Sparing/));
    expect(within(velger()).getByText(/^Ny:/)).toHaveTextContent("Vedlikehold — Bolig · Sparing");
    const lagre = within(velger()).getByRole("button", { name: "Lagre målpost" });
    await v.user.click(lagre);
    await v.user.click(lagre);
    expect(onEndreMal).toHaveBeenCalledTimes(1);
    expect(onEndreMal).toHaveBeenCalledWith(
      "OPENAI",
      { type: "budget", id: "b-mat" },
      { type: "sparing", id: "s-vedl" },
    );
    expect(within(velger()).getByRole("status")).toHaveTextContent("venter på bekreftelse");
    expect(kobletMot()).toHaveTextContent("Dagligvarer");
    await act(async () =>
      svar({
        status: "lagret",
        mal: { type: "sparing", id: "s-vedl", navn: "Vedlikehold", gruppe: "Bolig" },
      }),
    );
    v.oppdater([
      {
        ...R,
        targetType: "sparing",
        targetId: "s-vedl",
        targetName: "Vedlikehold",
        targetGruppe: "Bolig",
      },
    ]);
    expect(screen.queryByRole("region", { name: "Endre målpost" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent(
      "Lagret. Regelen kobles nå mot Vedlikehold — Bolig · Sparing.",
    );
    expect(kobletMot()).toHaveTextContent("Vedlikehold (Bolig · Sparing)");
    // Øvrige vilkår vises uendret.
    expect(
      within(screen.getByRole("dialog")).getByText("Treffer når").nextSibling,
    ).toHaveTextContent("og betalt fra");
  });

  it("feil: utkastet står, og «Prøv igjen» lagrer samme valg", async () => {
    const onEndreMal = vi
      .fn()
      .mockRejectedValueOnce(new Error("nekt"))
      .mockResolvedValueOnce({
        status: "lagret",
        mal: { type: "income", id: "i-lonn", navn: "Lønn Helen", gruppe: "Lønn" },
      });
    const v = vis(onEndreMal);
    await apne(v.user);
    await v.user.click(valg(/^Lønn Helen/));
    await v.user.click(within(velger()).getByRole("button", { name: "Lagre målpost" }));
    expect(within(velger()).getByRole("alert")).toHaveTextContent("Kunne ikke lagre målposten.");
    expect(valg(/^Lønn Helen/)).toHaveAttribute("aria-pressed", "true");
    await v.user.click(within(velger()).getByRole("button", { name: "Prøv igjen" }));
    expect(onEndreMal).toHaveBeenCalledTimes(2);
    expect(onEndreMal).toHaveBeenLastCalledWith(
      "OPENAI",
      { type: "budget", id: "b-mat" },
      { type: "income", id: "i-lonn" },
    );
  });

  it("ugyldig mål: tydelig feil, utkastet fjernes, ingenting lagret", async () => {
    const v = vis(vi.fn().mockResolvedValue({ status: "mal_ugyldig" }));
    await apne(v.user);
    await v.user.click(valg(/^VedlikeholdBolig · Kostnad/));
    await v.user.click(within(velger()).getByRole("button", { name: "Lagre målpost" }));
    expect(within(velger()).getByRole("alert")).toHaveTextContent("Målposten finnes ikke lenger");
    expect(within(velger()).getByRole("button", { name: "Lagre målpost" })).toBeDisabled();
  });

  it("endret samtidig: ingenting lagret; ny lagring er et bevisst valg mot det nye grunnlaget", async () => {
    const onEndreMal = vi
      .fn()
      .mockResolvedValueOnce({
        status: "endret_samtidig",
        naa: { targetType: "budget", targetId: "b-vedl", targetName: "Vedlikehold" },
      })
      .mockResolvedValueOnce({ status: "uendret" });
    const v = vis(onEndreMal);
    await apne(v.user);
    await v.user.click(valg(/^Lønn Helen/));
    v.oppdater([{ ...R, targetId: "b-vedl", targetName: "Vedlikehold", targetGruppe: "Bolig" }]);
    await v.user.click(within(velger()).getByRole("button", { name: "Lagre målpost" }));
    expect(within(velger()).getByRole("alert")).toHaveTextContent(
      "Regelen ble koblet mot Vedlikehold et annet sted i mellomtiden. Ingenting er lagret.",
    );
    await v.user.click(within(velger()).getByRole("button", { name: "Prøv igjen" }));
    expect(onEndreMal).toHaveBeenLastCalledWith(
      "OPENAI",
      { type: "budget", id: "b-vedl" },
      { type: "income", id: "i-lonn" },
    );
  });

  describe("samtidig endring MENS lagringen venter (review 5776966235)", () => {
    for (const server of [
      {
        targetType: "budget" as const,
        targetId: "b-vedl",
        targetName: "Vedlikehold",
        gruppe: "Bolig",
      },
      {
        targetType: "sparing" as const,
        targetId: "s-vedl",
        targetName: "Vedlikehold",
        gruppe: "Bolig",
      },
    ]) {
      it(`retry bruker det bekreftede målet fra konflikten (${server.targetType})`, async () => {
        let svar!: (u: EndreMalUtfall) => void;
        const onEndreMal = vi
          .fn()
          .mockImplementationOnce(() => new Promise<EndreMalUtfall>((res) => (svar = res)))
          .mockResolvedValueOnce({ status: "uendret" });
        const v = vis(onEndreMal);
        await apne(v.user);
        await v.user.click(valg(/^Lønn Helen/));
        await v.user.click(within(velger()).getByRole("button", { name: "Lagre målpost" }));
        const medServermal = {
          ...R,
          targetType: server.targetType,
          targetId: server.targetId,
          targetName: server.targetName,
          targetGruppe: server.gruppe,
        };
        // Abonnementet leverer servermålet før lagringen svarer …
        v.oppdater([medServermal]);
        await act(async () =>
          svar({
            status: "endret_samtidig",
            naa: {
              targetType: server.targetType,
              targetId: server.targetId,
              targetName: server.targetName,
            },
          }),
        );
        // … og på nytt etter avvisningen.
        v.oppdater([{ ...medServermal }]);
        expect(within(velger()).getByRole("alert")).toHaveTextContent("Ingenting er lagret.");
        expect(valg(/^Lønn Helen/)).toHaveAttribute("aria-pressed", "true");
        expect(onEndreMal).toHaveBeenCalledTimes(1);
        await v.user.click(within(velger()).getByRole("button", { name: "Prøv igjen" }));
        expect(onEndreMal).toHaveBeenLastCalledWith(
          "OPENAI",
          { type: server.targetType, id: server.targetId },
          { type: "income", id: "i-lonn" },
        );
      });
    }
  });

  it("Avbryt og Lukk lagrer aldri utkastet", async () => {
    const onEndreMal = vi.fn();
    const v = vis(onEndreMal);
    await apne(v.user);
    await v.user.click(valg(/^Lønn Helen/));
    await v.user.click(within(velger()).getByRole("button", { name: "Avbryt" }));
    await v.user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Endre målpost" }),
    );
    await v.user.click(valg(/^Lønn Helen/));
    // Lukk-knappen i detaljen (modalen har også sin egen).
    await v.user.click(
      within(screen.getByRole("dialog")).getAllByRole("button", { name: "Lukk" }).at(-1)!,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onEndreMal).not.toHaveBeenCalled();
  });

  it("regelen slettes mens detaljen er åpen: tydelig melding, ingen lagring mulig", async () => {
    const onEndreMal = vi.fn();
    const v = vis(onEndreMal);
    await apne(v.user);
    await v.user.click(valg(/^Lønn Helen/));
    v.oppdater([]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("alert")[0]).toHaveTextContent("Regelen er slettet");
    expect(within(velger()).getByRole("button", { name: "Lagre målpost" })).toBeDisabled();
    expect(onEndreMal).not.toHaveBeenCalled();
  });

  it("tastatur: søk, Tab til en post og Enter velger den", async () => {
    const v = vis(vi.fn());
    await apne(v.user);
    await v.user.type(within(velger()).getByRole("searchbox"), "lønn");
    await v.user.tab();
    expect(valg(/^Lønn Helen/)).toHaveFocus();
    await v.user.keyboard("{Enter}");
    expect(valg(/^Lønn Helen/)).toHaveAttribute("aria-pressed", "true");
  });
});
