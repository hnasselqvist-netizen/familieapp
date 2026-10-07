import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Gangen, useGangen } from "@hooks/useGangen";
import { loaded, loading } from "@app-types/status";
import { GangenScreen } from "./GangenScreen";

/**
 * Gangen som dagens ene inngang (#59, retning 1): høyst tre punkter, hvert
 * med direkte vei til stedet beslutningen tas og `fra=gangen` for veien
 * tilbake. Produktvalg C: ingen økonomi utover køene som venter.
 */

vi.mock("@hooks/useGangen", () => ({ useGangen: vi.fn() }));
vi.mock("@hooks/useAuthUser", () => ({ useAuthUser: () => ({ displayName: "Helen N" }) }));

function gangen(overrides: Partial<Gangen> = {}): Gangen {
  return {
    iDag: "Wed",
    trengerVurdering: 0,
    forslagTilMatch: 0,
    kvitteringerKlareForKobling: 0,
    middagIDag: { navn: "Taco", ingredienser: [{ itemId: "kjottdeig", name: "Kjøttdeig" }] },
    middagIMorgen: null,
    handleliste: [],
    fryser: [],
    ...overrides,
  };
}

function renderGangen() {
  return render(
    <MemoryRouter>
      <GangenScreen />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(useGangen).mockReturnValue(loaded(gangen()));
});

describe("GangenScreen", () => {
  it("konkluderer aldri før alle kilder har levert", () => {
    vi.mocked(useGangen).mockReturnValue(loading);
    renderGangen();
    expect(screen.getByText("Laster…")).toBeInTheDocument();
    expect(screen.queryByText("Ingenting trenger deg akkurat nå.")).not.toBeInTheDocument();
  });

  it("ingenting venter → rolig tomtilstand, og dagens middag er konkret i «Vi ordner»", () => {
    renderGangen();
    expect(screen.getByText("Ingenting trenger deg akkurat nå.")).toBeInTheDocument();
    expect(screen.getByText("I dag: Taco.")).toBeInTheDocument();
  });

  it("hvert punkt lenker rett til beslutningen, med veien tilbake", () => {
    vi.mocked(useGangen).mockReturnValue(
      loaded(
        gangen({
          middagIDag: null,
          trengerVurdering: 3,
          forslagTilMatch: 3,
          kvitteringerKlareForKobling: 1,
        }),
      ),
    );
    renderGangen();
    // Gangen selv har ingen andre lenker enn punktene (bunnmenyen eies av layouten).
    const lenker = screen.getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")]);
    expect(lenker).toEqual([
      ["Middagen i dager ikke planlagt ennå", "/mat/plan?dag=Wed&fra=gangen"],
      ["3 transaksjonerventer på vurdering", "/forvaltning/transaksjoner?ko=forslag&fra=gangen"],
      ["Én kvitteringventer på kobling", "/forvaltning/kvitteringer?fra=gangen"],
    ]);
  });

  it("varer til dagens middag som står på handlelisten blir et handlepunkt", () => {
    vi.mocked(useGangen).mockReturnValue(
      loaded(gangen({ handleliste: [{ itemId: "kjottdeig", name: "Kjøttdeig", done: false }] })),
    );
    renderGangen();
    expect(screen.getByRole("link", { name: /Én vare til Taco/ })).toHaveAttribute(
      "href",
      "/mat/handle?fra=gangen",
    );
  });

  it("produktvalg C: ingen beløp eller Spillerom-vurdering på Gangen", () => {
    vi.mocked(useGangen).mockReturnValue(loaded(gangen({ trengerVurdering: 2 })));
    renderGangen();
    expect(document.body.textContent).not.toMatch(/kr\b|Spillerom|frem til lønn/i);
  });
});
