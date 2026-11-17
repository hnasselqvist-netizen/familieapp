/**
 * «Fjern» på en basisvare i Matlager (Mat #20, ordre 6948538722) — EKTE
 * Firebase-emulator, syntetiske nøkler, ingen mock av databasen.
 *
 * Klient A er appens SDK/REST og bruker samme sammensetning som
 * `useStaples.fjernBasisvare`: eksakt lagret nøkkel →
 * `fjernBasisvareVersjonert` + `vurderBasisvareFjerning`. «Den andre
 * klienten» (B) er Admin SDK.
 *
 * Før rettingen var fjerningen et ubetinget `remove()`: A så `melk: true`,
 * B byttet verdien til et objekt med råfelt, og A sin forsinkede fjerning
 * slettet objektet (reprodusert på `df38a83`).
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { vurderBasisvareFjerning } from "@domain/shopping/basisvareFjerning";
import { getFirebaseAuth } from "./firebase";
import { fjernBasisvareVersjonert, subscribeStaples } from "./staples.repository";

const FAMILY_ID = "familie1";
const STI = `families/${FAMILY_ID}/staples`;

let adminApp: AdminApp;
let uid: string;
const b = () => getAdminDatabase(adminApp);
const fjern = (nokkel: string) =>
  fjernBasisvareVersjonert(FAMILY_ID, nokkel, vurderBasisvareFjerning);

/** Hele `staples` i eksportform (med prioritet), via Admin SDK. */
const eksport = async () => (await b().ref(STI).get()).exportVal() as unknown;

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-staples-fjern",
  );
  uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await b().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  const token = await getAdminAuth(adminApp).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), token);
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await b().ref(`families/${FAMILY_ID}`).remove();
  await deleteApp(adminApp);
});

describe("fjernBasisvareVersjonert (emulator)", () => {
  it("vanlig fjerning: bare `true` på eksakt nøkkel slettes; øvrige nøkler og råfelt står", async () => {
    await b()
      .ref(STI)
      .set({ melk: true, salt: true, rar: { x: 1 } });
    expect(await fjern("melk")).toEqual({ utfall: "fjernet" });
    expect(await eksport()).toEqual({ salt: true, rar: { x: 1 } });
  });

  it("A ser `true`, B bytter til objekt med råfelt, A sin forsinkede fjerning: objektet står (`erstattet`)", async () => {
    await b().ref(STI).set({ melk: true, salt: true });
    let sett: Record<string, unknown> = {};
    const av = subscribeStaples(FAMILY_ID, (s) => (sett = s));
    await vi.waitFor(() => expect(sett.melk).toBe(true));
    await b().ref(`${STI}/melk`).set({ ukjent: "råfelt", n: 2 });

    expect(await fjern("melk")).toEqual({ utfall: "erstattet" });
    av();
    expect(await eksport()).toEqual({ melk: { ukjent: "råfelt", n: 2 }, salt: true });
  });

  it("B bytter verdien MELLOM A sin lesing og sletting: if-match avviser, ny runde ser objektet, ingenting slettes", async () => {
    await b().ref(STI).set({ melk: true, salt: true });
    const ekte = globalThis.fetch;
    let byttet = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const res = await ekte(input, init);
      if (!byttet && (init?.method ?? "GET") === "GET" && String(input).includes("/staples/")) {
        byttet = true;
        await b().ref(`${STI}/melk`).set({ ukjent: "råfelt" });
      }
      return res;
    });
    expect(await fjern("melk")).toEqual({ utfall: "erstattet" });
    expect(byttet).toBe(true);
    expect(await eksport()).toEqual({ melk: { ukjent: "råfelt" }, salt: true });
  });

  it("allerede borte: skrivefritt, idempotent utfall; noden er uendret", async () => {
    await b()
      .ref(STI)
      .set({ salt: true, rar: { x: 1 } });
    const put = vi.spyOn(globalThis, "fetch");
    expect(await fjern("melk")).toEqual({ utfall: "borte" });
    expect(put.mock.calls.filter(([, i]) => i?.method === "PUT")).toHaveLength(0);
    expect(await eksport()).toEqual({ salt: true, rar: { x: 1 } });
  });

  it("uventet verdi (`false`, tekst, `true` med prioritet) står urørt", async () => {
    await b()
      .ref(STI)
      .set({ a: false, b: "ja", c: { ".value": true, ".priority": 1 }, salt: true });
    for (const k of ["a", "b", "c"]) expect(await fjern(k), k).toEqual({ utfall: "erstattet" });
    expect(await eksport()).toEqual({
      a: false,
      b: "ja",
      c: { ".value": true, ".priority": 1 },
      salt: true,
    });
  });

  it("den faktiske lagrede nøkkelen brukes eksakt: ingen små bokstaver, ingen URL-dekoding", async () => {
    await b().ref(STI).set({ "Crème Fraîche": true, "crème fraîche": true, "%41": true, A: true });
    expect(await fjern("Crème Fraîche")).toEqual({ utfall: "fjernet" });
    expect(await fjern("%41")).toEqual({ utfall: "fjernet" });
    expect(await eksport()).toEqual({ "crème fraîche": true, A: true });
  });

  it("avvist lagring (ikke medlem): `avvist`, ingenting endret", async () => {
    await b().ref(STI).set({ melk: true });
    await b().ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    try {
      expect(await fjern("melk")).toEqual({ utfall: "avvist" });
      expect(await eksport()).toEqual({ melk: true });
    } finally {
      await b().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
    }
  });
});
