/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en Hosting-
 * forhåndsvisning. Kjøres via `npm run test:integration`. Se
 * `recipes.repository.integration.test.ts`/`shopping.repository.integration.test.ts`
 * for det delte mønsteret.
 */
import { randomUUID } from "node:crypto";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
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
import { deleteApp as deleteClientApp, initializeApp as initializeClientApp } from "firebase/app";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMealLibraryEntry,
  removeMealLibraryEntry,
  subscribeMealLibrary,
  transactMealLibraryEntry,
} from "./mealLibrary.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { MealLibraryEntry } from "@app-types/shopping";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin-meallibrary",
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

describe("mealLibrary.repository (emulator)", () => {
  it("leser et biblioteksmåltid med shoppingBase, itemId:null normalisert til eksplisitt null", async () => {
    const id = randomUUID();
    await getAdminDatabase(adminApp)
      .ref(`families/${FAMILY_ID}/mealLibrary/${id}`)
      .set({
        name: "Fiskegrateng",
        shoppingBase: [
          { id: "sb1", itemId: "v1", name: "Fisk", amount: "400", unit: "g", cat: "Fisk" },
          // itemId:null skrevet eksplisitt — RTDB dropper feltet, se toppkommentaren i repository.ts.
          { id: "sb2", itemId: null, name: "Fritekst-vare", amount: "", unit: "", cat: "" },
        ],
      });

    const seen = await new Promise<MealLibraryEntry[]>((resolve) => {
      const unsubscribe = subscribeMealLibrary(FAMILY_ID, (entries) => {
        if (entries.some((e) => e.id === id)) {
          unsubscribe();
          resolve(entries);
        }
      });
    });
    const entry = seen.find((e) => e.id === id);
    expect(entry?.shoppingBase?.[1]?.itemId).toBeNull();
    expect(entry?.shoppingBase?.[0]).toEqual({
      id: "sb1",
      itemId: "v1",
      name: "Fisk",
      amount: "400",
      unit: "g",
      cat: "Fisk",
    });
  });

  it("leser et biblioteksmåltid UTEN shoppingBase (fersk oppretting) som fraværende, ikke tom liste", async () => {
    const id = randomUUID();
    await getAdminDatabase(adminApp)
      .ref(`families/${FAMILY_ID}/mealLibrary/${id}`)
      .set({ name: "Taco" });

    const seen = await new Promise<MealLibraryEntry[]>((resolve) => {
      const unsubscribe = subscribeMealLibrary(FAMILY_ID, (entries) => {
        if (entries.some((e) => e.id === id)) {
          unsubscribe();
          resolve(entries);
        }
      });
    });
    const entry = seen.find((e) => e.id === id);
    expect(entry?.shoppingBase).toBeUndefined();
  });

  it("oppretter et biblioteksmåltid på sin egen node, uten shoppingBase-nøkkel", async () => {
    const name = `Taco ${randomUUID()}`;
    const created = await createMealLibraryEntry(FAMILY_ID, name);
    expect(created.name).toBe(name);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/mealLibrary/${created.id}`),
    );
    expect(snapshot.val()).toEqual({ name });
  });

  it("fjerner ett biblioteksmåltid uten å påvirke andre", async () => {
    const keep = await createMealLibraryEntry(FAMILY_ID, `Behold ${randomUUID()}`);
    const toDelete = await createMealLibraryEntry(FAMILY_ID, `Fjern ${randomUUID()}`);

    await removeMealLibraryEntry(FAMILY_ID, toDelete.id);

    const afterDelete = await new Promise<{ hasKeep: boolean; hasRemoved: boolean }>((resolve) => {
      const unsubscribe = subscribeMealLibrary(FAMILY_ID, (entries) => {
        const hasKeep = entries.some((e) => e.id === keep.id);
        const hasRemoved = entries.some((e) => e.id === toDelete.id);
        if (hasKeep && !hasRemoved) {
          unsubscribe();
          resolve({ hasKeep, hasRemoved });
        }
      });
    });
    expect(afterDelete).toEqual({ hasKeep: true, hasRemoved: false });
  });

  it("transactMealLibraryEntry legger til en shoppingBase-rad basert på den FAKTISKE server-verdien", async () => {
    const created = await createMealLibraryEntry(FAMILY_ID, `Fiskegrateng ${randomUUID()}`);

    // `current === null` her er IKKE pålitelig "finnes ikke" — se
    // `transactMealLibraryEntry` sin toppkommentar (samme funn som
    // `toggleShoppingItemDone`, §shopping.repository.ts): `runTransaction`
    // kjører updateren spekulativt mot en muligens kald lokal cache FØR den
    // bekrefter mot serveren. `return null` her er derfor en gyldig,
    // retriable verdi — IKKE `undefined`, som ville avbrutt permanent uten
    // noen ny forsøk mot den ferske posten vi nettopp opprettet.
    await transactMealLibraryEntry(FAMILY_ID, created.id, (current) => {
      if (!current) return null;
      return {
        ...current,
        shoppingBase: [
          ...(current.shoppingBase ?? []),
          { id: "sb1", itemId: "v1", name: "Fisk", amount: "", unit: "", cat: "Fisk" },
        ],
      };
    });

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/mealLibrary/${created.id}/shoppingBase`),
    );
    expect(snapshot.val()).toEqual([
      { id: "sb1", itemId: "v1", name: "Fisk", amount: "", unit: "", cat: "Fisk" },
    ]);
  });

  it("to konkurrerende transactMealLibraryEntry-kall mot TO ULIKE biblioteksmåltider kolliderer ikke", async () => {
    const first = await createMealLibraryEntry(FAMILY_ID, `Taco ${randomUUID()}`);
    const second = await createMealLibraryEntry(FAMILY_ID, `Suppe ${randomUUID()}`);

    await Promise.all([
      transactMealLibraryEntry(FAMILY_ID, first.id, (current) =>
        current
          ? {
              ...current,
              shoppingBase: [
                { id: "a", itemId: null, name: "Vare A", amount: "", unit: "", cat: "" },
              ],
            }
          : null,
      ),
      transactMealLibraryEntry(FAMILY_ID, second.id, (current) =>
        current
          ? {
              ...current,
              shoppingBase: [
                { id: "b", itemId: null, name: "Vare B", amount: "", unit: "", cat: "" },
              ],
            }
          : null,
      ),
    ]);

    const [firstSnap, secondSnap] = await Promise.all([
      get(ref(getFirebaseDatabase(), `families/${FAMILY_ID}/mealLibrary/${first.id}/shoppingBase`)),
      get(
        ref(getFirebaseDatabase(), `families/${FAMILY_ID}/mealLibrary/${second.id}/shoppingBase`),
      ),
    ]);
    expect(firstSnap.val()?.[0]?.name).toBe("Vare A");
    expect(secondSnap.val()?.[0]?.name).toBe("Vare B");
  });

  it("transactMealLibraryEntry skriver og leser lettvint/variationTags — REGRESJONSTEST: disse ble tidligere systematisk strøket fra hver skriving (§repository sin toppkommentar)", async () => {
    const created = await createMealLibraryEntry(FAMILY_ID, `Fiskesuppe ${randomUUID()}`);

    await transactMealLibraryEntry(FAMILY_ID, created.id, (current) =>
      current ? { ...current, lettvint: true, variationTags: ["fisk"] } : null,
    );

    const seen = await new Promise<MealLibraryEntry | undefined>((resolve) => {
      const unsubscribe = subscribeMealLibrary(FAMILY_ID, (entries) => {
        const found = entries.find((e) => e.id === created.id);
        if (found?.lettvint !== undefined) {
          unsubscribe();
          resolve(found);
        }
      });
    });
    expect(seen?.lettvint).toBe(true);
    expect(seen?.variationTags).toEqual(["fisk"]);
  });

  it("transactMealLibraryEntry skriver og leser variants — recipeId- og shoppingBase-kildet variant side om side (§variantmodell, Issue #2)", async () => {
    const created = await createMealLibraryEntry(FAMILY_ID, `Taco ${randomUUID()}`);

    await transactMealLibraryEntry(FAMILY_ID, created.id, (current) =>
      current
        ? {
            ...current,
            variants: [
              { id: "var1", name: "Hjemmelaget", recipeId: "r1" },
              {
                id: "var2",
                name: "Kjøpetaco",
                shoppingBase: [
                  {
                    id: "sb1",
                    itemId: "v9",
                    name: "Tacoskjell",
                    amount: "1",
                    unit: "pk",
                    cat: "Tørrvare",
                  },
                ],
              },
            ],
          }
        : null,
    );

    const seen = await new Promise<MealLibraryEntry | undefined>((resolve) => {
      const unsubscribe = subscribeMealLibrary(FAMILY_ID, (entries) => {
        const found = entries.find((e) => e.id === created.id);
        if (found?.variants !== undefined) {
          unsubscribe();
          resolve(found);
        }
      });
    });
    expect(seen?.variants).toEqual([
      { id: "var1", name: "Hjemmelaget", recipeId: "r1" },
      {
        id: "var2",
        name: "Kjøpetaco",
        shoppingBase: [
          { id: "sb1", itemId: "v9", name: "Tacoskjell", amount: "1", unit: "pk", cat: "Tørrvare" },
        ],
      },
    ]);
  });

  it("et biblioteksmåltid UTEN variants (eksisterende data før denne skiven) leses fortsatt fint, variants fraværende", async () => {
    const id = randomUUID();
    await getAdminDatabase(adminApp)
      .ref(`families/${FAMILY_ID}/mealLibrary/${id}`)
      .set({
        name: "Gammelt måltid",
        shoppingBase: [
          { id: "sb1", itemId: "v1", name: "Fisk", amount: "400", unit: "g", cat: "Fisk" },
        ],
      });

    const seen = await new Promise<MealLibraryEntry[]>((resolve) => {
      const unsubscribe = subscribeMealLibrary(FAMILY_ID, (entries) => {
        if (entries.some((e) => e.id === id)) {
          unsubscribe();
          resolve(entries);
        }
      });
    });
    const entry = seen.find((e) => e.id === id);
    expect(entry?.variants).toBeUndefined();
    expect(entry?.shoppingBase).toEqual([
      { id: "sb1", itemId: "v1", name: "Fisk", amount: "400", unit: "g", cat: "Fisk" },
    ]);
  });

  it("skriving av en tom shoppingBase-liste (siste rad fjernet) leses tilbake som fraværende, ikke tom liste (RTDB dropper tomme arrays)", async () => {
    const created = await createMealLibraryEntry(FAMILY_ID, `Suppe ${randomUUID()}`);
    await transactMealLibraryEntry(FAMILY_ID, created.id, (current) =>
      current
        ? {
            ...current,
            shoppingBase: [
              { id: "sb1", itemId: null, name: "Vare", amount: "", unit: "", cat: "" },
            ],
          }
        : null,
    );

    await transactMealLibraryEntry(FAMILY_ID, created.id, (current) =>
      current
        ? { ...current, shoppingBase: (current.shoppingBase ?? []).filter((v) => v.id !== "sb1") }
        : null,
    );

    const seen = await new Promise<MealLibraryEntry | undefined>((resolve) => {
      const unsubscribe = subscribeMealLibrary(FAMILY_ID, (entries) => {
        const found = entries.find((e) => e.id === created.id);
        if (found) {
          unsubscribe();
          resolve(found);
        }
      });
    });
    expect(seen?.shoppingBase).toBeUndefined();
  });
});

