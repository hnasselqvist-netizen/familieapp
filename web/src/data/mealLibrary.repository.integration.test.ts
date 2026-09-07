/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en Hosting-
 * forhåndsvisning. Kjøres via `npm run test:integration`. Se
 * `recipes.repository.integration.test.ts` for det delte mønsteret.
 * KUN lesing testes her — skriving er fortsatt skjerm-eid, se
 * `mealLibrary.repository.ts` sin toppkommentar.
 */
import { randomUUID } from "node:crypto";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { signInWithCustomToken } from "firebase/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { subscribeMealLibrary } from "./mealLibrary.repository";
import { getFirebaseAuth } from "./firebase";
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
});
