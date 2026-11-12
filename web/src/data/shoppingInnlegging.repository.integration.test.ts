/**
 * Manuell innlegging med varsel (Mat #20, ordre 6830803229) i den EKTE
 * skriveveien mot emulatoren: `transactShoppingInnlegging` med domenets
 * rene beslutninger, slik `useShoppingList` kobler dem. Admin-SDK-en
 * spiller «en annen klient» (egen tilkobling, egne transaksjoner), og
 * klient-SDK-en har aldri et abonnement på noden (kald cache).
 * Syntetiske data.
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
import { stabil } from "@domain/shopping/handlelisteDuplikater";
import {
  KVITTERINGER,
  type NyRadPlan,
  type OkningsPlan,
  anvendNyRad,
  anvendOkning,
  lagOkningsPlan,
} from "@domain/shopping/handlelisteInnlegging";
import type { ShoppingItem } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import { transactShoppingInnlegging } from "./shopping.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const STI = `families/${FAMILY_ID}/shopping`;

let adminApp: AdminApp;
let admin: AdminDatabase;

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
const OPS = { req1: { tool: "shopping_list_add_items", at: 1, fp: "f", sub: "s", result: ["x"] } };
const lesNode = async () =>
  (await admin.ref(STI).get()).val() as Record<string, Record<string, unknown>> | null;
const settNode = (node: unknown) => admin.ref(STI).set(node);

const nyPlan = (opId: string, o: Partial<NyRadPlan["rad"]> = {}): NyRadPlan => ({
  opId,
  rad: { itemId: "v-melk", name: "Melk", amount: "1", cat: "Ost og meieri", done: false, ...o },
});
const okPlan = (r: ShoppingItem, tillegg: string, opId: string): OkningsPlan => {
  const p = lagOkningsPlan(r, tillegg, opId);
  if (!p.kan) throw new Error(p.grunn);
  return p.plan;
};
const leggTil = (p: NyRadPlan, gjentak = false) =>
  transactShoppingInnlegging(FAMILY_ID, (raw) => anvendNyRad(raw, p, gjentak));
const ok = (p: OkningsPlan, gjentak = false) =>
  transactShoppingInnlegging(FAMILY_ID, (raw) => anvendOkning(raw, p, gjentak));
/** Samme beslutning som en annen klient, via admin-SDK-ens egen transaksjon. */
const adminTransaksjon = async (beslutt: (raw: unknown) => { utfall: string; node: unknown }) => {
  let utfall = "";
  await admin.ref(STI).transaction((cur) => {
    const b = beslutt(cur);
    utfall = b.utfall;
    return b.utfall === "anvendt" ? b.node : cur;
  });
  return utfall;
};

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin-shopping-innlegging",
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

