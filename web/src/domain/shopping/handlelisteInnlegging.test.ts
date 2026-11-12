import { describe, expect, it } from "vitest";
import type { ShoppingItem } from "@app-types/shopping";
import {
  KVITTERINGER,
  type NyRadPlan,
  anvendNyRad,
  anvendOkning,
  finnTreff,
  lagOkningsPlan,
  vurderOkning,
} from "./handlelisteInnlegging";

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
const raa = (r: ShoppingItem, ekstra: Record<string, unknown> = {}) => ({ ...r, ...ekstra });
const okning = (r: ShoppingItem, tillegg: string, opId = "op-1") => {
  const p = lagOkningsPlan(r, tillegg, opId);
  if (!p.kan) throw new Error(p.grunn);
  return p.plan;
};
const nyPlan = (o: Partial<NyRadPlan["rad"]> = {}, opId = "op-ny"): NyRadPlan => ({
  opId,
  rad: { itemId: "v-melk", name: "Melk", amount: "2", cat: "Ost og meieri", done: false, ...o },
});

describe("finnTreff", () => {
  it("samme itemId er sterkt treff, også med annet navn", () => {
    const t = finnTreff([rad("a", { name: "Lettmelk" })], { name: "Melk", itemId: "v-melk" });
    expect(t.map((x) => [x.type, x.rad.id])).toEqual([["sterk", "a"]]);
  });

  it("samme normaliserte navn uten bekreftet identitet er kandidat", () => {
    const rader = [rad("a", { itemId: null, name: " melk " }), rad("b", { itemId: "v-melk" })];
    expect(finnTreff(rader, { name: "MELK", itemId: null }).map((x) => x.type)).toEqual([
      "kandidat",
      "kandidat",
    ]);
    // Ny vare med id, rad uten id: kandidat.
    expect(finnTreff([rad("a", { itemId: null })], { name: "melk", itemId: "v-melk" })).toEqual([
      { type: "kandidat", rad: rad("a", { itemId: null }) },
    ]);
  });

  it("ulike bekreftede itemId slås ikke sammen på delt navn", () => {
    expect(
      finnTreff([rad("a", { itemId: "v-annen" })], { name: "Melk", itemId: "v-melk" }),
    ).toEqual([]);
  });

  it("fullførte rader blokkerer ikke, poster uten navn hoppes over", () => {
    const rader = [rad("a", { done: true }), { id: "x" } as unknown as ShoppingItem];
    expect(finnTreff(rader, { name: "Melk", itemId: "v-melk" })).toEqual([]);
  });

  it("flere treff: sterke først", () => {
    const rader = [rad("k", { itemId: null }), rad("s")];
    expect(finnTreff(rader, { name: "Melk", itemId: "v-melk" }).map((t) => t.rad.id)).toEqual([
      "s",
      "k",
    ]);
  });

  it("tomt navn gir ingen kandidat", () => {
    expect(finnTreff([rad("a", { name: "", itemId: null })], { name: " ", itemId: null })).toEqual(
      [],
    );
  });
});

describe("vurderOkning", () => {
  it("entydige tall summeres eksakt, med komma når en av dem brukte komma", () => {
    expect(vurderOkning("1", "2")).toEqual({ type: "sum", resultat: "3" });
    expect(vurderOkning("1,5", "0.25")).toEqual({ type: "sum", resultat: "1,75" });
    expect(vurderOkning("0.1", "0.2")).toEqual({ type: "sum", resultat: "0.3" });
  });

  it("tom ny mengde gjettes ikke", () => {
    expect(vurderOkning("2", " ").type).toBe("uklar");
  });

  it("tom eksisterende mengde gjettes ikke", () => {
    expect(vurderOkning("", "2").type).toBe("uklar");
  });

  it("enheter og fritekst summeres ikke", () => {
    for (const [a, b] of [
      ["2 l", "1"],
      ["2", "1 pk"],
      ["litt", "1"],
      ["1.000", "1"],
    ]) {
      expect(vurderOkning(a!, b!).type, `${a} + ${b}`).toBe("uklar");
    }
  });

  it("for stor sum avvises", () => {
    expect(vurderOkning("999999,99", "1").type).toBe("uklar");
  });
});

describe("lagOkningsPlan", () => {
  it("fanger det Helen så og resultatet", () => {
    expect(okning(rad("a", { amount: "2" }), "3")).toEqual({
      opId: "op-1",
      radId: "a",
      sett: { name: "Melk", amount: "2", cat: "Ost og meieri", itemId: "v-melk", done: false },
      tillegg: "3",
      resultat: "5",
    });
  });

  it("nekter fullført rad og uklar mengde", () => {
    expect(lagOkningsPlan(rad("a", { done: true }), "1", "op").kan).toBe(false);
    expect(lagOkningsPlan(rad("a", { amount: "1 l" }), "1", "op").kan).toBe(false);
  });
});

