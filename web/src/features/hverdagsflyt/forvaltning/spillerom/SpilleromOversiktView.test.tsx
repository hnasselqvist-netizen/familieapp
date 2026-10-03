import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { Liquidity } from "@app-types/liquidity";
import { SpilleromOversiktView } from "./SpilleromOversiktView";

/**
 * Komponenttester for Spillerom-dashbordet (§Issue #34, pre-cutover 1).
 * Beregningene er differensielt testet mot legacy i
 * `domain/liquidity/oversikt.legacy.test.ts`; her låses visning, lenker og
 * saldo-redigeringen.
 */
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
];
const liquidity: Liquidity = {
  saldo: 52000,
  saldoUpdated: null,
  prognosisDate: "2026-10-25",
  lonnDay: 25,
  posts: {
    husleie: {
      id: "husleie",
      name: "Husleie",
      amount: 12000,
      direction: "out",
      date: "2026-10-05",
    } as Liquidity["posts"][string],
  },
};

function vis(liq: Liquidity = liquidity, onSaveSaldo = vi.fn()) {
  render(
    <MemoryRouter>
      <SpilleromOversiktView
        liquidity={liq}
        budgetGroups={budgetGroups}
        month={9}
        idag="2026-10-03"
        onSaveSaldo={onSaveSaldo}
      />
    </MemoryRouter>,
  );
  return onSaveSaldo;
}

describe("SpilleromOversiktView", () => {
  it("viser beslutningskortene, muligheter, neste utbetaling og fordeling per nivå", () => {
    vis();
    expect(screen.getByRole("button", { name: "Endre disponibelt beløp" })).toHaveTextContent(
      /52\s000/,
    );
    expect(screen.getByRole("link", { name: /Bundet.*12\s000/ })).toHaveAttribute(
      "href",
      "/forvaltning/spillerom",
    );
    expect(screen.getByRole("link", { name: /Spillerom.*40\s000.*detaljer/ })).toHaveAttribute(
      "href",
      "/forvaltning/spillerom",
    );
    const muligheter = screen.getByRole("list", { name: "Muligheter" });
    expect(
      within(muligheter)
        .getAllByRole("listitem")
        .map((l) => l.textContent),
    ).toEqual([
      "✓Alle faste kostnader er dekket frem til valgt dato.",
      "✓Du har spillerom til ekstra sparing.",
    ]);
    expect(screen.getByText("Forsikring hus").parentElement).toHaveTextContent(
      /Forsikring hus — 8\s400\s?kr i November/,
    );
    expect(screen.getByText("Beskytte").parentElement).toHaveTextContent(/12\s000/);
    expect(screen.getByText("Opprettholde").parentElement).toHaveTextContent(/9\s000/);
    expect(screen.getByText("Velge").parentElement).toHaveTextContent(/1\s500/);
    expect(screen.getByRole("link", { name: "Se budsjettdetaljer →" })).toHaveAttribute(
      "href",
      "/forvaltning/budsjett",
    );
  });

  it("uten saldo og poster: streker og nøytrale muligheter", () => {
    vis({ ...liquidity, saldo: 0, posts: {} });
    expect(screen.getByRole("button", { name: "Sett disponibelt beløp" })).toHaveTextContent("–");
    expect(screen.getByText("Oppdater saldo for å få en prognose.")).toBeInTheDocument();
    expect(screen.getByText("Ingen prognoseposter registrert ennå.")).toBeInTheDocument();
  });

  it("redigerer saldo inline og lagrer ved Enter (legacy parseFloat)", async () => {
    const user = userEvent.setup();
    const onSave = vis();
    await user.click(screen.getByRole("button", { name: "Endre disponibelt beløp" }));
    const felt = screen.getByRole("spinbutton", { name: "Disponibelt nå" });
    await user.clear(felt);
    await user.type(felt, "48500{Enter}");
    expect(onSave).toHaveBeenCalledWith(48500);
    expect(screen.queryByRole("spinbutton")).toBeNull();
  });
});
