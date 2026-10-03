import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
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

/**
 * Med forsoningsporten PÅ (R3b-cutover). Porten er av i dag; her låses
 * hvordan panelet oppfører seg når den slås på.
 */
describe("KjorReglerPanel — «Bruk resultatet» med porten på", () => {
  const skrevet = {
    status: "skrevet" as const,
    resultat: { auto: 2, forslagSkrevet: 1, forslagPaaVent: 1, malMangler: 1 },
  };

  it("porten av: ingen «Bruk resultatet» selv om handlingen finnes", async () => {
    renderPanel({ skrivingAktiv: false, onBrukResultat: vi.fn() });
    await apne();
    expect(screen.queryByRole("button", { name: /bruk resultatet/i })).toBeNull();
  });

  it("sender planen brukeren ser, lukker og viser legacy sin kvittering", async () => {
    const onBrukResultat = vi.fn().mockResolvedValue(skrevet);
    renderPanel({ skrivingAktiv: true, onBrukResultat });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Kjør regler" }));
    await user.click(screen.getByRole("button", { name: "Bruk resultatet" }));

    const plan = onBrukResultat.mock.calls[0]![0] as { transaksjonId: string; handling: string }[];
    expect(plan.map((l) => [l.transaksjonId, l.handling])).toEqual([
      ["t-auto", "auto"],
      ["t-lonn", "auto"],
      ["t-forslag", "forslag"],
      ["t-vent", "forslag_pa_vent"],
      ["t-mangler", "mal_mangler"],
    ]);
    expect(screen.queryByRole("region", { name: "Forhåndsvisning av Kjør regler" })).toBeNull();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("✓ Reglene er kjørt");
    expect(status).toHaveTextContent("• 2 behandlet");
    expect(status).toHaveTextContent("• 1 klare for vurdering");
    expect(status).toHaveTextContent("• 1 trenger ny plassering");
    expect(status).toHaveTextContent("• 1 på vent — urørt");
  });

  it("endret data: forhåndsvisningen blir stående med legacy sin advarsel", async () => {
    const onBrukResultat = vi.fn().mockResolvedValue({
      status: "endret",
      advarsel:
        "Data eller regler har endret seg. Kontroller den oppdaterte forhåndsvisningen før du fortsetter.",
      forhandsvisning: {},
    });
    renderPanel({ skrivingAktiv: true, onBrukResultat });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Kjør regler" }));
    await user.click(screen.getByRole("button", { name: "Bruk resultatet" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Data eller regler har endret seg");
    expect(
      screen.getByRole("region", { name: "Forhåndsvisning av Kjør regler" }),
    ).toBeInTheDocument();
  });

  it("ingenting å skrive: «Bruk resultatet» er av", async () => {
    renderPanel({ skrivingAktiv: true, onBrukResultat: vi.fn(), regler: [] });
    await userEvent.setup().click(screen.getByRole("button", { name: "Kjør regler" }));
    expect(screen.getByRole("button", { name: "Bruk resultatet" })).toBeDisabled();
  });

  it("feil under skriving: melding, og knappen kan prøves igjen", async () => {
    const onBrukResultat = vi.fn().mockRejectedValue(new Error("nett"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPanel({ skrivingAktiv: true, onBrukResultat });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Kjør regler" }));
    await user.click(screen.getByRole("button", { name: "Bruk resultatet" }));
    expect(screen.getByText("⚠ Noe gikk galt. Se konsollen for detaljer.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kjør regler" })).toBeEnabled();
  });
});
