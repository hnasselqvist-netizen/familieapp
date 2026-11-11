import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  type NavigateFunction,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseBudsjettfamilieResult } from "@hooks/useBudsjettfamilie";
import type { BudsjettfamilieNode, BudsjettGruppe } from "@app-types/budsjettfamilie";
import { loaded, loading } from "@app-types/status";
import { OkonomiScreen } from "./OkonomiScreen";

const post = (id: string, name: string, budget: number, spent: number) => ({
  id,
  name,
  months: Array.from({ length: 12 }, () => ({ budget, spent })),
});

const GRUPPER: Record<BudsjettfamilieNode, BudsjettGruppe[]> = {
  incomeGroups: [{ id: "lonn", label: "Lønn", items: [post("l1", "Lønn A", 50000, 50000)] }],
  budget: [
    { id: "bolig", label: "Bolig", items: [post("b1", "Husleie", 15000, 15000)] },
    { id: "mat", label: "Mat", items: [post("m1", "Dagligvarer", 8000, 3000)] },
  ],
  sparingGroups: [{ id: "buffer", label: "Buffer", items: [] }],
};

const kall: { node: BudsjettfamilieNode; month: number | undefined }[] = [];
const tilstand = vi.hoisted(() => ({ laster: false }));

vi.mock("@hooks/useBudsjettfamilie", () => ({
  useBudsjettfamilie: (node: BudsjettfamilieNode, month?: number): UseBudsjettfamilieResult => {
    kall.push({ node, month });
    return {
      grupper: tilstand.laster && node === "sparingGroups" ? loading : loaded(GRUPPER[node]),
      month: month ?? 0,
      setMonth: () => {},
      monthKey: "2026-10",
      actualTotals: {},
      hendelser: [],
      transaksjoner: [],
      receipts: [],
      gyldigeObservasjonIder: new Set(),
      updateBudget: async () => {},
      updateSpent: async () => {},
      addNewItem: async () => {},
      removeExistingItem: async () => {},
      saveMeta: async () => {},
    };
  },
}));

const nav: { til?: NavigateFunction } = {};
function Sted() {
  const l = useLocation();
  nav.til = useNavigate();
  return <div data-testid="sted">{l.pathname + l.search}</div>;
}
const gaaTil = (til: string | number) =>
  act(() => {
    void (typeof til === "number" ? nav.til!(til) : nav.til!(til));
  });

