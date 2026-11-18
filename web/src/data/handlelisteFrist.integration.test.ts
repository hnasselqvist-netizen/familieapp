/**
 * Avgrenset ventetid i den felles versjonsbetingede skriveveien for
 * handlelisten (Mat #20, ordre 6963830236) — EKTE Firebase-emulator,
 * syntetiske data. Kjernen (`kjorVersjonert`) testes gjennom generatorens
 * faktiske sammensetning (`skrivHandlelisteVersjonert` + `anvendGeneratorPlan`,
 * som `useShoppingList.leggTilFraGenerator`).
 *
 * En forespørsel som henger, simuleres ved at testens `fetch` holder svaret
 * til testen slipper det (uten å respektere avbruddet), slik et nett uten svar
 * gjør. Før rettingen ventet kjernen uten frist, så kallet ble aldri ferdig og
 * generatorens innsendingslås ble aldri frigitt.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  type Database as AdminDatabase,
  getDatabase as getAdminDatabase,
} from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { stabil } from "@domain/shopping/handlelisteDuplikater";
import {
  type GeneratorPlan,
  anvendGeneratorPlan,
  lagGeneratorPlan,
} from "@domain/shopping/handlelisteGenerator";
import { KVITTERINGER } from "@domain/shopping/handlelisteInnlegging";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import { skrivHandlelisteVersjonert } from "./shopping.repository";

const FAMILY_ID = "familie1";
const STI = `families/${FAMILY_ID}/shopping`;
const FRIST = { fristMs: 300 };

let adminApp: AdminApp;
let admin: AdminDatabase;

const MELK = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};
const NODE = () => ({
  ".priority": 1,
  m: { ...MELK, ".priority": 5 },
  _skriver: { av: "react", ".priority": 8 },
  _ops: { r1: { tool: "x", at: 1 } },
});
const LISTE: ShoppingItem[] = [MELK];
const NYE: ShoppingListEntry[] = [
  { itemId: "v-melk", name: "Melk", amount: "3", cat: "Ost og meieri", done: false },
  { itemId: "v-egg", name: "Egg", amount: "6", cat: "Ost og meieri", done: false },
];
const plan = (opId: string) => lagGeneratorPlan(LISTE, NYE, opId);
/** Samme sammensetning som `useShoppingList.leggTilFraGenerator`, med kort frist. */
const leggTil = (p: GeneratorPlan, gjentak = false) =>
  skrivHandlelisteVersjonert(
    FAMILY_ID,
    KVITTERINGER,
    (raw) => anvendGeneratorPlan(raw, p, gjentak),
    FRIST,
  );
const eksport = async () => (await admin.ref(STI).get()).exportVal() as Record<string, unknown>;
const lesNode = async () =>
  (await admin.ref(STI).get()).val() as Record<string, Record<string, unknown>>;
const egg = (n: Record<string, Record<string, unknown>>) =>
  Object.values(n).filter((r) => r?.name === "Egg");
const vent = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Holder FØRSTE `metode`-forespørsel mot `shopping` til `slipp()`; da sendes
 * den uendret (uten avbruddssignal) til emulatoren. Teller alle kall.
 */
function hengFoerste(metode: "GET" | "PUT") {
  const ekte = globalThis.fetch;
  let slipp: () => void = () => {};
  const port = new Promise<void>((r) => (slipp = r));
  let holdt = false;
  const kall: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const m = init?.method ?? "GET";
    if (!String(input).includes("/shopping.json")) return ekte(input, init);
    kall.push(m);
    if (!holdt && m === metode) {
      holdt = true;
      await port;
      // Sendes uten avbruddssignal: slik et svar som kommer etter fristen.
      const uten: RequestInit = { ...init };
      delete uten.signal;
      return ekte(input, uten);
    }
    return ekte(input, init);
  });
  return { slipp: () => slipp(), kall };
}

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-handleliste-frist",
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

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await admin.ref(`families/${FAMILY_ID}`).remove();
  await deleteApp(adminApp);
});

describe("avgrenset ventetid i kjorVersjonert (emulator)", () => {
  it(
    "lesingen henger: `ikkeLest` etter fristen; en sen lesing starter ingen PUT, noden er urørt",
    { timeout: 10_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const foer = await eksport();
      const h = hengFoerste("GET");
      expect(await leggTil(plan("op-frist-les"))).toEqual({ utfall: "ikkeLest" });
      h.slipp();
      await vent(500);
      expect(h.kall.filter((k) => k === "PUT")).toHaveLength(0);
      expect(stabil(await eksport())).toBe(stabil(foer));
    },
  );

  it(
    "PUT er sendt og henger: `ukjent`; serveren lagrer senere; skrivefritt gjentak av samme kvittering gir `allerede`, ingen dobling",
    { timeout: 10_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const p = plan("op-frist-skriv");
      const h = hengFoerste("PUT");
      expect(await leggTil(p)).toEqual({ utfall: "ukjent" });
      expect(h.kall).toEqual(["GET", "PUT"]); // ingen automatisk ny mutasjon
      // Den hengende PUT-en når serveren etter fristen (sent serverutfall).
      h.slipp();
      await vi.waitFor(async () => expect((await lesNode()).m!.amount).toBe("5"));
      const lagret = await eksport();
      expect(egg(await lesNode())).toHaveLength(1);
      vi.restoreAllMocks();

      // «Prøv igjen»: samme plan og opId, skrivefri kontroll mot kvitteringen.
      const g = hengFoerste("PUT"); // teller bare; ingen PUT forventes
      expect(await leggTil(p, true)).toEqual({ utfall: "allerede" });
      expect(g.kall).toEqual(["GET"]);
      expect(stabil(await eksport())).toBe(stabil(lagret));
      expect(egg(await lesNode())).toHaveLength(1);
      expect((await lesNode()).m!.amount).toBe("5");
    },
  );

  it(
    "uten heng: atomisk skriving med kvittering, prioritet, markør og MCP-metadata bevart",
    { timeout: 10_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      expect(await leggTil(plan("op-frist-ok"))).toEqual({ utfall: "anvendt" });
      const e = await eksport();
      expect(e[".priority"]).toBe(1);
      expect((e.m as Record<string, unknown>)[".priority"]).toBe(5);
      expect(e._skriver).toEqual({ av: "react", ".priority": 8 });
      expect(e._ops).toEqual({ r1: { tool: "x", at: 1 } });
      expect(egg(await lesNode())).toHaveLength(1);
    },
  );
});
