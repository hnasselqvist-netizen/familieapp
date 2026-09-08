/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en Hosting-
 * forhåndsvisning. Kjøres via `npm run test:integration`. Se
 * `freezer.repository.integration.test.ts` for det delte mønsteret
 * (Admin SDK kun for forutsetninger, selve lesingen/skrivingen går via
 * de samme repository-funksjonene og samme klient-SDK appen bruker).
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
import { createRecipe, deleteRecipe, subscribeRecipes, transactRecipe } from "./recipes.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { RecipeFields } from "@app-types/recipe";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

const baseRecipe = (overrides: Partial<RecipeFields> = {}): RecipeFields => ({
  name: "Test-oppskrift",
  cat: "Middag",
  tags: [],
  time: 20,
  servings: 4,
  url: "",
  imageUrl: null,
  source: "quick",
  instructions: "",
  ingredients: [{ name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt" }],
  ingredientGroups: [],
  lastCooked: null,
  timesCooked: 0,
  createdAt: Date.now(),
  ...overrides,
});

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin-recipes",
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

describe("recipes.repository (emulator)", () => {
  it("oppretter en oppskrift på sin egen node og gjør den lesbar for et abonnement", async () => {
    const name = `Taco ${randomUUID()}`;
    const created = await createRecipe(FAMILY_ID, baseRecipe({ name }));
    expect(created.name).toBe(name);

    const seen = await new Promise<boolean>((resolve) => {
      const unsubscribe = subscribeRecipes(FAMILY_ID, (recipes) => {
        if (recipes.some((r) => r.name === name)) {
          unsubscribe();
          resolve(true);
        }
      });
    });
    expect(seen).toBe(true);
  });

  it("fjerner én oppskrift uten å påvirke andre", async () => {
    const keep = await createRecipe(FAMILY_ID, baseRecipe({ name: `Behold ${randomUUID()}` }));
    const toDelete = await createRecipe(FAMILY_ID, baseRecipe({ name: `Fjern ${randomUUID()}` }));

    await deleteRecipe(FAMILY_ID, toDelete.id);

    const afterDelete = await new Promise<{ hasKeep: boolean; hasRemoved: boolean }>((resolve) => {
      const unsubscribe = subscribeRecipes(FAMILY_ID, (recipes) => {
        const hasKeep = recipes.some((r) => r.id === keep.id);
        const hasRemoved = recipes.some((r) => r.id === toDelete.id);
        if (hasKeep && !hasRemoved) {
          unsubscribe();
          resolve({ hasKeep, hasRemoved });
        }
      });
    });
    expect(afterDelete).toEqual({ hasKeep: true, hasRemoved: false });
  });

  it("leser tomme lister som [] (ikke undefined) — RTDB lagrer aldri en tom liste", async () => {
    // Realtime Database dropper feltet helt når det skrives som []/null —
    // se toppkommentaren i recipes.repository.ts. Denne testen beviser at
    // parseRecipeFields kompenserer for det på lesing, for BÅDE
    // abonnementet og transaksjonens `current`.
    const created = await createRecipe(
      FAMILY_ID,
      baseRecipe({ tags: [], ingredientGroups: [], imageUrl: null, lastCooked: null }),
    );

    const viaSubscription = await new Promise<RecipeFields>((resolve) => {
      const unsubscribe = subscribeRecipes(FAMILY_ID, (recipes) => {
        const found = recipes.find((r) => r.id === created.id);
        if (found) {
          unsubscribe();
          resolve(found);
        }
      });
    });
    expect(viaSubscription.tags).toEqual([]);
    expect(viaSubscription.ingredientGroups).toEqual([]);
    expect(viaSubscription.imageUrl).toBeNull();
    expect(viaSubscription.lastCooked).toBeNull();

    let seenInTransaction: RecipeFields | null = null;
    await transactRecipe(FAMILY_ID, created.id, (current) => {
      seenInTransaction = current;
      return current;
    });
    expect(seenInTransaction).not.toBeNull();
    expect((seenInTransaction as unknown as RecipeFields).tags).toEqual([]);
  });

  it("leser lettvint/variationTags tilbake — REGRESJONSTEST: parseRecipeFields inkluderte dem opprinnelig ikke i det hele tatt (§repository sin toppkommentar)", async () => {
    const created = await createRecipe(
      FAMILY_ID,
      baseRecipe({ lettvint: true, variationTags: ["fisk", "rask"] }),
    );

    const viaSubscription = await new Promise<RecipeFields>((resolve) => {
      const unsubscribe = subscribeRecipes(FAMILY_ID, (recipes) => {
        const found = recipes.find((r) => r.id === created.id);
        if (found) {
          unsubscribe();
          resolve(found);
        }
      });
    });
    expect(viaSubscription.lettvint).toBe(true);
    expect(viaSubscription.variationTags).toEqual(["fisk", "rask"]);
  });

  it("to konkurrerende oppdateringer av SAMME oppskrift mister ikke data (§Kontrolltårn-mønster fra Fryser)", async () => {
    // Speiler den reelle risikoen i dagens setRecipes: en bruker som
    // redigerer taggene på en oppskrift, mens "Bekreft middag" nesten
    // samtidig oppdaterer DENNE oppskriftens lastCooked/timesCooked.
    // Verifiserer at transactRecipe selv garanterer atomisk
    // les-endre-skriv, ikke at domenelogikken er riktig (det dekker
    // recipes.test.ts).
    const created = await createRecipe(FAMILY_ID, baseRecipe({ tags: [] }));

    const addTag = (current: RecipeFields | null): RecipeFields | null => {
      if (!current) return null;
      return { ...current, tags: [...current.tags, "favoritt"] };
    };
    const markCooked = (current: RecipeFields | null): RecipeFields | null => {
      if (!current) return null;
      return { ...current, timesCooked: (current.timesCooked || 0) + 1, lastCooked: 1720000000 };
    };

    await Promise.all([
      transactRecipe(FAMILY_ID, created.id, addTag),
      transactRecipe(FAMILY_ID, created.id, markCooked),
    ]);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/recipes/${created.id}`),
    );
    const finalValue = snapshot.val() as RecipeFields;
    // Uten transaksjon (to ubetingede set()-kall basert på lokal state)
    // ville den ene operasjonen ofte tapt for den andre — den tapte
    // oppdateringen dette skal bevise er løst.
    expect(finalValue.tags).toEqual(["favoritt"]);
    expect(finalValue.timesCooked).toBe(1);
  });
});

describe("security rules (emulator): medlemskap håndheves for recipes", () => {
  it("nekter lesing og skriving for en autentisert bruker som IKKE er medlem av familien", async () => {
    const nonMemberApp = initializeClientApp(
      { projectId: PROJECT_ID, databaseURL: DATABASE_URL, apiKey: "demo-key" },
      "non-member-test-app-recipes",
    );
    const nonMemberAuth = getClientAuth(nonMemberApp);
    connectAuthEmulator(nonMemberAuth, "http://127.0.0.1:9099", { disableWarnings: true });
    const nonMemberDb = getClientDatabase(nonMemberApp);
    connectDatabaseEmulator(nonMemberDb, "127.0.0.1", 9000);

    const nonMemberUid = `non-member-${randomUUID()}`;
    await getAdminAuth(adminApp).createUser({ uid: nonMemberUid });
    const token = await getAdminAuth(adminApp).createCustomToken(nonMemberUid);
    await signInWithCustomToken(nonMemberAuth, token);

    await expect(get(ref(nonMemberDb, `families/${FAMILY_ID}/recipes`))).rejects.toThrow(
      /permission.?denied/i,
    );
    await expect(
      set(ref(nonMemberDb, `families/${FAMILY_ID}/recipes/skal-ikke-skrives`), baseRecipe()),
    ).rejects.toThrow(/permission.?denied/i);

    await deleteClientApp(nonMemberApp);
  });
});
