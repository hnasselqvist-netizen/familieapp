/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en
 * Hosting-forhåndsvisning. Kjøres via `npm run test:integration`, som
 * starter emulatoren rundt denne kommandoen. Ikke en del av `npm test`.
 *
 * Firebase Admin SDK brukes KUN til å sette opp forutsetninger (en
 * innlogget testbruker som allerede er medlem av familien) —
 * akkurat som en ekte person ville blitt lagt inn i members-noden
 * manuelt (§arkitekturbeslutning, punkt 2) — ikke til å omgå det
 * selve testen skal verifisere. Selve lesingen/skrivingen i testene
 * går via de samme repository-funksjonene og den samme klient-SDK-en
 * appen bruker, og er dermed underlagt de ekte reglene i
 * infra/firebase/database.rules.json.
 */
import { randomUUID } from "node:crypto";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { signInWithCustomToken } from "firebase/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOrCreateItem, subscribeItems } from "./items.repository";
import { deleteFreezerItem, subscribeFreezer, writeFreezerItem } from "./freezer.repository";
import { getFirebaseAuth } from "./firebase";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin",
  );

  // Seed: én testbruker, allerede medlem av familien — speiler steget en
  // ekte bruker må gå gjennom manuelt (§overgangsplan, punkt 2) før
  // strengere regler kan stole på dem.
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await getAdminDatabase(adminApp).ref(`families/${FAMILY_ID}/members/${uid}`).set(true);

  const customToken = await getAdminAuth(adminApp).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), customToken);
});

afterAll(async () => {
  await getAdminDatabase(adminApp).ref(`families/${FAMILY_ID}`).remove();
  await deleteApp(adminApp);
});

describe("items.repository (emulator)", () => {
  it("oppretter en vare og gjør den lesbar for et abonnement", async () => {
    const name = `Karbonadedeig ${randomUUID()}`;
    const created = await findOrCreateItem(FAMILY_ID, name, "Kjøtt");
    expect(created?.name).toBe(name);

    const seen = await new Promise<boolean>((resolve) => {
      const unsubscribe = subscribeItems(FAMILY_ID, (items) => {
        if (items.some((i) => i.name === name)) {
          unsubscribe();
          resolve(true);
        }
      });
    });
    expect(seen).toBe(true);
  });

  it("finner (ikke duplikatoppretter) en vare som finnes fra før, case-insensitivt", async () => {
    const name = `Ost ${randomUUID()}`;
    const first = await findOrCreateItem(FAMILY_ID, name, "Ost og meieri");
    const second = await findOrCreateItem(FAMILY_ID, name.toUpperCase(), "Ost og meieri");
    expect(second?.id).toBe(first?.id);
  });
});

describe("freezer.repository (emulator)", () => {
  it("skriver og fjerner én fryserpost via sin egen node", async () => {
    const itemId = randomUUID();
    await writeFreezerItem(FAMILY_ID, {
      id: itemId,
      itemId: "vare-1",
      name: "Test-fryservare",
      batches: [{ id: randomUUID(), count: 2, unit: "pk", gramsPerUnit: 500 }],
    });

    const afterWrite = await new Promise<boolean>((resolve) => {
      const unsubscribe = subscribeFreezer(FAMILY_ID, (items) => {
        if (items.some((i) => i.id === itemId)) {
          unsubscribe();
          resolve(true);
        }
      });
    });
    expect(afterWrite).toBe(true);

    await deleteFreezerItem(FAMILY_ID, itemId);

    const afterDelete = await new Promise<boolean>((resolve) => {
      const unsubscribe = subscribeFreezer(FAMILY_ID, (items) => {
        if (!items.some((i) => i.id === itemId)) {
          unsubscribe();
          resolve(true);
        }
      });
    });
    expect(afterDelete).toBe(true);
  });
});
