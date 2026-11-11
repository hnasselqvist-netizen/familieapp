import { fireEvent, render, screen, within } from "@testing-library/react";
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
    registrerGave: vi.fn().mockResolvedValue(undefined),
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

/**
 * Review 5731615381: et levende abonnement kan flytte eller fjerne raden et
 * åpent skjema står i. Utkastet skal overleve, brukeren skal se det, og
 * ingenting skal gjenopprettes automatisk. Endringene kommer som faktisk
 * `rerender` med nye data, slik abonnementet leverer dem.
 */
describe("GaverView — utkast overlever abonnementsendringer", () => {
  const visMed = (
    h: GaverHandlinger,
    d: { anledninger?: Anledning[]; gaver?: Gave[]; personer?: Person[] } = {},
  ) => (
    <GaverView
      aar={2026}
      grupper={{}}
      personer={d.personer ?? [person]}
      anledninger={d.anledninger ?? [jul]}
      gaver={d.gaver ?? []}
      handlinger={h}
    />
  );

  it("person flyttet til annen gruppe av en annen enhet: utkastet står, grunnlaget er opprinnelig versjon", async () => {
    const lagrePerson = vi.fn().mockResolvedValue(undefined);
    const h = handlinger({ lagrePerson });
    const { rerender } = render(visMed(h));
    await userEvent.click(screen.getByRole("button", { name: "Personer" }));
    await userEvent.click(screen.getByRole("button", { name: "Rediger Syntetisk Tante" }));
    const navn = screen.getByLabelText("Navn");
    await userEvent.clear(navn);
    await userEvent.type(navn, "Mitt ulagrede utkast");

    rerender(visMed(h, { personer: [{ ...person, gruppe: "venner", versjon: 4 }] }));
    expect(screen.getByDisplayValue("Mitt ulagrede utkast")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Ulagrede utkast" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Lagre" }));
    // Grunnlaget er versjonen brukeren startet fra (3), så lagringen gir konflikt i datalaget.
    expect(lagrePerson).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ navn: "Mitt ulagrede utkast" }),
      person,
    );
  });

  it("mottaker fjernet av en annen enhet: nytt gaveutkast vises i «Ulagrede utkast», ingen automatisk gjenoppretting", async () => {
    const lagreGave = vi.fn().mockResolvedValue(undefined);
    const h = handlinger({ lagreGave });
    const { rerender } = render(visMed(h));
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    await userEvent.click(within(kort).getByRole("button", { name: "Legg til idé eller gave" }));
    await userEvent.type(within(kort).getByLabelText("Idé eller gave"), "Mitt gaveutkast");

    const fjernet: Anledning = {
      ...jul,
      versjon: 2,
      mottakere: { p1: { budsjett: { type: "ikke_satt" }, fjernet: "t2" } },
    };
    rerender(visMed(h, { anledninger: [fjernet] }));
    expect(screen.queryByRole("region", { name: "Syntetisk Tante" })).not.toBeInTheDocument();
    const panel = screen.getByRole("region", { name: "Ulagrede utkast" });
    expect(within(panel).getByDisplayValue("Mitt gaveutkast")).toBeInTheDocument();
    expect(panel).toHaveTextContent("personen er fjernet fra listen");
    expect(h.leggTilMottaker).not.toHaveBeenCalled();

    await userEvent.click(within(panel).getByRole("button", { name: "Lagre" }));
    expect(lagreGave).toHaveBeenCalledWith(
      "g-ny",
      expect.objectContaining({
        tekst: "Mitt gaveutkast",
        anledningId: "jul-2026",
        personId: "p1",
      }),
      null,
    );
    expect(screen.queryByRole("region", { name: "Ulagrede utkast" })).not.toBeInTheDocument();
  });

  it("utkastet kan forkastes eksplisitt fra panelet", async () => {
    const h = handlinger();
    const { rerender } = render(visMed(h));
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    await userEvent.click(within(kort).getByRole("button", { name: "Legg til idé eller gave" }));
    await userEvent.type(within(kort).getByLabelText("Idé eller gave"), "Kast meg");
    rerender(
      visMed(h, {
        anledninger: [
          { ...jul, mottakere: { p1: { budsjett: { type: "ikke_satt" }, fjernet: "t" } } },
        ],
      }),
    );
    const panel = screen.getByRole("region", { name: "Ulagrede utkast" });
    await userEvent.click(within(panel).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByDisplayValue("Kast meg")).not.toBeInTheDocument();
    expect(h.lagreGave).not.toHaveBeenCalled();
  });

  it("gave flyttet mellom lister (løpende → jul) av en annen enhet: redigeringsutkastet følger med", async () => {
    const h = handlinger();
    const lop = ide({ id: "g9", anledningId: undefined, tekst: "Puslespill" });
    const { rerender } = render(visMed(h, { gaver: [lop] }));
    await userEvent.click(screen.getByRole("button", { name: "Personer" }));
    await userEvent.click(screen.getByRole("button", { name: "Ideer for Syntetisk Tante (1)" }));
    const reg = screen.getByRole("region", { name: "Løpende ideer for Syntetisk Tante" });
    await userEvent.click(within(reg).getByRole("button", { name: "Rediger Puslespill" }));
    const felt = within(reg).getByLabelText("Idé eller gave");
    await userEvent.clear(felt);
    await userEvent.type(felt, "Puslespill 1000 biter");

    rerender(visMed(h, { gaver: [{ ...lop, anledningId: "jul-2026", versjon: 2 }] }));
    // Raden står nå i mottakerkortet under Jul; utkastet er der (fanen er bare skjult).
    await userEvent.click(screen.getByRole("button", { name: "Jul 2026" }));
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    expect(within(kort).getByDisplayValue("Puslespill 1000 biter")).toBeInTheDocument();
    await userEvent.click(within(kort).getByRole("button", { name: "Lagre" }));
    expect(h.lagreGave).toHaveBeenCalledWith(
      "g9",
      expect.objectContaining({ tekst: "Puslespill 1000 biter" }),
      lop,
    );
  });

  it("fanebytte beholder et åpent utkast", async () => {
    render(visMed(handlinger()));
    await userEvent.click(screen.getByRole("button", { name: "Personer" }));
    await userEvent.click(screen.getByRole("button", { name: "Rediger Syntetisk Tante" }));
    const navn = screen.getByLabelText("Navn");
    await userEvent.clear(navn);
    await userEvent.type(navn, "Halvferdig");
    await userEvent.click(screen.getByRole("button", { name: "Jul 2026" }));
    await userEvent.click(screen.getByRole("button", { name: "Personer" }));
    expect(screen.getByDisplayValue("Halvferdig")).toBeInTheDocument();
  });

  it("arkivert av en annen enhet mens den redigeres: skjemaet holder arkivlisten åpen", async () => {
    const h = handlinger();
    const { rerender } = render(visMed(h));
    await userEvent.click(screen.getByRole("button", { name: "Personer" }));
    await userEvent.click(screen.getByRole("button", { name: "Rediger Syntetisk Tante" }));
    await userEvent.type(screen.getByLabelText("Notat (valgfritt)"), "liker te");
    rerender(visMed(h, { personer: [{ ...person, arkivert: "t", versjon: 4 }] }));
    expect(screen.getByDisplayValue("liker te")).toBeInTheDocument();
    expect(h.arkiverPerson).not.toHaveBeenCalled();
  });

  it("budsjettutkast for en mottaker som fjernes, vises i panelet", async () => {
    const h = handlinger();
    const { rerender } = render(visMed(h));
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    await userEvent.click(within(kort).getByRole("button", { name: "Endre budsjett" }));
    const belop = within(kort).getByLabelText("Budsjett for Jul 2026, beløp i kroner");
    await userEvent.clear(belop);
    await userEvent.type(belop, "777");
    rerender(
      visMed(h, {
        anledninger: [
          { ...jul, versjon: 2, mottakere: { p1: { ...jul.mottakere.p1!, fjernet: "t" } } },
        ],
      }),
    );
    const panel = screen.getByRole("region", { name: "Ulagrede utkast" });
    expect(within(panel).getByDisplayValue("777")).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Lagre budsjett" }));
    // Grunnlaget er anledningen slik den var da skjemaet ble åpnet.
    expect(h.settMottakerBudsjett).toHaveBeenCalledWith(jul, "p1", {
      type: "belop",
      belopOre: 77700,
    });
  });
});

