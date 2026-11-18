/**
 * Avgrenset ventetid i handlelistens SKRIVEFRIE kontroller etter uavklart
 * utfall (Mat #20, ordre 6966670122) — EKTE Firebase-emulator, syntetiske
 * data. `sjekkHandlelisteposter` (og `sjekkHandlelistepost` via den) og
 * `lesHandlelistestatus` leser handlelisten direkte, utenom den
 * versjonsbetingede kjernen. Før rettingen ventet de uten frist på token,
 * lesing og JSON, så kontrollen ble aldri ferdig og UI-låsen ble aldri
 * frigitt.
 *
 * En forespørsel som henger, simuleres ved at testens `fetch` holder svaret
 * til testen slipper det (uten å respektere avbruddet), slik et nett uten
 * svar gjør. Alle kall telles: kontrollene skal aldri sende PUT.
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
import { getFirebaseAuth } from "./firebase";
import {
  lesHandlelistestatus,
  sjekkHandlelistepost,
  sjekkHandlelisteposter,
} from "./shopping.repository";

const FAMILY_ID = "familie1";
const STI = `families/${FAMILY_ID}/shopping`;
const FRIST = { fristMs: 300 };

let adminApp: AdminApp;
let admin: AdminDatabase;

const NODE = () => ({
  ".priority": 1,
  m: { id: "m", name: "Melk", amount: "2", cat: "Ost og meieri", done: true, ".priority": 5 },
  _skriver: { av: "react", ".priority": 8 },
  _ops: { r1: { tool: "x", at: 1 } },
});
const eksport = async () => (await admin.ref(STI).get()).exportVal() as Record<string, unknown>;
const vent = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Port = "GET" | "JSON";
/**
 * Holder FØRSTE lesing mot `shopping` til `slipp()`. `"GET"`: selve
 * forespørselen henger og sendes senere uten avbruddssignal. `"JSON"`:
 * svaret kommer, men kroppen blir først lest når testen slipper den.
 * Teller alle kall mot `shopping`.
 */
function hengFoerste(port: Port) {
  const ekte = globalThis.fetch;
  let slipp: () => void = () => {};
  const aapen = new Promise<void>((r) => (slipp = r));
  let holdt = false;
  const kall: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const m = init?.method ?? "GET";
    if (!String(input).includes("/shopping.json")) return ekte(input, init);
    kall.push(m);
    if (holdt) return ekte(input, init);
    holdt = true;
    const uten: RequestInit = { ...init };
    delete uten.signal;
    if (port === "GET") {
      await aapen;
      return ekte(input, uten);
    }
    const res = await ekte(input, uten);
    const tekst = await res.text();
    const kropp = new ReadableStream<Uint8Array>({
      async start(c) {
        await aapen;
        c.enqueue(new TextEncoder().encode(tekst));
        c.close();
      },
    });
    return new Response(kropp, { status: res.status, headers: res.headers });
  });
  return { slipp: () => slipp(), kall };
}

/** Holder innloggingens token til `slipp()`. */
function hengToken() {
  const bruker = getFirebaseAuth().currentUser!;
  const ekte = bruker.getIdToken.bind(bruker);
  let slipp: () => void = () => {};
  const aapen = new Promise<void>((r) => (slipp = r));
  vi.spyOn(bruker, "getIdToken").mockImplementationOnce(async (f) => {
    await aapen;
    return ekte(f);
  });
  const kall: string[] = [];
  const ekteFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (String(input).includes("/shopping.json")) kall.push(init?.method ?? "GET");
    return ekteFetch(input, init);
  });
  return { slipp: () => slipp(), kall };
}

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-handleliste-skrivefri-frist",
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

