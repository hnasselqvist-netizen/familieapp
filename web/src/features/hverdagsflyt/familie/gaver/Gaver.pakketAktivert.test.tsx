import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Anledning, Gave, Person } from "@app-types/gaver";
import type { GaverHandlinger } from "@hooks/useGaver";
import { GaverView } from "./GaverView";

/**
 * Status «Pakket» i appens aktiverte standardmodus (#20, ordre 7005959850 og
 * 7038853728, review 5973381911), med den EKTE aktiveringsbryteren (ingen
 * mock). Rollback-modusen (bryteren av) dekkes i `Gaver.test.tsx`.
 */
const T = "2026-11-02T10:00:00.000Z";

function handlinger(over: Partial<GaverHandlinger> = {}): GaverHandlinger {
  return {
    nyPersonId: () => "ny1",
    nyGaveId: () => "g-ny",
    lagrePerson: vi.fn().mockResolvedValue(undefined),
    arkiverPerson: vi.fn().mockResolvedValue(undefined),
    lagreGruppeStandard: vi.fn().mockResolvedValue(undefined),
    startJul: vi.fn().mockResolvedValue(undefined),
    leggTilMottaker: vi.fn().mockResolvedValue(undefined),
    fjernMottaker: vi.fn().mockResolvedValue(undefined),
    settMottakerBudsjett: vi.fn().mockResolvedValue(undefined),
    lagreGave: vi.fn().mockResolvedValue(undefined),
    settGaveStatus: vi.fn().mockResolvedValue(undefined),
    settValgt: vi.fn().mockResolvedValue(undefined),
    flyttGave: vi.fn().mockResolvedValue(undefined),
    registrerGave: vi.fn().mockResolvedValue(undefined),
    // Et frosset forsøk: det testen sender videre, er objektet herfra.
    lagRegistrering: vi.fn((gaveId, utkast, anledningValg) =>
      Object.freeze({ gaveId, utkast, anledningValg, gave: {}, sesjon: "s1" }),
    ),
    sendRegistrering: vi.fn().mockResolvedValue(undefined),
    fullforRegistrering: vi.fn().mockResolvedValue(undefined),
    fullforBursdag: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const person: Person = {
  id: "p1",
  navn: "Syntetisk Tante",
  gruppe: "naer",
  unntak: {},
  versjon: 3,
  opprettet: T,
  oppdatert: T,
};

const jul: Anledning = {
  id: "jul-2026",
  type: "jul",
  aar: 2026,
  mottakere: { p1: { budsjett: { type: "belop", belopOre: 50000 } } },
  versjon: 1,
  opprettet: T,
  oppdatert: T,
};

const ide = (over: Partial<Gave> = {}): Gave => ({
  id: "g1",
  personId: "p1",
  anledningId: "jul-2026",
  tekst: "Bok",
  status: "ide",
  planlagtOre: 30000,
  versjon: 1,
  opprettet: T,
  oppdatert: T,
  ...over,
});

const vis = (
  h: GaverHandlinger,
  over: { anledninger?: Anledning[]; gaver?: Gave[]; personer?: Person[] } = {},
) =>
  render(
    <GaverView
      aar={2026}
      grupper={{}}
      personer={over.personer ?? [person]}
      anledninger={over.anledninger ?? [jul]}
      gaver={over.gaver ?? []}
      handlinger={h}
    />,
  );

describe("status «Pakket» AKTIVERT (aktiveringscommiten)", () => {
  const valg = (el: HTMLElement) =>
    within(el)
      .getAllByRole("option")
      .map((o) => [(o as HTMLOptionElement).value, o.textContent]);

  it("statusvalget har Pakket mellom Kjøpt og Gitt, og valget sender «pakket»", async () => {
    const h = handlinger();
    vis(h, { gaver: [ide({ status: "kjopt" })] });
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    const status = within(kort).getByLabelText("Status for Bok");
    expect(valg(status)).toEqual([
      ["ide", "Idé"],
      ["kjopt", "Kjøpt"],
      ["pakket", "Pakket"],
      ["gitt", "Gitt"],
    ]);
    await userEvent.selectOptions(status, "pakket");
    expect(h.settGaveStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }), "pakket");
  });

  it("en pakket gave er «Ferdig», teller i planen som Kjøpt, og statusen vises som Pakket", () => {
    vis(handlinger(), { gaver: [ide({ status: "pakket", planlagtOre: 30000 })] });
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    expect(within(kort).getByText("Ferdig")).toBeInTheDocument();
    expect(within(kort).queryByText("Mangler gave")).toBeNull();
    expect(within(kort).getByLabelText("Status for Bok")).toHaveValue("pakket");
    expect(screen.getByText("Planlagt for gaver").nextSibling).toHaveTextContent("300 kr");
  });

  it("Pakket kan endres tilbake til Kjøpt og Idé i samme statusvalg", async () => {
    const h = handlinger();
    vis(h, { gaver: [ide({ status: "pakket" })] });
    const status = within(screen.getByRole("region", { name: "Syntetisk Tante" })).getByLabelText(
      "Status for Bok",
    );
    await userEvent.selectOptions(status, "kjopt");
    expect(h.settGaveStatus).toHaveBeenLastCalledWith(expect.anything(), "kjopt");
    await userEvent.selectOptions(status, "ide");
    expect(h.settGaveStatus).toHaveBeenLastCalledWith(expect.anything(), "ide");
  });

  it("gaveeditoren tilbyr Pakket og lagrer status «pakket» (gaveEndring fjerner «valgt»)", async () => {
    const h = handlinger();
    vis(h, { gaver: [ide({ valgt: true })] });
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    await userEvent.click(within(kort).getByRole("button", { name: /Rediger Bok/ }));
    const skjema = within(kort).getByRole("form");
    await userEvent.selectOptions(within(skjema).getByLabelText("Status"), "pakket");
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(h.lagreGave).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ status: "pakket" }),
      expect.anything(),
    );
  });

  it("helårsoversikten: registrering tilbyr Pakket, og en pakket gave teller i gaveverdien", async () => {
    vis(handlinger(), {
      gaver: [ide({ id: "j1", status: "pakket", planlagtOre: 30000 })],
    });
    await userEvent.click(screen.getByRole("button", { name: "Året 2026" }));
    const tante = screen.getByRole("region", { name: "Syntetisk Tante" });
    expect(
      (within(tante).getByText("Jul 2026", { selector: "dt" }).nextElementSibling as HTMLElement)
        .textContent,
    ).toContain("300 kr");
    await userEvent.click(screen.getByRole("button", { name: "Registrer gave" }));
    const skjema = screen.getByRole("form", { name: "Registrer gave" });
    expect(valg(within(skjema).getByLabelText("Status"))).toEqual([
      ["ide", "Idé"],
      ["kjopt", "Kjøpt"],
      ["pakket", "Pakket"],
      ["gitt", "Gitt"],
    ]);
  });
});
