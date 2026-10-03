import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import { KjorReglerPanel, type KjorReglerPanelProps } from "./KjorReglerPanel";

/**
 * Komponenttester for «Kjør regler»-forhåndsvisningen (§Issue #34).
 * Evaluering, plan og gruppering er differensielt testet mot legacy i
 * `kjorReglerForhandsvisning.legacy.test.ts`; her låses at panelet viser
 * dem som legacy og er REN VISNING — ingen «Bruk resultatet».
 */
const grupper = {
  budgetGroups: [
    { id: "mat", label: "Mat", items: [{ id: "dagligvarer", name: "Dagligvarer" }] },
    { id: "bil", label: "Bil", items: [{ id: "drivstoff", name: "Drivstoff" }] },
  ] as unknown as BudsjettGruppe[],
  incomeGroups: [
    { id: "lonn", label: "Lønn", items: [{ id: "lonnHelen", name: "Lønn Helen" }] },
  ] as unknown as BudsjettGruppe[],
  sparingGroups: [],
};
const tx = (id: string, felt: Partial<TransaksjonRecord>): TransaksjonRecord => ({
  id,
  dato: "2026-09-10",
  tekst: "REMA 1000",
  belop: 250,
  retning: "ut",
  konto: "felleskonto",
  status: "ny",
  ...felt,
});
const transaksjoner = [
  tx("t-auto", {}),
  tx("t-lonn", { tekst: "Lønn fra Arbeidsgiver AS", belop: 42000, retning: "inn", konto: "" }),
  tx("t-forslag", { tekst: "CIRCLE K", belop: 600 }),
  tx("t-vent", { tekst: "CIRCLE K BRYN", belop: 450 }),
  tx("t-mangler", { tekst: "KIWI 505", belop: 99 }),
  tx("t-ingen", { tekst: "Ukjent butikk" }),
];
const hendelse = (id: string, felt: Partial<HendelseRecord>): HendelseRecord => ({
  id,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [],
  dato: "2026-09-10",
  regelId: null,
  opprettet: "",
  oppdatert: "",
  ...felt,
});
const hendelser = [
  hendelse("h-vent", { transaksjonId: "t-vent", status: "pa_vent", paaVentAarsak: "maa_avklares" }),
];
const regel = (id: string, felt: Partial<RegelRecord>): RegelRecord => ({
  id,
  pattern: id,
  normalizedPattern: id,
  targetType: "budget",
  targetId: "dagligvarer",
  targetName: "Dagligvarer",
  mode: "auto",
  ...felt,
});
const regler = [
  regel("rema 1000", {}),
  regel("circle k", { targetId: "drivstoff", targetName: "Drivstoff", mode: "review" }),
  regel("lønn fra arbeidsgiver as", {
    matchType: "starter_med",
    targetType: "income",
    targetId: "lonnHelen",
    targetName: "Lønn Helen",
  }),
  regel("kiwi", { targetId: "borte", targetName: "Borte" }),
];

function renderPanel(props: Partial<KjorReglerPanelProps> = {}) {
  const alle: KjorReglerPanelProps = {
    regler,
    grupper,
    transaksjoner,
    hendelser,
    transaksjonerLastet: true,
    ...props,
  };
  const r = render(<KjorReglerPanel {...alle} />);
  return {
    ...r,
    rerenderMed: (p: Partial<KjorReglerPanelProps>) =>
      r.rerender(<KjorReglerPanel {...alle} {...p} />),
  };
}
const apne = async () =>
  userEvent.setup().click(screen.getByRole("button", { name: "Forhåndsvis «Kjør regler»" }));

describe("KjorReglerPanel", () => {
  it("lukket: knappen er av til transaksjonene er lest", () => {
    renderPanel({ transaksjonerLastet: false });
    expect(screen.getByRole("button", { name: "Forhåndsvis «Kjør regler»" })).toBeDisabled();
    expect(screen.getByText(/Ingenting endres/)).toBeInTheDocument();
  });

  it("viser legacy-seksjonene med tellere og linjetekster", async () => {
    renderPanel();
    await apne();
    const region = screen.getByRole("region", { name: "Forhåndsvisning av Kjør regler" });
    expect(region).toHaveTextContent("Reglene fant 3 treff av 6 vurderte transaksjoner");

    const auto = within(region).getByRole("region", { name: "Behandles automatisk" });
    expect(within(auto).getByRole("heading")).toHaveTextContent("Behandles automatisk (2)");
    // Datoformatet er legacy sitt (`nb-NO`, 2-digit) — ICU-versjonen avgjør «10.09»/«10.9.».
    expect(auto).toHaveTextContent(/10\.0?9\.? · REMA 1000 · felleskonto · -250 kr/);
    expect(auto).toHaveTextContent("→ Kostnad · Mat / Dagligvarer · faktisk +250 kr");
    // Ukjent konto vises som «?», inntekt med «+».
    expect(auto).toHaveTextContent("Lønn fra Arbeidsgiver AS · ? · +42 000 kr");
    expect(auto).toHaveTextContent("→ Inntekt · Lønn / Lønn Helen");

    const forslag = within(region).getByRole("region", { name: "Til vurdering" });
    expect(forslag).toHaveTextContent("CIRCLE K · felleskonto · -600 kr");
    expect(forslag).toHaveTextContent("→ Foreslått: Drivstoff · Krever vurdering");

    expect(within(region).getByRole("region", { name: "Røres ikke — på vent" })).toHaveTextContent(
      "CIRCLE K BRYN — På vent, treff funnet men ikke skrevet",
    );
    expect(
      within(region).getByRole("region", { name: "Mål mangler — kan ikke utføres" }),
    ).toHaveTextContent("KIWI 505 — regel «kiwi» peker mot en post som ikke finnes");
    expect(region).toHaveTextContent("1 transaksjon(er) uten treff — uendret.");
    expect(within(region).getByRole("note")).toHaveTextContent(
      "Kun forhåndsvisning — ingenting er skrevet. For å bruke resultatet: kjør regler i den gamle appen.",
    );
  });

  it("er ren visning: ingen «Bruk resultatet», og Lukk går tilbake", async () => {
    renderPanel();
    await apne();
    expect(screen.queryByRole("button", { name: /bruk resultatet/i })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "Lukk forhåndsvisningen" }));
    expect(screen.queryByRole("region", { name: "Forhåndsvisning av Kjør regler" })).toBeNull();
    expect(screen.getByRole("button", { name: "Forhåndsvis «Kjør regler»" })).toBeEnabled();
  });

  it("«Ingen nye treff akkurat nå» uten treff", async () => {
    renderPanel({ regler: [] });
    await apne();
    expect(screen.getByText("Ingen nye treff akkurat nå.")).toBeInTheDocument();
    expect(screen.getByText(/6 transaksjon\(er\) uten treff/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(
      /^Kun forhåndsvisning — ingenting er skrevet\.$/,
    );
  });

  it("følger live data mens den er åpen", async () => {
    const { rerenderMed } = renderPanel();
    await apne();
    expect(screen.getByRole("heading", { name: "Behandles automatisk (2)" })).toBeInTheDocument();
    // Legacy-appen plasserer REMA-kjøpet i mellomtiden → det vurderes ikke lenger.
    rerenderMed({ hendelser: [...hendelser, hendelse("h-ny", { transaksjonId: "t-auto" })] });
    expect(screen.getByRole("heading", { name: "Behandles automatisk (1)" })).toBeInTheDocument();
    expect(screen.getByText(/Reglene fant 2 treff av 5 vurderte/)).toBeInTheDocument();
  });
});
