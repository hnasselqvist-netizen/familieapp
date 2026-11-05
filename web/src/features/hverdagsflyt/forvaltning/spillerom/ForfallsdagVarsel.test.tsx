/**
 * Funn F: skrivefritt varsel i Spillerom for automatiske kilder uten
 * gyldig forfallsdag. Aldri «alt klart» under lasting/feil; tydelig vei
 * til postens redigering i Økonomi. Syntetiske data.
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import {
  type ForfallsdagMangel,
  type PrognoseKildeType,
  finnForfallsdagMangler,
} from "@domain/liquidity/forfallsdag";
import { generateForecastPosts } from "@domain/liquidity/liquidity";
import type { ForecastGroup, LiquidityPost } from "@app-types/liquidity";
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
    expect(rader[1]).toHaveTextContent(
      "Mangler forfallsdag – generatoren kan ikke lage standardposter for denne. Manuelt overstyrte poster står uendret og kan være med i prognosen.",
    );
    expect(rader[3]).toHaveTextContent(
      "Ugyldig forfallsdag «15abc» – generatoren tolker dagen når den lager standardposter. Kontroller dagen.",
    );
    // Påstår verken at kilden er medregnet eller at den mangler i prognosen
    // (review 5790655651): bare hva standardgenereringen kan gjøre.
    for (const rad of rader) {
      expect(rad).not.toHaveTextContent("ikke med i prognosen");
      expect(rad).not.toHaveTextContent("prognosen bruker");
    }
    expect(rader[1]).not.toHaveTextContent("tolker");
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

/**
 * Review 5790655651: generatoren bevarer manuelt overstyrte poster uansett
 * forfallsdag (#114). Varselet for samme kilde må derfor ikke si at kilden
 * mangler i prognosen — bare at standardgenereringen ikke kan bruke dagen.
 */
describe.each<[PrognoseKildeType, string, Partial<LiquidityPost>]>([
  ["kostnader", "bolig", { sourceBudgetItemId: "x", sourceBudgetGroupId: "bolig" }],
  ["inntekter", "lonn", { sourceItemId: "x" }],
  ["sparing", "buffer", { sourceSparingItemId: "x", sourceSparingGroupId: "buffer" }],
])("%s: tom forfallsdag + eksisterende overstyrt post", (type, gruppeId, kildefelt) => {
  const prefiks = type === "kostnader" ? "x" : type === "sparing" ? "spar_x" : "inc_x";
  const ov = {
    id: "ov",
    name: "Husleie",
    amount: 150,
    direction: type === "inntekter" ? "in" : "out",
    date: "2026-11-20",
    type: "fast",
    kilde: "generator",
    manueltOverstyrt: true,
    sourceType: type,
    _genKey: `${prefiks}_2026_10_20`,
    ...kildefelt,
  } as LiquidityPost;
  const grupper = [
    {
      id: gruppeId,
      label: gruppeId,
      items: [
        {
          id: "x",
          name: "Husleie",
          meta: { automatisk: true, forfallsdag: "" },
          months: Array.from({ length: 12 }, () => ({ budget: 100, spent: 0 })),
        },
      ],
    },
  ] as unknown as ForecastGroup[];
  const inputs = {
    budgetGroups: type === "kostnader" ? grupper : [],
    incomeGroups: type === "inntekter" ? grupper : [],
    sparingGroups: type === "sparing" ? grupper : [],
  };

  it("generatoren bevarer overstyringen byte-likt; varselet påstår ikke at kilden mangler", () => {
    const for_ = JSON.stringify(ov);
    const poster = generateForecastPosts(
      inputs.budgetGroups,
      { ov },
      new Date(2026, 10, 1),
      new Date(2026, 10, 30),
      inputs.incomeGroups,
      inputs.sparingGroups,
      () => "ny",
    );
    expect(Object.values(poster)).toHaveLength(1);
    expect(JSON.stringify(poster.ov)).toBe(for_);

    const mangler = finnForfallsdagMangler(inputs);
    expect(mangler).toMatchObject([{ type, gruppeId, postId: "x", status: "utelatt" }]);
    vis(loaded(mangler));
    const rad = screen.getByRole("listitem");
    expect(rad).not.toHaveTextContent("ikke med i prognosen");
    expect(rad).toHaveTextContent("generatoren kan ikke lage standardposter for denne");
    expect(rad).toHaveTextContent(
      "Manuelt overstyrte poster står uendret og kan være med i prognosen.",
    );
  });
});
