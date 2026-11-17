/**
 * «Merk som basisvare» i React (Mat #20, ordre 6953147250) — EKTE
 * Firebase-emulator, syntetiske nøkler, ingen mock av databasen.
 *
 * Klient A bruker samme sammensetning som `useStaples.markAsStaple`:
 * normalisert nøkkel → `merkBasisvareVersjonert` + `vurderBasisvareMerking`.
 * «Den andre klienten» (B) er Admin SDK.
 *
 * Før rettingen var merkingen et ubetinget `set(true)`: en eksisterende
 * råverdi (`{ukjent: "råfelt"}`) og en `true` med prioritet ble begge
 * overskrevet med `true` (reprodusert på `4755d9a`).
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { vurderBasisvareMerking } from "@domain/shopping/basisvareMerking";
import { getFirebaseAuth } from "./firebase";
import { merkBasisvareVersjonert } from "./staples.repository";

const FAMILY_ID = "familie1";
const STI = `families/${FAMILY_ID}/staples`;

let adminApp: AdminApp;
let uid: string;
const b = () => getAdminDatabase(adminApp);
const merk = (nokkel: string) => merkBasisvareVersjonert(FAMILY_ID, nokkel, vurderBasisvareMerking);
const eksport = async () => (await b().ref(STI).get()).exportVal() as unknown;
const putKall = (spion: { mock: { calls: unknown[][] } }) =>
  spion.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === "PUT");

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-staples-merk",
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

describe("merkBasisvareVersjonert (emulator)", () => {
  it("ordinær oppretting: `true` opprettes bare på målnøkkelen; øvrige nøkler og råfelt står", async () => {
    await b()
      .ref(STI)
      .set({ salt: true, rar: { x: 1 } });
    expect(await merk("melk")).toEqual({ utfall: "merket" });
    expect(await eksport()).toEqual({ salt: true, rar: { x: 1 }, melk: true });
  });

  it("eksisterende `true` med prioritet: skrivefritt `allerede`, prioriteten står", async () => {
    await b()
      .ref(STI)
      .set({ salt: { ".value": true, ".priority": 3 }, melk: true });
    const spion = vi.spyOn(globalThis, "fetch");
    expect(await merk("salt")).toEqual({ utfall: "allerede" });
    expect(await merk("melk")).toEqual({ utfall: "allerede" });
    expect(putKall(spion)).toHaveLength(0);
    expect(await eksport()).toEqual({ salt: { ".value": true, ".priority": 3 }, melk: true });
  });

  it("ukjent råverdi: `konflikt`, ingenting overskrives (reproduksjonen)", async () => {
    await b()
      .ref(STI)
      .set({ melk: { ukjent: "råfelt" }, av: false, tekst: "ja" });
    const spion = vi.spyOn(globalThis, "fetch");
    for (const k of ["melk", "av", "tekst"])
      expect(await merk(k), k).toEqual({ utfall: "konflikt" });
    expect(putKall(spion)).toHaveLength(0);
    expect(await eksport()).toEqual({ melk: { ukjent: "råfelt" }, av: false, tekst: "ja" });
  });

  it("samtidig endring: B oppretter en annen verdi MELLOM A sin lesing og skriving — B sin verdi står", async () => {
    await b().ref(STI).set({ salt: true });
    const ekte = globalThis.fetch;
    let opprettet = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const res = await ekte(input, init);
      if (!opprettet && (init?.method ?? "GET") === "GET" && String(input).includes("/staples/")) {
        opprettet = true;
        await b().ref(`${STI}/melk`).set({ ukjent: "fra B" });
      }
      return res;
    });
    expect(await merk("melk")).toEqual({ utfall: "konflikt" });
    expect(opprettet).toBe(true);
    expect(await eksport()).toEqual({ salt: true, melk: { ukjent: "fra B" } });
  });

  it("samtidig endring: B merker `true` med prioritet mellom lesing og skriving — `allerede`, prioriteten står", async () => {
    await b().ref(STI).set({ salt: true });
    const ekte = globalThis.fetch;
    let opprettet = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const res = await ekte(input, init);
      if (!opprettet && (init?.method ?? "GET") === "GET" && String(input).includes("/staples/")) {
        opprettet = true;
        await b().ref(`${STI}/melk`).setWithPriority(true, 7);
      }
      return res;
    });
    expect(await merk("melk")).toEqual({ utfall: "allerede" });
    expect(await eksport()).toEqual({ salt: true, melk: { ".value": true, ".priority": 7 } });
  });

  it("avvist lagring (ikke medlem): `avvist`, ingenting endret", async () => {
    await b().ref(STI).set({ salt: true });
    await b().ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    try {
      expect(await merk("melk")).toEqual({ utfall: "avvist" });
      expect(await eksport()).toEqual({ salt: true });
    } finally {
      await b().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
    }
  });
});
