/**
 * Avgrenset ventetid for versjonsbetinget merking og fjerning av basisvarer
 * i React (Mat #20, ordre 6962110764) — EKTE Firebase-emulator, syntetiske
 * nøkler. En forespørsel som henger, simuleres ved at testens `fetch` holder
 * svaret til testen slipper det (uten å respektere avbruddet), slik et nett
 * uten svar gjør.
 *
 * Før rettingen ventet den felles ETag-kjernen uten frist på token, lesing og
 * skriving, så kallet ble aldri ferdig (og UI-låsene ble aldri frigitt).
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { vurderBasisvareFjerning } from "@domain/shopping/basisvareFjerning";
import { vurderBasisvareMerking } from "@domain/shopping/basisvareMerking";
import { getFirebaseAuth } from "./firebase";
import { fjernBasisvareVersjonert, merkBasisvareVersjonert } from "./staples.repository";

const FAMILY_ID = "familie1";
const STI = `families/${FAMILY_ID}/staples`;
const FRIST = { fristMs: 300 };

let adminApp: AdminApp;
const b = () => getAdminDatabase(adminApp);
const eksport = async () => (await b().ref(STI).get()).exportVal() as unknown;
const vent = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-staples-frist",
  );
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await b().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  await signInWithCustomToken(
    getFirebaseAuth(),
    await getAdminAuth(adminApp).createCustomToken(uid),
  );
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await b().ref(`families/${FAMILY_ID}`).remove();
  await deleteApp(adminApp);
});

/**
 * Holder FØRSTE `metode`-forespørsel mot `staples/` til `slipp()`; da sendes
 * den uendret (uten avbruddssignal) til emulatoren. Teller alle PUT-er.
 */
function hengFoerste(metode: "GET" | "PUT") {
  const ekte = globalThis.fetch;
  let slipp: () => void = () => {};
  const port = new Promise<void>((r) => (slipp = r));
  let holdt = false;
  const puts: string[] = [];
  let sendtPut = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const m = init?.method ?? "GET";
    const url = String(input);
    if (!url.includes("/staples/")) return ekte(input, init);
    if (m === "PUT") puts.push(url);
    if (!holdt && m === metode) {
      holdt = true;
      if (m === "PUT") sendtPut = true;
      await port;
      // Sendes uten avbruddssignal: slik et svar som kommer etter fristen.
      const uten: RequestInit = { ...init };
      delete uten.signal;
      return ekte(input, uten);
    }
    return ekte(input, init);
  });
  return { slipp: () => slipp(), puts, harSendtPut: () => sendtPut };
}

describe("avgrenset ventetid (emulator)", () => {
  it(
    "merking, lesingen henger: `ikkeLest` etter fristen, og en sen lesing starter ingen PUT",
    { timeout: 10_000 },
    async () => {
      await b().ref(STI).set({ salt: true });
      const h = hengFoerste("GET");
      expect(
        await merkBasisvareVersjonert(FAMILY_ID, "melk", vurderBasisvareMerking, FRIST),
      ).toEqual({
        utfall: "ikkeLest",
      });
      h.slipp();
      await vent(500);
      expect(h.puts).toHaveLength(0);
      expect(await eksport()).toEqual({ salt: true });
    },
  );

  it(
    "merking, skrivingen henger: `ukjent` etter fristen; nytt eksplisitt forsøk leser fersk verdi",
    { timeout: 10_000 },
    async () => {
      await b().ref(STI).set({ salt: true });
      const h = hengFoerste("PUT");
      expect(
        await merkBasisvareVersjonert(FAMILY_ID, "melk", vurderBasisvareMerking, FRIST),
      ).toEqual({
        utfall: "ukjent",
      });
      expect(h.harSendtPut()).toBe(true);
      // Den hengende PUT-en når serveren senere (kan ha blitt lagret).
      h.slipp();
      await vi.waitFor(async () => expect(await eksport()).toEqual({ salt: true, melk: true }));
      vi.restoreAllMocks();
      expect(
        await merkBasisvareVersjonert(FAMILY_ID, "melk", vurderBasisvareMerking, FRIST),
      ).toEqual({
        utfall: "allerede",
      });
    },
  );

  it(
    "fjerning, lesingen henger: `ikkeLest` etter fristen, og en sen lesing starter ingen PUT",
    { timeout: 10_000 },
    async () => {
      await b().ref(STI).set({ melk: true, salt: true });
      const h = hengFoerste("GET");
      expect(
        await fjernBasisvareVersjonert(FAMILY_ID, "melk", vurderBasisvareFjerning, FRIST),
      ).toEqual({
        utfall: "ikkeLest",
      });
      h.slipp();
      await vent(500);
      expect(h.puts).toHaveLength(0);
      expect(await eksport()).toEqual({ melk: true, salt: true });
    },
  );

  it(
    "fjerning, skrivingen henger: `ukjent` etter fristen; nytt eksplisitt forsøk gir `borte`",
    { timeout: 10_000 },
    async () => {
      await b().ref(STI).set({ melk: true, salt: true });
      const h = hengFoerste("PUT");
      expect(
        await fjernBasisvareVersjonert(FAMILY_ID, "melk", vurderBasisvareFjerning, FRIST),
      ).toEqual({
        utfall: "ukjent",
      });
      h.slipp();
      await vi.waitFor(async () => expect(await eksport()).toEqual({ salt: true }));
      vi.restoreAllMocks();
      expect(
        await fjernBasisvareVersjonert(FAMILY_ID, "melk", vurderBasisvareFjerning, FRIST),
      ).toEqual({
        utfall: "borte",
      });
    },
  );

  it(
    "uten heng: samtidighetsvernet (412 → ny lesing) og råverdier står som før",
    { timeout: 10_000 },
    async () => {
      await b()
        .ref(STI)
        .set({ salt: { ".value": true, ".priority": 3 }, rar: { x: 1 } });
      expect(
        await merkBasisvareVersjonert(FAMILY_ID, "salt", vurderBasisvareMerking, FRIST),
      ).toEqual({
        utfall: "allerede",
      });
      expect(
        await merkBasisvareVersjonert(FAMILY_ID, "rar", vurderBasisvareMerking, FRIST),
      ).toEqual({
        utfall: "konflikt",
      });
      expect(
        await fjernBasisvareVersjonert(FAMILY_ID, "rar", vurderBasisvareFjerning, FRIST),
      ).toEqual({
        utfall: "erstattet",
      });
      expect(await eksport()).toEqual({ salt: { ".value": true, ".priority": 3 }, rar: { x: 1 } });
    },
  );
});
