import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "@app-types/shopping";
import {
  type SammenslaingsPlan,
  angreSammenslaing,
  anvendSammenslaing,
  entydigTall,
  tallIHundredeler,
  finnDuplikatgrupper,
  lagPlan,
  stabil,
  vurderMengder,
} from "./handlelisteDuplikater";

const T0 = "2026-10-23T08:00:00.000Z";
const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
/** Rå node slik RTDB lagrer den: `id` inne i posten, ukjente felt og `_ops` med. */
const raaNode = (...rr: ShoppingItem[]): Record<string, unknown> => ({
  _ops: { req1: { tool: "shopping_list_add_items", at: 1, fp: "x", sub: "s", result: [] } },
  ...Object.fromEntries(rr.map((r) => [r.id, { ...r, ukjent: { fra: "legacy" } }])),
});
const plan = (valgte: ShoppingItem[], beholdId: string, valg: "sum" | "behold" = "sum") => {
  const p = lagPlan(valgte, beholdId, valg, "op-1", T0);
  if (!p.kan) throw new Error(p.grunn);
  return p.plan;
};

describe("finnDuplikatgrupper", () => {
  it("sterk gruppe for samme itemId; kandidat bare for likt navn med ulik/manglende itemId; fullførte utelatt", () => {
    const g = finnDuplikatgrupper([
      rad("a"),
      rad("b", { name: "melk " }),
      rad("c", { itemId: "v-annen", name: "Melk" }),
      rad("d", { itemId: null, name: "MELK" }),
      rad("e", { done: true }),
      rad("f", { itemId: "v-egg", name: "Egg" }),
    ]);
    expect(g.find((x) => x.type === "sterk")!.rader.map((r) => r.id)).toEqual(["a", "b"]);
    expect(g.find((x) => x.type === "kandidat")!.rader.map((r) => r.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(g.every((x) => x.rader.every((r) => !r.done))).toBe(true);
  });

  it("likt navn med SAMME itemId er ikke en ekstra kandidatgruppe", () => {
    const g = finnDuplikatgrupper([rad("a"), rad("b")]);
    expect(g.map((x) => x.type)).toEqual(["sterk"]);
  });
});

describe("kandidater uten varetilknytning (review 6355066911 pkt. 3)", () => {
  it("to og tre navnelike rader som alle mangler itemId er en uvalgt kandidatgruppe", () => {
    const to = finnDuplikatgrupper([rad("a", { itemId: null }), rad("b", { itemId: null })]);
    expect(to.map((g) => [g.type, g.rader.map((r) => r.id)])).toEqual([["kandidat", ["a", "b"]]]);
    const tre = finnDuplikatgrupper([
      rad("a", { itemId: null }),
      rad("b", { itemId: null, name: " melk" }),
      rad("c", { itemId: null, name: "MELK" }),
    ]);
    expect(tre.map((g) => [g.type, g.rader.length])).toEqual([["kandidat", 3]]);
  });

  it("blandet tilknytning: sterk gruppe for samme vare, kandidat for hele navnegruppen; fullførte utelatt", () => {
    const g = finnDuplikatgrupper([
      rad("a"),
      rad("b"),
      rad("c", { itemId: null }),
      rad("d", { itemId: null, done: true }),
    ]);
    expect(g.map((x) => [x.type, x.rader.map((r) => r.id)])).toEqual([
      ["sterk", ["a", "b"]],
      ["kandidat", ["a", "b", "c"]],
    ]);
    expect(
      finnDuplikatgrupper([rad("a", { itemId: null }), rad("b", { itemId: null, done: true })]),
    ).toEqual([]);
  });
});

describe("mengder: bare entydige tall summeres", () => {
  it("entydigTall godtar heltall og desimaltall med komma eller punktum (høyst to desimaler)", () => {
    expect(entydigTall("2")).toBe(2);
    expect(entydigTall(" 1,5 ")).toBe(1.5);
    expect(entydigTall("2.25")).toBe(2.25);
    for (const s of [
      "2 stk",
      "500 g",
      "1.000",
      "1,250",
      "-1",
      "1/2",
      "ca 2",
      "",
      "2,",
      ",5",
      "1e3",
    ]) {
      expect(entydigTall(s)).toBeNull();
    }
  });

  it("utrygge tall avvises: 309 niere, 2^53+1 og mer enn seks heltallssifre; grensen er eksakt", () => {
    expect(tallIHundredeler("9".repeat(309))).toBeNull();
    expect(tallIHundredeler("9007199254740993")).toBeNull();
    expect(tallIHundredeler("1234567")).toBeNull();
    expect(tallIHundredeler("999999,99")).toBe(99_999_999);
    expect(tallIHundredeler("0,05")).toBe(5);
    expect(tallIHundredeler("2.5")).toBe(250);
  });

  it("en sum over grensen blokkeres — aldri Infinity eller feil avrundet resultat", () => {
    const v = vurderMengder([rad("a", { amount: "999999" }), rad("b", { amount: "1" })], "a");
    expect(v).toEqual({ type: "blokkert", grunn: "Summen blir for stor til å slås sammen trygt." });
    const stor = vurderMengder(
      [rad("a", { amount: "9".repeat(309) }), rad("b", { amount: "1" })],
      "a",
    );
    expect(stor.type).toBe("blokkert");
    expect(JSON.stringify(stor)).not.toMatch(/Infinity/);
  });

  it("eksakt desimalregning: hundredeler summeres som heltall", () => {
    const v = vurderMengder(
      [
        rad("a", { amount: "0,05" }),
        rad("b", { amount: "0,1" }),
        rad("c", { amount: "999998,85" }),
      ],
      "a",
    );
    expect(v).toEqual({ type: "tall", sum: "999999", behold: "0,05" });
    expect(
      vurderMengder([rad("a", { amount: "1.25" }), rad("b", { amount: "2.5" })], "a"),
    ).toMatchObject({ sum: "3.75" });
  });

  it("tre rader med tall: sum eller behold, aldri automatisk", () => {
    const rr = [rad("a", { amount: "1" }), rad("b", { amount: "2,5" }), rad("c", { amount: "" })];
    expect(vurderMengder(rr, "a")).toEqual({ type: "tall", sum: "3,5", behold: "1" });
  });

  it("like enhetsmengder («2 stk» + «2 stk») blokkeres — blir aldri 4 uten enhet", () => {
    const v = vurderMengder([rad("a", { amount: "2 stk" }), rad("b", { amount: "2 stk" })], "a");
    expect(v.type).toBe("blokkert");
  });

  it("blandet tall og fritekst blokkeres; bare tomme mengder gir ingen endring", () => {
    expect(
      vurderMengder([rad("a", { amount: "2" }), rad("b", { amount: "500 g" })], "a").type,
    ).toBe("blokkert");
    expect(vurderMengder([rad("a", { amount: "" }), rad("b", { amount: "" })], "a")).toEqual({
      type: "ingen",
      behold: "",
    });
  });

  it("flyttallsstøy avrundes til to desimaler", () => {
    const v = vurderMengder([rad("a", { amount: "0.1" }), rad("b", { amount: "0.2" })], "a");
    expect(v).toMatchObject({ type: "tall", sum: "0.3" });
  });
});

describe("lagPlan: bare eksplisitte, gyldige valg", () => {
  it("krever to rader, en beholdt rad blant de valgte, ingen fullførte og ikke blokkerte mengder", () => {
    expect(lagPlan([rad("a")], "a", "sum", "op", T0)).toMatchObject({ kan: false });
    expect(lagPlan([rad("a"), rad("b")], "x", "sum", "op", T0)).toMatchObject({ kan: false });
    expect(lagPlan([rad("a"), rad("b", { done: true })], "a", "sum", "op", T0)).toMatchObject({
      kan: false,
    });
    expect(
      lagPlan([rad("a", { amount: "1 l" }), rad("b", { amount: "1 l" })], "a", "behold", "op", T0),
    ).toMatchObject({ kan: false });
    expect(lagPlan([rad("a"), rad("a")], "a", "sum", "op", T0)).toMatchObject({ kan: false });
  });

  it("«sum» kun for tall; «behold» gir beholdt rads mengde; planen fanger det Helen så", () => {
    const p = plan([rad("a", { amount: "1" }), rad("b", { amount: "2" })], "a", "sum");
    expect(p).toMatchObject({ beholdId: "a", kildeIds: ["b"], resultatMengde: "3" });
    expect(p.sett.b).toEqual({
      name: "Melk",
      amount: "2",
      cat: "Ost og meieri",
      itemId: "v-melk",
      done: false,
    });
    expect(plan([rad("a"), rad("b", { amount: "2" })], "a", "behold").resultatMengde).toBe("1");
  });

  it("nekter rader med uavklart sammenslåingshistorikk", () => {
    const r = rad("a", { sammenslaing: { opId: "gammel", tidspunkt: T0, antallKilder: 1 } });
    expect(lagPlan([r, rad("b")], "a", "sum", "op", T0)).toMatchObject({ kan: false });
  });
});

describe("anvendSammenslaing mot fersk node", () => {
  const a = rad("a", { amount: "1" });
  const b = rad("b", { amount: "2" });
  const c = rad("c", { amount: "3" });
  const andre = rad("x", { name: "Egg", itemId: "v-egg" });

  it("tre rader: beholdt rad får summen og full rå historikk; kilder fjernes; _ops og andre rader urørt", () => {
    const node = raaNode(a, b, c, andre);
    const r = anvendSammenslaing(node, plan([a, b, c], "a"));
    expect(r.utfall).toBe("anvendt");
    const ny = r.node as Record<string, Record<string, unknown>>;
    expect(Object.keys(ny).sort()).toEqual(["_ops", "a", "x"]);
    expect(ny._ops).toEqual(node._ops);
    expect(ny.x).toEqual(node.x);
    expect(ny.a!.amount).toBe("6");
    expect(ny.a!.ukjent).toEqual({ fra: "legacy" });
    const h = ny.a!.sammenslaing as Record<string, unknown>;
    expect(h.foer).toEqual(node.a);
    expect(h.kilder).toEqual({ b: node.b, c: node.c });
  });

  it("legacy-array-form håndteres og andre elementer bevares", () => {
    const arr = [
      null,
      { ...rad("1"), amount: "1" },
      { ...rad("2"), amount: "1" },
      rad("3", { name: "Egg", itemId: "e" }),
    ];
    const p = plan([rad("1"), rad("2")], "1");
    const r = anvendSammenslaing(arr, p);
    expect(r.utfall).toBe("anvendt");
    expect(Object.keys(r.node as object).sort()).toEqual(["1", "3"]);
  });

  const stale: [string, (n: Record<string, Record<string, unknown>>) => void][] = [
    ["endret mengde", (n) => (n.b!.amount = "5")],
    ["huket av", (n) => (n.b!.done = true)],
    ["fjernet", (n) => delete n.b],
    ["endret navn", (n) => (n.a!.name = "Lettmelk")],
    ["endret vare", (n) => (n.a!.itemId = "v-annen")],
    ["endret kategori", (n) => (n.b!.cat = "Drikke")],
  ];
  for (const [navn, endre] of stale) {
    it(`stale forhåndsvisning (${navn}) → konflikt, noden uendret`, () => {
      const node = raaNode(a, b) as Record<string, Record<string, unknown>>;
      const p = plan([a, b], "a");
      endre(node);
      const foer = stabil(node);
      const r = anvendSammenslaing(node, p);
      expect(r.utfall).toBe("konflikt");
      expect(r.node).toBe(node);
      expect(stabil(node)).toBe(foer);
    });
  }

  it("dobbel utførelse med samme opId gir én virkning; samme opId med annen payload er konflikt", () => {
    const p = plan([a, b], "a");
    const etter = anvendSammenslaing(raaNode(a, b), p);
    expect(etter.utfall).toBe("anvendt");
    const igjen = anvendSammenslaing(etter.node, p);
    expect(igjen.utfall).toBe("allerede");
    expect(igjen.node).toBe(etter.node);
    const annen: SammenslaingsPlan = { ...p, resultatMengde: "9" };
    expect(anvendSammenslaing(etter.node, annen).utfall).toBe("konflikt");
  });

  it("tidspunkt alene endrer ikke payload (retry med ny klokke er replay)", () => {
    const p = plan([a, b], "a");
    const etter = anvendSammenslaing(raaNode(a, b), p);
    expect(anvendSammenslaing(etter.node, { ...p, tidspunkt: "senere" }).utfall).toBe("allerede");
  });

  it("merge → merge: en rad med uavklart historikk kan ikke slås sammen igjen", () => {
    const p1 = plan([a, b], "a");
    const etter = anvendSammenslaing(raaNode(a, b, c), p1).node as Record<
      string,
      Record<string, unknown>
    >;
    const aEtter = rad("a", { amount: "3" });
    const p2 = lagPlan([aEtter, c], "a", "sum", "op-2", T0);
    expect(p2.kan).toBe(true);
    const r = anvendSammenslaing(etter, (p2 as { plan: SammenslaingsPlan }).plan);
    expect(r).toMatchObject({ utfall: "konflikt" });
    expect((r as { grunn: string }).grunn).toMatch(/ikke er avklart/);
  });

  it("kald/tom node gir konflikt uten å skrive noe", () => {
    const r = anvendSammenslaing(null, plan([a, b], "a"));
    expect(r.utfall).toBe("konflikt");
  });
});

describe("angreSammenslaing: eksakt, og aldri over senere endringer", () => {
  const a = rad("a", { amount: "1" });
  const b = rad("b", { amount: "2" });

  it("gjenoppretter beholdt rad og kilder rått; merker opId som angret; _ops urørt", () => {
    const node = raaNode(a, b);
    const etter = anvendSammenslaing(node, plan([a, b], "a")).node;
    const r = angreSammenslaing(etter, "a", "op-1");
    expect(r.utfall).toBe("anvendt");
    const ny = r.node as Record<string, Record<string, unknown>>;
    expect(ny.b).toEqual(node.b);
    const { sammenslaingAngret, ...aUten } = ny.a!;
    expect(aUten).toEqual(node.a);
    expect(sammenslaingAngret).toEqual({ "op-1": true });
    expect(ny._ops).toEqual(node._ops);
  });

  it("nektes når beholdt rad er endret etterpå (mengde, avhuking, ukjent felt) — ingenting overskrives", () => {
    const etter = anvendSammenslaing(raaNode(a, b), plan([a, b], "a")).node as Record<
      string,
      Record<string, unknown>
    >;
    for (const endre of [
      (r: Record<string, unknown>) => (r.amount = "4"),
      (r: Record<string, unknown>) => (r.done = true),
      (r: Record<string, unknown>) => (r.ukjent = "endret"),
    ]) {
      const n = JSON.parse(JSON.stringify(etter)) as Record<string, Record<string, unknown>>;
      endre(n.a!);
      const r = angreSammenslaing(n, "a", "op-1");
      expect(r.utfall).toBe("konflikt");
      expect(r.node).toBe(n);
    }
  });

  it("nektes når en kilde-id finnes igjen (ville gitt dobbelt)", () => {
    const etter = anvendSammenslaing(raaNode(a, b), plan([a, b], "a")).node as Record<
      string,
      unknown
    >;
    const r = angreSammenslaing({ ...etter, b: { ...b } }, "a", "op-1");
    expect(r.utfall).toBe("konflikt");
  });

  it("dobbel angring er no-op; merge → angre → forsinket retry slår ikke inn igjen", () => {
    const p = plan([a, b], "a");
    const etter = anvendSammenslaing(raaNode(a, b), p).node;
    const angret = angreSammenslaing(etter, "a", "op-1").node;
    expect(angreSammenslaing(angret, "a", "op-1").utfall).toBe("allerede");
    const retry = anvendSammenslaing(angret, p);
    expect(retry.utfall).toBe("konflikt");
    expect((retry as { grunn: string }).grunn).toMatch(/allerede angret/);
    expect(retry.node).toBe(angret);
  });

  it("en ny sammenslåing etter angring virker, og angres på nytt med tidligere merke bevart", () => {
    const etter = anvendSammenslaing(raaNode(a, b), plan([a, b], "a")).node;
    const angret = angreSammenslaing(etter, "a", "op-1").node as Record<
      string,
      Record<string, unknown>
    >;
    const p2 = lagPlan([a, b], "a", "behold", "op-2", T0);
    const ny = anvendSammenslaing(angret, (p2 as { plan: SammenslaingsPlan }).plan);
    expect(ny.utfall).toBe("anvendt");
    const angret2 = angreSammenslaing(ny.node, "a", "op-2").node as Record<
      string,
      Record<string, unknown>
    >;
    expect(angret2.a!.sammenslaingAngret).toEqual({ "op-1": true, "op-2": true });
  });
});
