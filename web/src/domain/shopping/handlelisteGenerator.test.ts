import { describe, expect, it } from "vitest";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import { anvendGeneratorPlan, beregnEffekter, lagGeneratorPlan } from "./handlelisteGenerator";
import { KVITTERINGER, medEndringer } from "./handlelisteInnlegging";

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
const ny = (o: Partial<ShoppingListEntry> = {}): ShoppingListEntry => ({
  itemId: "v-melk",
  name: "Melk",
  amount: "3",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
const node = (...rr: ShoppingItem[]) => Object.fromEntries(rr.map((r) => [r.id, { ...r }]));
const etter = (raw: unknown, u: ReturnType<typeof anvendGeneratorPlan>) =>
  u.utfall === "anvendt" ? medEndringer(raw, u) : raw;

describe("beregnEffekter — samme regler som før", () => {
  it("summerer tall inn i første ikke-fullførte rad med samme navn; ellers ny rad", () => {
    const e = beregnEffekter(node(rad("m")), [ny(), ny({ name: "Egg", itemId: "v-egg" })], "op");
    expect(e!.endret).toEqual({ m: { sett: expect.objectContaining({ amount: "2" }), til: "5" } });
    expect(e!.nye.map((n) => [n.id, n.rad.name])).toEqual([["op-1", "Egg"]]);
  });

  it("mengder som ikke begge er positive tall: raden står urørt, ingen ny rad", () => {
    const e = beregnEffekter(node(rad("m", { amount: "" })), [ny()], "op");
    expect(e).toEqual({ nye: [], endret: {}, uendret: { m: expect.any(Object) } });
    expect(beregnEffekter(node(rad("m")), [ny({ amount: "" })], "op")!.uendret).toHaveProperty("m");
  });

  it("parseFloat-semantikken er uendret: «1 pk» + «1» blir «2»", () => {
    const e = beregnEffekter(
      node(rad("b", { name: "Brød", amount: "1 pk" })),
      [ny({ name: "Brød", amount: "1" })],
      "op",
    );
    expect(e!.endret.b!.til).toBe("2");
  });

  it("fullført rad blokkerer ikke; nye varer matches aldri mot hverandre", () => {
    const e = beregnEffekter(node(rad("m", { done: true })), [ny(), ny({ amount: "1" })], "op");
    expect(e!.nye.map((n) => n.id)).toEqual(["op-0", "op-1"]);
  });

  it("flere nye varer mot samme kandidat summeres etter hverandre", () => {
    const e = beregnEffekter(node(rad("m")), [ny(), ny({ amount: "1" })], "op");
    expect(e!.endret.m!.til).toBe("6");
  });

  it("reserverte nøkler og poster uten navn er aldri kandidater", () => {
    const n = { ...node(rad("m")), _ops: { name: "Melk" }, undefined: { r: 1 } };
    const e = beregnEffekter(n, [ny()], "op");
    expect(Object.keys(e!.endret)).toEqual(["m"]);
  });
});

describe("anvendGeneratorPlan mot fersk node", () => {
  const liste = [rad("m"), rad("b", { name: "Brød", itemId: "v-brod", amount: "1 pk" })];
  const entries = [ny(), ny({ name: "Egg", itemId: "v-egg", amount: "6" })];
  const plan = () => lagGeneratorPlan(liste, entries, "op-1");

  it("anvendt: nye rader på stabile nøkler, summert mengde, andre felt urørt, kvittering", () => {
    const n: Record<string, Record<string, unknown>> = {
      ...node(...liste),
      m: { ...liste[0], ukjent: { x: 1 } },
      _ops: { r: 1 },
    };
    const u = anvendGeneratorPlan(n, plan());
    expect(u.utfall).toBe("anvendt");
    const e = etter(n, u) as Record<string, Record<string, unknown>>;
    expect(e.m).toEqual({ ...n.m, amount: "5" });
    expect(e["op-1-1"]).toMatchObject({ name: "Egg", amount: "6", id: "op-1-1", done: false });
    expect(e.b).toEqual(n.b);
    expect(e._ops).toEqual(n._ops);
    expect(e[KVITTERINGER]).toEqual({
      "op-1": { generator: { nye: ["op-1-1"], endret: { m: { fra: "2", til: "5" } } } },
    });
  });

  it("samme opId igjen (dobbeltklikk, «Send på nytt») etter lagring: allerede, ingen dobbel virkning", () => {
    const n = node(...liste);
    const lagret = etter(n, anvendGeneratorPlan(n, plan()));
    expect(anvendGeneratorPlan(lagret, plan()).utfall).toBe("allerede");
    expect(anvendGeneratorPlan(lagret, plan(), true).utfall).toBe("allerede");
  });

  it("gjentak uten kvittering: ubekreftet, ingenting skrives", () => {
    expect(anvendGeneratorPlan(node(...liste), plan(), true).utfall).toBe("ubekreftet");
  });

  it("grunnlaget avviker (kandidat endret, avhuket, fjernet; ny kandidat): konflikt", () => {
    const p = plan();
    for (const n of [
      node(rad("m", { amount: "4" }), liste[1]!),
      node(rad("m", { done: true }), liste[1]!),
      node(liste[1]!),
      { ...node(...liste), e: rad("e", { name: "Egg", itemId: "v-egg", amount: "1" }) },
    ]) {
      const u = anvendGeneratorPlan(n, p);
      expect(u.utfall, JSON.stringify(Object.keys(n))).toBe("konflikt");
      expect((u as { grunn: string }).grunn).toMatch(/Se gjennom varene på nytt/);
    }
  });

  it("bare urørte kandidater: ingenting å skrive", () => {
    const p = lagGeneratorPlan([rad("m", { amount: "" })], [ny()], "op-2");
    expect(anvendGeneratorPlan(node(rad("m", { amount: "" })), p).utfall).toBe("allerede");
  });

  it("samme opId med annet innhold, id-kollisjon og uventet form avvises", () => {
    const n = node(...liste);
    const lagret = etter(n, anvendGeneratorPlan(n, plan())) as Record<string, unknown>;
    const annen = lagGeneratorPlan(liste, [ny({ amount: "1" })], "op-1");
    expect(anvendGeneratorPlan(lagret, annen).utfall).toBe("konflikt");
    expect(anvendGeneratorPlan({ ...n, "op-1-1": { r: 1 } }, plan()).utfall).toBe("konflikt");
    expect(anvendGeneratorPlan("tekst", plan()).utfall).toBe("konflikt");
    expect(anvendGeneratorPlan({ ...n, [KVITTERINGER]: "x" }, plan()).utfall).toBe("konflikt");
  });
});
