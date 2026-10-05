import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@features/hverdagsflyt/forvaltning/okonomi/OkonomiScreen", () => ({
  OkonomiScreen: function Stub() {
    const l = useLocation();
    return <div>Økonomi-stub {l.pathname + l.search}</div>;
  },
}));

vi.mock("@features/hverdagsflyt/forvaltning/spillerom/SpilleromScreen", () => ({
  SpilleromScreen: function Stub() {
    const l = useLocation();
    return <div>Spillerom-stub {l.pathname}</div>;
  },
}));

const { routes } = await import("./router");

/**
 * De tidligere separate skjermene Budsjett/Inntekter/Sparing er erstattet av
 * den samlede økonomiflaten (#59). Gamle lenker og bokmerker skal lande på
 * riktig område — bruker det ekte rutetreet, med skjermen stubbet.
 */
function renderAt(path: string) {
  const forvaltning = routes[0]!.children!.find((r) => r.path === "forvaltning")!;
  const router = createMemoryRouter([{ path: "/forvaltning", children: forvaltning.children }], {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

describe("Økonomiflaten erstatter Budsjett/Inntekter/Sparing", () => {
  it.each([
    ["/forvaltning/budsjett", "kostnader"],
    ["/forvaltning/inntekter", "inntekter"],
    ["/forvaltning/sparing", "sparing"],
  ])("%s sender til økonomiflaten med %s valgt", (fra, omrade) => {
    renderAt(fra);
    expect(
      screen.getByText(`Økonomi-stub /forvaltning/okonomi?omrade=${omrade}`),
    ).toBeInTheDocument();
  });
});

describe("Spillerom er ett rom (#59)", () => {
  it("den gamle oversikt-adressen sender til Spillerom", () => {
    renderAt("/forvaltning/oversikt");
    expect(screen.getByText("Spillerom-stub /forvaltning/spillerom")).toBeInTheDocument();
  });
});
