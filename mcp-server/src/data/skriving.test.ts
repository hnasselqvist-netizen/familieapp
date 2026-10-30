import { describe, expect, it } from "vitest";
import {
  BESKYTTET,
  type Beslutning,
  besluttSkriving,
  forberedSkriving,
  MAKS_FAMILIE_LESE_BYTES,
  MAKS_FAMILIE_SKRIVE_BYTES,
  parseKvittering,
  type SkriveInn,
  type SkriveOpInn,
  UgyldigSkriving,
} from "./skriving";
import { MANGLER, versjonAv } from "./versjon";

const NAA = Date.parse("2026-10-30T12:00:00Z");
const DAG = 24 * 60 * 60 * 1000;
const P = { sub: "google-oauth2|helen", uid: "uid-h", client: "chatgpt" };
const opId = (dato = "2026-10-30", hale = "abcdef12") => `${dato}_${hale}`;

const familie = () => ({
  members: { "uid-h": true },
  mealLibrary: { m1: { navn: "Taco", porsjoner: 4 }, m2: { navn: "Suppe" } },
  shopping: {
    _skriver: { app: "web-v2" },
    _ops: { r1: { tool: "x" } },
    a: { name: "Melk", amount: "1" },
  },
  budget: { mat: 4000 },
  tekst: "en verdi",
});

const inn = (ops: SkriveOpInn[], id = opId()): SkriveInn => ({ opId: id, ops });
const forbered = (ops: SkriveOpInn[], id?: string) => forberedSkriving(inn(ops, id), NAA);
const v = (x: unknown, rot = false) => versjonAv(x, { rot });
type Tre = Record<string, unknown>;
const mcpAv = (n: unknown) =>
  (n as { _mcp: { ops: Record<string, unknown>; vannmerke?: string } })._mcp;

function kode(f: () => unknown): string {
  try {
    f();
  } catch (err) {
    if (err instanceof UgyldigSkriving) return err.code;
    throw err;
  }
  return "ingen feil";
}

function anvend(raa: unknown, ops: SkriveOpInn[], id?: string): Beslutning {
  return besluttSkriving(raa, forbered(ops, id), P, NAA);
}

function neste(b: Beslutning) {
  if (b.kind !== "apply") throw new Error(`forventet apply, fikk ${b.kind}`);
  return b;
}

describe("versjonAv", () => {
  it("er lik for array og indeksobjekt, uavhengig av nøkkelorden, og skiller typer", () => {
    expect(v(["a", "b"])).toBe(v({ 1: "b", 0: "a" }));
    expect(v({ a: 1, b: { c: true } })).toBe(v({ b: { c: true }, a: 1 }));
    expect(v({ a: "1" })).not.toBe(v({ a: 1 }));
    expect(v({ a: 1 })).not.toBe(v({ a: true }));
    expect(v({ a: 1 })).toMatch(/^v1-[0-9a-f]{32}$/);
  });

  it("null, manglende og tomme noder er «mangler»; null-felt teller ikke", () => {
    for (const x of [null, undefined, {}, [], { a: null }, { a: {} }]) expect(v(x)).toBe(MANGLER);
    expect(v({ a: 1, b: null })).toBe(v({ a: 1 }));
  });

  it("rotversjonen tar ikke med `_mcp` (ingen sirkulær kvittering)", () => {
    expect(v({ a: 1, _mcp: { ops: { x: 1 } } }, true)).toBe(v({ a: 1 }, true));
    expect(v({ a: 1, _mcp: { ops: { x: 1 } } })).not.toBe(v({ a: 1 }));
  });
});

