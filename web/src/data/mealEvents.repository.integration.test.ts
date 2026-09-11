/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en Hosting-
 * forhåndsvisning. Kjøres via `npm run test:integration`. Speiler
 * `mealLibrary.repository.integration.test.ts` sitt oppsett — en ny,
 * additiv samling under samme `families/{familyId}`-sikkerhetsregel
 * (§infra/firebase/database.rules.json, uendret av denne skiven — regelen
 * er allerede et wildcard på hele familie-treet).
 */
import { randomUUID } from "node:crypto";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { signInWithCustomToken } from "firebase/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMealEvent,
  removeMealEvent,
  subscribeMealEvents,
  updateMealEvent,
} from "./mealEvents.repository";
import { getFirebaseAuth } from "./firebase";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin-mealevents",
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

describe("mealEvents.repository (emulator)", () => {
  it("oppretter, oppdaterer og fjerner en brukerdefinert hendelse — full livssyklus mot ekte Firebase", async () => {
    const created = await createMealEvent(FAMILY_ID, { name: "Pizza-kveld", emoji: "🍕" });
    expect(created.name).toBe("Pizza-kveld");

    const afterCreate = await new Promise<{ id: string; name: string; emoji?: string }[]>(
      (resolve) => {
        const unsubscribe = subscribeMealEvents(FAMILY_ID, (events) => {
          if (events.some((e) => e.id === created.id)) {
            unsubscribe();
            resolve(events);
          }
        });
      },
    );
    expect(afterCreate.find((e) => e.id === created.id)).toEqual(created);

    await updateMealEvent(FAMILY_ID, created.id, { name: "Fredagspizza" });
    const afterUpdate = await new Promise<{ id: string; name: string; emoji?: string }[]>(
      (resolve) => {
        const unsubscribe = subscribeMealEvents(FAMILY_ID, (events) => {
          const match = events.find((e) => e.id === created.id);
          if (match?.name === "Fredagspizza") {
            unsubscribe();
            resolve(events);
          }
        });
      },
    );
    const updated = afterUpdate.find((e) => e.id === created.id);
    expect(updated).toEqual({ id: created.id, name: "Fredagspizza", emoji: "🍕" });

    await removeMealEvent(FAMILY_ID, created.id);
    const afterRemove = await new Promise<boolean>((resolve) => {
      const unsubscribe = subscribeMealEvents(FAMILY_ID, (events) => {
        if (!events.some((e) => e.id === created.id)) {
          unsubscribe();
          resolve(true);
        }
      });
    });
    expect(afterRemove).toBe(true);
  });

  it("oppretter en hendelse uten emoji — feltet er fraværende, ikke en tom streng", async () => {
    const created = await createMealEvent(FAMILY_ID, { name: "Kollektiv matlaging" });
    expect(created).toEqual({ id: created.id, name: "Kollektiv matlaging" });
    expect(created).not.toHaveProperty("emoji");
  });
});
