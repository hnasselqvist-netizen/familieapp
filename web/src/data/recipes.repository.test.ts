import { describe, expect, it } from "vitest";
import type { RecipeFields } from "@app-types/recipe";
import { medBevarteFelt } from "./recipes.repository";

/** #20 6736384489: hva `transactRecipe` skriver tilbake. Emulatortestene dekker selve transaksjonen. */
describe("medBevarteFelt", () => {
  const neste = (over: Partial<RecipeFields> = {}): RecipeFields => ({
    name: "Syntetisk",
    cat: "Middag",
    tags: [],
    time: 0,
    servings: 4,
    url: "",
    imageUrl: null,
    source: "manual",
    instructions: "",
    ingredients: [],
    ingredientGroups: [],
    lastCooked: null,
    timesCooked: 1,
    createdAt: 1,
    ...over,
  });

  it("bevarer ukjente rå felt (også numerisk id) og legger aldri til id", () => {
    expect(medBevarteFelt({ id: 4, x: { y: 1 }, name: "Gammel" }, neste())).toMatchObject({
      id: 4,
      x: { y: 1 },
      name: "Syntetisk",
    });
    expect(medBevarteFelt({ name: "Gammel" }, neste())).not.toHaveProperty("id");
  });

  it("et kjent felt updateren utelater eller gir undefined, skrives ikke", () => {
    const { lettvint: _l, ...uten } = neste({ lettvint: true });
    void _l;
    const ut = medBevarteFelt({ lettvint: true, source: "manual" }, {
      ...uten,
      source: undefined,
    } as unknown as RecipeFields);
    expect(ut).not.toHaveProperty("lettvint");
    expect(ut).not.toHaveProperty("source");
    expect(Object.values(ut)).not.toContain(undefined);
  });

  it("en egen «__proto__»-nøkkel blir en vanlig egen nøkkel, ikke prototypen", () => {
    const raa = JSON.parse('{"__proto__":{"forurenset":true},"id":"r1"}') as Record<
      string,
      unknown
    >;
    const ut = medBevarteFelt(raa, neste());
    expect(Object.getPrototypeOf(ut)).toBe(Object.prototype);
    expect(Object.hasOwn(ut, "__proto__")).toBe(true);
    expect((ut as { forurenset?: unknown }).forurenset).toBeUndefined();
  });
});
