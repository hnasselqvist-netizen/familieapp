import { describe, expect, it } from "vitest";
import { type SletteUtfall, sletteBekreftelse, sletteTekst, slettHvisUendret } from "./sletting";

const RAA = {
  name: "Taco",
  _mcp: { n: 1 },
  shoppingBase: [{ id: "sb1", name: "Lefser", x: 1 }],
  variants: [{ id: "v1", name: "Fisketaco", source: "recipe", recipeId: "r1" }],
};

describe("slettHvisUendret (Mat #20, ordre 6968416205)", () => {
  it("lik råpost (uavhengig av nøkkelrekkefølge) gir sletting", () => {
    const omstokket = {
      variants: RAA.variants,
      shoppingBase: RAA.shoppingBase,
      _mcp: { n: 1 },
      name: "Taco",
    };
    expect(slettHvisUendret(omstokket, RAA)).toEqual({ type: "slett" });
  });

  it.each([
    ["ukjent toppfelt", { ...RAA, _mcp: { n: 2 } }],
    ["nytt ukjent toppfelt", { ...RAA, ekstra: true }],
    ["ukjent felt i varelinje", { ...RAA, shoppingBase: [{ id: "sb1", name: "Lefser", x: 2 }] }],
    ["variant", { ...RAA, variants: [{ ...RAA.variants[0]!, name: "Kyllingtaco" }] }],
    ["variant fjernet", { ...RAA, variants: [] }],
    ["erstattet post", { name: "Taco" }],
  ])("endret %s gir `endret`", (_n, fersk) => {
    expect(slettHvisUendret(fersk, RAA)).toEqual({ type: "stopp", utfall: "endret" });
  });

  it("uten observert grunnlag, eller med ugyldig grunnlag, slettes ingenting", () => {
    expect(slettHvisUendret(RAA, undefined)).toEqual({ type: "stopp", utfall: "endret" });
    expect(slettHvisUendret(null, null)).toEqual({ type: "stopp", utfall: "endret" });
    expect(slettHvisUendret("Taco", "Taco")).toEqual({ type: "stopp", utfall: "endret" });
  });

  it("prioriteter er en del av grunnlaget, på posten og nøstet (review 5950868309)", () => {
    const med = { ...RAA, ".priority": 2 };
    expect(slettHvisUendret(med, med)).toEqual({ type: "slett" });
    expect(slettHvisUendret({ ...RAA, ".priority": 3 }, med)).toEqual({
      type: "stopp",
      utfall: "endret",
    });
    expect(slettHvisUendret(RAA, med)).toEqual({ type: "stopp", utfall: "endret" });
    const nostet = { ...RAA, variants: [{ ...RAA.variants[0]!, ".priority": 7 }] };
    expect(slettHvisUendret(RAA, nostet)).toEqual({ type: "stopp", utfall: "endret" });
  });

  it('REST-liste og klientens `{"0": …}` er samme RTDB-data', () => {
    const klient = {
      ".priority": 2,
      name: "Taco",
      variants: { "0": { ".priority": 7, id: "v1" }, "1": { id: "v2" } },
    };
    const rest = {
      ".priority": 2.0,
      name: "Taco",
      variants: [{ ".priority": 7.0, id: "v1" }, { id: "v2" }],
    };
    expect(slettHvisUendret(rest, klient)).toEqual({ type: "slett" });
    expect(slettHvisUendret({ ...rest, variants: [{ id: "v1" }, { id: "v2" }] }, klient)).toEqual({
      type: "stopp",
      utfall: "endret",
    });
  });
});

describe("tekster", () => {
  it("bekreftelsen forklarer handlegrunnlaget uten å love at ukeplaner er upåvirket", () => {
    const t = sletteBekreftelse("Taco");
    expect(t).toContain("«Taco» fjernes fra biblioteket.");
    expect(t).toContain(
      "Dager i ukeplanen som henter handlegrunnlag eller varianter fra denne middagen",
    );
    expect(t).toContain("En oppskrift som er koblet direkte til dagen, gir fortsatt varer.");
    expect(t).not.toMatch(/påvirkes ikke/);
  });

  it.each<[SletteUtfall, RegExp]>([
    ["slettet", /^«Taco» er slettet fra biblioteket\.$/],
    ["endret", /endret på en annen enhet.*Ingenting er slettet/],
    ["mangler", /allerede slettet.*Ingenting er gjenopprettet/],
    ["avvist", /ikke tilgang.*Ingenting er slettet/],
    ["ikkeLest", /Kunne ikke kontrollere «Taco» nå\. Ingenting er slettet/],
    ["byttet", /^Innloggingen ble endret mens slettingen pågikk\. Ingenting er slettet\.$/],
    ["ukjent", /Vi vet ikke om «Taco» ble slettet/],
  ])("%s har egen, tydelig tekst", (u, re) => {
    expect(sletteTekst(u, "Taco")).toMatch(re);
  });
});
