/**
 * Preflight for legacy-identitet (#77 review 5654569092 pkt. 1 og 3): ren,
 * skrivefri, ingen rådata i svaret. `legacySkriv` etterligner legacy
 * (`index.html` ~15929/~16497) og brukes som fasit for flytting og tap.
 */
import { describe, expect, it } from "vitest";
import { kontrollerLegacyIdentitet } from "./legacyIdentitet";
import { HANDLELISTE_MARKOR, kanonisk } from "./overgangKontroll";

type Node = Record<string, unknown>;
/** Legacy: `Object.values(v||{})`, så `Object.fromEntries(next.map(i=>[i.id,i]))`. */
const legacySkriv = (node: Node): Node =>
  Object.fromEntries(Object.values(node).map((i) => [(i as { id?: unknown }).id, i]));

const vare = (id: string | undefined, navn: string) => ({
  ...(id === undefined ? {} : { id }),
  itemId: `v-${navn}`,
  name: navn,
  amount: "",
  cat: "Diverse",
  done: false,
});
const OPS = { r1: { tool: "shopping_list_add_items", at: 1, result: ["a"] } };

/** Syntetisk speiling av produksjonsfunnet: 12 poster, 5 uten `id`. */
function tolvMedFemUtenId(): Node {
  const node: Node = {};
  for (let i = 0; i < 12; i += 1) {
    const nokkel = `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    node[nokkel] = vare(i < 5 ? undefined : nokkel, `Vare ${i}`);
  }
  return node;
}

describe("kontrollerLegacyIdentitet", () => {
  it("alle med id lik nøkkel: ok, og en legacy-skriving er identisk", () => {
    const node = { a: vare("a", "Melk"), b: vare("b", "Egg") };
    expect(kontrollerLegacyIdentitet(node)).toEqual({
      antallOppforinger: 2,
      antallUtenGyldigId: 0,
      antallIdUlikNokkel: 0,
      antallDeltId: 0,
      antallFlyttes: 0,
      antallTapes: 0,
      antallMetadataBerort: 0,
      ok: true,
      avvik: [],
    });
    expect(kanonisk(legacySkriv(node))).toBe(kanonisk(node));
  });

  it("12 poster, 5 uten id: 5 flyttes, 4 tapes — som legacy-skrivingen faktisk gjør", () => {
    const node = tolvMedFemUtenId();
    const r = kontrollerLegacyIdentitet(node);
    expect(r).toMatchObject({
      antallOppforinger: 12,
      antallUtenGyldigId: 5,
      antallFlyttes: 5,
      antallTapes: 4,
      ok: false,
      avvik: ["uten_id"],
    });
    const etter = legacySkriv(node);
    expect(Object.keys(etter)).toHaveLength(12 - r.antallTapes);
    expect(Object.keys(etter)).toContain("undefined");
  });

  it("én manglende id sammen med metadata: kolliderer med _ops under «undefined»", () => {
    const node = { a: vare("a", "Melk"), b: vare(undefined, "Egg"), _ops: OPS };
    const r = kontrollerLegacyIdentitet(node);
    expect(r).toMatchObject({
      antallUtenGyldigId: 2,
      antallFlyttes: 2,
      antallTapes: 1,
      antallMetadataBerort: 1,
      ok: false,
      avvik: ["uten_id"],
    });
    expect(Object.keys(legacySkriv(node)).sort()).toEqual(["a", "undefined"]);
  });

  it("én manglende id alene er også avvik: posten flyttes til «undefined»", () => {
    const r = kontrollerLegacyIdentitet({ a: vare("a", "Melk"), b: vare(undefined, "Egg") });
    expect(r).toMatchObject({ antallFlyttes: 1, antallTapes: 0, ok: false, avvik: ["uten_id"] });
  });

  it("to like ikke-tomme id-er: delt id og id ulik nøkkel; én tapes", () => {
    const node = { a: vare("a", "Melk"), b: vare("a", "Egg") };
    const r = kontrollerLegacyIdentitet(node);
    expect(r).toMatchObject({
      antallUtenGyldigId: 0,
      antallIdUlikNokkel: 1,
      antallDeltId: 2,
      antallFlyttes: 1,
      antallTapes: 1,
      ok: false,
      avvik: ["id_ulik_nokkel", "delt_id"],
    });
    expect(Object.keys(legacySkriv(node))).toEqual(["a"]);
  });

  it("id ulik nøkkel uten kollisjon: flyttes, ingen tap, men ikke ok", () => {
    expect(kontrollerLegacyIdentitet({ a: vare("x", "Melk") })).toMatchObject({
      antallIdUlikNokkel: 1,
      antallFlyttes: 1,
      antallTapes: 0,
      ok: false,
      avvik: ["id_ulik_nokkel"],
    });
  });

  it("tom, ikke-streng og primitiv id er ikke gyldig; markøren vurderes ikke", () => {
    const r = kontrollerLegacyIdentitet({
      _skriver: { ...HANDLELISTE_MARKOR },
      a: { ...vare("a", "Melk"), id: "" },
      b: { ...vare("b", "Egg"), id: 7 },
      c: "tekst",
    });
    expect(r).toMatchObject({ antallOppforinger: 3, antallUtenGyldigId: 3, ok: false });
    expect(kontrollerLegacyIdentitet({ _skriver: { ...HANDLELISTE_MARKOR } })).toMatchObject({
      antallOppforinger: 0,
      ok: true,
    });
  });

  it("array-node: indeksnøkler er ikke id-ene, så postene flyttes", () => {
    expect(kontrollerLegacyIdentitet([vare("a", "Melk"), vare("b", "Egg")])).toMatchObject({
      antallIdUlikNokkel: 2,
      antallFlyttes: 2,
      ok: false,
    });
  });

  it("returnerer aldri navn, nøkler eller id-er, og endrer aldri input", () => {
    const node = { ...tolvMedFemUtenId(), _ops: OPS };
    const foer = kanonisk(node);
    const r = kontrollerLegacyIdentitet(node);
    expect(JSON.stringify(r)).not.toMatch(/Vare|0000|shopping_list|v-/);
    expect(kanonisk(node)).toBe(foer);
  });
});