describe("forberedSkriving — validering før noe leses", () => {
  const set = (sti: string, verdi: unknown): SkriveOpInn => ({
    sti,
    type: "set",
    verdi,
    forventet: MANGLER,
  });

  it.each([
    ["uten dato", "abcdef1234"],
    ["ugyldig dato", "2026-02-30_abcdef12"],
    ["for kort hale", "2026-10-30_abc"],
    ["ulovlige tegn", "2026-10-30_abc/def12"],
  ])("opId %s avvises", (_n, id) => {
    expect(kode(() => forbered([set("x", 1)], id))).toBe("ugyldig_skriving");
  });

  it("opId-dato mer enn én dag fram avvises (klokkeavvik); i går og i morgen godtas", () => {
    expect(kode(() => forbered([set("x", 1)], opId("2026-11-01")))).toBe("ugyldig_skriving");
    expect(kode(() => forbered([set("x", 1)], opId("2026-10-31")))).toBe("ingen feil");
    expect(kode(() => forbered([set("x", 1)], opId("2026-10-29")))).toBe("ingen feil");
  });

  it.each([
    ["null", null],
    ["null inne i objekt", { a: null }],
    ["tomt objekt", {}],
    ["tomt objekt inne", { a: {} }],
    ["tom liste", []],
    // eslint-disable-next-line no-sparse-arrays -- hullet er selve testen
    ["liste med hull", [1, , 3]],
    ["liste med null", [1, null]],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-0", -0],
    ["nøkkel med /", { "a/b": 1 }],
    ["nøkkel med .", { "a.b": 1 }],
    ["tom nøkkel", { "": 1 }],
    ["nøkkel constructor", { constructor: 1 }],
    ["nøkkel prototype", { x: { prototype: 1 } }],
    ["__proto__ fra JSON", JSON.parse('{"__proto__": {"forurenset": true}}')],
    ["dato-objekt", new Date()],
    ["tekst over Firebases 10 MB-grense", "x".repeat(10_485_761)],
    ["flerbyte-tekst over grensen", "ø".repeat(5_242_881)],
  ])("verdi med %s avvises", (_n, verdi) => {
    expect(kode(() => forbered([set("x", verdi)]))).toBe("ugyldig_skriving");
    expect(({} as Record<string, unknown>).forurenset).toBeUndefined();
  });

  it("ugyldige stier avvises som invalid_path", () => {
    for (const sti of ["../annen", "/abs", "a//b", "a/", "a.b", "a/$x"]) {
      expect(kode(() => forbered([set(sti, 1)]))).toBe("invalid_path");
    }
  });

  it("overlappende posisjoner i samme kall avvises (lik, forelder/barn, update-barn)", () => {
    const ugyldig = [
      [set("a", 1), set("a", 2)],
      [set("a", { b: 1 }), set("a/b", 2)],
      [{ sti: "a", type: "slett", forventet: MANGLER }, set("a/b/c", 2)],
      [{ sti: "a", type: "update", verdi: { b: 1 }, forventet: { b: MANGLER } }, set("a/b", 2)],
      [set("", { a: 1 }), set("z", 1)],
    ] as SkriveOpInn[][];
    for (const ops of ugyldig) expect(kode(() => forbered(ops))).toBe("ugyldig_skriving");
    expect(kode(() => forbered([set("a/b", 1), set("a/c", 2), set("ab", 3)]))).toBe("ingen feil");
  });

  it("beskyttede felt: direkte, under, via update-nøkkel og i en forelders verdi avvises", () => {
    for (const b of BESKYTTET) {
      const sti = b.join("/");
      expect(kode(() => forbered([set(sti, 1)]))).toBe("beskyttet");
      expect(kode(() => forbered([set(`${sti}/x`, 1)]))).toBe("beskyttet");
      expect(kode(() => forbered([{ sti, type: "slett", forventet: MANGLER }]))).toBe("beskyttet");
    }
    const forelder = [
      set("", { members: { ny: true } }),
      set("", { _mcp: { ops: { x: 1 } }, a: 1 }),
      set("shopping", { _skriver: { app: "annen" } }),
      set("", { shopping: { _ops: { x: 1 } } }),
      {
        sti: "",
        type: "update",
        verdi: { members: { x: true } },
        forventet: { members: "mangler" },
      },
      { sti: "shopping", type: "update", verdi: { _ops: 1 }, forventet: { _ops: "mangler" } },
    ] as SkriveOpInn[];
    for (const op of forelder) expect(kode(() => forbered([op]))).toBe("beskyttet");
  });

  it("enkeltverdi eller liste på en forelder til et beskyttet felt avvises", () => {
    expect(kode(() => forbered([set("shopping", "tekst")]))).toBe("beskyttet");
    expect(kode(() => forbered([set("shopping", [1, 2])]))).toBe("beskyttet");
    expect(kode(() => forbered([set("", 1)]))).toBe("beskyttet");
    // Lister er ellers tillatt (legacy-nodene er lister).
    expect(kode(() => forbered([set("transaksjoner", [{ id: "t0" }])]))).toBe("ingen feil");
  });

  it("forventet: format, og for update nøyaktig samme nøkler som verdi", () => {
    expect(kode(() => forbered([{ sti: "a", type: "set", verdi: 1, forventet: "v1-x" }]))).toBe(
      "ugyldig_skriving",
    );
    const upd = (forventet: unknown) =>
      kode(() =>
        forbered([{ sti: "a", type: "update", verdi: { b: 1, c: 2 }, forventet } as SkriveOpInn]),
      );
    expect(upd(MANGLER)).toBe("ugyldig_skriving");
    expect(upd({ b: MANGLER })).toBe("ugyldig_skriving");
    expect(upd({ b: MANGLER, c: MANGLER, d: MANGLER })).toBe("ugyldig_skriving");
    expect(upd({ b: MANGLER, c: MANGLER })).toBe("ingen feil");
  });

  it("slett tar ingen verdi; update krever et ikke-tomt objekt", () => {
    expect(kode(() => forbered([{ sti: "a", type: "slett", verdi: 1, forventet: MANGLER }]))).toBe(
      "ugyldig_skriving",
    );
    for (const verdi of [{}, [1], "x"]) {
      expect(kode(() => forbered([{ sti: "a", type: "update", verdi, forventet: {} }]))).toBe(
        "ugyldig_skriving",
      );
    }
  });

  it("for dyp verdi avvises", () => {
    let dyp: unknown = 1;
    for (let i = 0; i < 31; i++) dyp = { n: dyp };
    expect(kode(() => forbered([set("a", dyp)]))).toBe("ugyldig_skriving");
  });

  it("fingeravtrykket er stabilt for samme payload og endres med verdi/forventet", () => {
    const a = forbered([set("a", { x: 1, y: [1, 2] })]);
    expect(forbered([set("a", { y: [1, 2], x: 1 })]).fp).toBe(a.fp);
    expect(forbered([set("a", { x: 2, y: [1, 2] })]).fp).not.toBe(a.fp);
    expect(forbered([{ ...set("a", { x: 1, y: [1, 2] }), forventet: v(1) }]).fp).not.toBe(a.fp);
  });
});

