/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en
 * Hosting-forhåndsvisning. Kjøres via `npm run test:integration`, som
 * starter emulatoren rundt denne kommandoen. Ikke en del av `npm test`.
 *
 * Firebase Admin SDK brukes KUN til å sette opp forutsetninger (en
 * innlogget testbruker som allerede er medlem av familien, og — i
 * security-testene under — en som bevisst IKKE er det) — akkurat som en
 * ekte person ville blitt lagt inn i (eller utelatt fra) members-noden
 * manuelt (§arkitekturbeslutning, punkt 2) — ikke til å omgå det selve
 * testen skal verifisere. Selve lesingen/skrivingen i testene går via de
 * samme repository-funksjonene og den samme klient-SDK-en appen bruker,
 * og er dermed underlagt de ekte reglene i
 * infra/firebase/database.rules.json.
 */
import { randomUUID } from "node:crypto";
import { deleteApp as deleteClientApp, initializeApp as initializeClientApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth as getClientAuth,
  signInWithCustomToken,
} from "firebase/auth";
import {
  connectDatabaseEmulator,
  get,
  getDatabase as getClientDatabase,
  ref,
  set,
} from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findOrCreateItem, subscribeItems } from "./items.repository";
import { deleteFreezerItem, subscribeFreezer, transactFreezerItem } from "./freezer.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { FreezerItemFields } from "@app-types/freezer";

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
    await transactFreezerItem(FAMILY_ID, itemId, () => ({
      itemId: "vare-1",
      name: "Test-fryservare",
      batches: [{ id: randomUUID(), count: 2, unit: "pk", gramsPerUnit: 500 }],
    }));

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

  it("to konkurrerende oppdateringer av SAMME post mister ikke data (§Kontrolltårn-review)", async () => {
    // Speiler nøyaktig risikoen som ble påpekt: to raske "+1"-operasjoner
    // på samme batch, uten noen ventetid mellom dem — akkurat som to
    // raske klikk før React-tilstanden har rukket å oppdateres fra
    // Firebase. Testen bruker en bevisst enkel, inline updater (ikke
    // domenefunksjonene) — det som verifiseres her er at
    // `transactFreezerItem` selv garanterer atomisk les-endre-skriv, ikke
    // at domenelogikken er riktig (det dekker freezer.test.ts).
    const itemId = randomUUID();
    const batchId = randomUUID();

    await transactFreezerItem(FAMILY_ID, itemId, () => ({
      itemId: "vare-race",
      name: "Racetest",
      batches: [{ id: batchId, count: 0, unit: "stk", gramsPerUnit: null }],
    }));

    const incrementByOne = (current: FreezerItemFields | null): FreezerItemFields | null => {
      if (!current) return null;
      return {
        ...current,
        batches: current.batches.map((b) => (b.id === batchId ? { ...b, count: b.count + 1 } : b)),
      };
    };

    await Promise.all([
      transactFreezerItem(FAMILY_ID, itemId, incrementByOne),
      transactFreezerItem(FAMILY_ID, itemId, incrementByOne),
    ]);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/freezer/${itemId}`),
    );
    const finalCount = (snapshot.val() as FreezerItemFields).batches.find(
      (b) => b.id === batchId,
    )?.count;
    // Uten transaksjon (et ubetinget set() basert på lokal state) ville
    // begge kallene ofte lest samme utgangspunkt (count 0) og endt på 1,
    // ikke 2 — den tapte oppdateringen dette skal bevise er løst.
    expect(finalCount).toBe(2);
  });
});

describe("security rules (emulator): medlemskap håndheves", () => {
  it("nekter lesing og skriving for en autentisert bruker som IKKE er medlem av familien", async () => {
    // Egen, uavhengig klient-app-instans (egen Auth/Database) — ikke den
    // delte singletonen fra ./firebase, som allerede har det EKTE
    // medlemmet innlogget for testene over. Unngår enhver avhengighet av
    // testrekkefølge eller å måtte logge inn/ut på delt tilstand.
    const nonMemberApp = initializeClientApp(
      { projectId: PROJECT_ID, databaseURL: DATABASE_URL, apiKey: "demo-key" },
      "non-member-test-app",
    );
    const nonMemberAuth = getClientAuth(nonMemberApp);
    connectAuthEmulator(nonMemberAuth, "http://127.0.0.1:9099", { disableWarnings: true });
    const nonMemberDb = getClientDatabase(nonMemberApp);
    connectDatabaseEmulator(nonMemberDb, "127.0.0.1", 9000);

    const nonMemberUid = `non-member-${randomUUID()}`;
    await getAdminAuth(adminApp).createUser({ uid: nonMemberUid });
    // Bevisst IKKE lagt til i families/{FAMILY_ID}/members — det er
    // selve poenget med testen.
    const token = await getAdminAuth(adminApp).createCustomToken(nonMemberUid);
    await signInWithCustomToken(nonMemberAuth, token);

    await expect(get(ref(nonMemberDb, `families/${FAMILY_ID}/freezer`))).rejects.toThrow(
      /permission.?denied/i,
    );
    await expect(
      set(ref(nonMemberDb, `families/${FAMILY_ID}/freezer/skal-ikke-skrives`), {
        itemId: "x",
        name: "Skal ikke skrives",
        batches: [],
      }),
    ).rejects.toThrow(/permission.?denied/i);

    await deleteClientApp(nonMemberApp);
  });
});
