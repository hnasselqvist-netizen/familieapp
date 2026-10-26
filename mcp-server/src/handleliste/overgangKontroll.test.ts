/**
 * Den rene kontrollen bak `shopping_cutover_kontroll`, testet isolert:
 * ingen I/O, ingen skriving, ingen rådata i resultatet.
 */
import { describe, expect, it } from "vitest";
import {
  HANDLELISTE_MARKOR,
  KONTROLL_FORMAT,
  erMarkor,
  kanonisk,
  kontrollerHandleliste,
} from "./overgangKontroll";

const M = { ...HANDLELISTE_MARKOR };
const MELK = { id: "melk", name: "Melk", amount: "1", cat: "Meieri", done: false };
const EGG = { id: "egg", name: "Egg", amount: "6", cat: "Meieri", done: true };
const OPS = { r1: { tool: "shopping_list_add_items", at: 1, result: ["melk"] } };

describe("markørformatet", () => {
  it("er vareformet uten id; bare nøyaktig dette formatet er en markør", () => {
    expect(M).toEqual({
      versjon: "web-v2",
      name: "Handlelisten redigeres i den nye appen",
      cat: "Diverse",
      amount: "",
      done: true,
    });
    expect(erMarkor(M)).toBe(true);
    expect(erMarkor({ ...M, id: "_skriver" })).toBe(false);
    expect(KONTROLL_FORMAT).toBe(2);
  });
});

describe("kontrollerHandleliste (skrivefri)", () => {
  it("teller uten å returnere navn eller mengder", () => {
    const k = kontrollerHandleliste({
      _skriver: M,
      _ops: OPS,
      undefined: { r0: OPS.r1 },
      melk: MELK,
      egg: { ...EGG, sammenslaing: { opId: "op-1" }, sammenslaingAngret: { a: true, b: true } },
      tom: { amount: "2" },
    });
    expect(k).toMatchObject({
      form: "objekt",
      strukturOk: true,
      markor: "ok",
      antallVarer: 2,
      antallFullfort: 1,
      antallUtenNavn: 1,
      antallUtenId: 1,
      undefinedForm: "ops",
      antallOps: 1,
      antallSammenslatt: 1,
      antallAngremerker: 2,
    });
    expect(JSON.stringify(k)).not.toMatch(/Melk|Egg|Meieri/);
  });

  it("form: mangler, array, objekt og ugyldig", () => {
    expect(kontrollerHandleliste(null)).toMatchObject({ form: "mangler", strukturOk: true });
    expect(kontrollerHandleliste([null, MELK])).toMatchObject({ form: "array", antallVarer: 1 });
    expect(kontrollerHandleliste("tekst")).toMatchObject({ form: "ugyldig", strukturOk: false });
    expect(kontrollerHandleliste(42).strukturOk).toBe(false);
  });

  it("markør: ok, mangler og feil (delvis, ekstra felt, id, feil type)", () => {
    expect(kontrollerHandleliste({ melk: MELK }).markor).toBe("mangler");
    for (const feil of [
      { versjon: "web-v2" },
      { ...M, id: "_skriver" },
      { ...M, done: false },
      { ...M, name: 1 },
      { ...M, ekstra: true },
      "web-v2",
    ]) {
      expect(kontrollerHandleliste({ _skriver: feil }).markor).toBe("feil");
    }
  });

  it("«undefined» klassifiseres: ops, markør, vare og annet", () => {
    const f = (v: unknown) => kontrollerHandleliste({ undefined: v }).undefinedForm;
    expect(f({ r0: OPS.r1 })).toBe("ops");
    expect(f(M)).toBe("markor");
    expect(f(MELK)).toBe("vare");
    expect(f({ r0: { tool: "annet" } })).toBe("annet");
    expect(kontrollerHandleliste({}).undefinedForm).toBe("mangler");
  });

  it("antallUtenId: vanlige poster uten ikke-tom streng-id; markør, _-nøkler og «undefined» telles ikke", () => {
    const utenId = { name: "Melk", amount: "1", cat: "Meieri", done: false };
    expect(
      kontrollerHandleliste({
        _skriver: M,
        _ops: OPS,
        undefined: utenId,
        melk: MELK,
        a: utenId,
        b: { ...EGG, id: "" },
        c: { ...EGG, id: 7 },
        d: { amount: "2" },
        e: "tekst",
      }),
    ).toMatchObject({ antallVarer: 4, antallUtenNavn: 2, antallUtenId: 5, stopp: [] });
    expect(kontrollerHandleliste([MELK, utenId]).antallUtenId).toBe(1);
    expect(kontrollerHandleliste({ melk: MELK, egg: EGG }).antallUtenId).toBe(0);
  });

  it("digest: uavhengig av nøkkelrekkefølge og markør; array og objekt i samme nøkkelform", () => {
    const a = kontrollerHandleliste({ melk: MELK, egg: EGG }).digestUtenMarkor;
    expect(kontrollerHandleliste({ egg: EGG, melk: MELK, _skriver: M }).digestUtenMarkor).toBe(a);
    expect(kontrollerHandleliste([MELK, EGG]).digestUtenMarkor).toBe(
      kontrollerHandleliste({ 0: MELK, 1: EGG }).digestUtenMarkor,
    );
    expect(kontrollerHandleliste({ melk: { ...MELK, amount: "2" } }).digestUtenMarkor).not.toBe(
      kontrollerHandleliste({ melk: MELK }).digestUtenMarkor,
    );
    expect(kanonisk({ b: 1, a: [1, null] })).toBe('{"a":[1,null],"b":1}');
  });
});

