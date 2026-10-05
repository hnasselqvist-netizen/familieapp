import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import { SpilleromHode, type SpilleromHodeProps } from "./SpilleromHode";
import { SpilleromMuligheter, SpilleromPlan } from "./SpilleromPlan";

/**
 * Spillerom som ett rom (#59): hodet med regnestykket og «planen» (neste
 * større utbetaling + fordeling per nivå) flyttet fra den tidligere
 * oversikten. Beregningene er differensielt testet mot legacy i
 * `domain/liquidity/oversikt.legacy.test.ts`.
 */
const tall = (t: string | null | undefined) => (t ?? "").replace(/\s/g, " ");

const hode = (p: Partial<SpilleromHodeProps> = {}) => {
  const onSaveSaldo = vi.fn();
  render(
    <SpilleromHode
      saldo={10000}
      harSaldo
      innbetalinger={38000}
      utbetalinger={17200}
      spillerom={30800}
      prognosisDate="2026-10-25"
      saldoAlderMin={5}
      onSaveSaldo={onSaveSaldo}
      {...p}
    />,
  );
  return onSaveSaldo;
};

describe("SpilleromHode", () => {
  it("ett tall og regnestykket i klartekst — inn og ut hver for seg, ingen «Bundet»", () => {
    hode();
    const s = screen.getByRole("region", { name: "Spillerom" });
    expect(tall(s.textContent)).toContain("Spillerom til 25. okt.30 800 kr");
    const rader = within(s)
      .getAllByRole("term")
      .map((dt) => [dt.textContent, tall(dt.nextElementSibling?.textContent)]);
    expect(rader).toEqual([
      ["Disponibelt nå", "10 000 kr"],
      ["Kommer inn", "+38 000 kr"],
      ["Skal ut", "−17 200 kr"],
    ]);
    expect(s.textContent).not.toMatch(/Bundet/);
    expect(screen.getByText("Saldo oppdatert for 5 min siden")).toBeInTheDocument();
  });

  it("redigerer disponibelt beløp på stedet og lagrer ved Enter (mellomrom og komma tåles)", async () => {
    const user = userEvent.setup();
    const onSave = hode();
    await user.click(screen.getByRole("button", { name: "Endre disponibelt beløp" }));
    const felt = screen.getByRole("textbox", { name: "Disponibelt nå" });
    await user.clear(felt);
    await user.type(felt, "48 500,5{Enter}");
    expect(onSave).toHaveBeenCalledExactlyOnceWith(48500.5);
  });

  it("ugyldig eller avbrutt redigering lagrer ingenting", async () => {
    const user = userEvent.setup();
    const onSave = hode();
    await user.click(screen.getByRole("button", { name: "Endre disponibelt beløp" }));
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Endre disponibelt beløp" }));
    await user.clear(screen.getByRole("textbox", { name: "Disponibelt nå" }));
    await user.type(screen.getByRole("textbox", { name: "Disponibelt nå" }), "abc{Enter}");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("uten saldo: inviterer til å sette beløpet", () => {
    hode({ harSaldo: false, saldo: 0, saldoAlderMin: null });
    expect(screen.getByRole("button", { name: "Sett disponibelt beløp" })).toHaveTextContent(
      "Sett beløp",
    );
  });
});

const mnd = (budget: number, unntak: Record<number, number> = {}) =>
  Array.from({ length: 12 }, (_, i) => ({ budget: unntak[i] ?? budget, spent: 0 }));
const budgetGroups: BudsjettGruppe[] = [
  {
    id: "bolig",
    label: "Bolig",
    items: [
      { id: "husleie", name: "Husleie", months: mnd(12000), meta: { niva: "beskytte" } },
      {
        id: "forsikring",
        name: "Forsikring hus",
        months: mnd(0, { 10: 8400 }),
        meta: { paymentPattern: "yearly" },
      },
      { id: "mat", name: "Mat", months: mnd(9000) },
      { id: "ferie", name: "Ferie", months: mnd(1500), meta: { niva: "velge" } },
    ],
  },
] as BudsjettGruppe[];

describe("SpilleromPlan (flyttet fra Spillerom-oversikten)", () => {
  it("neste større planlagte utbetaling og fordeling per nivå, med vei til budsjettet", () => {
    render(
      <MemoryRouter>
        <SpilleromPlan budgetGroups={budgetGroups} month={9} />
      </MemoryRouter>,
    );
    expect(tall(screen.getByText("Forsikring hus").parentElement?.textContent)).toBe(
      "Forsikring hus — 8 400 kr i november",
    );
    const fordeling = screen.getByRole("region", { name: "Fordeling per nivå" });
    expect(
      within(fordeling)
        .getAllByRole("term")
        .map((dt) => `${dt.textContent} ${tall(dt.nextElementSibling?.textContent)}`),
    ).toEqual(["Beskytte 12 000 kr", "Opprettholde 9 000 kr", "Velge 1 500 kr"]);
    expect(within(fordeling).getByRole("link", { name: "Se budsjettdetaljer →" })).toHaveAttribute(
      "href",
      "/forvaltning/okonomi?omrade=kostnader",
    );
  });

  it("uten større utbetalinger: én rolig linje", () => {
    render(
      <MemoryRouter>
        <SpilleromPlan budgetGroups={[]} month={9} />
      </MemoryRouter>,
    );
    expect(screen.getByText("Ingen større planlagte utbetalinger.")).toBeInTheDocument();
  });

  it("muligheter vises som rolige linjer, og ingenting når det ikke er noen", () => {
    const { rerender } = render(
      <SpilleromMuligheter
        muligheter={[{ tekst: "Du har spillerom til ekstra sparing.", type: "positiv" }]}
      />,
    );
    expect(
      within(screen.getByRole("list", { name: "Muligheter" })).getAllByRole("listitem"),
    ).toHaveLength(1);
    rerender(<SpilleromMuligheter muligheter={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});
