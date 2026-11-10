/**
 * Redigering via brukerhandlingen i Kokeboken (#20 6781074174): skjemaet
 * sender oppskriften slik det ble åpnet som grunnlag, viser utfallet og
 * beholder utkastet når ingenting er lagret. Datalaget er dekket mot
 * emulatoren i `recipes.repository.integration.test.ts`. Syntetiske data.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loaded } from "@app-types/status";
import type { RedigeringsUtfall } from "@domain/recipes/recipes";
import type { Recipe } from "@app-types/recipe";
import { RecipesScreen } from "./RecipesScreen";

const taco: Recipe = {
  id: "r1",
  name: "Taco",
  cat: "Middag",
  tags: [],
  time: 20,
  servings: 4,
  url: "",
  imageUrl: null,
  source: "manual",
  instructions: "",
  ingredients: [{ name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt" }],
  ingredientGroups: [],
  lastCooked: null,
  timesCooked: 0,
  createdAt: 0,
};

let oppskrifter: Recipe[] = [taco];
const redigerRecipe = vi.fn<(o: Recipe, p: Partial<Recipe>) => Promise<RedigeringsUtfall>>();

vi.mock("@hooks/useRecipes", () => ({
  useRecipes: () => ({
    recipes: loaded(oppskrifter),
    addRecipe: vi.fn(),
    updateRecipe: vi.fn(),
    redigerRecipe,
    removeRecipe: vi.fn(),
  }),
}));
vi.mock("@hooks/useItems", () => ({
  useItems: () => ({ items: loaded([]), findOrCreateItem: vi.fn() }),
}));
vi.mock("@hooks/useFreezer", () => ({
  useFreezer: () => ({ freezer: loaded([]) }),
}));

const vis = () =>
  render(
    <MemoryRouter initialEntries={["/mat/kokebok?apne=r1"]}>
      <RecipesScreen />
    </MemoryRouter>,
  );

const navnefelt = () => screen.getByPlaceholderText("Tomatsuppe…") as HTMLInputElement;

async function endreNavnOgLagre(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /Rediger/ }));
  await user.clear(navnefelt());
  await user.type(navnefelt(), "Fredagstaco");
  await user.click(screen.getByRole("button", { name: "💾 Lagre endringer" }));
}

beforeEach(() => {
  oppskrifter = [taco];
  redigerRecipe.mockReset();
});

describe("RecipesScreen — redigering med observert grunnlag", () => {
  it("vellykket lagring: grunnlaget er oppskriften slik skjemaet ble åpnet, og skjemaet lukkes", async () => {
    const user = userEvent.setup();
    redigerRecipe.mockResolvedValue("lagret");
    vis();
    await endreNavnOgLagre(user);

    expect(redigerRecipe).toHaveBeenCalledTimes(1);
    const [observert, patch] = redigerRecipe.mock.calls[0]!;
    expect(observert).toBe(taco);
    expect(patch).toMatchObject({ name: "Fredagstaco", servings: 4 });
    await vi.waitFor(() => expect(screen.queryByPlaceholderText("Tomatsuppe…")).toBeNull());
  });

  it("endret på en annen enhet: tydelig utfall, og utkastet står", async () => {
    const user = userEvent.setup();
    redigerRecipe.mockResolvedValue("endret");
    vis();
    await endreNavnOgLagre(user);

    expect((await screen.findByRole("alert")).textContent).toMatch(
      /«Taco» er endret på en annen enhet.*Ingenting er lagret/,
    );
    expect(navnefelt().value).toBe("Fredagstaco");
  });

  it("slettet mens skjemaet er åpent: skjemaet og utkastet står, og lagring melder at ingenting er gjenopprettet", async () => {
    const user = userEvent.setup();
    redigerRecipe.mockResolvedValue("mangler");
    const { rerender } = vis();
    await user.click(screen.getByRole("button", { name: /Rediger/ }));
    await user.clear(navnefelt());
    await user.type(navnefelt(), "Fredagstaco");

    oppskrifter = [];
    rerender(
      <MemoryRouter initialEntries={["/mat/kokebok?apne=r1"]}>
        <RecipesScreen />
      </MemoryRouter>,
    );
    expect(navnefelt().value).toBe("Fredagstaco");

    await user.click(screen.getByRole("button", { name: "💾 Lagre endringer" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /«Taco» er slettet.*ikke gjenopprettet/,
    );
    expect(navnefelt().value).toBe("Fredagstaco");
  });
});
