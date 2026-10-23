import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HANDLELISTE_MARKOR,
  type OvergangDb,
  kanonisk,
  kjorKontroll,
  kjorMarkor,
  kontrollerHandleliste,
  planMarkor,
} from "./handlelisteOvergang";

const M = { ...HANDLELISTE_MARKOR };
const MELK = { id: "melk", name: "Melk", amount: "1", cat: "Meieri", done: false };
const EGG = { id: "egg", name: "Egg", amount: "6", cat: "Meieri", done: true };
const OPS = { r1: { tool: "shopping_list_add_items", at: 1, result: ["melk"] } };

describe("markøren", () => {
  it("er lik fixture-filen som rules-forslaget og testene bruker", () => {
    const fil = new URL(
      "../../../infra/firebase/forslag/handleliste-skrivemarkor.markor.json",
      import.meta.url,
    );
    expect(JSON.parse(readFileSync(fil, "utf8"))).toEqual(M);
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

describe("historikk telles uavhengig av visningsgyldighet (review 6356969393 pkt. 1)", () => {
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

  it.each([
    ["vanlig", { melk: { ...MELK, sammenslaing: H } }],
    ["navnløs", { x: { sammenslaing: { opId: "p" } } }],
    ["«undefined»", { undefined: { ...MELK, sammenslaing: H } }],
    ["uavklart", { x: { name: "Melk", sammenslaing: "x" } }],
  ])("fjern nekter når historikk finnes (%s)", (_n, node) => {
    expect(planMarkor({ _skriver: M, ...node }, "fjern")).toMatchObject({
      utfall: "nekt",
      grunn: expect.stringMatching(/sammenslåingshistorikk/),
    });
  });
});

describe("planMarkor", () => {
  it("sett: mangler → skriv med alle andre rådata uendret; ok → allerede", () => {
    const node = { _ops: OPS, undefined: { r0: OPS.r1 }, melk: { ...MELK, ukjent: { x: 1 } } };
    const p = planMarkor(node, "sett");
    expect(p).toEqual({ utfall: "skriv", neste: { ...node, _skriver: M } });
    expect(planMarkor({ ...node, _skriver: M }, "sett")).toEqual({ utfall: "allerede" });
  });

  it("sett på manglende og array-node", () => {
    expect(planMarkor(null, "sett")).toEqual({ utfall: "skriv", neste: { _skriver: M } });
    expect(planMarkor([null, MELK], "sett")).toEqual({
      utfall: "skriv",
      neste: { 1: MELK, _skriver: M },
    });
  });

  it("avvikende markør overskrives og fjernes aldri; ugyldig form nektes", () => {
    for (const modus of ["sett", "fjern"] as const) {
      expect(planMarkor({ _skriver: { versjon: "web-v2" }, melk: MELK }, modus)).toMatchObject({
        utfall: "nekt",
        grunn: expect.stringMatching(/avvikende markør/),
      });
      expect(planMarkor("tekst", modus)).toMatchObject({ utfall: "nekt" });
    }
  });

  it("fjern: bare nøyaktig markør; tom liste blir null", () => {
    expect(planMarkor({ _skriver: M, melk: MELK }, "fjern")).toEqual({
      utfall: "skriv",
      neste: { melk: MELK },
    });
    expect(planMarkor({ _skriver: M }, "fjern")).toEqual({ utfall: "skriv", neste: null });
    expect(planMarkor({ melk: MELK }, "fjern")).toEqual({ utfall: "allerede" });
  });

  it("forventet digest: avvik nektes (undersøk), lik digest tillates", () => {
    const d = kontrollerHandleliste({ melk: MELK }).digestUtenMarkor;
    expect(planMarkor({ melk: MELK }, "sett", d).utfall).toBe("skriv");
    expect(planMarkor({ melk: { ...MELK, done: true } }, "sett", d)).toMatchObject({
      utfall: "nekt",
      grunn: expect.stringMatching(/Undersøk/),
    });
  });
});

/** In-memory database med valgfri «samtidig skriving» mellom lesing og transaksjon. */
function minneDb(start: unknown, underveis?: (v: unknown) => unknown) {
  let verdi = start;
  let skrivinger = 0;
  const db: OvergangDb = {
    read: async () => structuredClone(verdi),
    transact: async (_p, update) => {
      if (underveis) verdi = underveis(verdi);
      verdi = structuredClone(update(structuredClone(verdi)));
      skrivinger += 1;
    },
  };
  return { db, verdi: () => verdi, skrivinger: () => skrivinger };
}

describe("kjorKontroll og kjorMarkor", () => {
  it("kontroll skriver aldri", async () => {
    const m = minneDb({ melk: MELK });
    expect((await kjorKontroll(m.db, "familie1")).kontroll.antallVarer).toBe(1);
    expect(m.skrivinger()).toBe(0);
  });

  it("tørrkjøring skriver ikke; apply skriver; retry gir allerede", async () => {
    const m = minneDb({ _ops: OPS, melk: MELK });
    expect(
      await kjorMarkor(m.db, { familyId: "familie1", modus: "sett", apply: false }),
    ).toMatchObject({
      dryRun: true,
      utfall: "skriv",
    });
    expect(m.skrivinger()).toBe(0);
    const r = await kjorMarkor(m.db, { familyId: "familie1", modus: "sett", apply: true });
    expect(r).toMatchObject({ utfall: "skriv", avvik: [] });
    expect(r.etter?.markor).toBe("ok");
    expect(m.verdi()).toEqual({ _ops: OPS, melk: MELK, _skriver: M });
    expect(
      await kjorMarkor(m.db, { familyId: "familie1", modus: "sett", apply: true }),
    ).toMatchObject({
      utfall: "allerede",
    });
  });

  it("samtidig legitim endring etter kontrollen: forventet digest nekter, ingenting gjenopprettes", async () => {
    const d = kontrollerHandleliste({ melk: MELK }).digestUtenMarkor;
    const m = minneDb({ melk: MELK }, (v) => ({ ...(v as object), egg: EGG }));
    const r = await kjorMarkor(m.db, {
      familyId: "familie1",
      modus: "sett",
      apply: true,
      forventetDigest: d,
    });
    expect(r).toMatchObject({ utfall: "nekt", grunn: expect.stringMatching(/Undersøk/) });
    expect(m.verdi()).toEqual({ melk: MELK, egg: EGG });
  });

  it("fjern vurderes i SAMME transaksjon: historikk som dukker opp etter lesingen nekter fjerning", async () => {
    const m = minneDb({ _skriver: M, melk: MELK }, (v) => ({
      ...(v as object),
      melk: { ...MELK, sammenslaing: { opId: "p" } },
    }));
    const r = await kjorMarkor(m.db, { familyId: "familie1", modus: "fjern", apply: true });
    expect(r).toMatchObject({
      utfall: "nekt",
      grunn: expect.stringMatching(/sammenslåingshistorikk/),
    });
    expect((m.verdi() as Record<string, unknown>)._skriver).toEqual(M);
  });

  it("ugyldig familie-id avvises før I/O", async () => {
    const m = minneDb(null);
    await expect(
      kjorMarkor(m.db, { familyId: "../x", modus: "sett", apply: true }),
    ).rejects.toThrow();
    expect(m.skrivinger()).toBe(0);
  });
});
