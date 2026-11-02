import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Anledning, Gave, Person } from "@app-types/gaver";
import type { GaverHandlinger } from "@hooks/useGaver";
import { GaverView } from "./GaverView";

/**
 * Gaver (S1): UI-et bevarer utkastet ved konflikt og lagringsfeil, viser
 * ingen ferdigmelding før lagringen er bekreftet, og forklarer summene.
 * Logikken er testet i domenet; skrivingen i emulatortestene.
 */
const T = "2026-11-02T10:00:00.000Z";

const konflikt = () =>
  Object.assign(new Error("Endret på en annen enhet."), { name: "EndretAvAndre" });

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
      budsjett={[]}
      handlinger={h}
    />,
  );

describe("GaverView", () => {
  it("julen startes bare eksplisitt", async () => {
    const h = handlinger();
    vis(h, { anledninger: [] });
    expect(h.startJul).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Start juleplanlegging 2026" }));
    expect(h.startJul).toHaveBeenCalledWith(2026);
  });

  it("konflikt ved redigering av person: utkastet beholdes, og brukeren velger", async () => {
    const lagrePerson = vi.fn().mockRejectedValueOnce(konflikt()).mockResolvedValue(undefined);
    const h = handlinger({ lagrePerson });
    vis(h);
    await userEvent.click(screen.getByRole("button", { name: "Personer" }));
    await userEvent.click(screen.getByRole("button", { name: "Rediger Syntetisk Tante" }));
    const skjema = screen.getByRole("form", { name: "Rediger Syntetisk Tante" });
    const navn = within(skjema).getByLabelText("Navn");
    await userEvent.clear(navn);
    await userEvent.type(navn, "Mitt utkast");
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("annen enhet");
    expect(within(skjema).getByLabelText("Navn")).toHaveValue("Mitt utkast");
    expect(lagrePerson).toHaveBeenLastCalledWith(
      "p1",
      expect.objectContaining({ navn: "Mitt utkast" }),
      person,
    );

    await userEvent.click(screen.getByRole("button", { name: "Lagre min versjon likevel" }));
    expect(lagrePerson).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("form", { name: "Rediger Syntetisk Tante" })).not.toBeInTheDocument();
  });

  it("nettverksfeil ved ny idé: skjemaet blir stående med utkastet", async () => {
    const lagreGave = vi.fn().mockRejectedValue(new Error("offline"));
    vis(handlinger({ lagreGave }));
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    await userEvent.click(within(kort).getByRole("button", { name: "Legg til idé eller gave" }));
    const skjema = within(kort).getByRole("form", { name: "Ny idé eller gave" });
    await userEvent.type(within(skjema).getByLabelText("Idé eller gave"), "Skjerf");
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(await within(kort).findByRole("alert")).toHaveTextContent("tatt vare på");
    expect(within(skjema).getByLabelText("Idé eller gave")).toHaveValue("Skjerf");
    expect(lagreGave).toHaveBeenCalledWith(
      "g-ny",
      expect.objectContaining({
        personId: "p1",
        anledningId: "jul-2026",
        tekst: "Skjerf",
        status: "ide",
      }),
      null,
    );
  });

  it("ugyldig beløp lagres ikke; 0 er gyldig", async () => {
    const lagreGave = vi.fn().mockResolvedValue(undefined);
    vis(handlinger({ lagreGave }));
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    await userEvent.click(within(kort).getByRole("button", { name: "Legg til idé eller gave" }));
    const skjema = within(kort).getByRole("form", { name: "Ny idé eller gave" });
    await userEvent.type(within(skjema).getByLabelText("Idé eller gave"), "Kort");
    await userEvent.type(within(skjema).getByLabelText("Planlagt beløp (valgfritt)"), "abc");
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(lagreGave).not.toHaveBeenCalled();
    const belop = within(skjema).getByLabelText("Planlagt beløp (valgfritt)");
    await userEvent.clear(belop);
    await userEvent.type(belop, "0");
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(lagreGave).toHaveBeenCalledWith(
      "g-ny",
      expect.objectContaining({ planlagtOre: 0 }),
      null,
    );
  });

  it("en idé er «Mangler gave»; summen teller bare valgte ideer og forklares", () => {
    vis(handlinger(), {
      gaver: [ide(), ide({ id: "g2", tekst: "Te", planlagtOre: 9900, valgt: true })],
    });
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    expect(within(kort).getByText("Mangler gave")).toBeInTheDocument();
    expect(
      screen.getByText(/Ideer som ikke er valgt, er alternativer og telles ikke/),
    ).toBeInTheDocument();
    expect(screen.getByText("Planlagt for gaver").nextSibling).toHaveTextContent("99 kr");
  });

  it("fjerning krever bekreftelse, forklarer at gavene beholdes, og er reversibel", async () => {
    const h = handlinger();
    vis(h, { gaver: [ide()] });
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    await userEvent.click(within(kort).getByRole("button", { name: "Fjern fra årets liste" }));
    expect(h.fjernMottaker).not.toHaveBeenCalled();
    const gruppe = within(kort).getByRole("group", { name: "Fjern Syntetisk Tante" });
    expect(gruppe).toHaveTextContent("beholdes");
    await userEvent.click(within(gruppe).getByRole("button", { name: "Fjern fra årets liste" }));
    expect(h.fjernMottaker).toHaveBeenCalledWith(jul, "p1");
  });

  it("fjernet mottaker vises med gavene og kan legges tilbake", async () => {
    const h = handlinger();
    const fjernet = { ...jul, mottakere: { p1: { ...jul.mottakere.p1!, fjernet: T } } };
    vis(h, { anledninger: [fjernet], gaver: [ide({ status: "kjopt" })] });
    expect(screen.getByText("Fjernet fra årets liste")).toBeInTheDocument();
    expect(screen.getByText("Bok")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Legg Syntetisk Tante tilbake" }));
    expect(h.leggTilMottaker).toHaveBeenCalledWith(fjernet, person);
  });

  it("løpende idé kan opprettes fra registeret før planen er startet", async () => {
    const lagreGave = vi.fn().mockResolvedValue(undefined);
    vis(handlinger({ lagreGave }), { anledninger: [] });
    await userEvent.click(screen.getByRole("button", { name: "Personer" }));
    await userEvent.click(screen.getByRole("button", { name: "Ideer for Syntetisk Tante (0)" }));
    const seksjon = screen.getByRole("region", { name: "Løpende ideer for Syntetisk Tante" });
    expect(seksjon).toHaveTextContent("Når juleplanleggingen for 2026 er startet");
    await userEvent.click(
      within(seksjon).getByRole("button", { name: "Ny idé til Syntetisk Tante" }),
    );
    const skjema = within(seksjon).getByRole("form", { name: "Ny idé eller gave" });
    await userEvent.type(within(skjema).getByLabelText("Idé eller gave"), "Puslespill");
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(lagreGave).toHaveBeenCalledWith(
      "g-ny",
      expect.objectContaining({ personId: "p1", anledningId: undefined, tekst: "Puslespill" }),
      null,
    );
  });

  it("løpende idé kan brukes til jul fra registeret når personen er mottaker", async () => {
    const flyttGave = vi.fn().mockResolvedValue(undefined);
    const lop = ide({ id: "g9", anledningId: undefined, tekst: "Puslespill" });
    vis(handlinger({ flyttGave }), { gaver: [lop] });
    await userEvent.click(screen.getByRole("button", { name: "Personer" }));
    await userEvent.click(screen.getByRole("button", { name: "Ideer for Syntetisk Tante (1)" }));
    await userEvent.click(screen.getByRole("button", { name: "Bruk til jul 2026" }));
    expect(flyttGave).toHaveBeenCalledWith(lop, "jul-2026");
  });

  it("konflikt på NY gave: utkastet beholdes; «lagre likevel» bruker den lagrede posten som grunnlag", async () => {
    const lagreGave = vi.fn().mockRejectedValueOnce(konflikt()).mockResolvedValue(undefined);
    const h = handlinger({ lagreGave });
    const { rerender } = vis(h);
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    await userEvent.click(within(kort).getByRole("button", { name: "Legg til idé eller gave" }));
    const skjema = within(kort).getByRole("form", { name: "Ny idé eller gave" });
    await userEvent.type(within(skjema).getByLabelText("Idé eller gave"), "Mitt utkast");
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(await within(kort).findByRole("alert")).toHaveTextContent("annen enhet");
    expect(within(skjema).getByLabelText("Idé eller gave")).toHaveValue("Mitt utkast");

    // Den lagrede posten (fra en annen enhet) kommer inn via abonnementet.
    const lagret = ide({ id: "g-ny", tekst: "Nyere endring", status: "kjopt", versjon: 2 });
    rerender(
      <GaverView
        aar={2026}
        grupper={{}}
        personer={[person]}
        anledninger={[jul]}
        gaver={[lagret]}
        budsjett={[]}
        handlinger={h}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Lagre min versjon likevel" }));
    expect(lagreGave).toHaveBeenLastCalledWith(
      "g-ny",
      expect.objectContaining({ tekst: "Mitt utkast" }),
      lagret,
    );
  });
});
