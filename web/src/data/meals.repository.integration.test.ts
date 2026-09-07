/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en Hosting-
 * forhåndsvisning. Kjøres via `npm run test:integration`. Se
 * `freezer.repository.integration.test.ts`/`recipes.repository.integration.test.ts`
 * for det delte mønsteret.
 *
 * §Kontrolltårn-handoff sin testmatrise dekkes eksplisitt her:
 * samtidighet på ULIKE dager i samme uke (skal begge overleve — dette er
 * selve poenget med per-dag-noder), samtidighet på SAMME dag (atomisk
 * serialisert av RTDB), og full `recipeId:null`-normalisering (menu og
 * enkelt-oppskrift).
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
import { subscribeWeekMeals, transactMealDay } from "./meals.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { MealRecipeRef, MealValue } from "@app-types/meal";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin-meals",
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

function newWeekKey(): string {
  // Unik per test — unngår at tester paavirker hverandres uke-node.
  return `test-week-${randomUUID()}`;
}

/**
 * Bevisst enkel, inline updater (ikke domenefunksjonen `addRecipeToMeal`
 * — `src/data/**` har ikke lov å importere `src/domain/**`, håndhevet av
 * eslint). Det som verifiseres her er at `transactMealDay` selv
 * garanterer atomisk les-endre-skriv paa tvers av konkurrerende kall,
 * ikke at domenelogikken er riktig (det dekker meals.test.ts). Speiler
 * samme mønster som `recipes.repository.integration.test.ts` sin
 * `addTag`/`markCooked`.
 */
function addRecipe(current: MealValue | null, recipe: MealRecipeRef): MealValue {
  const existing: MealRecipeRef[] =
    current && typeof current === "object" && current.type === "menu"
      ? current.recipes
      : current && typeof current === "object" && current.type === "recipe"
        ? [{ name: current.name, recipeId: current.recipeId }]
        : [];
  const newRecipes = [...existing, recipe];
  return { type: "menu", name: newRecipes.map((r) => r.name).join(" · "), recipes: newRecipes };
}

