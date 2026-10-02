/**
 * Datalag-/integrasjonstest mot en EKTE Firebase Emulator Suite-instans
 * (RTDB + Auth) — aldri produksjon eller en Hosting-forhåndsvisning.
 * Kjøres via `npm run test:integration`.
 *
 * Kvitteringsinnboksen (§Issue #34 R2) er kun lesing: datalaget leser
 * legacy sin array-form (også sparsom, og med base64-`imageUrl`) og har
 * ingen skrivefunksjoner (ADR 0002).
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  type Database as AdminDatabase,
  getDatabase as getAdminDatabase,
} from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KvitteringRecord } from "@app-types/forsoning";
import { getFirebaseAuth } from "./firebase";
import * as repo from "./forsoning.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
let adminApp: AdminApp;
let admin: AdminDatabase;

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "forsoning-it-admin",
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

afterAll(async () => {
  await admin.ref(`families/${FAMILY_ID}/receipts`).remove();
  await deleteApp(adminApp);
});

describe("forsoning.repository (emulator): kun lesing", () => {
  it("eksporterer kun subscribe-funksjoner", () => {
    expect(Object.keys(repo).sort()).toEqual([
      "subscribeHendelser",
      "subscribeKvitteringer",
      "subscribeTransaksjonRecords",
    ]);
  });

  it("leser legacy-array (indeksnøkler, sparsom) med base64-bilde, uten å endre noden", async () => {
    const legacyArray = {
      "0": { id: "k1", merchant: "Rema", total: 250 },
      "2": { id: "k2", imageUrl: "data:image/png;base64,AAAA", transactionId: "t1" },
      "3": { id: "k3", merchant: "Kiwi", forkastet: true },
    };
    await admin.ref(`families/${FAMILY_ID}/receipts`).set(legacyArray);
    const foer = (await admin.ref(`families/${FAMILY_ID}/receipts`).get()).val();

    const lest = await new Promise<KvitteringRecord[]>((resolve) => {
      const unsubscribe = repo.subscribeKvitteringer(FAMILY_ID, (liste) => {
        if (liste.length === 3) {
          unsubscribe();
          resolve(liste);
        }
      });
    });
    expect(lest.map((k) => k.id)).toEqual(["k1", "k2", "k3"]);
    expect(lest[1]).toMatchObject({ imageUrl: "data:image/png;base64,AAAA" });
    expect((await admin.ref(`families/${FAMILY_ID}/receipts`).get()).val()).toEqual(foer);
  });
});
