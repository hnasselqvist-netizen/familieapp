/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en
 * Hosting-forhåndsvisning. Kjøres via `npm run test:integration`. Se
 * freezer.repository.integration.test.ts for medlemskaps-/sikkerhets-
 * regeltesten — ikke duplisert her, samme regel gjelder alle stier
 * under `families/{familyId}`.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { get, ref } from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addItem,
  removeItem,
  saveItemMeta,
  subscribeBudgetGroups,
  updateItemMonth,
} from "./budsjettfamilie.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "budsjettfamilie-integration-test-admin",
  );

  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await getAdminDatabase(adminApp).ref(`families/${FAMILY_ID}/members/${uid}`).set(true);

  const customToken = await getAdminAuth(adminApp).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), customToken);
});

afterAll(async () => {
  await getAdminDatabase(adminApp).ref(`families/${FAMILY_ID}/budget`).remove();
  await deleteApp(adminApp);
});

function waitForBudgetGroups(predicate: (grupper: BudsjettGruppe[]) => boolean) {
  return new Promise<void>((resolve) => {
    const unsubscribe = subscribeBudgetGroups(FAMILY_ID, (grupper) => {
      if (predicate(grupper)) {
        unsubscribe();
        resolve();
      }
    });
  });
}

describe("budsjettfamilie.repository (emulator)", () => {
  it("addItem skriver til gruppens egen node og fjerner _gruppeplassholder", async () => {
    // Start fra en bevisst tom gruppe (samme invariant som legacy sin
    // whole-node-skriving produserer for en tom gruppe).
    await getAdminDatabase(adminApp)
      .ref(`families/${FAMILY_ID}/budget/bolig`)
      .set({ _gruppeplassholder: true });
    await waitForBudgetGroups((g) => g.find((x) => x.id === "bolig")?.items.length === 0);

    const id = await addItem(FAMILY_ID, "budget", "bolig", {
      name: "Ny post",
      budget: 500,
      spent: 0,
      monthIndex: 3,
    });

    await waitForBudgetGroups((g) => (g.find((x) => x.id === "bolig")?.items.length ?? 0) > 0);

    const snapshot = await get(ref(getFirebaseDatabase(), `families/${FAMILY_ID}/budget/bolig`));
    const value = snapshot.val() as Record<string, unknown>;
    expect(value._gruppeplassholder).toBeUndefined();
    expect((value[id] as { name: string }).name).toBe("Ny post");
    expect((value[id] as { months: { budget: number }[] }).months[3]?.budget).toBe(500);
  });

  it("updateItemMonth skriver kun feltet/måneden som endres, uten å røre andre måneder", async () => {
    const id = await addItem(FAMILY_ID, "budget", "bolig", {
      name: "Strøm-test",
      budget: 100,
      spent: 0,
      monthIndex: 0,
    });
    await waitForBudgetGroups(
      (g) => !!g.find((x) => x.id === "bolig")?.items.some((it) => it.id === id),
    );

    await updateItemMonth(FAMILY_ID, "budget", "bolig", id, 6, "budget", 3000);
    await waitForBudgetGroups(
      (g) =>
        g.find((x) => x.id === "bolig")?.items.find((it) => it.id === id)?.months[6]?.budget ===
        3000,
    );

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/budget/bolig/${id}`),
    );
    const value = snapshot.val() as { months: { budget: number }[] };
    expect(value.months[6]?.budget).toBe(3000);
    expect(value.months[0]?.budget).toBe(100); // uendret
  });

  it("removeItem fjerner posten, og skriver _gruppeplassholder tilbake når gruppen blir tom", async () => {
    const id = await addItem(FAMILY_ID, "budget", "bolig", {
      name: "Skal fjernes",
      budget: 1,
      spent: 0,
      monthIndex: 0,
    });
    await waitForBudgetGroups(
      (g) => !!g.find((x) => x.id === "bolig")?.items.some((it) => it.id === id),
    );

    await removeItem(FAMILY_ID, "budget", "bolig", id, true);
    await waitForBudgetGroups((g) => g.find((x) => x.id === "bolig")?.items.length === 0);

    const snapshot = await get(ref(getFirebaseDatabase(), `families/${FAMILY_ID}/budget/bolig`));
    expect((snapshot.val() as Record<string, unknown>)._gruppeplassholder).toBe(true);
  });

  it("saveItemMeta erstatter meta og endrer navn kun når eksplisitt sendt inn", async () => {
    const id = await addItem(FAMILY_ID, "budget", "bolig", {
      name: "Opprinnelig navn",
      budget: 1,
      spent: 0,
      monthIndex: 0,
    });
    await waitForBudgetGroups(
      (g) => !!g.find((x) => x.id === "bolig")?.items.some((it) => it.id === id),
    );

    await saveItemMeta(FAMILY_ID, "budget", "bolig", id, { eier: "Helen", automatisk: true });
    await waitForBudgetGroups(
      (g) =>
        g.find((x) => x.id === "bolig")?.items.find((it) => it.id === id)?.meta?.eier === "Helen",
    );

    let snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/budget/bolig/${id}`),
    );
    expect((snapshot.val() as { name: string }).name).toBe("Opprinnelig navn");

    await saveItemMeta(FAMILY_ID, "budget", "bolig", id, { eier: "Eivind" }, "Nytt navn");
    await waitForBudgetGroups(
      (g) =>
        g.find((x) => x.id === "bolig")?.items.find((it) => it.id === id)?.name === "Nytt navn",
    );

    snapshot = await get(ref(getFirebaseDatabase(), `families/${FAMILY_ID}/budget/bolig/${id}`));
    const value = snapshot.val() as { name: string; meta: { eier: string } };
    expect(value.name).toBe("Nytt navn");
    expect(value.meta.eier).toBe("Eivind");
  });
});
