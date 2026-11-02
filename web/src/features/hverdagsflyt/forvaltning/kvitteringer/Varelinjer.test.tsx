/**
 * Varelinjer i kvitteringsdetaljen (#59, kvitteringer C). Logikken er
 * testet i domenet og skrivingen mot emulatoren; her låses at UI-et sender
 * riktig kontrakt, bevarer utkastet ved feil, konflikt og levende
 * abonnementsendring, og holder varelinjene adskilt fra fordelingen.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { KvitteringRecord } from "@app-types/forsoning";
import { KvitteringsinnboksView } from "./KvitteringsinnboksView";
import { VarelinjerRedigering } from "./Varelinjer";

const kvittering = (over: Partial<KvitteringRecord> = {}): KvitteringRecord => ({
  id: "r1",
  merchant: "Syntetisk butikk",
  purchaseDate: "2026-11-01",
  total: 30,
  allocationMode: null,
  splits: [],
  matchingStatus: "unmatched",
  ...over,
});

const endret = () =>
  Object.assign(new Error("Varelinjene er endret på en annen enhet."), {
    name: "VarelinjerEndret",
  });

let n = 0;
const nyId = () => `ny${++n}`;

async function fyllLinje(i: number, felt: Record<string, string>) {
  const linje = screen.getByRole("group", { name: new RegExp(`^Linje ${i}`) });
  for (const [etikett, verdi] of Object.entries(felt)) {
    const el = within(linje).getByLabelText(etikett);
    if (el.tagName === "SELECT") await userEvent.selectOptions(el, verdi);
    else {
      await userEvent.clear(el);
      await userEvent.type(el, verdi);
    }
  }
}

describe("VarelinjerRedigering", () => {
  it("sender heltallsøre, linjebeløp før rabatt, pant med fortegn, og utelater manglende felt", async () => {
    n = 0;
    const lagre = vi.fn().mockResolvedValue("lagret");
    render(<VarelinjerRedigering r={kvittering()} lagre={lagre} nyId={nyId} />);
    expect(screen.getByText(/Påvirker ikke økonomien/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Legg til varelinje" }));
    await fyllLinje(1, {
      "Vare eller tekst": "Epler",
      "Linjebeløp før rabatt (kr)": "18,03",
      "Mengde (valgfritt)": "0,452",
      "Enhet (valgfritt)": "kg",
      "Enhetspris (kr, valgfritt)": "39,90",
    });
    await userEvent.click(screen.getByRole("button", { name: "Legg til varelinje" }));
    await fyllLinje(2, {
      "Vare eller tekst": "Kaffe",
      "Linjebeløp før rabatt (kr)": "20",
      "Rabatt (kr, valgfritt)": "5",
    });
    await userEvent.click(screen.getByRole("button", { name: "Legg til varelinje" }));
    await fyllLinje(3, {
      "Vare eller tekst": "Pantelapp",
      Type: "pant",
      "Linjebeløp før rabatt (kr)": "-3,03",
    });
    await userEvent.click(screen.getByRole("button", { name: "Legg til varelinje" }));
    await fyllLinje(4, { "Vare eller tekst": "Ukjent pris" });

    // Sum 18,03 + 15 − 3,03 = 30 = total; én linje mangler beløp.
    expect(screen.getByText("1 linje mangler beløp og er ikke med i summen.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Lagre varelinjer" }));
    expect(lagre).toHaveBeenCalledWith(
      "r1",
      [
        {
          id: "ny1",
          art: "vare",
          tekst: "Epler",
          mengde: 0.452,
          enhet: "kg",
          enhetsprisOre: 3990,
          belopOre: 1803,
        },
        { id: "ny2", art: "vare", tekst: "Kaffe", belopOre: 2000, rabattOre: 500 },
        { id: "ny3", art: "pant", tekst: "Pantelapp", belopOre: -303 },
        { id: "ny4", art: "vare", tekst: "Ukjent pris" },
      ],
      0,
    );
  });

  it("ugyldige tall lagres ikke; feilen står ved feltet og utkastet beholdes", async () => {
    n = 0;
    const lagre = vi.fn();
    render(<VarelinjerRedigering r={kvittering()} lagre={lagre} nyId={nyId} />);
    await userEvent.click(screen.getByRole("button", { name: "Legg til varelinje" }));
    await fyllLinje(1, { "Vare eller tekst": "Melk", "Rabatt (kr, valgfritt)": "-5" });
    await userEvent.click(screen.getByRole("button", { name: "Lagre varelinjer" }));
    expect(lagre).not.toHaveBeenCalled();
    expect(screen.getByText(/Skriv rabatten som et positivt beløp/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Melk")).toBeInTheDocument();
  });

  it("ekte 0 sendes som 0", async () => {
    n = 0;
    const lagre = vi.fn().mockResolvedValue("lagret");
    render(<VarelinjerRedigering r={kvittering({ total: 0 })} lagre={lagre} nyId={nyId} />);
    await userEvent.click(screen.getByRole("button", { name: "Legg til varelinje" }));
    await fyllLinje(1, { "Vare eller tekst": "Pose", "Linjebeløp før rabatt (kr)": "0" });
    await userEvent.click(screen.getByRole("button", { name: "Lagre varelinjer" }));
    expect(lagre.mock.calls[0]![1]).toEqual([
      { id: "ny1", art: "vare", tekst: "Pose", belopOre: 0 },
    ]);
  });

  it("konflikt: utkastet beholdes; «lagre likevel» bruker gjeldende versjon", async () => {
    n = 0;
    const lagre = vi.fn().mockRejectedValueOnce(endret()).mockResolvedValue("lagret");
    const r = kvittering();
    const { rerender } = render(<VarelinjerRedigering r={r} lagre={lagre} nyId={nyId} />);
    await userEvent.click(screen.getByRole("button", { name: "Legg til varelinje" }));
    await fyllLinje(1, { "Vare eller tekst": "Mitt utkast", "Linjebeløp før rabatt (kr)": "10" });
    await userEvent.click(screen.getByRole("button", { name: "Lagre varelinjer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("annen enhet");
    expect(screen.getByDisplayValue("Mitt utkast")).toBeInTheDocument();

    // Den andre enhetens lagring kommer inn via abonnementet.
    rerender(
      <VarelinjerRedigering
        r={{
          ...r,
          varelinjer: [{ id: "b", art: "vare", tekst: "Fra B", belopOre: 500 }],
          varelinjerVersjon: 1,
        }}
        lagre={lagre}
        nyId={nyId}
      />,
    );
    expect(screen.getByDisplayValue("Mitt utkast")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Lagre min versjon likevel" }));
    expect(lagre).toHaveBeenLastCalledWith(
      "r1",
      [{ id: "ny1", art: "vare", tekst: "Mitt utkast", belopOre: 1000 }],
      1,
    );
  });

  it("levende endring uten ulagrede endringer tas inn; med ulagrede endringer står utkastet", async () => {
    n = 0;
    const lagre = vi.fn();
    const r = kvittering({
      varelinjer: [{ id: "a", art: "vare", tekst: "A", belopOre: 100 }],
      varelinjerVersjon: 1,
    });
    const { rerender } = render(<VarelinjerRedigering r={r} lagre={lagre} nyId={nyId} />);
    rerender(
      <VarelinjerRedigering
        r={{
          ...r,
          varelinjer: [{ id: "a", art: "vare", tekst: "A2", belopOre: 100 }],
          varelinjerVersjon: 2,
        }}
        lagre={lagre}
        nyId={nyId}
      />,
    );
    expect(screen.getByDisplayValue("A2")).toBeInTheDocument();

    await fyllLinje(1, { "Vare eller tekst": "Mitt" });
    rerender(
      <VarelinjerRedigering
        r={{
          ...r,
          varelinjer: [{ id: "a", art: "vare", tekst: "A3", belopOre: 100 }],
          varelinjerVersjon: 3,
        }}
        lagre={lagre}
        nyId={nyId}
      />,
    );
    expect(screen.getByDisplayValue("Mitt")).toBeInTheDocument();
    expect(screen.getByText(/endret på en annen enhet mens du skrev/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Lagre varelinjer" }));
    // Grunnlaget er versjonen utkastet bygger på (2), så datalaget gir konflikt.
    expect(lagre.mock.calls[0]![2]).toBe(2);
  });

  it("fjerne en linje og lagre sender listen uten den", async () => {
    const lagre = vi.fn().mockResolvedValue("lagret");
    render(
      <VarelinjerRedigering
        r={kvittering({
          varelinjer: [
            { id: "a", art: "vare", tekst: "A", belopOre: 100 },
            { id: "b", art: "vare", tekst: "B", belopOre: 200 },
          ],
          varelinjerVersjon: 4,
        })}
        lagre={lagre}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fjern linje 1 (A)" }));
    await userEvent.click(screen.getByRole("button", { name: "Lagre varelinjer" }));
    expect(lagre).toHaveBeenCalledWith(
      "r1",
      [{ id: "b", art: "vare", tekst: "B", belopOre: 200 }],
      4,
    );
  });

  it("nettverksfeil: utkastet beholdes og feilen forklares", async () => {
    n = 0;
    const lagre = vi.fn().mockRejectedValue(new Error("offline"));
    render(<VarelinjerRedigering r={kvittering()} lagre={lagre} nyId={nyId} />);
    await userEvent.click(screen.getByRole("button", { name: "Legg til varelinje" }));
    await fyllLinje(1, { "Vare eller tekst": "Brød" });
    await userEvent.click(screen.getByRole("button", { name: "Lagre varelinjer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("tatt vare på");
    expect(screen.getByDisplayValue("Brød")).toBeInTheDocument();
    expect(screen.queryByText("Varelinjene er lagret.")).not.toBeInTheDocument();
  });
});

describe("KvitteringsinnboksView med varelinjer", () => {
  const basis = {
    transaksjoner: [],
    hendelser: [],
    skrivingAktiv: true,
    onUtfor: vi.fn().mockResolvedValue(undefined),
  };

  it("ferdig behandlet kvittering kan åpnes og får bare varelinjeredigering", async () => {
    const ferdig = kvittering({ id: "f1", merchant: "Ferdig butikk", matchingStatus: "matched" });
    const lagre = vi.fn().mockResolvedValue("lagret");
    render(
      <KvitteringsinnboksView {...basis} alle={[ferdig]} aktive={[]} onLagreVarelinjer={lagre} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Vis ferdig behandlede (1)" }));
    await userEvent.click(screen.getByRole("button", { name: /Ferdig butikk/ }));
    expect(screen.getByRole("region", { name: "Varelinjer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lagre endringer" })).not.toBeInTheDocument();
  });

  it("åpen kvittering som forkastes eller blir ferdig andre steder, lukkes ikke; utkastet står", async () => {
    const r = kvittering();
    const lagre = vi.fn();
    const { rerender } = render(
      <KvitteringsinnboksView {...basis} alle={[r]} aktive={[r]} onLagreVarelinjer={lagre} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Syntetisk butikk/ }));
    await userEvent.click(screen.getByRole("button", { name: "Legg til varelinje" }));
    await userEvent.type(screen.getByLabelText("Vare eller tekst"), "Ikke mist meg");

    rerender(
      <KvitteringsinnboksView
        {...basis}
        alle={[{ ...r, forkastet: true }]}
        aktive={[]}
        onLagreVarelinjer={lagre}
      />,
    );
    expect(screen.getByDisplayValue("Ikke mist meg")).toBeInTheDocument();
    expect(screen.getByText(/Denne kvitteringen er forkastet/)).toBeInTheDocument();
  });

  it("uten skrivetilgang vises lagrede varelinjer bare til lesing", async () => {
    const r = kvittering({ varelinjer: [{ id: "a", art: "vare", tekst: "Melk", belopOre: 2490 }] });
    render(<KvitteringsinnboksView transaksjoner={[]} hendelser={[]} alle={[r]} aktive={[r]} />);
    await userEvent.click(screen.getByRole("button", { name: /Syntetisk butikk/ }));
    const seksjon = screen.getByRole("region", { name: "Varelinjer" });
    expect(seksjon).toHaveTextContent("Melk");
    expect(
      within(seksjon).queryByRole("button", { name: "Lagre varelinjer" }),
    ).not.toBeInTheDocument();
  });
});
