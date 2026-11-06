/**
 * Mengdevisning i Matlager og oppskrift (#20, ordre 6693886984). Datahooks
 * mocket, syntetiske batcher. Visningen er skrivefri: ingen skriver kalles,
 * og kildeobjektene muteres ikke.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";
import type { FreezerItem } from "@app-types/freezer";
import type { Recipe } from "@app-types/recipe";

const FRYSER: FreezerItem[] = [
  {
    id: "mel",
    itemId: "v-mel",
    name: "Mel",
    batches: [
      { id: "m1", count: 1, unit: "kg", gramsPerUnit: null },
      { id: "m2", count: 500, unit: "g", gramsPerUnit: null },
    ],
  },
  {
    id: "kjottdeig",
    itemId: "v-kd",
    name: "Kjøttdeig",
    batches: [
      { id: "k1", count: 2, unit: "pk", gramsPerUnit: 400 },
      { id: "k2", count: 500, unit: "g", gramsPerUnit: null },
    ],
  },
  {
    id: "bonner",
    itemId: "v-b",
    name: "Bønner",
    batches: [
      { id: "b1", count: 2, unit: "boks", gramsPerUnit: null },
      { id: "b2", count: 300, unit: "g", gramsPerUnit: null },
    ],
  },
  {
    id: "pinner",
    itemId: "v-p",
    name: "Fiskepinner",
    batches: [
      { id: "p1", count: 2, unit: "pk", gramsPerUnit: null },
      { id: "p2", count: 3, unit: "stk", gramsPerUnit: null },
    ],
  },
  {
    id: "gammel",
    itemId: "v-g",
    name: "Gammel",
    batches: [{ id: "g1", count: 2, unit: "kg", gramsPerUnit: 500 }],
  },
  {
    id: "brod",
    itemId: "v-br",
    name: "Brød",
    batches: [{ id: "br1", count: 3, unit: "stk", gramsPerUnit: null }],
  },
];

const skrivere = {
  addBatch: vi.fn(),
  adjustBatchCount: vi.fn(),
  removeItem: vi.fn(),
};
vi.mock("@hooks/useFreezer", () => ({
  useFreezer: () => ({ freezer: loaded(FRYSER), ...skrivere }),
}));
vi.mock("@hooks/useItems", () => ({
  useItems: () => ({ items: loaded([]), findOrCreateItem: vi.fn() }),
}));
vi.mock("@hooks/useStaples", () => ({
  useStaples: () => ({ staples: loaded({}), unmarkStaple: vi.fn() }),
}));

const { FreezerScreen } = await import("./FreezerScreen");
const { RecipeIngredients } = await import("../kokebok/RecipeIngredients");

describe("Matlager — Totalt", () => {
  it("viser korrekte summer og ledd, og skriver ingenting", () => {
    const foer = structuredClone(FRYSER);
    render(<FreezerScreen />);
    expect(screen.getByText("Totalt: 1500 g")).toBeInTheDocument();
    expect(screen.getByText("Totalt: 1300 g")).toBeInTheDocument();
    expect(screen.getByText("Totalt: 300 g · 2 boks")).toBeInTheDocument();
    expect(screen.getByText("Totalt: 2 pk · 3 stk")).toBeInTheDocument();
    // Tvetydig gammel verdi: vises som lagret i batchraden, ingen utledet sum.
    expect(screen.getAllByText("2 kg à 500 g").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Totalt: 1000 g/)).toBeNull();
    // Én batch uten mer å si: ingen Totalt-linje.
    expect(screen.queryByText("Totalt: 3 stk")).toBeNull();
    expect(screen.queryByText(/501 g|5 pk|800 g/)).toBeNull();
    expect(FRYSER).toEqual(foer);
    expect(skrivere.addBatch).not.toHaveBeenCalled();
    expect(skrivere.adjustBatchCount).not.toHaveBeenCalled();
    expect(skrivere.removeItem).not.toHaveBeenCalled();
  });
});

describe("Oppskrift — Matlager-etikett", () => {
  it("viser samme ledd per ingrediens", () => {
    const recipe = {
      id: "r",
      name: "Gryte",
      cat: "",
      tags: [],
      time: 0,
      servings: 0,
      url: "",
      imageUrl: null,
      source: "",
      instructions: "",
      ingredients: [
        { name: "Kjøttdeig", amount: "400 g" },
        { name: "Bønner", amount: "1 boks" },
        { name: "Fiskepinner", amount: "" },
      ],
      ingredientGroups: [],
      lastCooked: null,
      timesCooked: 0,
      createdAt: 0,
    } as unknown as Recipe;
    render(<RecipeIngredients recipe={recipe} freezer={FRYSER} />);
    expect(screen.getByText("❄️ 1300 g i Matlager")).toBeInTheDocument();
    expect(screen.getByText("❄️ 300 g · 2 boks i Matlager")).toBeInTheDocument();
    expect(screen.getByText("❄️ 2 pk · 3 stk i Matlager")).toBeInTheDocument();
  });
});