describe("ny rad uten treff (emulator, kald klient)", () => {
  it("tom liste: raden lagres på opId med kvittering; gjentak gir allerede, ingen ny rad", async () => {
    expect(await leggTil(nyPlan("op-1"))).toEqual({ utfall: "anvendt" });
    const n = await lesNode();
    expect(n!["op-1"]).toEqual({
      itemId: "v-melk",
      name: "Melk",
      amount: "1",
      cat: "Ost og meieri",
      done: false,
      id: "op-1",
    });
    expect(await leggTil(nyPlan("op-1"), true)).toEqual({ utfall: "allerede" });
    expect(stabil(await lesNode())).toBe(stabil(n));
  });

  it("annen vare, fullført rad og annen bekreftet vare med samme navn: ny rad, alt annet urørt", async () => {
    const foer = {
      _ops: OPS,
      f: { ...rad("f"), done: true, ukjent: { fra: "legacy" } },
      a: rad("a", { itemId: "v-annen" }),
      b: rad("b", { name: "Brød", itemId: "v-brod" }),
    };
    await settNode(foer);
    expect(await leggTil(nyPlan("op-2"))).toEqual({ utfall: "anvendt" });
    const n = await lesNode();
    expect(Object.keys(n!).sort()).toEqual(["_ops", KVITTERINGER, "a", "b", "f", "op-2"]);
    for (const k of ["_ops", "a", "b", "f"] as const) expect(stabil(n![k])).toBe(stabil(foer[k]));
  });

  it("varen ble lagt til av en annen klient etter visning: konflikt med treff, ingenting skrives", async () => {
    await settNode({ b: rad("b", { name: "Brød", itemId: "v-brod" }) });
    await admin.ref(`${STI}/x`).set(rad("x", { itemId: null, name: "melk" }));
    const foer = await lesNode();
    expect(await leggTil(nyPlan("op-3"))).toMatchObject({ utfall: "konflikt", treff: true });
    expect(stabil(await lesNode())).toBe(stabil(foer));
  });

  it("to klienter legger til samme vare samtidig: nøyaktig én rad, den andre får konflikt", async () => {
    await settNode({ b: rad("b", { name: "Brød", itemId: "v-brod" }) });
    const [klient, annen] = await Promise.all([
      leggTil(nyPlan("op-k")),
      adminTransaksjon((raw) => anvendNyRad(raw, nyPlan("op-a"))),
    ]);
    const utfall = [klient.utfall, annen].sort();
    expect(utfall).toEqual(["anvendt", "konflikt"]);
    const n = await lesNode();
    const melk = Object.entries(n!).filter(([k, v]) => !k.startsWith("_") && v.name === "Melk");
    expect(melk).toHaveLength(1);
  });

  it("gjentak uten kvittering er ubekreftet og skriver ingenting", async () => {
    await settNode({ b: rad("b", { name: "Brød", itemId: "v-brod" }) });
    const foer = await lesNode();
    expect(await leggTil(nyPlan("op-4"), true)).toMatchObject({ utfall: "ubekreftet" });
    expect(stabil(await lesNode())).toBe(stabil(foer));
  });

  it("raden fjernet på annen enhet etter lagring: gjentak gjenoppretter den ikke", async () => {
    expect(await leggTil(nyPlan("op-5"))).toEqual({ utfall: "anvendt" });
    await admin.ref(`${STI}/op-5`).remove();
    expect(await leggTil(nyPlan("op-5"), true)).toEqual({ utfall: "allerede" });
    expect((await lesNode())!["op-5"]).toBeUndefined();
  });
});

describe("«Øk antallet» (emulator, kald klient)", () => {
  const melk = rad("m", { amount: "2" });
  const lagret = {
    ...melk,
    ukjent: { fra: "legacy" },
    sammenslaing: { opId: "s1", foer: { name: "Melk" }, kilder: { k: { name: "Melk" } } },
  };

  it("øker bare mengden; andre felt, metadata og historikk bevares; gjentak øker ikke to ganger", async () => {
    const foer = { _ops: OPS, m: lagret, b: rad("b", { name: "Brød", itemId: "v-brod" }) };
    await settNode(foer);
    const p = okPlan(melk, "3", "op-o1");
    expect(await ok(p)).toEqual({ utfall: "anvendt" });
    const n = await lesNode();
    expect(stabil(n!.m)).toBe(stabil({ ...lagret, amount: "5" }));
    expect(stabil(n!._ops)).toBe(stabil(OPS));
    expect(stabil(n!.b)).toBe(stabil(foer.b));
    // Tapt svar → samme forsøk sendes på nytt: kvitteringen hindrer dobbel økning.
    expect(await ok(p, true)).toEqual({ utfall: "allerede" });
    expect(await ok(p)).toEqual({ utfall: "allerede" });
    expect((await lesNode())!.m!.amount).toBe("5");
  });

  const stale: [string, () => Promise<unknown>][] = [
    ["mengde endret", () => admin.ref(`${STI}/m/amount`).set("4")],
    ["huket av", () => admin.ref(`${STI}/m/done`).set(true)],
    ["fjernet", () => admin.ref(`${STI}/m`).remove()],
  ];
  for (const [navn, endre] of stale) {
    it(`målraden ${navn} på annen klient etter visning → konflikt, ingenting skrives`, async () => {
      await settNode({ m: lagret });
      const p = okPlan(melk, "1", `op-${navn}`);
      await endre();
      const foer = await lesNode();
      expect(await ok(p)).toMatchObject({ utfall: "konflikt" });
      expect(stabil(await lesNode())).toBe(stabil(foer));
    });
  }

  it("to klienter øker samme rad samtidig: nøyaktig én økning", async () => {
    await settNode({ m: lagret });
    const [klient, annen] = await Promise.all([
      ok(okPlan(melk, "1", "op-k")),
      adminTransaksjon((raw) => anvendOkning(raw, okPlan(melk, "1", "op-a"))),
    ]);
    expect([klient.utfall, annen].sort()).toEqual(["anvendt", "konflikt"]);
    expect((await lesNode())!.m!.amount).toBe("3");
  });
});
