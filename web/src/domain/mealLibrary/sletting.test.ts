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

  it("uten observert grunnlag slettes ingenting", () => {
    expect(slettHvisUendret(RAA, undefined)).toEqual({ type: "stopp", utfall: "endret" });
  });
});

describe("tekster", () => {
  it("bekreftelsen forklarer handlegrunnlaget uten å love at ukeplaner er upåvirket", () => {
    const t = sletteBekreftelse("Taco");
    expect(t).toContain("«Taco» fjernes fra biblioteket.");
    expect(t).toContain("handlelistegeneratoren finner ikke lenger handlegrunnlaget");
    expect(t).not.toMatch(/påvirkes ikke/);
  });

  it.each<[SletteUtfall, RegExp]>([
    ["slettet", /^«Taco» er slettet fra biblioteket\.$/],
    ["endret", /endret på en annen enhet.*Ingenting er slettet/],
    ["mangler", /allerede slettet.*Ingenting er gjenopprettet/],
    ["avvist", /ikke tilgang.*Ingenting er slettet/],
    ["ukjent", /Vi vet ikke om «Taco» ble slettet/],
  ])("%s har egen, tydelig tekst", (u, re) => {
    expect(sletteTekst(u, "Taco")).toMatch(re);
  });
});
