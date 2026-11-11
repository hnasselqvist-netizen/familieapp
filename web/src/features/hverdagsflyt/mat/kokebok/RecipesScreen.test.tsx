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
import { UKJENT_LAGRING, type RedigeringsUtfall, type SletteUtfall } from "@domain/recipes/recipes";
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
const slettRecipe = vi.fn<(o: Recipe) => Promise<SletteUtfall>>();

vi.mock("@hooks/useRecipes", () => ({
  useRecipes: () => ({
    recipes: loaded(oppskrifter),
    addRecipe: vi.fn(),
    updateRecipe: vi.fn(),
    redigerRecipe,
    removeRecipe: vi.fn(),
    slettRecipe,
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
  slettRecipe.mockReset();
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
    expect(patch).toMatchObject({ name: "Fredagstaco" });
    // Porsjonsfeltet er ikke rørt, så det skrives ikke (#20 6784919488).
    expect(patch).not.toHaveProperty("servings");
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

  it("utsatt svar: skjemaet er sperret mens lagringen pågår, og lukkes først når den er lagret", async () => {
    const user = userEvent.setup();
    let svar: (u: RedigeringsUtfall) => void = () => {};
    redigerRecipe.mockImplementation(() => new Promise((r) => (svar = r)));
    vis();
    await endreNavnOgLagre(user);

    expect(navnefelt().matches(":disabled")).toBe(true);
    await user.type(navnefelt(), " deluxe");
    expect(navnefelt().value).toBe("Fredagstaco");

    svar("lagret");
    await vi.waitFor(() => expect(screen.queryByPlaceholderText("Tomatsuppe…")).toBeNull());
    expect(redigerRecipe).toHaveBeenCalledTimes(1);
  });

  it("ukjent utfall: sier at vi ikke vet om endringen ble lagret, og utkastet står", async () => {
    const user = userEvent.setup();
    redigerRecipe.mockResolvedValue("ukjent");
    vis();
    await endreNavnOgLagre(user);

    const melding = (await screen.findByRole("alert")).textContent ?? "";
    expect(melding).toContain(UKJENT_LAGRING);
    expect(melding).not.toMatch(/Ingenting er lagret/);
    expect(navnefelt().value).toBe("Fredagstaco");
    expect(navnefelt().matches(":disabled")).toBe(false);
  });
});

describe("RecipesScreen — «Slett» med observert grunnlag (#20 6789830224)", () => {
  const slettKnapp = () => screen.getByRole("button", { name: /Slett/ });
  const iDetaljen = () => screen.queryByRole("button", { name: /Tilbake/ }) !== null;

  it("bekreftet sletting: grunnlaget er oppskriften slik detaljen viste den, og skjermen går til listen med bekreftelse", async () => {
    const user = userEvent.setup();
    slettRecipe.mockResolvedValue("slettet");
    vis();
    await user.click(slettKnapp());

    expect(slettRecipe).toHaveBeenCalledTimes(1);
    expect(slettRecipe.mock.calls[0]![0]).toBe(taco);
    expect((await screen.findByRole("status")).textContent).toContain("«Taco» er slettet.");
    expect(iDetaljen()).toBe(false);
  });

  it.each([
    ["endret", /«Taco» er endret på en annen enhet.*Ingenting er slettet/, true],
    ["mangler", /«Taco» var allerede slettet.*Ingenting er gjenopprettet/, false],
    ["avvist", /ikke tilgang.*Ingenting er slettet/, true],
    ["ukjent", /Vi vet ikke om «Taco» ble slettet/, true],
  ] as const)(
    "%s: tydelig utfall, og detaljen står bare når oppskriften kan finnes",
    async (utfall, tekst, blir) => {
      const user = userEvent.setup();
      slettRecipe.mockResolvedValue(utfall);
      vis();
      await user.click(slettKnapp());

      expect((await screen.findByRole("alert")).textContent).toMatch(tekst);
      expect(iDetaljen()).toBe(blir);
    },
  );

  it("et avvist løfte vises som ukjent utfall", async () => {
    const user = userEvent.setup();
    slettRecipe.mockRejectedValue(new Error("nett"));
    vis();
    await user.click(slettKnapp());
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /Vi vet ikke om «Taco» ble slettet/,
    );
  });

  it("doble trykk mens slettingen pågår sender bare ett kall", async () => {
    const user = userEvent.setup();
    let svar: (u: SletteUtfall) => void = () => {};
    slettRecipe.mockImplementation(() => new Promise((r) => (svar = r)));
    vis();
    await user.click(slettKnapp());
    expect((slettKnapp() as HTMLButtonElement).disabled).toBe(true);
    await user.click(slettKnapp());
    expect(slettRecipe).toHaveBeenCalledTimes(1);

    svar("endret");
    await screen.findByRole("alert");
    expect((slettKnapp() as HTMLButtonElement).disabled).toBe(false);
  });
});
