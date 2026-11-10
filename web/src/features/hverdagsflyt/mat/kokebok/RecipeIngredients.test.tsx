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
    "en åpen visning med ukjente grunnporsjoner (%s) viser 1 pers når en positiv verdi lagres; gjenåpning starter på den lagrede grunnen",
    (_, s) => {
      const { rerender, unmount } = render(
        <RecipeIngredients recipe={oppskrift(s)} freezer={[]} />,
      );
      rerender(<RecipeIngredients recipe={oppskrift(4)} freezer={[]} />);
      // Skalaen ble satt til 1 uten synlig velger, og regnes nå fra grunn 4.
      expect(screen.getByText("1 pers")).toBeTruthy();
      expect(screen.getByText("100 g")).toBeTruthy();
      unmount();

      render(<RecipeIngredients recipe={oppskrift(4)} freezer={[]} />);
      expect(screen.getByText("4 pers")).toBeTruthy();
      expect(screen.getByText("400 g")).toBeTruthy();
    },
  );

  it("en åpen visning beholder valgt porsjonstall når grunnporsjonene endres under den", () => {
    const { rerender } = render(<RecipeIngredients recipe={oppskrift(4)} freezer={[]} />);
    rerender(<RecipeIngredients recipe={oppskrift(2)} freezer={[]} />);
    // Skalaen er fortsatt 4, men regnes nå fra grunn 2.
    expect(screen.getByText("4 pers")).toBeTruthy();
    expect(screen.getByText("800 g")).toBeTruthy();
  });
});
