import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { RegelRecord } from "@app-types/forsoning";
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