describe("sjekkHandlelisteposter / sjekkHandlelistepost: frist (emulator)", () => {
  it.each<Port>(["GET", "JSON"])(
    "%s henger: `ikkeLest` etter fristen, sen respons gir ingen PUT, noden urørt; ny kontroll leser riktig",
    { timeout: 10_000 },
    async (port) => {
      await admin.ref(STI).set(NODE());
      const foer = await eksport();
      const h = hengFoerste(port);
      expect(await sjekkHandlelisteposter(FAMILY_ID, ["m", "x"], FRIST)).toEqual({
        utfall: "ikkeLest",
      });
      h.slipp();
      await vent(500);
      expect(h.kall).toEqual(["GET"]);
      expect(stabil(await eksport())).toBe(stabil(foer));

      // Ny, eksplisitt skrivefri kontroll (samme plan) etter fristen.
      expect(await sjekkHandlelisteposter(FAMILY_ID, ["m", "x"], FRIST)).toEqual({
        utfall: "lest",
        borte: ["x"],
        finnes: ["m"],
      });
      expect(h.kall).toEqual(["GET", "GET"]);
    },
  );

  it(
    "token henger: `ikkeLest` etter fristen, og et sent token starter ingen forespørsel",
    { timeout: 10_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const h = hengToken();
      expect(await sjekkHandlelisteposter(FAMILY_ID, ["m"], FRIST)).toEqual({
        utfall: "ikkeLest",
      });
      h.slipp();
      await vent(500);
      expect(h.kall).toEqual([]);
    },
  );

  it(
    "én rad («Fjern»): `ikkeLest` ved heng; deretter `finnes`/`borte` uten PUT",
    { timeout: 10_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const h = hengFoerste("GET");
      expect(await sjekkHandlelistepost(FAMILY_ID, "m", FRIST)).toEqual({ utfall: "ikkeLest" });
      h.slipp();
      await vent(500);
      expect(await sjekkHandlelistepost(FAMILY_ID, "m", FRIST)).toEqual({ utfall: "finnes" });
      expect(await sjekkHandlelistepost(FAMILY_ID, "x", FRIST)).toEqual({ utfall: "borte" });
      expect(h.kall).toEqual(["GET", "GET", "GET"]);
    },
  );
});

describe("lesHandlelistestatus: frist (emulator)", () => {
  it.each<Port>(["GET", "JSON"])(
    "%s henger: `ikkeLest` etter fristen; en sen respons blir aldri vurdert eller skrevet; ny kontroll vurderer fersk node",
    { timeout: 10_000 },
    async (port) => {
      await admin.ref(STI).set(NODE());
      const foer = await eksport();
      const vurder = vi.fn((node: unknown) => ({
        utfall: "lest" as const,
        done: (node as Record<string, { done?: unknown }>).m?.done,
      }));
      const h = hengFoerste(port);
      expect(await lesHandlelistestatus(FAMILY_ID, vurder, FRIST)).toEqual({ utfall: "ikkeLest" });
      h.slipp();
      await vent(500);
      expect(vurder).not.toHaveBeenCalled();
      expect(h.kall).toEqual(["GET"]);
      expect(stabil(await eksport())).toBe(stabil(foer));

      expect(await lesHandlelistestatus(FAMILY_ID, vurder, FRIST)).toEqual({
        utfall: "lest",
        done: true,
      });
      expect(vurder).toHaveBeenCalledTimes(1);
      expect(h.kall).toEqual(["GET", "GET"]);
    },
  );

  it(
    "token henger: `ikkeLest` etter fristen, og et sent token starter ingen forespørsel",
    { timeout: 10_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const vurder = vi.fn(() => ({ utfall: "lest" as const }));
      const h = hengToken();
      expect(await lesHandlelistestatus(FAMILY_ID, vurder, FRIST)).toEqual({ utfall: "ikkeLest" });
      h.slipp();
      await vent(500);
      expect(h.kall).toEqual([]);
      expect(vurder).not.toHaveBeenCalled();
    },
  );

  it(
    "uten heng: vellykket lesing gir vurderingen av fersk node; ingen PUT",
    { timeout: 10_000 },
    async () => {
      await admin.ref(STI).set(NODE());
      const h = hengToken();
      h.slipp();
      expect(
        await lesHandlelistestatus(FAMILY_ID, (node) => Object.keys(node as object).sort(), FRIST),
      ).toEqual(["_ops", "_skriver", "m"]);
      expect(h.kall).toEqual(["GET"]);
    },
  );
});