describe("GaverView — mottakere gruppert etter registerets gruppe (roadmap Gaver punkt 4)", () => {
  const p = (id: string, navn: string, gruppe: Person["gruppe"]): Person => ({
    ...person,
    id,
    navn,
    gruppe,
  });
  const personer = [
    p("p1", "Syntetisk Tante", "naer"),
    p("p2", "Syntetisk Venn", "venner"),
    p("p3", "Syntetisk Fetter", "utvidet"),
  ];
  const julMed: Anledning = {
    ...jul,
    mottakere: {
      p1: { budsjett: { type: "belop", belopOre: 50000 } },
      p2: { budsjett: { type: "belop", belopOre: 20000 } },
      p3: { budsjett: { type: "ikke_satt" } },
      borte: { budsjett: { type: "belop", belopOre: 10000 } },
      p9: { budsjett: { type: "belop", belopOre: 7000 }, fjernet: T },
    },
  };
  const visGruppert = (h: GaverHandlinger, pers: Person[]) => (
    <GaverView
      aar={2026}
      grupper={{}}
      personer={pers}
      anledninger={[julMed]}
      gaver={[]}
      handlinger={h}
    />
  );
  const gruppeOverskrifter = () =>
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent ?? "");
  const kortI = (gruppe: string) =>
    within(screen.getByRole("region", { name: new RegExp(`^${gruppe}`) }))
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);

  it("viser gruppene i registerets rekkefølge, en restgruppe, og hver mottaker én gang", async () => {
    const h = handlinger();
    render(visGruppert(h, personer));
    await userEvent.click(screen.getByRole("button", { name: "Jul 2026" }));
    const overskrifter = gruppeOverskrifter();
    const rekke = ["Nærmeste familie", "Utvidet familie", "Venner", "Ikke i personregisteret"].map(
      (n) => overskrifter.findIndex((t) => t.startsWith(n)),
    );
    expect(rekke.every((i) => i >= 0)).toBe(true);
    expect([...rekke].sort((a, b) => a - b)).toEqual(rekke);
    expect(kortI("Nærmeste familie")).toEqual(["Syntetisk Tante"]);
    expect(kortI("Utvidet familie")).toEqual(["Syntetisk Fetter"]);
    expect(kortI("Venner")).toEqual(["Syntetisk Venn"]);
    expect(kortI("Ikke i personregisteret")).toEqual(["Ukjent person"]);
    // Den fjernede mottakeren står fortsatt i sin egen seksjon, ikke i en gruppe.
    expect(screen.getByRole("heading", { name: "Fjernet fra årets liste" })).toBeInTheDocument();
    // Summen er uendret: budsjett for de fire aktive mottakerne.
    expect(screen.getByText(/800,00|800 kr/)).toBeInTheDocument();
  });

  it("person flyttet i registeret: kortet flytter gruppe, ingen skriving til julen", async () => {
    const h = handlinger();
    const { rerender } = render(visGruppert(h, personer));
    await userEvent.click(screen.getByRole("button", { name: "Jul 2026" }));
    expect(kortI("Venner")).toEqual(["Syntetisk Venn"]);

    rerender(
      visGruppert(h, [personer[0]!, { ...personer[1]!, gruppe: "naer", versjon: 4 }, personer[2]!]),
    );
    expect(kortI("Nærmeste familie")).toEqual(["Syntetisk Tante", "Syntetisk Venn"]);
    expect(screen.queryByRole("region", { name: /^Venner/ })).not.toBeInTheDocument();
    for (const f of Object.values(h)) {
      if (vi.isMockFunction(f)) expect(f).not.toHaveBeenCalled();
    }
  });
});

