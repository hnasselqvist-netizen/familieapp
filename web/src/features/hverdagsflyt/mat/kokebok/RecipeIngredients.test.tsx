/**
 * Karakterisering av grunnporsjoner (`Recipe.servings`) i ingrediensvisningen
 * (#27 6770296542, docs/drift/kokebok-porsjoner.md). Skaleringen er ren
 * visning: lagrede mengder gjelder for `servings`, og visningen starter der.
 * Syntetiske data.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RecipeIngredients } from "./RecipeIngredients";
import type { Recipe } from "@app-types/recipe";

const oppskrift = (servings: number | undefined): Recipe => ({
  id: "r1",
  name: "Gryte",
  cat: "Middag",
  tags: [],
  time: 30,
  servings: servings as number,
  url: "",
  imageUrl: null,
  source: "quick",
  instructions: "",
  ingredients: [
    { name: "Kjøttdeig", amount: "400 g", cat: "Kjøtt" },
    { name: "Salt", amount: "", cat: "Diverse" },
  ],
  ingredientGroups: [],
  lastCooked: null,
  timesCooked: 0,
  createdAt: 0,
});

describe("RecipeIngredients — grunnporsjoner", () => {
  it("starter på grunnporsjonene og viser de lagrede mengdene uendret", () => {
    render(<RecipeIngredients recipe={oppskrift(4)} freezer={[]} />);
    expect(screen.getByText("4 pers")).toBeTruthy();
    expect(screen.getByText("400 g")).toBeTruthy();
  });

  it("korrigerte grunnporsjoner med uendrede mengder: samme visning ved åpning, skaleringen regnes fra ny grunn", async () => {
    const user = userEvent.setup();
    render(<RecipeIngredients recipe={oppskrift(2)} freezer={[]} />);
    expect(screen.getByText("2 pers")).toBeTruthy();
    expect(screen.getByText("400 g")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Flere porsjoner" }));
    await user.click(screen.getByRole("button", { name: "Flere porsjoner" }));
    expect(screen.getByText("4 pers")).toBeTruthy();
    expect(screen.getByText("800 g")).toBeTruthy();
  });

  it.each([
    ["0", 0],
    ["manglende felt", undefined],
  ])("ukjente grunnporsjoner (%s): ingen skaleringsknapper, mengdene vises som lagret", (_, s) => {
    render(<RecipeIngredients recipe={oppskrift(s)} freezer={[]} />);
    expect(screen.queryByRole("button", { name: "Flere porsjoner" })).toBeNull();
    expect(screen.queryByText(/pers$/)).toBeNull();
    expect(screen.getByText("400 g")).toBeTruthy();
  });

  it.each([
    ["0", 0],
    ["manglende felt", undefined],
  ])(
    "en åpen visning med ukjente grunnporsjoner (%s) følger ny positiv grunn og viser lagrede mengder",
    (_, s) => {
      const { rerender } = render(<RecipeIngredients recipe={oppskrift(s)} freezer={[]} />);
      rerender(<RecipeIngredients recipe={oppskrift(4)} freezer={[]} />);
      expect(screen.getByText("4 pers")).toBeTruthy();
      expect(screen.getByText("400 g")).toBeTruthy();
    },
  );

  it("positiv → positiv uten eget valg: visningen følger ny grunn og viser lagrede mengder", () => {
    const { rerender } = render(<RecipeIngredients recipe={oppskrift(4)} freezer={[]} />);
    rerender(<RecipeIngredients recipe={oppskrift(2)} freezer={[]} />);
    expect(screen.getByText("2 pers")).toBeTruthy();
    expect(screen.getByText("400 g")).toBeTruthy();
  });

  it("positiv → positiv med eget valg: valgt porsjonstall står og regnes fra ny grunn", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RecipeIngredients recipe={oppskrift(4)} freezer={[]} />);
    await user.click(screen.getByRole("button", { name: "Flere porsjoner" }));
    expect(screen.getByText("5 pers")).toBeTruthy();
    expect(screen.getByText("500 g")).toBeTruthy();

    rerender(<RecipeIngredients recipe={oppskrift(2)} freezer={[]} />);
    expect(screen.getByText("5 pers")).toBeTruthy();
    expect(screen.getByText("1000 g")).toBeTruthy();
  });

  it("et valgt porsjonstall gjelder ikke en annen oppskrift", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RecipeIngredients recipe={oppskrift(4)} freezer={[]} />);
    await user.click(screen.getByRole("button", { name: "Færre porsjoner" }));
    expect(screen.getByText("3 pers")).toBeTruthy();

    rerender(<RecipeIngredients recipe={{ ...oppskrift(2), id: "r2" }} freezer={[]} />);
    expect(screen.getByText("2 pers")).toBeTruthy();
    expect(screen.getByText("400 g")).toBeTruthy();
  });

  it("A → B → A uten valg i B: A starter på sin grunn igjen, ikke på det gamle valget", async () => {
    const user = userEvent.setup();
    const a = oppskrift(4);
    const b = { ...oppskrift(2), id: "r2" };
    const { rerender } = render(<RecipeIngredients recipe={a} freezer={[]} />);
    await user.click(screen.getByRole("button", { name: "Flere porsjoner" }));
    expect(screen.getByText("5 pers")).toBeTruthy();

    rerender(<RecipeIngredients recipe={b} freezer={[]} />);
    expect(screen.getByText("2 pers")).toBeTruthy();
    rerender(<RecipeIngredients recipe={a} freezer={[]} />);
    expect(screen.getByText("4 pers")).toBeTruthy();
    expect(screen.getByText("400 g")).toBeTruthy();
  });

  it("− på grunn 1 er ikke et valg: ny grunn 4 vises med lagrede mengder", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RecipeIngredients recipe={oppskrift(1)} freezer={[]} />);
    await user.click(screen.getByRole("button", { name: "Færre porsjoner" }));
    expect(screen.getByText("1 pers")).toBeTruthy();

    rerender(<RecipeIngredients recipe={oppskrift(4)} freezer={[]} />);
    expect(screen.getByText("4 pers")).toBeTruthy();
    expect(screen.getByText("400 g")).toBeTruthy();
  });

  it("et faktisk valg etter et trykk uten endring beholdes for samme oppskrift", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RecipeIngredients recipe={oppskrift(1)} freezer={[]} />);
    await user.click(screen.getByRole("button", { name: "Færre porsjoner" }));
    await user.click(screen.getByRole("button", { name: "Flere porsjoner" }));
    expect(screen.getByText("2 pers")).toBeTruthy();

    rerender(<RecipeIngredients recipe={oppskrift(4)} freezer={[]} />);
    expect(screen.getByText("2 pers")).toBeTruthy();
    expect(screen.getByText("200 g")).toBeTruthy();
  });
});
