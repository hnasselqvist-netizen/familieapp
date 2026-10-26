/**
 * Sammenslåing av handlelisteduplikater (Mat #20, review 6353438086) i den
 * EKTE skriveveien mot emulatoren: `transactShoppingNode` med domenets
 * rene beslutninger, slik `useShoppingList` kobler dem. Admin-SDK-en
 * spiller «en annen klient» og legacy (som skriver hele noden), og
 * klient-SDK-en har aldri et abonnement på noden (kald cache).
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  type Database as AdminDatabase,
  getDatabase as getAdminDatabase,
} from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type SammenslaingsPlan,
  angreSammenslaing,
  anvendSammenslaing,
  lagPlan,
  stabil,
} from "@domain/shopping/handlelisteDuplikater";
import { shoppingMergeRules } from "@domain/shopping/handlelisteRules";
import type { ShoppingItem } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import {
  addBatchToShoppingList,
  removeShoppingItem,
  toggleShoppingItemDone,
  transactShoppingNode,
  updateShoppingItemField,
} from "./shopping.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const T0 = "2026-10-23T08:00:00.000Z";
const STI = `families/${FAMILY_ID}/shopping`;

let adminApp: AdminApp;
let admin: AdminDatabase;

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
/** Rå post slik appen og legacy lagrer den: `id` inne i posten pluss et ukjent felt. */
const raa = (r: ShoppingItem) => ({ ...r, ukjent: { fra: "legacy" } });
const OPS = { req1: { tool: "shopping_list_add_items", at: 1, fp: "f", sub: "s", result: ["x"] } };

const lesNode = async () =>
  (await admin.ref(STI).get()).val() as Record<string, Record<string, unknown>>;
const settNode = (node: unknown) => admin.ref(STI).set(node);
const plan = (
  valgte: ShoppingItem[],
  beholdId: string,
  valg: "sum" | "behold" = "sum",
  opId = "op-1",
) => {
  const p = lagPlan(valgte, beholdId, valg, opId, T0);
  if (!p.kan) throw new Error(p.grunn);
  return p.plan;
};
const slaaSammen = (p: SammenslaingsPlan) =>
  transactShoppingNode(FAMILY_ID, (raw) => anvendSammenslaing(raw, p));
const angre = (beholdId: string, opId: string) =>
  transactShoppingNode(FAMILY_ID, (raw) => angreSammenslaing(raw, beholdId, opId));

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin-shopping-duplikater",
  );
  admin = getAdminDatabase(adminApp);
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  await signInWithCustomToken(
    getFirebaseAuth(),
    await getAdminAuth(adminApp).createCustomToken(uid),
  );
});

beforeEach(() => admin.ref(STI).remove());

afterAll(async () => {
  await admin.ref(`families/${FAMILY_ID}`).remove();
  await deleteApp(adminApp);
});

describe("sammenslåing via ekte skrivevei (emulator, kald klient)", () => {
  const a = rad("a", { amount: "1" });
  const b = rad("b", { amount: "2" });
  const c = rad("c", { amount: "3" });
  const egg = rad("x", { name: "Egg", itemId: "v-egg" });

  it("tre rader slås sammen; _ops, andre rader og ukjente felt bevares byte-likt", async () => {
    await settNode({ _ops: OPS, a: raa(a), b: raa(b), c: raa(c), x: raa(egg) });
    const foer = await lesNode();
    expect(await slaaSammen(plan([a, b, c], "a"))).toEqual({ utfall: "anvendt" });
    const n = await lesNode();
    expect(Object.keys(n).sort()).toEqual(["_ops", "a", "x"]);
    expect(stabil(n._ops)).toBe(stabil(foer._ops));
    expect(stabil(n.x)).toBe(stabil(foer.x));
    expect(n.a!.amount).toBe("6");
    expect(n.a!.ukjent).toEqual({ fra: "legacy" });
    const h = n.a!.sammenslaing as { foer: unknown; kilder: Record<string, unknown> };
    expect(stabil(h.foer)).toBe(stabil(foer.a));
    expect(stabil(h.kilder)).toBe(stabil({ b: foer.b, c: foer.c }));
  });

  it("legacy-array-form (heltallsnøkler) håndteres", async () => {
    await settNode([
      null,
      raa(rad("1")),
      raa(rad("2")),
      raa(rad("3", { name: "Egg", itemId: "e" })),
    ]);
    expect(await slaaSammen(plan([rad("1"), rad("2")], "1"))).toEqual({ utfall: "anvendt" });
    const n = await lesNode();
    expect(
      Object.keys(n)
        .filter((k) => n[k])
        .sort(),
    ).toEqual(["1", "3"]);
  });

  const stale: [string, () => Promise<unknown>][] = [
    ["mengde endret på annen klient", () => admin.ref(`${STI}/b/amount`).set("5")],
    ["huket av på annen klient", () => admin.ref(`${STI}/b/done`).set(true)],
    ["fjernet på annen klient", () => admin.ref(`${STI}/b`).remove()],
  ];
  for (const [navn, endre] of stale) {
    it(`stale forhåndsvisning (${navn}) → konflikt, ingenting skrives`, async () => {
      await settNode({ _ops: OPS, a: raa(a), b: raa(b) });
      const p = plan([a, b], "a");
      await endre();
      const foer = await lesNode();
      const r = await slaaSammen(p);
      expect(r.utfall).toBe("konflikt");
      expect(stabil(await lesNode())).toBe(stabil(foer));
    });
  }

  it("legacy skriver hele noden mellom forhåndsvisning og utførelse → konflikt, legacy-tilstanden står", async () => {
    await settNode({ a: raa(a), b: raa(b) });
    const p = plan([a, b], "a");
    await settNode({
      a: raa(a),
      b: raa({ ...b, amount: "4" }),
      y: raa(rad("y", { name: "Brød" })),
    });
    const foer = await lesNode();
    expect((await slaaSammen(p)).utfall).toBe("konflikt");
    expect(stabil(await lesNode())).toBe(stabil(foer));
  });

  it("dobbel utførelse (parallelt og etterpå) gir én virkning; samme opId med annen payload er konflikt", async () => {
    await settNode({ a: raa(a), b: raa(b) });
    const p = plan([a, b], "a");
    const [r1, r2] = await Promise.all([slaaSammen(p), slaaSammen(p)]);
    expect([r1.utfall, r2.utfall].sort()).toEqual(["allerede", "anvendt"]);
    const etter = await lesNode();
    expect((await slaaSammen({ ...p, tidspunkt: "senere" })).utfall).toBe("allerede");
    expect((await slaaSammen({ ...p, resultatMengde: "9" })).utfall).toBe("konflikt");
    expect(stabil(await lesNode())).toBe(stabil(etter));
    expect(etter.a!.amount).toBe("3");
  });

  it("merge → merge: en rad med uavklart historikk slås ikke sammen igjen", async () => {
    await settNode({ a: raa(a), b: raa(b), c: raa(c) });
    await slaaSammen(plan([a, b], "a"));
    const foer = await lesNode();
    const r = await slaaSammen(plan([rad("a", { amount: "3" }), c], "a", "sum", "op-2"));
    expect(r.utfall).toBe("konflikt");
    expect(stabil(await lesNode())).toBe(stabil(foer));
  });
});