const vis = (url = "/forvaltning/okonomi") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/forvaltning/okonomi"
          element={
            <>
              <OkonomiScreen />
              <Sted />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

const tall = (tekst: string) => tekst.replace(/\s/g, " ");
const omrader = () => within(screen.getByRole("tablist", { name: "Område" })).getAllByRole("tab");
const panel = () => screen.getByRole("tabpanel");

beforeEach(() => {
  kall.length = 0;
  tilstand.laster = false;
});

describe("OkonomiScreen — samlet økonomiflate", () => {
  it("venter til alle tre områdene er lastet", () => {
    tilstand.laster = true;
    vis();
    expect(screen.getByText("Laster…")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("sammendraget viser alle tre områdene og netto for samme måned", () => {
    vis();
    expect(omrader().map((t) => tall(t.textContent ?? ""))).toEqual([
      "Inntekter50 000 kr50 000 kr",
      "Kostnader18 000 kr23 000 kr",
      "Sparing0 kr0 kr",
    ]);
    expect(tall(screen.getByText("Netto").parentElement?.textContent ?? "")).toBe(
      "Netto32 000 kr27 000 kr",
    );
  });

  it("kostnader er åpent som standard, med gruppene for det området", () => {
    vis();
    expect(omrader()[1]).toHaveAttribute("aria-selected", "true");
    expect(panel()).toHaveAccessibleName("Kostnader");
    expect(within(panel()).getByText("Bolig")).toBeInTheDocument();
    expect(within(panel()).queryByText("Lønn")).toBeNull();
  });

  it("?omrade= åpner riktig område direkte (lenkene fra forsiden og de gamle rutene)", () => {
    vis("/forvaltning/okonomi?omrade=sparing");
    expect(omrader()[2]).toHaveAttribute("aria-selected", "true");
    expect(within(panel()).getByText("Buffer")).toBeInTheDocument();
  });

  it("ett område av gangen: valg bytter panel og oppdaterer adressen", async () => {
    const user = userEvent.setup();
    vis();
    await user.click(omrader()[0]!);
    expect(omrader()[0]).toHaveAttribute("aria-selected", "true");
    expect(omrader()[1]).toHaveAttribute("aria-selected", "false");
    expect(within(panel()).getByText("Lønn")).toBeInTheDocument();
    expect(within(panel()).queryByText("Bolig")).toBeNull();
    expect(screen.getByTestId("sted")).toHaveTextContent("/forvaltning/okonomi?omrade=inntekter");
  });

  it("én månedsvelger styrer alle tre områdene", async () => {
    const user = userEvent.setup();
    vis();
    const start = new Date().getMonth();
    expect(new Set(kall.map((k) => k.month))).toEqual(new Set([start]));
    kall.length = 0;
    await user.click(screen.getByRole("button", { name: "Neste måned" }));
    const neste = (start + 1) % 12;
    expect(kall.filter((k) => k.month === neste).map((k) => k.node)).toEqual(
      expect.arrayContaining(["incomeGroups", "budget", "sparingGroups"]),
    );
    expect(kall.every((k) => k.month === neste)).toBe(true);
  });

  it("?gruppe=&post= åpner postens detaljredigering; lukking fjerner post fra adressen (funn F)", async () => {
    const user = userEvent.setup();
    vis("/forvaltning/okonomi?omrade=kostnader&gruppe=bolig&post=b1");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Detaljer — Husleie");
    await user.click(within(dialog).getByRole("button", { name: "Avbryt" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("sted")).toHaveTextContent("/forvaltning/okonomi?omrade=kostnader");
  });

  it("ukjent post eller post i annen gruppe åpner ingenting (identitet er gruppe + ID)", () => {
    vis("/forvaltning/okonomi?omrade=kostnader&gruppe=mat&post=b1");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(panel()).toHaveAccessibleName("Kostnader");
  });

  describe("lenkemål ved URL-navigasjon uten remount (review 5790655651)", () => {
    const B1 = "/forvaltning/okonomi?omrade=kostnader&gruppe=bolig&post=b1";
    const M1 = "/forvaltning/okonomi?omrade=kostnader&gruppe=mat&post=m1";
    it("navigering til lenkemål i samme rute åpner riktig post", () => {
      vis("/forvaltning/okonomi?omrade=kostnader");
      expect(screen.queryByRole("dialog")).toBeNull();
      gaaTil(B1);
      expect(screen.getByRole("dialog")).toHaveTextContent("Detaljer — Husleie");
    });

    it("bytte mellom to mål i samme område uten ulagrede endringer", () => {
      vis("/forvaltning/okonomi?omrade=kostnader");
      gaaTil(B1);
      expect(screen.getByRole("dialog")).toHaveTextContent("Detaljer — Husleie");
      gaaTil(M1);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("dialog")).toHaveTextContent("Detaljer — Dagligvarer");
      expect(screen.getByDisplayValue("Dagligvarer")).toBeInTheDocument();
    });

    it("lukking og ny åpning av samme mål", async () => {
      const user = userEvent.setup();
      vis("/forvaltning/okonomi?omrade=kostnader");
      gaaTil(B1);
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Avbryt" }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.getByTestId("sted")).toHaveTextContent("/forvaltning/okonomi?omrade=kostnader");
      gaaTil(B1);
      expect(screen.getByRole("dialog")).toHaveTextContent("Detaljer — Husleie");
    });

    it("tilbake lukker en uendret lenkeredigering; frem åpner den igjen", () => {
      vis("/forvaltning/okonomi?omrade=kostnader");
      gaaTil(B1);
      expect(screen.getByRole("dialog")).toHaveTextContent("Detaljer — Husleie");
      gaaTil(-1);
      expect(screen.queryByRole("dialog")).toBeNull();
      gaaTil(1);
      expect(screen.getByRole("dialog")).toHaveTextContent("Detaljer — Husleie");
    });

    it("nytt mål med ulagret utkast: utkastet står, eksplisitt valg; «Fortsett» beholder utkastet", async () => {
      const user = userEvent.setup();
      vis("/forvaltning/okonomi?omrade=kostnader");
      gaaTil(B1);
      const navn = screen.getByDisplayValue("Husleie");
      await user.clear(navn);
      await user.type(navn, "Husleie ny");
      gaaTil(M1);
      expect(screen.getAllByRole("dialog")).toHaveLength(1);
      expect(screen.getByRole("dialog")).toHaveTextContent("Detaljer — Husleie");
      expect(screen.getByDisplayValue("Husleie ny")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Adressen peker nå på «Dagligvarer». Endringene i «Husleie» er ikke lagret.",
      );
      await user.click(screen.getByRole("button", { name: "Fortsett redigering" }));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByDisplayValue("Husleie ny")).toBeInTheDocument();
    });

    it("nytt mål med ulagret utkast: «Forkast og åpne» åpner den nye posten med friskt utkast", async () => {
      const user = userEvent.setup();
      vis("/forvaltning/okonomi?omrade=kostnader");
      gaaTil(B1);
      await user.type(screen.getByDisplayValue("Husleie"), " x");
      gaaTil(M1);
      await user.click(screen.getByRole("button", { name: "Forkast og åpne «Dagligvarer»" }));
      expect(screen.getByRole("dialog")).toHaveTextContent("Detaljer — Dagligvarer");
      expect(screen.getByDisplayValue("Dagligvarer")).toBeInTheDocument();
      expect(screen.queryByDisplayValue("Husleie x")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("tilbake med ulagret utkast lukker ikke redigeringen", async () => {
      const user = userEvent.setup();
      vis("/forvaltning/okonomi?omrade=kostnader");
      gaaTil(B1);
      await user.type(screen.getByDisplayValue("Husleie"), " x");
      gaaTil(-1);
      expect(screen.getByDisplayValue("Husleie x")).toBeInTheDocument();
    });

    it("live-oppdatering av gruppene nullstiller ikke utkastet", async () => {
      const user = userEvent.setup();
      const r = vis("/forvaltning/okonomi?omrade=kostnader");
      gaaTil(B1);
      await user.type(screen.getByDisplayValue("Husleie"), " x");
      GRUPPER.budget = GRUPPER.budget.map((g) => ({ ...g, items: [...g.items] }));
      r.rerender(
        <MemoryRouter initialEntries={["/forvaltning/okonomi?omrade=kostnader"]}>
          <Routes>
            <Route
              path="/forvaltning/okonomi"
              element={
                <>
                  <OkonomiScreen />
                  <Sted />
                </>
              }
            />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByDisplayValue("Husleie x")).toBeInTheDocument();
    });

    it("ukjent mål ved navigering åpner ingenting", () => {
      vis("/forvaltning/okonomi?omrade=kostnader");
      gaaTil("/forvaltning/okonomi?omrade=kostnader&gruppe=bolig&post=finnes-ikke");
      expect(screen.queryByRole("dialog")).toBeNull();
      gaaTil("/forvaltning/okonomi?omrade=kostnader&gruppe=mat&post=b1");
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
