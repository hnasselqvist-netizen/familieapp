/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en Hosting-
 * forhåndsvisning. Kjøres via `npm run test:integration`. Se
 * `recipes.repository.integration.test.ts`/`meals.repository.integration.test.ts`
 * for det delte mønsteret.
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
import {
  clearDoneShoppingItems,
  createShoppingItem,
  removeShoppingItem,
  subscribeShoppingList,
  toggleShoppingItemDone,
  updateShoppingItemField,
} from "./shopping.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

const baseEntry = (overrides: Partial<ShoppingListEntry> = {}): ShoppingListEntry => ({
  itemId: "v1",
  name: "Melk",
  amount: "1 l",
  cat: "Meieri",
  done: false,
  ...overrides,
});

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin-shopping",
  );

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

describe("shopping.repository (emulator)", () => {
  it("oppretter en post på sin egen node og gjør den lesbar for et abonnement", async () => {
    const name = `Egg ${randomUUID()}`;
    const created = await createShoppingItem(FAMILY_ID, baseEntry({ name }));
    expect(created.name).toBe(name);

    const seen = await new Promise<boolean>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        if (items.some((i) => i.name === name)) {
          unsubscribe();
          resolve(true);
        }
      });
    });
    expect(seen).toBe(true);
  });

  it("snur done via toggleShoppingItemDone, uavhengig av tidligere verdi", async () => {
    const created = await createShoppingItem(FAMILY_ID, baseEntry({ done: false }));
    await toggleShoppingItemDone(FAMILY_ID, created.id);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/shopping/${created.id}`),
    );
    expect((snapshot.val() as ShoppingListEntry).done).toBe(true);
  });

  it("to konkurrerende oppdateringer av ULIKE felt på SAMME post overlever begge (update(), ikke set())", async () => {
    const created = await createShoppingItem(
      FAMILY_ID,
      baseEntry({ amount: "1 l", cat: "Meieri" }),
    );

    await Promise.all([
      updateShoppingItemField(FAMILY_ID, created.id, "amount", "2 l"),
      updateShoppingItemField(FAMILY_ID, created.id, "cat", "Kjøl"),
    ]);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/shopping/${created.id}`),
    );
    const value = snapshot.val() as ShoppingListEntry;
    expect(value.amount).toBe("2 l");
    expect(value.cat).toBe("Kjøl");
    expect(value.name).toBe("Melk");
  });

  it("fjerner én post uten å påvirke andre", async () => {
    const keep = await createShoppingItem(FAMILY_ID, baseEntry({ name: `Behold ${randomUUID()}` }));
    const toDelete = await createShoppingItem(
      FAMILY_ID,
      baseEntry({ name: `Fjern ${randomUUID()}` }),
    );

    await removeShoppingItem(FAMILY_ID, toDelete.id);

    const afterDelete = await new Promise<{ hasKeep: boolean; hasRemoved: boolean }>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        const hasKeep = items.some((i) => i.id === keep.id);
        const hasRemoved = items.some((i) => i.id === toDelete.id);
        if (hasKeep && !hasRemoved) {
          unsubscribe();
          resolve({ hasKeep, hasRemoved });
        }
      });
    });
    expect(afterDelete).toEqual({ hasKeep: true, hasRemoved: false });
  });

  it("clearDoneShoppingItems fjerner KUN fullførte poster, i ett målrettet kall", async () => {
    const done1 = await createShoppingItem(
      FAMILY_ID,
      baseEntry({ name: `D1 ${randomUUID()}`, done: true }),
    );
    const done2 = await createShoppingItem(
      FAMILY_ID,
      baseEntry({ name: `D2 ${randomUUID()}`, done: true }),
    );
    const pending = await createShoppingItem(
      FAMILY_ID,
      baseEntry({ name: `P1 ${randomUUID()}`, done: false }),
    );

    const currentList = await new Promise<ShoppingItem[]>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        if (items.some((i) => i.id === pending.id)) {
          unsubscribe();
          resolve(items);
        }
      });
    });

    await clearDoneShoppingItems(FAMILY_ID, currentList);

    const afterClear = await new Promise<ShoppingItem[]>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        unsubscribe();
        resolve(items);
      });
    });
    const ids = afterClear.map((i) => i.id);
    expect(ids).not.toContain(done1.id);
    expect(ids).not.toContain(done2.id);
    expect(ids).toContain(pending.id);
  });

  it("clearDoneShoppingItems overlever en post som ble ubekreftet ETTER at listen ble lest (stale-read-race, §Kontrolltårn-review)", async () => {
    const flipped = await createShoppingItem(
      FAMILY_ID,
      baseEntry({ name: `Flip ${randomUUID()}`, done: true }),
    );

    // Les listen mens posten fortsatt er done:true — dette er "den gamle
    // listen" et konkurrerende toggle skal rekke å løpe forbi.
    const staleList = await new Promise<ShoppingItem[]>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        if (items.some((i) => i.id === flipped.id)) {
          unsubscribe();
          resolve(items);
        }
      });
    });
    expect(staleList.find((i) => i.id === flipped.id)?.done).toBe(true);

    // Brukeren krysser posten tilbake til ikke-fullført FØR clear faktisk kjører.
    await toggleShoppingItemDone(FAMILY_ID, flipped.id);

    // clearDoneShoppingItems kalles med den GAMLE (nå utdaterte) listen.
    await clearDoneShoppingItems(FAMILY_ID, staleList);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/shopping/${flipped.id}`),
    );
    // Posten skal ha overlevd — den var IKKE lenger done på slettetidspunktet,
    // selv om den øyeblikksbildet som ble sendt inn sa den var det.
    expect(snapshot.exists()).toBe(true);
    expect((snapshot.val() as ShoppingListEntry).done).toBe(false);
  });

  it("leser itemId:null tilbake som eksplisitt null, ikke fraværende (RTDB dropper null ved skriving)", async () => {
    const created = await createShoppingItem(FAMILY_ID, baseEntry({ itemId: null }));

    const seen = await new Promise<ShoppingItem | undefined>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        const found = items.find((i) => i.id === created.id);
        if (found) {
          unsubscribe();
          resolve(found);
        }
      });
    });
    expect(seen?.itemId).toBeNull();
  });
});

describe("security rules (emulator): medlemskap håndheves for shopping", () => {
  it("nekter lesing og skriving for en autentisert bruker som IKKE er medlem av familien", async () => {
    const nonMemberApp = initializeClientApp(
      { projectId: PROJECT_ID, databaseURL: DATABASE_URL, apiKey: "demo-key" },
      "non-member-test-app-shopping",
    );
    const nonMemberAuth = getClientAuth(nonMemberApp);
    connectAuthEmulator(nonMemberAuth, "http://127.0.0.1:9099", { disableWarnings: true });
    const nonMemberDb = getClientDatabase(nonMemberApp);
    connectDatabaseEmulator(nonMemberDb, "127.0.0.1", 9000);

    const nonMemberUid = `non-member-${randomUUID()}`;
    await getAdminAuth(adminApp).createUser({ uid: nonMemberUid });
    const token = await getAdminAuth(adminApp).createCustomToken(nonMemberUid);
    await signInWithCustomToken(nonMemberAuth, token);

    await expect(get(ref(nonMemberDb, `families/${FAMILY_ID}/shopping`))).rejects.toThrow(
      /permission.?denied/i,
    );
    await expect(
      set(ref(nonMemberDb, `families/${FAMILY_ID}/shopping/skal-ikke-skrives`), baseEntry()),
    ).rejects.toThrow(/permission.?denied/i);

    await deleteClientApp(nonMemberApp);
  });
});
