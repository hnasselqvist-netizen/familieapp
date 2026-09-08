/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en Hosting-
 * forhåndsvisning. Kjøres via `npm run test:integration`. Se
 * `mealLibrary.repository.integration.test.ts` for det delte mønsteret.
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
  deleteMealFeedback,
  setMealFeedback,
  subscribeWeekMealFeedback,
} from "./mealFeedback.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { MealFeedback, WeekMealFeedback } from "@app-types/mealFeedback";

const FAMILY_ID = "familie1";
const WEEK_KEY = "2026-W37";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin-mealfeedback",
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

describe("mealFeedback.repository (emulator)", () => {
  it("skriver og leser en feedback-post uten avvik (kun feedback, ingen actual)", async () => {
    const feedback: MealFeedback = {
      feedback: { wantAgain: true, comment: "Veldig god, gjenta!" },
      recordedAt: 1720000000,
    };
    await setMealFeedback(FAMILY_ID, WEEK_KEY, "Mon", feedback);

    const seen = await new Promise<WeekMealFeedback>((resolve) => {
      const unsubscribe = subscribeWeekMealFeedback(FAMILY_ID, WEEK_KEY, (data) => {
        if (data.Mon) {
          unsubscribe();
          resolve(data);
        }
      });
    });
    expect(seen.Mon?.actual).toBeUndefined();
    expect(seen.Mon?.feedback).toEqual({ wantAgain: true, comment: "Veldig god, gjenta!" });
    expect(seen.Mon?.recordedAt).toBe(1720000000);
  });

  it("skriver og leser et registrert avvik (actual avviker fra planen, flere retter)", async () => {
    const feedback: MealFeedback = {
      actual: {
        type: "menu",
        name: "Taco · Pizza",
        recipes: [
          { name: "Taco", recipeId: "r1" },
          { name: "Pizza", recipeId: null },
        ],
      },
      recordedAt: 1720000001,
    };
    await setMealFeedback(FAMILY_ID, WEEK_KEY, "Tue", feedback);

    const seen = await new Promise<WeekMealFeedback>((resolve) => {
      const unsubscribe = subscribeWeekMealFeedback(FAMILY_ID, WEEK_KEY, (data) => {
        if (data.Tue) {
          unsubscribe();
          resolve(data);
        }
      });
    });
    expect(seen.Tue?.actual).toEqual({
      type: "menu",
      name: "Taco · Pizza",
      recipes: [
        { name: "Taco", recipeId: "r1" },
        { name: "Pizza", recipeId: null },
      ],
    });
  });

  it("retrospektiv korrigering: en ny setMealFeedback overskriver hele forrige post", async () => {
    await setMealFeedback(FAMILY_ID, WEEK_KEY, "Wed", {
      feedback: { paused: true },
      recordedAt: 1000,
    });
    await setMealFeedback(FAMILY_ID, WEEK_KEY, "Wed", {
      feedback: { wantAgain: true },
      recordedAt: 2000,
    });

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/mealFeedback/${WEEK_KEY}/Wed`),
    );
    expect(snapshot.val()).toEqual({ feedback: { wantAgain: true }, recordedAt: 2000 });
  });

  it("nullstiller (sletter) en feedback-post — dagen faller tilbake til fraværende, ikke tom", async () => {
    await setMealFeedback(FAMILY_ID, WEEK_KEY, "Thu", {
      feedback: { comment: "Fjernes" },
      recordedAt: 3000,
    });
    await deleteMealFeedback(FAMILY_ID, WEEK_KEY, "Thu");

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/mealFeedback/${WEEK_KEY}/Thu`),
    );
    expect(snapshot.exists()).toBe(false);
  });
});

describe("security rules (emulator): medlemskap håndheves for mealFeedback", () => {
  it("nekter lesing og skriving for en autentisert bruker som IKKE er medlem av familien", async () => {
    const nonMemberApp = initializeClientApp(
      { projectId: PROJECT_ID, databaseURL: DATABASE_URL, apiKey: "demo-key" },
      "non-member-test-app-mealfeedback",
    );
    const nonMemberAuth = getClientAuth(nonMemberApp);
    connectAuthEmulator(nonMemberAuth, "http://127.0.0.1:9099", { disableWarnings: true });
    const nonMemberDb = getClientDatabase(nonMemberApp);
    connectDatabaseEmulator(nonMemberDb, "127.0.0.1", 9000);

    const nonMemberUid = `non-member-${randomUUID()}`;
    await getAdminAuth(adminApp).createUser({ uid: nonMemberUid });
    const token = await getAdminAuth(adminApp).createCustomToken(nonMemberUid);
    await signInWithCustomToken(nonMemberAuth, token);

    await expect(
      get(ref(nonMemberDb, `families/${FAMILY_ID}/mealFeedback/${WEEK_KEY}`)),
    ).rejects.toThrow(/permission.?denied/i);
    await expect(
      set(ref(nonMemberDb, `families/${FAMILY_ID}/mealFeedback/${WEEK_KEY}/Fri`), {
        feedback: { comment: "nei" },
        recordedAt: 1,
      }),
    ).rejects.toThrow(/permission.?denied/i);

    await deleteClientApp(nonMemberApp);
  });
});