describe("meals.repository (emulator)", () => {
  it("skriver og leser én dag via abonnement", async () => {
    const weekKey = newWeekKey();
    const value: MealValue = { type: "recipe", name: "Taco", recipeId: "r1" };
    await transactMealDay(FAMILY_ID, weekKey, "Mon", () => value);

    const seen = await new Promise<MealValue | undefined>((resolve) => {
      const unsubscribe = subscribeWeekMeals(FAMILY_ID, weekKey, (meals) => {
        if (meals.Mon) {
          unsubscribe();
          resolve(meals.Mon);
        }
      });
    });
    expect(seen).toEqual(value);
  });

  it("tømming av én dag ('') fjerner kun den dagens node, andre dager upaavirket", async () => {
    const weekKey = newWeekKey();
    await transactMealDay(FAMILY_ID, weekKey, "Mon", () => "Grandiosa");
    await transactMealDay(FAMILY_ID, weekKey, "Tue", () => "Rester");

    await transactMealDay(FAMILY_ID, weekKey, "Mon", () => "");

    const afterClear = await new Promise<{ hasMon: boolean; tueValue: MealValue | undefined }>(
      (resolve) => {
        const unsubscribe = subscribeWeekMeals(FAMILY_ID, weekKey, (meals) => {
          if (meals.Tue !== undefined) {
            unsubscribe();
            resolve({ hasMon: meals.Mon !== undefined, tueValue: meals.Tue });
          }
        });
      },
    );
    expect(afterClear).toEqual({ hasMon: false, tueValue: "Rester" });
  });

  it("konkurrerende skriving paa TO ULIKE dager i SAMME uke overlever begge (per-dag-noder løser hele-uke-racen)", async () => {
    const weekKey = newWeekKey();

    await Promise.all([
      transactMealDay(FAMILY_ID, weekKey, "Mon", () => "Taco"),
      transactMealDay(FAMILY_ID, weekKey, "Tue", () => "Lasagne"),
    ]);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/meals/${weekKey}`),
    );
    const week = snapshot.val() as Record<string, MealValue>;
    // Speiler nettopp risikoen dagens hele-uke-`setWeekMeals` har: uten
    // per-dag-noder kunne den ene skrivingen tapt for den andre.
    expect(week.Mon).toBe("Taco");
    expect(week.Tue).toBe("Lasagne");
  });

  it("konkurrerende skriving paa SAMME dag serialiseres atomisk (ingen tapt legg-til)", async () => {
    const weekKey = newWeekKey();

    const addTaco = (current: MealValue | null): MealValue =>
      addRecipe(current, { name: "Taco", recipeId: "r1" });
    const addPannekaker = (current: MealValue | null): MealValue =>
      addRecipe(current, { name: "Pannekaker", recipeId: "r2" });

    await transactMealDay(FAMILY_ID, weekKey, "Wed", () => ({
      type: "recipe",
      name: "Suppe",
      recipeId: "r0",
    }));

    await Promise.all([
      transactMealDay(FAMILY_ID, weekKey, "Wed", addTaco),
      transactMealDay(FAMILY_ID, weekKey, "Wed", addPannekaker),
    ]);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/meals/${weekKey}/Wed`),
    );
    const finalValue = snapshot.val() as MealValue;
    // Begge samtidige legg-til-forsøk skal ha overlevd — RTDB kjører
    // updateren paa nytt naar den oppdager konkurrerende skriving, en
    // sterkere garanti enn dagens siste-skriving-vinner-mønster.
    expect(typeof finalValue).toBe("object");
    const menu = finalValue as { type: string; recipes: { name: string }[] };
    expect(menu.type).toBe("menu");
    expect(menu.recipes.map((r) => r.name).sort()).toEqual(["Pannekaker", "Suppe", "Taco"]);
  });

  it("en updater som returnerer undefined avbryter transaksjonen uten aa skrive noe (§addRecipeToMeal sitt duplikat-signal, domain/meals.test.ts)", async () => {
    const weekKey = newWeekKey();
    const original: MealValue = { type: "recipe", name: "Taco", recipeId: "r1" };
    await transactMealDay(FAMILY_ID, weekKey, "Thu", () => original);

    await transactMealDay(FAMILY_ID, weekKey, "Thu", () => undefined);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/meals/${weekKey}/Thu`),
    );
    expect(snapshot.val()).toEqual(original);
  });

  it("leser recipeId:null tilbake som eksplisitt null, ikke fraværende (RTDB dropper null ved skriving)", async () => {
    const weekKey = newWeekKey();
    await transactMealDay(FAMILY_ID, weekKey, "Fri", () => ({
      type: "recipe",
      name: "Biblioteksmiddag",
      recipeId: null,
    }));

    const seen = await new Promise<MealValue | undefined>((resolve) => {
      const unsubscribe = subscribeWeekMeals(FAMILY_ID, weekKey, (meals) => {
        if (meals.Fri) {
          unsubscribe();
          resolve(meals.Fri);
        }
      });
    });
    expect(seen).toEqual({ type: "recipe", name: "Biblioteksmiddag", recipeId: null });
    expect((seen as { recipeId: string | null }).recipeId).toBeNull();
  });

  it("normaliserer recipeId:null for HVER oppskrift inni en meny", async () => {
    const weekKey = newWeekKey();
    const menuValue: MealValue = {
      type: "menu",
      name: "Taco · Biblioteksmiddag",
      recipes: [
        { name: "Taco", recipeId: "r1" },
        { name: "Biblioteksmiddag", recipeId: null },
      ],
    };
    await transactMealDay(FAMILY_ID, weekKey, "Sat", () => menuValue);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/meals/${weekKey}/Sat`),
    );
    expect(snapshot.val().recipes[1].recipeId).toBeUndefined(); // raadata fra Firebase mangler feltet

    const seen = await new Promise<MealValue | undefined>((resolve) => {
      const unsubscribe = subscribeWeekMeals(FAMILY_ID, weekKey, (meals) => {
        if (meals.Sat) {
          unsubscribe();
          resolve(meals.Sat);
        }
      });
    });
    expect(seen).toEqual(menuValue); // normalisert tilbake til eksplisitt null
  });
});

describe("security rules (emulator): medlemskap håndheves for meals", () => {
  it("nekter lesing og skriving for en autentisert bruker som IKKE er medlem av familien", async () => {
    const nonMemberApp = initializeClientApp(
      { projectId: PROJECT_ID, databaseURL: DATABASE_URL, apiKey: "demo-key" },
      "non-member-test-app-meals",
    );
    const nonMemberAuth = getClientAuth(nonMemberApp);
    connectAuthEmulator(nonMemberAuth, "http://127.0.0.1:9099", { disableWarnings: true });
    const nonMemberDb = getClientDatabase(nonMemberApp);
    connectDatabaseEmulator(nonMemberDb, "127.0.0.1", 9000);

    const nonMemberUid = `non-member-${randomUUID()}`;
    await getAdminAuth(adminApp).createUser({ uid: nonMemberUid });
    const token = await getAdminAuth(adminApp).createCustomToken(nonMemberUid);
    await signInWithCustomToken(nonMemberAuth, token);

    const weekKey = newWeekKey();
    await expect(get(ref(nonMemberDb, `families/${FAMILY_ID}/meals/${weekKey}`))).rejects.toThrow(
      /permission.?denied/i,
    );
    await expect(
      set(ref(nonMemberDb, `families/${FAMILY_ID}/meals/${weekKey}/Mon`), "Skal ikke skrives"),
    ).rejects.toThrow(/permission.?denied/i);

    await deleteClientApp(nonMemberApp);
  });
});
