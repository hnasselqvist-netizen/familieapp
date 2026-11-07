/**
 * «Fjern varen» med grunnlagsvern (#20, ordre 6700834307). Rene
 * domenetester av sammenligningen som kjøres inne i nodetransaksjonen;
 * selve transaksjonen testes mot emulatoren i
 * `src/data/freezer.fjern.integration.test.ts`.
 */
import { describe, expect, it } from "vitest";
import type { FreezerItem, FreezerItemFields } from "@app-types/freezer";
import { fjernHvisUendret, sletteTekst } from "./freezer";

/** Som lagret i RTDB: ingen `null`-felt. */
const lagret = (): FreezerItemFields =>
  ({
    itemId: "v1",
    name: "Laks",
    batches: [
      { id: "b1", count: 2, unit: "pk", gramsPerUnit: 400 },
      { id: "b2", count: 1, unit: "stk" },
    ],
    sted: "fryser",
  }) as unknown as FreezerItemFields;
/** Som abonnementet gir den: nodenøkkelen som `id`. */
const sett = (felt: FreezerItemFields, nodeId = "n1"): FreezerItem => ({ ...felt, id: nodeId });

describe("fjernHvisUendret", () => {
  it("uendret React-post uten id-felt slettes", () => {
    expect(fjernHvisUendret(lagret(), sett(lagret()))).toEqual({ verdi: null });
  });

  it("uendret legacy-post med id-felt lik nodenøkkelen slettes", () => {
    const legacy = { ...lagret(), id: "n1" } as FreezerItemFields;
    expect(fjernHvisUendret(legacy, sett(legacy))).toEqual({ verdi: null });
  });

  it("nøkkelrekkefølge påvirker ikke sammenligningen", () => {
    const omstokket = JSON.parse(
      '{"sted":"fryser","batches":[{"unit":"pk","id":"b1","gramsPerUnit":400,"count":2},{"count":1,"unit":"stk","id":"b2"}],"name":"Laks","itemId":"v1"}',
    ) as FreezerItemFields;
    expect(fjernHvisUendret(omstokket, sett(lagret()))).toEqual({ verdi: null });
  });

  const endringer: [string, (f: Record<string, unknown>) => void][] = [
    [
      "ny batch lagt til",
      (f) => (f.batches as unknown[]).push({ id: "b3", count: 1, unit: "boks" }),
    ],
    ["antall endret", (f) => ((f.batches as { count: number }[])[0]!.count = 3)],
    ["batch fjernet", (f) => (f.batches as unknown[]).pop()],
    ["batchrekkefølge endret", (f) => (f.batches as unknown[]).reverse()],
    ["navn endret", (f) => (f.name = "Ørret")],
    ["itemId endret", (f) => (f.itemId = "v2")],
    ["ukjent felt endret", (f) => (f.sted = "kjoleskap")],
    ["ukjent felt lagt til", (f) => (f.merknad = "ny")],
    ["ukjent felt fjernet", (f) => delete f.sted],
    ["id-felt som avviker fra nodenøkkelen", (f) => (f.id = "annen-id")],
  ];
  for (const [hva, endre] of endringer) {
    it(`avviser når ${hva}`, () => {
      const fersk = structuredClone(lagret()) as unknown as Record<string, unknown>;
      endre(fersk);
      expect(fjernHvisUendret(fersk as unknown as FreezerItemFields, sett(lagret()))).toEqual({
        avvisning: { type: "endret", navn: "Laks" },
      });
    });
  }

  it("manglende post avvises (ingen gjenoppretting)", () => {
    expect(fjernHvisUendret(null, sett(lagret()))).toEqual({
      avvisning: { type: "mangler", navn: "Laks" },
    });
  });

  it("muterer ikke inndata", () => {
    const fersk = lagret();
    const obs = sett(lagret());
    fjernHvisUendret(fersk, obs);
    expect(fersk).toEqual(lagret());
    expect(obs).toEqual(sett(lagret()));
  });
});

describe("sletteTekst", () => {
  it("lover aldri mer enn utfallet sier", () => {
    expect(sletteTekst({ type: "endret", navn: "X" })).toContain("Ingenting er fjernet");
    expect(sletteTekst({ type: "mangler", navn: "X" })).toContain("Ingenting er gjenopprettet");
  });
});
