/**
 * Funn F: skrivefritt varsel i Spillerom for automatiske kilder uten
 * gyldig forfallsdag. Aldri «alt klart» under lasting/feil; tydelig vei
 * til postens redigering i Økonomi. Syntetiske data.
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type { ForfallsdagMangel } from "@domain/liquidity/forfallsdag";
import { loadError, loaded, loading, notLoaded } from "@app-types/status";
import { ForfallsdagVarsel } from "./ForfallsdagVarsel";

const mangel = (o: Partial<ForfallsdagMangel>): ForfallsdagMangel => ({
  type: "kostnader",
  gruppeId: "bolig",
  gruppeNavn: "Bolig",
  iOkonomi: true,
  postId: "x",
  postNavn: "Husleie",
  verdi: "",
  status: "utelatt",
  ...o,
});
const vis = (m: Parameters<typeof ForfallsdagVarsel>[0]["mangler"]) =>
  render(
    <MemoryRouter>
      <ForfallsdagVarsel mangler={m} />
    </MemoryRouter>,
  );

describe("ForfallsdagVarsel", () => {
  it.each([
    ["not_loaded", notLoaded],
    ["loading", loading],
  ])("%s: sier at grunnlaget kontrolleres, ikke at alt er klart", (_n, s) => {
    vis(s);
    expect(screen.getByRole("status")).toHaveTextContent("Kontrollerer forfallsdager");
    expect(screen.queryByText(/ufullstendig/)).toBeNull();
  });

  it("feil: sier at grunnlaget ikke kunne kontrolleres", () => {
    vis(loadError(new Error("permission_denied")));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Kunne ikke kontrollere forfallsdager i prognosegrunnlaget",
    );
  });

  it("ingen mangler: ingenting vises", () => {
    const { container } = vis(loaded([]));
    expect(container).toBeEmptyDOMElement();
  });

  it("viser type, gruppe og post, status og lenke til riktig post i Økonomi", () => {
    vis(
      loaded([
        mangel({ type: "inntekter", gruppeId: "lonn", gruppeNavn: "Lønn", postNavn: "Lønn A" }),
        mangel({}),
        mangel({ gruppeId: "transport", gruppeNavn: "Transport" }), // samme ID/navn, annen gruppe
        mangel({
          type: "sparing",
          gruppeId: "buffer",
          gruppeNavn: "Buffer",
          postId: "b",
          postNavn: "Buffer",
          verdi: "15abc",
          status: "tolket",
        }),
      ]),
    );
    const seksjon = screen.getByRole("region", { name: "Prognosegrunnlag ufullstendig" });
    expect(seksjon).toHaveTextContent("4 automatiske poster trenger forfallsdag.");
    const rader = within(seksjon).getAllByRole("listitem");
    expect(rader.map((r) => r.firstChild?.textContent)).toEqual([
      "Inntekt · Lønn · Lønn A",
      "Kostnad · Bolig · Husleie",
      "Kostnad · Transport · Husleie",
      "Sparing · Buffer · Buffer",
    ]);
    expect(rader[1]).toHaveTextContent("Mangler forfallsdag – ikke med i prognosen.");
    expect(rader[3]).toHaveTextContent(
      "Ugyldig forfallsdag «15abc» – prognosen bruker en tolket dag. Kontroller dagen.",
    );
    // Hevder aldri at en utelatt post er medregnet.
    expect(rader[1]).not.toHaveTextContent("tolket");
    const lenker = within(seksjon).getAllByRole("link");
    expect(lenker.map((l) => l.getAttribute("href"))).toEqual([
      "/forvaltning/okonomi?omrade=inntekter&gruppe=lonn&post=x",
      "/forvaltning/okonomi?omrade=kostnader&gruppe=bolig&post=x",
      "/forvaltning/okonomi?omrade=kostnader&gruppe=transport&post=x",
      "/forvaltning/okonomi?omrade=sparing&gruppe=buffer&post=b",
    ]);
    expect(lenker[2]).toHaveAccessibleName(
      "Rett forfallsdag for Husleie (kostnad, Transport) i Økonomi",
    );
  });

  it("gruppe som ikke vises i Økonomi: ingen lenke, tydelig tekst", () => {
    vis(loaded([mangel({ gruppeId: "egen", gruppeNavn: "egen", iOkonomi: false })]));
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      screen.getByText("Gruppen «egen» vises ikke i Økonomi og kan ikke rettes her."),
    ).toBeInTheDocument();
    expect(screen.getByText("1 automatisk post trenger forfallsdag.")).toBeInTheDocument();
  });
});