describe("security rules (emulator): medlemskap håndheves for mealLibrary", () => {
  it("nekter lesing og skriving for en autentisert bruker som IKKE er medlem av familien", async () => {
    const nonMemberApp = initializeClientApp(
      { projectId: PROJECT_ID, databaseURL: DATABASE_URL, apiKey: "demo-key" },
      "non-member-test-app-meallibrary",
    );
    const nonMemberAuth = getClientAuth(nonMemberApp);
    connectAuthEmulator(nonMemberAuth, "http://127.0.0.1:9099", { disableWarnings: true });
    const nonMemberDb = getClientDatabase(nonMemberApp);
    connectDatabaseEmulator(nonMemberDb, "127.0.0.1", 9000);

    const nonMemberUid = `non-member-${randomUUID()}`;
    await getAdminAuth(adminApp).createUser({ uid: nonMemberUid });
    const token = await getAdminAuth(adminApp).createCustomToken(nonMemberUid);
    await signInWithCustomToken(nonMemberAuth, token);

    await expect(get(ref(nonMemberDb, `families/${FAMILY_ID}/mealLibrary`))).rejects.toThrow(
      /permission.?denied/i,
    );
    await expect(
      set(ref(nonMemberDb, `families/${FAMILY_ID}/mealLibrary/skal-ikke-skrives`), { name: "X" }),
    ).rejects.toThrow(/permission.?denied/i);

    await deleteClientApp(nonMemberApp);
  });
});