describe("anvendOkning", () => {
  const sammenslaing = { opId: "s1", foer: { name: "Melk" }, kilder: {} };
  const node = () => ({
    a: raa(rad("a", { amount: "2" }), { ukjent: { x: 1 }, sammenslaing }),
    b: raa(rad("b", { name: "Brød", itemId: "v-brod" })),
    _ops: { r1: { tool: "t" } },
  });

  it("øker bare amount; andre felt, metadata og historikk bevares", () => {
    const u = anvendOkning(node(), okning(rad("a", { amount: "2" }), "3"));
    expect(u.utfall).toBe("anvendt");
    const n = u.node as Record<string, unknown>;
    expect(n.a).toEqual({ ...node().a, amount: "5" });
    expect(n.b).toEqual(node().b);
    expect(n._ops).toEqual(node()._ops);
    expect(n[KVITTERINGER]).toEqual({ "op-1": { okt: { a: { fra: "2", til: "5" } } } });
  });

  it("replay med samme opId gir allerede — ingen dobbel økning", () => {
    const p = okning(rad("a", { amount: "2" }), "3");
    const etter = anvendOkning(node(), p).node;
    expect(anvendOkning(etter, p).utfall).toBe("allerede");
    expect(anvendOkning(etter, p, true).utfall).toBe("allerede");
  });

  it("gjentak uten kvittering er ubekreftet og skriver ingenting", () => {
    const u = anvendOkning(node(), okning(rad("a", { amount: "2" }), "3"), true);
    expect(u.utfall).toBe("ubekreftet");
    expect(u.node).toEqual(node());
  });

  it("samme opId med annet innhold er konflikt", () => {
    const etter = anvendOkning(node(), okning(rad("a", { amount: "2" }), "3")).node;
    expect(anvendOkning(etter, okning(rad("a", { amount: "2" }), "4")).utfall).toBe("konflikt");
  });

  it("endret, avhuket eller fjernet målrad gir konflikt uten skriving", () => {
    const p = okning(rad("a", { amount: "2" }), "3");
    for (const endring of [{ amount: "3" }, { done: true }, { cat: "Annet" }, { name: "Mjølk" }]) {
      const n = { ...node(), a: { ...node().a, ...endring } };
      const u = anvendOkning(n, p);
      expect(u.utfall, JSON.stringify(endring)).toBe("konflikt");
      expect(u.node).toBe(n);
    }
    const uten = { ...node(), a: undefined };
    expect(anvendOkning(uten, p).utfall).toBe("konflikt");
  });

  it("reservert målnøkkel og uventet form avvises", () => {
    const p = { ...okning(rad("a", { amount: "2" }), "3"), radId: "_ops" };
    expect(anvendOkning(node(), p).utfall).toBe("konflikt");
    expect(anvendOkning("tekst", okning(rad("a"), "1")).utfall).toBe("konflikt");
  });
});

describe("anvendNyRad", () => {
  it("ingen treff: ny rad på opId med kvittering; tom liste fungerer", () => {
    const u = anvendNyRad(null, nyPlan());
    expect(u).toEqual({
      utfall: "anvendt",
      node: {
        "op-ny": {
          itemId: "v-melk",
          name: "Melk",
          amount: "2",
          cat: "Ost og meieri",
          done: false,
          id: "op-ny",
        },
        [KVITTERINGER]: { "op-ny": { lagt: { "op-ny": { name: "Melk", cat: "Ost og meieri" } } } },
      },
    });
  });

  it("aktiv rad med samme vare i fersk node: konflikt med treff, ingenting skrives", () => {
    const n = { x: rad("x", { itemId: null, name: "melk" }) };
    const u = anvendNyRad(n, nyPlan());
    expect(u).toMatchObject({ utfall: "konflikt", treff: true });
    expect(u.node).toBe(n);
  });

  it("fullført rad og annen bekreftet vare med samme navn blokkerer ikke", () => {
    const n = {
      x: rad("x", { done: true }),
      y: rad("y", { itemId: "v-annen" }),
      _ops: { r: 1 },
    };
    const u = anvendNyRad(n, nyPlan());
    expect(u.utfall).toBe("anvendt");
    expect(Object.keys(u.node as object).sort()).toEqual(["_ops", KVITTERINGER, "op-ny", "x", "y"]);
  });

  it("replay etter commit gir allerede; gjentak uten kvittering er ubekreftet", () => {
    const etter = anvendNyRad({}, nyPlan()).node;
    expect(anvendNyRad(etter, nyPlan()).utfall).toBe("allerede");
    expect(anvendNyRad(etter, nyPlan(), true).utfall).toBe("allerede");
    // Raden fjernet av en annen enhet etterpå: kvitteringen hindrer gjenoppstandelse.
    const fjernet = { ...(etter as Record<string, unknown>) };
    delete fjernet["op-ny"];
    expect(anvendNyRad(fjernet, nyPlan(), true).utfall).toBe("allerede");
    expect(anvendNyRad({}, nyPlan(), true).utfall).toBe("ubekreftet");
  });

  it("eksisterende kvitteringer fra andre forsøk bevares", () => {
    const u = anvendNyRad({ [KVITTERINGER]: { gammel: { lagt: false } } }, nyPlan());
    expect((u.node as Record<string, Record<string, unknown>>)[KVITTERINGER]).toHaveProperty(
      "gammel",
    );
  });

  it("id-kollisjon og reservert opId avvises", () => {
    expect(anvendNyRad({ "op-ny": { name: "Annet" } }, nyPlan()).utfall).toBe("konflikt");
    expect(anvendNyRad({}, nyPlan({}, "_x")).utfall).toBe("konflikt");
  });
});