describe("Året 2026 — helårsoversikt og etterregistrering (Gaver punkt 2)", () => {
  const venn: Person = {
    ...person,
    id: "p2",
    navn: "Syntetisk Venn",
    gruppe: "venner",
    unntak: { bursdag: { budsjett: { type: "belop", belopOre: 40000 } } },
  };
  const bursdagP2: Anledning = {
    id: "bursdag-p2-2026",
    type: "bursdag",
    aar: 2026,
    mottakere: { p2: { budsjett: { type: "belop", belopOre: 40000 } } },
    versjon: 1,
    opprettet: T,
    oppdatert: T,
  };
  const aapne = () => userEvent.click(screen.getByRole("button", { name: "Året 2026" }));
  const kortFor = (navn: string) => screen.getByRole("region", { name: navn });
  const tall = (kort: HTMLElement, dt: string) =>
    within(kort).getByText(dt, { selector: "dt" }).nextElementSibling as HTMLElement;

  it("viser bursdag, jul, samlet gaveverdi og rom per person; manglende budsjett er ukjent", async () => {
    vis(handlinger(), {
      personer: [person, venn],
      anledninger: [jul, bursdagP2],
      gaver: [
        ide({ id: "j1", status: "kjopt", planlagtOre: 30000 }),
        ide({
          id: "b1",
          personId: "p2",
          anledningId: "bursdag-p2-2026",
          tekst: "Skjerf",
          status: "gitt",
          planlagtOre: 15000,
          kjopsdato: "2025-12-28",
        }),
      ],
    });
    await aapne();
    const tante = kortFor("Syntetisk Tante");
    expect(tall(tante, "Jul 2026")).toHaveTextContent("300 krav 500 kr");
    expect(tall(tante, "Bursdag 2026")).toHaveTextContent("budsjett ukjent");
    expect(tall(tante, "Igjen av budsjett")).toHaveTextContent(
      "Ukjentmangler budsjett for bursdag",
    );

    // Personens eget bursdagsbudsjett (overstyring), og ikke med i en startet jul.
    const venner = kortFor("Syntetisk Venn");
    expect(tall(venner, "Bursdag 2026")).toHaveTextContent("150 krav 400 kr");
    expect(tall(venner, "Jul 2026")).toHaveTextContent("ikke med i budsjettet");
    expect(tall(venner, "Samlet gaveverdi")).toHaveTextContent("150 kr");
    expect(tall(venner, "Igjen av budsjett")).toHaveTextContent("250 kr");
    // Anledning og kjøpsdato vises hver for seg.
    expect(
      within(venner).getByRole("list", { name: "Bursdagsgaver til Syntetisk Venn" }),
    ).toHaveTextContent("Beløp 150 kr · kjøpsdato 28.12.2025");
  });

  it("registrerer en allerede gitt bursdagsgave eksplisitt, med mottaker, anledning, beløp, status og kjøpsdato", async () => {
    const h = handlinger();
    vis(h, { personer: [person, venn] });
    await aapne();
    // Ingenting skrives av å åpne oversikten.
    for (const f of Object.values(h)) if (vi.isMockFunction(f)) expect(f).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Registrer gave" }));
    const skjema = screen.getByRole("form", { name: "Registrer gave" });
    await userEvent.selectOptions(within(skjema).getByLabelText("Mottaker"), "p2");
    expect(within(skjema).getByLabelText("Anledning")).toHaveValue("bursdag");
    expect(within(skjema).getByLabelText("Status")).toHaveValue("gitt");
    await userEvent.type(within(skjema).getByLabelText("Gave"), "Skjerf");
    await userEvent.type(within(skjema).getByLabelText("Beløp (valgfritt)"), "350");
    fireEvent.change(within(skjema).getByLabelText("Kjøpsdato (valgfritt)"), {
      target: { value: "2026-03-14" },
    });
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));

    expect(h.registrerGave).toHaveBeenCalledWith(
      "g-ny",
      {
        personId: "p2",
        tekst: "Skjerf",
        status: "gitt",
        planlagtOre: 35000,
        kjopsdato: "2026-03-14",
      },
      { type: "bursdag", aar: 2026 },
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Registrert: Skjerf til Syntetisk Venn (Bursdag 2026).",
    );
    expect(screen.queryByRole("form", { name: "Registrer gave" })).not.toBeInTheDocument();
    expect(h.lagreGave).not.toHaveBeenCalled();
  });

  it("konflikt ved registrering: utkastet beholdes, og ny lagring bruker samme gave-id", async () => {
    const registrerGave = vi.fn().mockRejectedValueOnce(konflikt()).mockResolvedValue(undefined);
    const h = handlinger({ registrerGave });
    vis(h);
    await aapne();
    await userEvent.click(screen.getByRole("button", { name: "Registrer gave" }));
    const skjema = screen.getByRole("form", { name: "Registrer gave" });
    await userEvent.selectOptions(within(skjema).getByLabelText("Mottaker"), "p1");
    await userEvent.type(within(skjema).getByLabelText("Gave"), "Bok");
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));

    expect(await within(skjema).findByRole("alert")).toHaveTextContent("annen enhet");
    expect(within(skjema).getByLabelText("Gave")).toHaveValue("Bok");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(registrerGave).toHaveBeenCalledTimes(2);
    expect(registrerGave.mock.calls[1]![0]).toBe(registrerGave.mock.calls[0]![0]);
    expect(await screen.findByRole("status")).toHaveTextContent("Registrert: Bok");
  });

  it("jul kan bare velges når juleplanleggingen er startet; ugyldig beløp lagres ikke", async () => {
    const h = handlinger();
    vis(h, { anledninger: [] });
    await aapne();
    await userEvent.click(screen.getByRole("button", { name: "Registrer gave" }));
    const skjema = screen.getByRole("form", { name: "Registrer gave" });
    await userEvent.selectOptions(within(skjema).getByLabelText("Mottaker"), "p1");
    await userEvent.type(within(skjema).getByLabelText("Gave"), "Bok");
    await userEvent.type(within(skjema).getByLabelText("Beløp (valgfritt)"), "abc");
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(within(skjema).getByText(/Skriv beløpet i kroner/)).toBeInTheDocument();
    await userEvent.clear(within(skjema).getByLabelText("Beløp (valgfritt)"));
    await userEvent.selectOptions(within(skjema).getByLabelText("Anledning"), "jul");
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(within(skjema).getByText(/Start juleplanleggingen for 2026/)).toBeInTheDocument();
    expect(h.registrerGave).not.toHaveBeenCalled();
  });

  const gjenstar = () =>
    Object.assign(new Error("Gaven er lagret. Bursdagen gjenstår."), {
      name: "AnledningGjenstar",
    });

  async function fyllUt(skjema: HTMLElement) {
    await userEvent.selectOptions(within(skjema).getByLabelText("Mottaker"), "p2");
    await userEvent.type(within(skjema).getByLabelText("Gave"), "Skjerf");
    await userEvent.type(within(skjema).getByLabelText("Beløp (valgfritt)"), "150");
  }

  it("review 5821211956: delvis utfall vises i skjemaet, og fullføring lager ingen ny gave", async () => {
    const nyGaveId = vi.fn().mockReturnValue("g-ny");
    const registrerGave = vi.fn().mockRejectedValueOnce(gjenstar());
    const fullforBursdag = vi.fn().mockResolvedValue(undefined);
    const h = handlinger({ nyGaveId, registrerGave, fullforBursdag });
    vis(h, { personer: [person, venn] });
    await aapne();
    await userEvent.click(screen.getByRole("button", { name: "Registrer gave" }));
    await fyllUt(screen.getByRole("form", { name: "Registrer gave" }));
    await userEvent.click(screen.getByRole("button", { name: "Lagre" }));

    const panel = await screen.findByRole("region", { name: "Registrer gave" });
    expect(within(panel).getByRole("alert")).toHaveTextContent(
      "Gaven er lagret. Bursdagen gjenstår.",
    );
    expect(within(panel).queryByText(/Kunne ikke lagre/)).not.toBeInTheDocument();
    // Ingen vei til en ny registrering fra skjemaet.
    expect(within(panel).queryByRole("button", { name: "Lagre" })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Registrer gave" })).not.toBeInTheDocument();

    await userEvent.click(within(panel).getByRole("button", { name: "Fullfør bursdag 2026" }));
    expect(fullforBursdag).toHaveBeenCalledWith("p2", 2026);
    expect(registrerGave).toHaveBeenCalledTimes(1);
    expect(nyGaveId).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Registrert: Skjerf til Syntetisk Venn (Bursdag 2026).",
    );
  });

  it("review 5821211956: feilet fullføring beholder panelet; «Lukk» gir ingen ny registrering", async () => {
    const registrerGave = vi.fn().mockRejectedValueOnce(gjenstar());
    const fullforBursdag = vi.fn().mockRejectedValueOnce(new Error("nett"));
    const h = handlinger({ registrerGave, fullforBursdag });
    vis(h, { personer: [person, venn] });
    await aapne();
    await userEvent.click(screen.getByRole("button", { name: "Registrer gave" }));
    await fyllUt(screen.getByRole("form", { name: "Registrer gave" }));
    await userEvent.click(screen.getByRole("button", { name: "Lagre" }));
    const panel = await screen.findByRole("region", { name: "Registrer gave" });
    await userEvent.click(within(panel).getByRole("button", { name: "Fullfør bursdag 2026" }));
    expect(await within(panel).findByText(/Kunne ikke lagre/)).toBeInTheDocument();
    expect(within(panel).getByText(/Gaven er lagret. Bursdagen gjenstår./)).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("button", { name: "Lukk" }));
    expect(registrerGave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("vanlig feil før gaven er lagret: «Kunne ikke lagre», utkastet og «Lagre» står", async () => {
    const registrerGave = vi.fn().mockRejectedValueOnce(new Error("nett"));
    const h = handlinger({ registrerGave });
    vis(h, { personer: [person, venn] });
    await aapne();
    await userEvent.click(screen.getByRole("button", { name: "Registrer gave" }));
    const skjema = screen.getByRole("form", { name: "Registrer gave" });
    await fyllUt(skjema);
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(await within(skjema).findByRole("alert")).toHaveTextContent("Kunne ikke lagre");
    expect(within(skjema).getByLabelText("Gave")).toHaveValue("Skjerf");
    expect(within(skjema).queryByText(/Bursdagen gjenstår/)).not.toBeInTheDocument();
    expect(within(skjema).getByRole("button", { name: "Lagre" })).toBeInTheDocument();
    expect(h.fullforBursdag).not.toHaveBeenCalled();
  });

  it("gave lagret uten bursdag (feil i andre steg): eksplisitt «Fullfør bursdag», ingen automatisk skriving", async () => {
    const h = handlinger();
    vis(h, {
      personer: [venn],
      anledninger: [jul],
      gaver: [
        ide({
          id: "b1",
          personId: "p2",
          anledningId: "bursdag-p2-2026",
          status: "gitt",
          planlagtOre: 15000,
        }),
      ],
    });
    await aapne();
    const kort = kortFor("Syntetisk Venn");
    // Gaven teller, med personens gjeldende budsjett.
    expect(tall(kort, "Bursdag 2026")).toHaveTextContent("150 krav 400 kr");
    expect(within(kort).getByText(/Bursdag 2026 er ikke ferdig lagret/)).toBeInTheDocument();
    for (const f of Object.values(h)) if (vi.isMockFunction(f)) expect(f).not.toHaveBeenCalled();
    await userEvent.click(within(kort).getByRole("button", { name: "Fullfør bursdag 2026" }));
    expect(h.fullforBursdag).toHaveBeenCalledWith("p2", 2026);
  });

  it("bursdagsbudsjettet settes som personunntak under «Personer» (arv er standard)", async () => {
    const lagrePerson = vi.fn().mockResolvedValue(undefined);
    vis(handlinger({ lagrePerson }));
    await userEvent.click(screen.getByRole("button", { name: "Personer" }));
    await userEvent.click(screen.getByRole("button", { name: "Rediger Syntetisk Tante" }));
    const skjema = screen.getByRole("form", { name: "Rediger Syntetisk Tante" });
    const felt = within(skjema).getByLabelText("Budsjett for bursdag");
    expect(felt).toHaveValue("arv");
    await userEvent.selectOptions(felt, "belop");
    await userEvent.type(
      within(skjema).getByLabelText("Budsjett for bursdag, beløp i kroner"),
      "400",
    );
    await userEvent.click(within(skjema).getByRole("button", { name: "Lagre" }));
    expect(lagrePerson).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ bursdag: { budsjett: { type: "belop", belopOre: 40000 } } }),
      person,
    );
  });
});

