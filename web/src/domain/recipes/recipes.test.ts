/**
 * Karakteriseringstester — dokumenterer den FAKTISKE oppførselen til
 * `getIngredients` (linje ~3892), `RecipeIngredients.scaleAmt`
 * (linje ~4702) og "bekreft middag"-statistikkoppdateringen
 * (linje ~3828–3831) i dagens index.html, slik den er lest og
 * verifisert manuelt mot koden FØR noe ble flyttet. Ved uenighet om
 * "riktig" oppførsel senere: dette er fasiten, ikke en idealisert
 * versjon.
 */
import { describe, expect, it } from "vitest";
import {
  getIngredients,
  markRecipeCooked,
  redigerHvisUendret,
  redigeringTekst,
  SKJEMAFELT,
  scaleIngredientAmount,
  slettHvisUendret,
  sletteTekst,
} from "./recipes";
import type { Ingredient, Recipe, RecipeFields } from "@app-types/recipe";

const ing = (overrides: Partial<Ingredient> = {}): Ingredient => ({
  name: "Kjøttdeig",
  amount: "500 g",
  cat: "Kjøtt",
  ...overrides,
});

describe("getIngredients", () => {
  it("returnerer tom liste for null/undefined", () => {
    expect(getIngredients(null)).toEqual([]);
    expect(getIngredients(undefined)).toEqual([]);
  });

  it("flater ut ingredientGroups når den finnes og ikke er tom", () => {
    const recipe = {
      ingredients: [],
      ingredientGroups: [
        { id: "g1", name: "Bunn", ingredients: [ing({ name: "Pasta" })] },
        { id: "g2", name: "Fyll", ingredients: [ing({ name: "Ost" }), ing({ name: "Skinke" })] },
      ],
    } as unknown as Recipe;
    expect(getIngredients(recipe).map((i) => i.name)).toEqual(["Pasta", "Ost", "Skinke"]);
  });

  it("bruker de flate ingredients når ingredientGroups er tom", () => {
    const recipe = {
      ingredients: [ing({ name: "Løk" })],
      ingredientGroups: [],
    } as unknown as Recipe;
    expect(getIngredients(recipe).map((i) => i.name)).toEqual(["Løk"]);
  });

  it("bruker de flate ingredients når ingredientGroups mangler helt", () => {
    const recipe = { ingredients: [ing({ name: "Gulrot" })] } as unknown as Recipe;
    expect(getIngredients(recipe).map((i) => i.name)).toEqual(["Gulrot"]);
  });

  it("returnerer tom liste når verken ingredients eller ingredientGroups finnes", () => {
    expect(getIngredients({} as Recipe)).toEqual([]);
  });
});

describe("scaleIngredientAmount", () => {
  it("skalerer opp det ledende tallet proporsjonalt, beholder enhetssuffikset", () => {
    expect(scaleIngredientAmount("500 g", 4, 8)).toBe("1000 g");
  });

  it("skalerer ned og runder til to desimaler", () => {
    expect(scaleIngredientAmount("100 g", 3, 1)).toBe("33.33 g");
  });

  it("returnerer mengden uendret når baseServings er 0", () => {
    expect(scaleIngredientAmount("500 g", 0, 8)).toBe("500 g");
  });

  it("returnerer tom streng for tom/manglende mengde", () => {
    expect(scaleIngredientAmount("", 4, 8)).toBe("");
  });

  it("returnerer mengden uendret når den ikke starter med et lesbart tall", () => {
    expect(scaleIngredientAmount("etter behov", 4, 8)).toBe("etter behov");
  });

  it("gjør ingenting når target===base", () => {
    expect(scaleIngredientAmount("500 g", 4, 4)).toBe("500 g");
  });
});

describe("markRecipeCooked", () => {
  it("setter lastCooked og teller opp timesCooked fra 0", () => {
    const current = { timesCooked: 0 } as RecipeFields;
    const result = markRecipeCooked(current, 1720000000);
    expect(result.lastCooked).toBe(1720000000);
    expect(result.timesCooked).toBe(1);
  });

  it("teller opp timesCooked fra en eksisterende verdi", () => {
    const current = { timesCooked: 6 } as RecipeFields;
    const result = markRecipeCooked(current, 1720000000);
    expect(result.timesCooked).toBe(7);
  });

  it("behandler manglende timesCooked som 0", () => {
    const current = {} as RecipeFields;
    const result = markRecipeCooked(current, 1720000000);
    expect(result.timesCooked).toBe(1);
  });

  it("endrer ikke andre felt på posten", () => {
    const current = { name: "Taco", cat: "Middag", timesCooked: 2 } as RecipeFields;
    const result = markRecipeCooked(current, 1720000000);
    expect(result.name).toBe("Taco");
    expect(result.cat).toBe("Middag");
  });
});