describe("besluttSkriving — inne i transaksjonen", () => {
  it("set, update og slett i ett kall; urørte felt bevares; kvittering med før/etter", () => {
    const f = familie();
    const b = neste(
      anvend(f, [
        { sti: "mealLibrary/m1/navn", type: "set", verdi: "Fisketaco", forventet: v("Taco") },
        {
          sti: "budget",
          type: "update",
          verdi: { klaer: 500, mat: 4500 },
          forventet: { klaer: MANGLER, mat: v(4000) },
        },
        { sti: "tekst", type: "slett", forventet: v("en verdi") },
        { sti: "nyttDomene/a/b", type: "set", verdi: [1, "to"], forventet: MANGLER },
      ]),
    );
    const n = b.neste as ReturnType<typeof familie> & Tre;
    expect(n.mealLibrary).toEqual({
      m1: { navn: "Fisketaco", porsjoner: 4 },
      m2: { navn: "Suppe" },
    });
    expect(n.budget).toEqual({ mat: 4500, klaer: 500 });
    expect(n.tekst).toBeUndefined();
    expect(n.nyttDomene).toEqual({ a: { b: { 0: 1, 1: "to" } } });
    expect(n.shopping).toEqual(f.shopping);
    expect(n.members).toEqual(f.members);
    expect(b.kvittering).toMatchObject({ fp: expect.any(String), sub: P.sub, uid: P.uid, at: NAA });
    expect(b.kvittering.skrivinger.map((s) => [s.sti, s.type, s.foer === MANGLER])).toEqual([
      ["mealLibrary/m1/navn", "set", false],
      ["budget/klaer", "update", true],
      ["budget/mat", "update", false],
      ["tekst", "slett", false],
      ["nyttDomene/a/b", "set", true],
    ]);
    expect(b.kvittering.skrivinger[3]!.etter).toBe(MANGLER);
    expect(b.kvittering.skrivinger[0]!.etter).toBe(v("Fisketaco"));
    expect(parseKvittering(mcpAv(n).ops[opId()])).toEqual(b.kvittering);
  });

  it("feil forventet versjon på én posisjon: konflikt med alle avvik, ingen skriving", () => {
    const b = anvend(familie(), [
      { sti: "budget/mat", type: "set", verdi: 1, forventet: v(4000) },
      { sti: "tekst", type: "set", verdi: "ny", forventet: v("gammel") },
      { sti: "ny", type: "set", verdi: 1, forventet: v(1) },
    ]);
    expect(b).toEqual({
      kind: "konflikt",
      avvik: [
        { sti: "tekst", forventet: v("gammel"), faktisk: v("en verdi") },
        { sti: "ny", forventet: v(1), faktisk: MANGLER },
      ],
    });
  });

  it("en forelder som i dag er en enkeltverdi erstattes ikke stille", () => {
    expect(
      anvend(familie(), [{ sti: "tekst/barn", type: "set", verdi: 1, forventet: MANGLER }]),
    ).toEqual({
      kind: "forelder_er_verdi",
      sti: "tekst",
    });
  });

  it("ikke medlem (fjernet, false eller familien finnes ikke) → ingen skriving", () => {
    const op = [{ sti: "x", type: "set", verdi: 1, forventet: MANGLER }] as SkriveOpInn[];
    expect(anvend({ ...familie(), members: { annen: true } }, op).kind).toBe("ikke_medlem");
    expect(anvend({ ...familie(), members: { "uid-h": false } }, op).kind).toBe("ikke_medlem");
    expect(anvend(null, op).kind).toBe("ikke_medlem");
  });

  it("replay: samme opId, payload og principal gir lagret kvittering — også når datoen er utløpt", () => {
    const op = [{ sti: "x", type: "set", verdi: 1, forventet: MANGLER }] as SkriveOpInn[];
    const forste = neste(anvend(familie(), op));
    const igjen = anvend(forste.neste, op);
    expect(igjen).toEqual({ kind: "replay", kvittering: forste.kvittering });

    const gammelId = opId("2026-09-01");
    const gammel = neste(
      besluttSkriving(
        familie(),
        forberedSkriving(inn(op, gammelId), Date.parse("2026-09-01")),
        P,
        Date.parse("2026-09-01"),
      ),
    );
    expect(anvend(gammel.neste, op, gammelId).kind).toBe("replay");
  });

  it("samme opId med annen payload eller annen principal → idempotens_konflikt", () => {
    const op = [{ sti: "x", type: "set", verdi: 1, forventet: MANGLER }] as SkriveOpInn[];
    const forste = neste(anvend(familie(), op));
    expect(anvend(forste.neste, [{ ...op[0]!, verdi: 2 }]).kind).toBe("idempotens_konflikt");
    expect(anvend(forste.neste, [{ ...op[0]!, sti: "y" }]).kind).toBe("idempotens_konflikt");
    expect(besluttSkriving(forste.neste, forbered(op), { ...P, sub: "annen|sub" }, NAA).kind).toBe(
      "idempotens_konflikt",
    );
  });

  it("utløp: ukjent opId eldre enn 30 dager eller ≤ vannmerket → utlopt; grensen er inklusiv", () => {
    const op = [{ sti: "x", type: "set", verdi: 1, forventet: MANGLER }] as SkriveOpInn[];
    expect(anvend(familie(), op, opId("2026-09-29")).kind).toBe("utlopt");
    expect(anvend(familie(), op, opId("2026-09-30")).kind).toBe("apply");
    const medVannmerke = { ...familie(), _mcp: { vannmerke: "2026-10-05" } };
    expect(anvend(medVannmerke, op, opId("2026-10-05")).kind).toBe("utlopt");
    expect(anvend(medVannmerke, op, opId("2026-10-06")).kind).toBe("apply");
  });

  it("beskjæring: bare i ny skriving, kvitteringer eldre enn 31 dager fjernes og vannmerket flyttes", () => {
    const op = (sti: string) =>
      [{ sti, type: "set", verdi: 1, forventet: MANGLER }] as SkriveOpInn[];
    let rot: unknown = familie();
    for (const [dato, sti] of [
      ["2026-09-20", "a"],
      ["2026-09-28", "b"],
      ["2026-09-30", "c"],
    ] as const) {
      const t = Date.parse(`${dato}T10:00:00Z`);
      rot = neste(besluttSkriving(rot, forberedSkriving(inn(op(sti), opId(dato)), t), P, t)).neste;
    }
    const b = neste(anvend(rot, op("d")));
    const mcp = mcpAv(b.neste);
    expect(Object.keys(mcp.ops).sort()).toEqual([opId("2026-09-30"), opId()]);
    expect(mcp.vannmerke).toBe("2026-09-28");
    // Et beskåret opId (datoen er en del av id-en) kan aldri bli en ny operasjon.
    expect(anvend(b.neste, op("a"), opId("2026-09-20")).kind).toBe("utlopt");
    expect(anvend(b.neste, op("a"), opId("2026-09-28")).kind).toBe("utlopt");
  });

  it("slett på familieroten bevarer members, `_mcp` og handlelistens markør/ops", () => {
    const f = { ...familie(), _mcp: { ops: { [opId("2026-10-29")]: { tidligere: true } } } };
    const b = neste(anvend(f, [{ sti: "", type: "slett", forventet: v(f, true) }]));
    const n = b.neste as Tre;
    expect(Object.keys(n).sort()).toEqual(["_mcp", "members", "shopping"]);
    expect(n.members).toEqual(f.members);
    expect(n.shopping).toEqual({ _skriver: f.shopping._skriver, _ops: f.shopping._ops });
    expect(mcpAv(n).ops[opId("2026-10-29")]).toEqual({ tidligere: true });
    expect(b.kvittering.skrivinger[0]!.bevart.sort()).toEqual([
      "_mcp",
      "members",
      "shopping/_ops",
      "shopping/_skriver",
    ]);
    // `etter` er versjonen av den faktisk lagrede formen, uten `_mcp`.
    expect(b.kvittering.skrivinger[0]!.etter).toBe(v(n, true));
  });

  it("set på familieroten og på shopping bevarer de beskyttede barna", () => {
    const f = familie();
    const rot = neste(
      anvend(f, [{ sti: "", type: "set", verdi: { ny: 1 }, forventet: v(f, true) }]),
    );
    expect(rot.neste).toMatchObject({
      ny: 1,
      members: f.members,
      shopping: { _skriver: f.shopping._skriver },
    });
    expect((rot.neste as Tre).mealLibrary).toBeUndefined();

    const s = neste(
      anvend(f, [
        { sti: "shopping", type: "set", verdi: { b: { name: "Brød" } }, forventet: v(f.shopping) },
      ]),
    );
    expect((s.neste as Tre).shopping).toEqual({
      _skriver: f.shopping._skriver,
      _ops: f.shopping._ops,
      b: { name: "Brød" },
    });
    expect(s.kvittering.skrivinger[0]!.bevart).toEqual(["shopping/_skriver", "shopping/_ops"]);
  });

  it("eksisterende data med `__proto__`-nøkkel forurenser ikke prototypen", () => {
    const raa = JSON.parse('{"members":{"uid-h":true},"x":{"__proto__":{"forurenset":true}}}');
    const b = neste(anvend(raa, [{ sti: "y", type: "set", verdi: 1, forventet: MANGLER }]));
    expect(Object.hasOwn((b.neste as Tre).x as Tre, "__proto__")).toBe(true);
    expect(({} as Record<string, unknown>).forurenset).toBeUndefined();
  });

  it("er ren: samme inndata gir samme beslutning, og inndata endres ikke", () => {
    const f = familie();
    const kopi = structuredClone(f);
    const ops = [{ sti: "budget/mat", type: "set", verdi: 1, forventet: v(4000) }] as SkriveOpInn[];
    expect(anvend(f, ops)).toEqual(anvend(f, ops));
    expect(f).toEqual(kopi);
  });

  describe("størrelsesvern (#85-review 5709352689 pkt. 3)", () => {
    const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x), "utf8");
    /** Familie med nøyaktig `b` byte JSON. */
    const medStorrelse = (b: number) => {
      const tom = { members: { "uid-h": true }, blob: "" };
      return { ...tom, blob: "x".repeat(b - bytes(tom)) };
    };
    const settY = (verdi: unknown = 1) =>
      [{ sti: "y", type: "set", verdi, forventet: MANGLER }] as SkriveOpInn[];

    it("hjelperen treffer eksakt størrelse", () => {
      expect(bytes(medStorrelse(1_000))).toBe(1_000);
    });

    it("kandidaten som krysser skrivegrensen (data + kvittering) → for_stor «skriving»", () => {
      const f = medStorrelse(MAKS_FAMILIE_SKRIVE_BYTES - 1_000);
      expect(anvend(f, settY("z".repeat(500))).kind).toBe("apply");
      const b = anvend(f, settY("z".repeat(2_000)));
      expect(b).toMatchObject({
        kind: "for_stor",
        grunn: "skriving",
        grense: MAKS_FAMILIE_SKRIVE_BYTES,
      });
      expect((b as { bytes: number }).bytes).toBeGreaterThan(MAKS_FAMILIE_SKRIVE_BYTES);
    });

    it("kvitteringen alene kan krysse grensen: den telles med", () => {
      const f = medStorrelse(MAKS_FAMILIE_SKRIVE_BYTES - 20);
      // Selve dataendringen er ~6 byte; kvitteringen er flere hundre.
      const b = anvend(f, settY());
      expect(b).toMatchObject({ kind: "for_stor", grunn: "skriving" });
    });

    it("en endring som gjør en for stor familie mindre, går (lesebudsjett > skrivebudsjett)", () => {
      const f = medStorrelse(MAKS_FAMILIE_SKRIVE_BYTES + 500_000);
      expect(anvend(f, settY()).kind).toBe("for_stor");
      const b = neste(anvend(f, [{ sti: "blob", type: "slett", forventet: v(f.blob) }]));
      expect(bytes(b.neste)).toBeLessThan(MAKS_FAMILIE_SKRIVE_BYTES);
    });

    it("over lesebudsjettet → for_stor «lesing»", () => {
      const f = { members: { "uid-h": true }, blob: "x".repeat(MAKS_FAMILIE_LESE_BYTES) };
      expect(anvend(f, settY())).toMatchObject({ kind: "for_stor", grunn: "lesing" });
    });

    it("skrivegrensen ligger under Firebases 16 MB per SDK-write", () => {
      expect(MAKS_FAMILIE_SKRIVE_BYTES).toBeLessThan(16 * 1024 * 1024);
      expect(MAKS_FAMILIE_SKRIVE_BYTES).toBeLessThan(16_000_000);
    });
  });

  it("dag-grenser: utløp regnes fra serverens dato", () => {
    const op = [{ sti: "x", type: "set", verdi: 1, forventet: MANGLER }] as SkriveOpInn[];
    const t = NAA + 2 * DAG;
    expect(
      besluttSkriving(familie(), forberedSkriving(inn(op, opId("2026-10-02")), t), P, t).kind,
    ).toBe("apply");
    expect(
      besluttSkriving(familie(), forberedSkriving(inn(op, opId("2026-10-01")), t), P, t).kind,
    ).toBe("utlopt");
  });
});