describe("historikk telles uavhengig av visningsgyldighet ", () => {
  const H = { opId: "p", foer: {}, kilder: {} };
  it.each([
    ["vanlig post", { melk: { ...MELK, sammenslaing: H } }],
    ["navnløs post", { x: { sammenslaing: { opId: "p" } } }],
    ["«undefined» med navn", { undefined: { ...MELK, sammenslaing: H } }],
    [
      "ukjente felt rundt",
      { melk: { ...MELK, ukjent: { a: 1 }, sammenslaing: { ...H, nytt: 2 } } },
    ],
  ])("%s gir antallSammenslatt = 1", (_n, node) => {
    const foer = JSON.stringify(node);
    const k = kontrollerHandleliste({ _skriver: M, ...node });
    expect(k).toMatchObject({ antallSammenslatt: 1, antallHistorikkUavklart: 0, stopp: [] });
    expect(JSON.stringify(node)).toBe(foer);
  });

  it.each([
    ["streng", "x"],
    ["tomt objekt", {}],
    ["opId ikke streng", { opId: 3 }],
    ["tom opId", { opId: "" }],
    ["null-lignende array", [1]],
  ])("feilformet sammenslaing (%s) er uavklart og et stoppvilkår", (_n, h) => {
    const k = kontrollerHandleliste({ x: { name: "Melk", sammenslaing: h } });
    expect(k.antallSammenslatt).toBe(0);
    expect(k.antallHistorikkUavklart).toBe(1);
    expect(k.stopp).toEqual([expect.stringMatching(/historikk som ikke kan tolkes/)]);
  });

  it("feilformet sammenslaingAngret er også uavklart", () => {
    expect(kontrollerHandleliste({ x: { name: "Melk", sammenslaingAngret: true } })).toMatchObject({
      antallHistorikkUavklart: 1,
    });
  });

  it("stopp: ugyldig form og avvikende markør; manglende markør er IKKE stopp", () => {
    expect(kontrollerHandleliste("tekst").stopp).toEqual([expect.stringMatching(/ugyldig form/)]);
    expect(kontrollerHandleliste({ _skriver: { versjon: "web-v2" } }).stopp).toEqual([
      expect.stringMatching(/Markøren avviker/),
    ]);
    expect(kontrollerHandleliste({ melk: MELK }).stopp).toEqual([]);
  });
});

describe("stoppKoder", () => {
  it("speiler stopp i samme rekkefølge, maskinlesbart", () => {
    const k = kontrollerHandleliste({
      _skriver: { versjon: "web-v2" },
      x: { name: "Melk", sammenslaing: "x" },
    });
    expect(k.stoppKoder).toEqual(["markor_avvik", "historikk_uavklart"]);
    expect(k.stopp).toHaveLength(2);
    expect(kontrollerHandleliste("tekst").stoppKoder).toEqual(["ugyldig_form"]);
    expect(kontrollerHandleliste({ melk: MELK }).stoppKoder).toEqual([]);
  });

  it("endrer aldri input", () => {
    const node = {
      _skriver: { versjon: "x" },
      _ops: OPS,
      melk: MELK,
      egg: EGG,
      x: { sammenslaing: 1 },
    };
    const foer = kanonisk(node);
    kontrollerHandleliste(node);
    expect(kanonisk(node)).toBe(foer);
  });
});