describe("angring via ekte skrivevei (emulator)", () => {
  const a = rad("a", { amount: "1" });
  const b = rad("b", { amount: "2" });

  it("gjenoppretter eksakt (rå) og merker opId; _ops urørt", async () => {
    await settNode({ _ops: OPS, a: raa(a), b: raa(b) });
    const foer = await lesNode();
    await slaaSammen(plan([a, b], "a"));
    expect(await angre("a", "op-1")).toEqual({ utfall: "anvendt" });
    const n = await lesNode();
    expect(stabil(n.b)).toBe(stabil(foer.b));
    const { sammenslaingAngret, ...aUten } = n.a!;
    expect(stabil(aUten)).toBe(stabil(foer.a));
    expect(sammenslaingAngret).toEqual({ "op-1": true });
    expect(stabil(n._ops)).toBe(stabil(foer._ops));
  });

  it("senere redigering på annen klient → angring nektes og noden er uendret", async () => {
    await settNode({ a: raa(a), b: raa(b) });
    await slaaSammen(plan([a, b], "a"));
    await updateShoppingItemField(FAMILY_ID, "a", "amount", "10");
    const foer = await lesNode();
    expect((await angre("a", "op-1")).utfall).toBe("konflikt");
    expect(stabil(await lesNode())).toBe(stabil(foer));
  });

  it("merge → angre → forsinket retry av samme opId slår ikke inn igjen; dobbel angring er no-op", async () => {
    await settNode({ a: raa(a), b: raa(b) });
    const p = plan([a, b], "a");
    await slaaSammen(p);
    await angre("a", "op-1");
    const angret = await lesNode();
    expect((await angre("a", "op-1")).utfall).toBe("allerede");
    expect((await slaaSammen(p)).utfall).toBe("konflikt");
    expect(stabil(await lesNode())).toBe(stabil(angret));
  });
});

describe("skrivinger ETTER at sammenslåingen er lagret gjenoppretter aldri en delrad", () => {
  const a = rad("a", { amount: "1" });
  const b = rad("b", { amount: "2" });

  it("feltredigering, avhuking og fjerning av en innslått rad er no-op", async () => {
    await settNode({ a: raa(a), b: raa(b) });
    await slaaSammen(plan([a, b], "a"));
    const etter = await lesNode();
    await updateShoppingItemField(FAMILY_ID, "b", "amount", "7");
    await updateShoppingItemField(FAMILY_ID, "b", "name", "Melk");
    await toggleShoppingItemDone(FAMILY_ID, "b");
    await removeShoppingItem(FAMILY_ID, "b");
    expect(stabil(await lesNode())).toBe(stabil(etter));
  });

  it("feltredigering på en eksisterende rad bevarer alle andre felt, også historikk og ukjente felt", async () => {
    await settNode({ a: raa(a), b: raa(b) });
    await slaaSammen(plan([a, b], "a"));
    const foer = await lesNode();
    await updateShoppingItemField(FAMILY_ID, "a", "cat", "Drikke");
    const n = await lesNode();
    expect(stabil({ ...n.a, cat: foer.a!.cat })).toBe(stabil(foer.a));
  });

  it("generatoren legger inn en NY hel rad (ikke en delrad) når dedup-kandidaten er slått inn", async () => {
    await settNode({ a: raa(a), b: raa(b) });
    await slaaSammen(plan([a, b], "a"));
    // Generatoren fant «b» som kandidat i et eldre øyeblikksbilde (før sammenslåingen).
    await addBatchToShoppingList(
      FAMILY_ID,
      [b],
      [{ itemId: "v-melk", name: "Melk", amount: "1", cat: "Ost og meieri", done: false }],
      { ...shoppingMergeRules, findMergeCandidate: () => b },
    );
    const n = await lesNode();
    expect(n.b).toBeUndefined();
    const nye = Object.entries(n).filter(([k]) => k !== "a");
    expect(nye).toHaveLength(1);
    expect(nye[0]![1]).toMatchObject({ name: "Melk", amount: "1", itemId: "v-melk", done: false });
  });
});
