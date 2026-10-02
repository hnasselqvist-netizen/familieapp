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
  addBatchToShoppingList,
  clearDoneShoppingItems,
  createShoppingItem,
  removeShoppingItem,
  subscribeShoppingList,
  toggleShoppingItemDone,
  updateShoppingItemField,
} from "./shopping.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import { shoppingMergeRules } from "@domain/shopping/handlelisteRules";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import { legacyContains } from "../test/legacy";

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

  it("addBatchToShoppingList oppretter en ny post når ingen kandidat matcher", async () => {
    const name = `Batch-ny ${randomUUID()}`;
    await addBatchToShoppingList(
      FAMILY_ID,
      [],
      [baseEntry({ name, amount: "2 stk" })],
      shoppingMergeRules,
    );

    const seen = await new Promise<ShoppingItem | undefined>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        const found = items.find((i) => i.name === name);
        if (found) {
          unsubscribe();
          resolve(found);
        }
      });
    });
    expect(seen?.amount).toBe("2 stk");
  });

  it("addBatchToShoppingList slår sammen tallmengder inn i en eksisterende, ikke-fullført post med samme navn", async () => {
    const name = `Batch-slaa-sammen ${randomUUID()}`;
    const existing = await createShoppingItem(
      FAMILY_ID,
      baseEntry({ name, amount: "2", done: false }),
    );

    await addBatchToShoppingList(
      FAMILY_ID,
      [existing],
      [baseEntry({ name, amount: "3" })],
      shoppingMergeRules,
    );

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/shopping/${existing.id}`),
    );
    expect((snapshot.val() as ShoppingListEntry).amount).toBe("5");

    const all = await new Promise<ShoppingItem[]>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        unsubscribe();
        resolve(items);
      });
    });
    expect(all.filter((i) => i.name === name)).toHaveLength(1);
  });

  it("addBatchToShoppingList lar en eksisterende post være urørt (ingen duplikat) når mengdene ikke begge er tall, akkurat som mergeIntoShoppingList", async () => {
    const name = `Batch-ikke-tall ${randomUUID()}`;
    const existing = await createShoppingItem(
      FAMILY_ID,
      baseEntry({ name, amount: "etter behov", done: false }),
    );

    await addBatchToShoppingList(
      FAMILY_ID,
      [existing],
      [baseEntry({ name, amount: "2" })],
      shoppingMergeRules,
    );

    const all = await new Promise<ShoppingItem[]>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        unsubscribe();
        resolve(items);
      });
    });
    const matches = all.filter((i) => i.name === name);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.amount).toBe("etter behov");
  });

  it("addBatchToShoppingList matcher KUN ikke-fullførte poster — en fullført post med samme navn blokkerer ikke en ny rad", async () => {
    const name = `Batch-fullfort ${randomUUID()}`;
    await createShoppingItem(FAMILY_ID, baseEntry({ name, amount: "1", done: true }));

    await addBatchToShoppingList(
      FAMILY_ID,
      [],
      [baseEntry({ name, amount: "1" })],
      shoppingMergeRules,
    );

    const all = await new Promise<ShoppingItem[]>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        if (items.filter((i) => i.name === name).length >= 2) {
          unsubscribe();
          resolve(items);
        }
      });
    });
    expect(all.filter((i) => i.name === name)).toHaveLength(2);
  });

  it("addBatchToShoppingList faller tilbake til en ny post når dedup-kandidaten ble slettet ETTER at øyeblikksbildet ble lest (race)", async () => {
    const name = `Batch-slettet-kandidat ${randomUUID()}`;
    const staleCandidate = await createShoppingItem(FAMILY_ID, baseEntry({ name, amount: "1" }));

    // Kandidaten fjernes FØR batch-kallet faktisk kjører — akkurat som
    // clearDoneShoppingItems sin tilsvarende stale-read-race-test.
    await removeShoppingItem(FAMILY_ID, staleCandidate.id);

    await addBatchToShoppingList(
      FAMILY_ID,
      [staleCandidate],
      [baseEntry({ name, amount: "2" })],
      shoppingMergeRules,
    );

    const seen = await new Promise<ShoppingItem | undefined>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (items) => {
        const found = items.find((i) => i.name === name);
        if (found) {
          unsubscribe();
          resolve(found);
        }
      });
    });
    expect(seen?.id).not.toBe(staleCandidate.id);
    expect(seen?.amount).toBe("2");
  });

  it("nye poster bærer sitt eget `id`, og toggle/merge bevarer det og ukjente felt (PR #40, 5950478583 pkt. 3)", async () => {
    const adminDb = getAdminDatabase(adminApp);
    const name = `Id-bevares ${randomUUID()}`;
    const created = await createShoppingItem(FAMILY_ID, baseEntry({ name, amount: "1" }));
    const nodeRef = adminDb.ref(`families/${FAMILY_ID}/shopping/${created.id}`);
    expect((await nodeRef.get()).val()).toMatchObject({ id: created.id, name });

    await nodeRef.update({ ukjentFelt: "beholdes" });
    await toggleShoppingItemDone(FAMILY_ID, created.id);
    expect((await nodeRef.get()).val()).toMatchObject({
      id: created.id,
      ukjentFelt: "beholdes",
      done: true,
    });

    await toggleShoppingItemDone(FAMILY_ID, created.id);
    const current: ShoppingItem = { id: created.id, ...baseEntry({ name, amount: "1" }) };
    await addBatchToShoppingList(
      FAMILY_ID,
      [current],
      [baseEntry({ name, amount: "2" })],
      shoppingMergeRules,
    );
    expect((await nodeRef.get()).val()).toMatchObject({
      id: created.id,
      ukjentFelt: "beholdes",
      amount: "3",
      done: false,
    });
  });

  it("legacy `setShopping` sin helnode-skriving kollapser IKKE web-opprettede poster (PR #40, 5950478583 pkt. 3)", async () => {
    // Simuleringen må være legacys faktiske skriveuttrykk — feiler hvis
    // index.html endres, så testen aldri stille slutter å bevise noe.
    expect(
      legacyContains("dbSet(`${FAM}/shopping`, Object.fromEntries(next.map(i=>[i.id,i])))"),
    ).toBe(true);
    const legacyWholeNodeWrite = (raw: Record<string, Record<string, unknown>>) => {
      const next = Object.values(raw); // legacy `listen("shopping")`
      return Object.fromEntries(next.map((i) => [i.id, i])); // legacy `setShopping`
    };

    // Kontroll: poster UTEN eget id (dagens tilstand før rettingen) kollapser.
    const adminDb = getAdminDatabase(adminApp);
    const controlRef = adminDb.ref(`kontroll-${randomUUID()}/shopping`);
    await controlRef.set({ a: { name: "Melk" }, b: { name: "Brød" } });
    await controlRef.set(legacyWholeNodeWrite((await controlRef.get()).val()));
    expect(Object.keys((await controlRef.get()).val())).toEqual(["undefined"]);
    await controlRef.parent!.remove();

    // Web-opprettede poster etter rettingen overlever under sine egne nøkler.
    const a = await createShoppingItem(FAMILY_ID, baseEntry({ name: `Legacy-a ${randomUUID()}` }));
    const b = await createShoppingItem(FAMILY_ID, baseEntry({ name: `Legacy-b ${randomUUID()}` }));
    const listRef = adminDb.ref(`families/${FAMILY_ID}/shopping`);
    await listRef.set(legacyWholeNodeWrite((await listRef.get()).val()));
    const after = (await listRef.get()).val() as Record<string, Record<string, unknown>>;
    expect(after[a.id]).toMatchObject({ id: a.id, name: a.name });
    expect(after[b.id]).toMatchObject({ id: b.id, name: b.name });
  });

  it("subscribeShoppingList hopper over reserverte metadata-nøkler (`shopping/_ops`)", async () => {
    const adminDb = getAdminDatabase(adminApp);
    const opsRef = adminDb.ref(`families/${FAMILY_ID}/shopping/_ops`);
    await opsRef.set({ "req-1": { tool: "shopping_list_add_items", at: 1 } });
    const name = `Etter-ops ${randomUUID()}`;
    await createShoppingItem(FAMILY_ID, baseEntry({ name }));

    const items = await new Promise<ShoppingItem[]>((resolve) => {
      const unsubscribe = subscribeShoppingList(FAMILY_ID, (list) => {
        if (list.some((i) => i.name === name)) {
          unsubscribe();
          resolve(list);
        }
      });
    });
    expect(items.some((i) => i.id === "_ops")).toBe(false);
    expect(items.every((i) => typeof i.name === "string")).toBe(true);
    await opsRef.remove();
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
