/**
 * Handlelistens felles versjonsbetingede skrivevei (`kjorVersjonert`) bundet
 * til innloggingen som startet forsøket (Mat #20, ordre 6979672219; som
 * Kokebokens #178 og Middagsbibliotekets #179) — EKTE Firebase-emulator,
 * syntetiske data. Kjernen testes gjennom generatorens faktiske sammensetning
 * (`skrivHandlelisteVersjonert` + `anvendGeneratorPlan`, som
 * `useShoppingList.leggTilFraGenerator`).
 *
 * Før rettingen leste `handlelisteRest` `currentUser` på nytt for hver GET og
 * PUT: ble kontoen byttet (eller avsluttet) mens forsøket pågikk, kunne PUT-en
 * sendes på vegne av en annen sesjon.
 *
 * To syntetiske medlemmer A og B i samme familie. Alle REST-kall mot
 * `shopping` telles.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken, signOut } from "firebase/auth";
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
/** Lang nok frist til at sesjonsbyttet skjer før den, så utfallet viser byttet. */
const LANG = { fristMs: 8_000 };

let adminApp: AdminApp;
let admin: AdminDatabase;
let tokenA = "";
let tokenB = "";
const somA = async () => signInWithCustomToken(getFirebaseAuth(), tokenA);

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
/** Samme sammensetning som `useShoppingList.leggTilFraGenerator`. */
const leggTil = (p: GeneratorPlan) =>
  skrivHandlelisteVersjonert(
    FAMILY_ID,
    KVITTERINGER,
    (raw) => anvendGeneratorPlan(raw, p, false),
    LANG,
  );
const eksport = async () => (await admin.ref(STI).get()).exportVal() as Record<string, unknown>;

/**
 * Teller REST-kall mot `shopping`. `hengGet` holder første GET til `slipp()`
 * (sendes da uten avbruddssignal). `etterPut` kjøres med svaret på første PUT
 * før det leveres til kjernen; `foerPut` kjøres før første PUT sendes.
 */
function rest(
  valg: {
    hengGet?: boolean;
    foerPut?: () => Promise<void>;
    etterPut?: (res: Response) => Promise<void>;
  } = {},
) {
  const ekte = globalThis.fetch;
  const kall: string[] = [];
  let slipp: () => void = () => {};
  const port = new Promise<void>((r) => (slipp = r));
  let getHoldt = false;
  let putSett = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (!String(input).includes("/shopping.json")) return ekte(input, init);
    const m = init?.method ?? "GET";
    kall.push(m);
    if (m === "GET" && valg.hengGet && !getHoldt) {
      getHoldt = true;
      await port;
      const uten: RequestInit = { ...init };
      delete uten.signal;
      return ekte(input, uten);
    }
    if (m === "PUT" && !putSett) {
      putSett = true;
      await valg.foerPut?.();
      const res = await ekte(input, init);
      await valg.etterPut?.(res);
      return res;
    }
    return ekte(input, init);
  });
  return { kall, slipp: () => slipp() };
}

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-handleliste-sesjon",
  );
  admin = getAdminDatabase(adminApp);
  // To syntetiske medlemmer av samme familie: A starter handlingen, B overtar sesjonen.
  for (const hvem of ["A", "B"] as const) {
    const uid = `test-${hvem}-${randomUUID()}`;
    await getAdminAuth(adminApp).createUser({ uid });
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
    const t = await getAdminAuth(adminApp).createCustomToken(uid);
    if (hvem === "A") tokenA = t;
    else tokenB = t;
  }
  await somA();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await somA();
});

afterAll(async () => {
  await admin.ref(`families/${FAMILY_ID}`).remove();
  await deleteApp(adminApp);
});

describe("kjorVersjonert: bundet til innloggingen som startet forsøket (emulator)", () => {
  it(
    "A starter, sesjonen byttes til B mens GET står ute: `byttet`, ingen PUT, noden står byte for byte",
    { timeout: 15_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const foer = await eksport();
      const r = rest({ hengGet: true });
      const forsok = leggTil(plan("op-sesjon-get"));
      await vi.waitFor(() => expect(r.kall).toEqual(["GET"]));
      await signInWithCustomToken(getFirebaseAuth(), tokenB);
      r.slipp();
      expect(await forsok).toEqual({ utfall: "byttet" });
      expect(r.kall).toEqual(["GET"]);
      expect(stabil(await eksport())).toBe(stabil(foer));
    },
  );

  it(
    "utlogging mens tokenet til PUT hentes: `byttet`, ingen PUT, noden står byte for byte",
    { timeout: 15_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const foer = await eksport();
      const r = rest();
      const bruker = getFirebaseAuth().currentUser!;
      const ekte = bruker.getIdToken.bind(bruker);
      let slipp: () => void = () => {};
      const port = new Promise<void>((res) => (slipp = res));
      let n = 0;
      let putTokenBedt = false;
      vi.spyOn(bruker, "getIdToken").mockImplementation(async (f) => {
        n += 1;
        if (n === 2) {
          // Tokenet til PUT: venter til testen har logget ut.
          putTokenBedt = true;
          await port;
        }
        return ekte(f);
      });
      const forsok = leggTil(plan("op-sesjon-utlogging"));
      await vi.waitFor(() => expect(putTokenBedt).toBe(true));
      await signOut(getFirebaseAuth());
      slipp();
      expect(await forsok).toEqual({ utfall: "byttet" });
      expect(r.kall).toEqual(["GET"]);
      expect(stabil(await eksport())).toBe(stabil(foer));
    },
  );

  it(
    "ny innlogging som samme bruker (ny sesjon) mens GET står ute: også stoppet, ingen PUT",
    { timeout: 15_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const foer = await eksport();
      const r = rest({ hengGet: true });
      const forsok = leggTil(plan("op-sesjon-ny"));
      await vi.waitFor(() => expect(r.kall).toEqual(["GET"]));
      await signOut(getFirebaseAuth());
      await somA();
      r.slipp();
      expect(await forsok).toEqual({ utfall: "byttet" });
      expect(r.kall).toEqual(["GET"]);
      expect(stabil(await eksport())).toBe(stabil(foer));
    },
  );

  it(
    "sesjonsbytte etter 412, før ny runde: `byttet`, ingen ny GET/PUT; den samtidige endringen står",
    { timeout: 15_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const r = rest({
        // En annen klient endrer mellom GET og PUT: PUT-en avvises med 412.
        foerPut: () => admin.ref(`${STI}/m/amount`).set("9"),
        // Mens 412-svaret er på vei, byttes sesjonen til B.
        etterPut: async (res) => {
          expect(res.status).toBe(412);
          await signInWithCustomToken(getFirebaseAuth(), tokenB);
        },
      });
      const etterEndring = { ...NODE(), m: { ...NODE().m, amount: "9" } };
      expect(await leggTil(plan("op-sesjon-412"))).toEqual({ utfall: "byttet" });
      expect(r.kall).toEqual(["GET", "PUT"]);
      expect(stabil(await eksport())).toBe(stabil(etterEndring));
    },
  );

  it(
    "uten bytte: én GET og én PUT, anvendt; prioriteter og metadata bevart",
    { timeout: 15_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const r = rest();
      expect(await leggTil(plan("op-sesjon-ok"))).toEqual({ utfall: "anvendt" });
      expect(r.kall).toEqual(["GET", "PUT"]);
      const e = await eksport();
      expect(e[".priority"]).toBe(1);
      expect((e.m as Record<string, unknown>)[".priority"]).toBe(5);
      expect(e._skriver).toEqual({ av: "react", ".priority": 8 });
    },
  );
});