/**
 * Roadmap Gaver punkt 5 (#20): gavemodulen sammenligner ikke lenger med
 * årsbudsjettet i Økonomi. Et budsjett med desemberposter sendes likevel med
 * (som det gamle grensesnittet tok imot) for å vise at det ikke brukes.
 */
describe("Gaver uten årsbudsjett (Gaver punkt 5)", () => {
  const maaneder = (des: number) =>
    Array.from({ length: 12 }, (_, i) => ({ budget: i === 11 ? des : 0, spent: 0 }));
  const aarsbudsjett = [
    {
      id: "gaver",
      label: "Gaver",
      items: [
        { id: "gaver", name: "Gaver", months: maaneder(3000) },
        { id: "p2", name: "Gavepapir, kort og annet", months: maaneder(250) },
      ],
    },
  ];
  const jul2025: Anledning = {
    ...jul,
    id: "jul-2025",
    aar: 2025,
    mottakere: { p1: { budsjett: { type: "belop", belopOre: 40000 } } },
  };
  const visUtenOkonomi = (h: GaverHandlinger) =>
    render(
      <GaverView
        aar={2026}
        grupper={{
          naer: {
            id: "naer",
            standard: { bursdag: { budsjett: { type: "belop", belopOre: 30000 } } },
            versjon: 1,
          },
        }}
        personer={[person]}
        anledninger={[jul, jul2025]}
        gaver={[
          ide({ id: "g1", status: "kjopt", planlagtOre: 20000, kjopsdato: "2026-11-01" }),
          ide({ id: "g0", anledningId: "jul-2025", tekst: "Fjorårets bok", status: "gitt" }),
        ]}
        handlinger={h}
        {...({ budsjett: aarsbudsjett } as object)}
      />,
    );

  it("juleplanen viser ingen sammenligning med Økonomi, men gavebudsjett og historikk står", () => {
    visUtenOkonomi(handlinger());
    expect(screen.queryByText(/Fra budsjettet i Økonomi/)).not.toBeInTheDocument();
    expect(screen.queryByText(/bare til sammenligning/)).not.toBeInTheDocument();
    expect(screen.queryByText("Gavepapir, kort og annet")).not.toBeInTheDocument();
    expect(screen.queryByText("3 000 kr")).not.toBeInTheDocument();

    expect(screen.getByText("Planlagt budsjett").nextSibling).toHaveTextContent("500 kr");
    expect(screen.getByText("Planlagt for gaver").nextSibling).toHaveTextContent("200 kr");
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    expect(kort).toHaveTextContent("budsjett 500 kr");
    expect(within(kort).getByText("Tidligere gaver")).toBeInTheDocument();
    expect(kort).toHaveTextContent("Jul 2025: Fjorårets bok");
  });

  it("årsoversikten bruker gavebudsjettet fra personer, grupper og anledninger; kjøpsdato står for seg", async () => {
    visUtenOkonomi(handlinger());
    await userEvent.click(screen.getByRole("button", { name: "Året 2026" }));
    const kort = screen.getByRole("region", { name: "Syntetisk Tante" });
    const tall = (dt: string) =>
      within(kort).getByText(dt, { selector: "dt" }).nextElementSibling as HTMLElement;
    expect(tall("Jul 2026")).toHaveTextContent("200 krav 500 kr");
    expect(tall("Bursdag 2026")).toHaveTextContent("0 krav 300 kr");
    expect(tall("Igjen av budsjett")).toHaveTextContent("600 kr");
    expect(screen.queryByText(/Økonomi, desember/)).not.toBeInTheDocument();
  });
});
