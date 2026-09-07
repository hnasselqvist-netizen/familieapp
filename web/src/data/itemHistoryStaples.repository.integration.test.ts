/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en Hosting-
 * forhåndsvisning. Kjøres via `npm run test:integration`. Slått sammen
 * i én fil siden begge repositoriene er KUN-lesing, ett-funksjon hver,
 * og deler nøyaktig samme oppsett — se `mealLibrary.repository.integration.test.ts`
 * for det vanlige separate mønsteret.
 */
import { randomUUID } from "node:crypto";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { signInWithCustomToken } from "firebase/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { subscribeItemHistory } from "./itemHistory.repository";
import { subscribeStaples } from "./staples.repository";
import { getFirebaseAuth } from "./firebase";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin-history-staples",
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

describe("itemHistory.repository (emulator)", () => {
  // Rekkefølgen er bevisst: tomt-sjekken må kjøre FØR skrive-testen,
  // siden begge deler samme familie-node og path-et er en enkelt flat
  // liste (ikke id-adresserbare underposter slik de andre repositoriene
  // har) — det finnes ingen egen, isolert sti å skrive/lese mot per test.
  it("leser tom/fraværende historikk som [] (må kjøre først i denne describe-blokken)", async () => {
    const seen = await new Promise<unknown>((resolve) => {
      const unsubscribe = subscribeItemHistory(FAMILY_ID, (entries) => {
        unsubscribe();
        resolve(entries);
      });
    });
    expect(seen).toEqual([]);
  });

  it("leser varehistorikken som en flat liste", async () => {
    await getAdminDatabase(adminApp)
      .ref(`families/${FAMILY_ID}/itemHistory`)
      .set([
        { name: "Melk", cat: "Meieri" },
        { name: "Fisk", cat: "Fisk og skalldyr" },
      ]);

    const seen = await new Promise<{ name: string; cat: string }[]>((resolve) => {
      const unsubscribe = subscribeItemHistory(FAMILY_ID, (entries) => {
        if (entries.length > 0) {
          unsubscribe();
          resolve(entries);
        }
      });
    });
    expect(seen).toEqual([
      { name: "Melk", cat: "Meieri" },
      { name: "Fisk", cat: "Fisk og skalldyr" },
    ]);
  });
});

describe("staples.repository (emulator)", () => {
  it("leser basisvarer som {navn: true}", async () => {
    await getAdminDatabase(adminApp)
      .ref(`families/${FAMILY_ID}/staples`)
      .set({ melk: true, egg: true });

    const seen = await new Promise<Record<string, boolean>>((resolve) => {
      const unsubscribe = subscribeStaples(FAMILY_ID, (staples) => {
        if (Object.keys(staples).length > 0) {
          unsubscribe();
          resolve(staples);
        }
      });
    });
    expect(seen).toEqual({ melk: true, egg: true });
  });
});