describe("redigerHvisUendret (#20 6781074174)", () => {
  const felt = (o: Partial<RecipeFields> = {}): RecipeFields => ({
    name: "Taco",
    cat: "Middag",
    tags: [],
    time: 20,
    servings: 4,
    url: "",
    imageUrl: null,
    source: "manual",
    instructions: "",
    ingredients: [ing()],
    ingredientGroups: [],
    lastCooked: null,
    timesCooked: 0,
    createdAt: 1,
    ...o,
  });
  const skjema = (o: Partial<RecipeFields> = {}): Partial<RecipeFields> => ({
    name: "Fredagstaco",
    servings: 4,
    ingredients: [ing()],
    ...o,
  });

  it("uendret grunnlag: skriver patchen over den ferske posten", () => {
    const r = redigerHvisUendret(felt(), felt(), skjema());
    expect(r).toEqual({ type: "skriv", fields: { ...felt(), ...skjema() } });
  });

  it("nøkkelrekkefølge i lagrede objekter spiller ingen rolle", () => {
    const fersk = felt({ ingredients: [{ cat: "Kjøtt", amount: "500 g", name: "Kjøttdeig" }] });
    expect(redigerHvisUendret(fersk, felt(), skjema()).type).toBe("skriv");
  });

  it.each([
    ["ingredienser", { ingredients: [ing({ amount: "600 g" })] }],
    ["porsjoner", { servings: 2 }],
    ["navn", { name: "Taco deluxe" }],
  ])("et felt skjemaet skriver (%s) er endret siden åpning: stopp", (_, endring) => {
    const r = redigerHvisUendret(felt(endring), felt(), skjema());
    expect(r).toEqual({ type: "stopp", utfall: "endret" });
  });

  it("felt skjemaet ikke skriver («Bekreft middag») er ikke grunnlag, og tas fra den ferske posten", () => {
    const fersk = felt({ lastCooked: 99, timesCooked: 3 });
    const r = redigerHvisUendret(fersk, felt(), skjema());
    expect(r).toEqual({ type: "skriv", fields: { ...fersk, ...skjema() } });
  });

  it.each([
    ["0", 0],
    ["manglende felt", undefined],
    ["positiv verdi", 4],
  ])(
    "uendrede porsjoner (%s) skrives ikke, men er grunnlag: verdien bevares (#20 6784919488)",
    (_, lagret) => {
      const utenPorsjoner = skjema();
      delete utenPorsjoner.servings;
      const r = redigerHvisUendret(
        felt({ servings: lagret as number }),
        felt({ servings: lagret as number }),
        utenPorsjoner,
        SKJEMAFELT,
      );
      expect(r.type).toBe("skriv");
      if (r.type === "skriv") expect(r.fields.servings).toBe(lagret);
    },
  );

  it("en samtidig porsjonsendring stopper redigeringen selv når porsjonene ikke skrives", () => {
    const utenPorsjoner = skjema();
    delete utenPorsjoner.servings;
    const r = redigerHvisUendret(
      felt({ servings: 6 }),
      felt({ servings: 0 }),
      utenPorsjoner,
      SKJEMAFELT,
    );
    expect(r).toEqual({ type: "stopp", utfall: "endret" });
  });

  it("brukertekstene sier at ingenting er lagret og at utkastet står", () => {
    expect(redigeringTekst("endret", "Taco")).toMatch(
      /«Taco» er endret.*Ingenting er lagret.*Utkastet/,
    );
    expect(redigeringTekst("avvist", "Taco")).toMatch(/ikke tilgang.*Ingenting er lagret/);
    expect(redigeringTekst("ukjent", "Taco")).toMatch(/vet ikke om endringen ble lagret/);
    expect(redigeringTekst("ukjent", "Taco")).not.toMatch(/Ingenting er lagret/);
    expect(redigeringTekst("mangler", "Taco")).toMatch(
      /«Taco» er slettet.*ikke gjenopprettet.*Utkastet/,
    );
  });
});

describe("slettHvisUendret (#20 6789830224)", () => {
  const felt = (o: Partial<RecipeFields> = {}): RecipeFields => ({
    name: "Taco",
    cat: "Middag",
    tags: [],
    time: 20,
    servings: 4,
    url: "",
    imageUrl: null,
    source: "manual",
    instructions: "",
    ingredients: [ing()],
    ingredientGroups: [],
    lastCooked: null,
    timesCooked: 0,
    createdAt: 1,
    ...o,
  });

  it("uendret oppskrift: slettes", () => {
    expect(slettHvisUendret(felt(), felt())).toEqual({ type: "slett" });
  });

  it("nøkkelrekkefølge spiller ingen rolle", () => {
    const fersk = felt({ ingredients: [{ cat: "Kjøtt", amount: "500 g", name: "Kjøttdeig" }] });
    expect(slettHvisUendret(fersk, felt())).toEqual({ type: "slett" });
  });

  it.each([
    ["navn", { name: "Fredagstaco" }],
    ["ingredienser", { ingredients: [ing({ amount: "600 g" })] }],
    ["«Bekreft middag»", { lastCooked: 99, timesCooked: 1 }],
  ])("endret %s siden visningen: stopp", (_, endring) => {
    expect(slettHvisUendret(felt(endring), felt())).toEqual({ type: "stopp", utfall: "endret" });
  });

  it("brukertekstene skiller utfallene", () => {
    expect(sletteTekst("slettet", "Taco")).toBe("«Taco» er slettet.");
    expect(sletteTekst("endret", "Taco")).toMatch(/endret.*Ingenting er slettet/);
    expect(sletteTekst("mangler", "Taco")).toMatch(/allerede slettet.*Ingenting er gjenopprettet/);
    expect(sletteTekst("avvist", "Taco")).toMatch(/ikke tilgang.*Ingenting er slettet/);
    expect(sletteTekst("ukjent", "Taco")).toMatch(/vet ikke om «Taco» ble slettet/);
    expect(sletteTekst("ukjent", "Taco")).not.toMatch(/Ingenting er slettet/);
  });
});
