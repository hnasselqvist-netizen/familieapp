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
  goOffline,
  goOnline,
  onValue,
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
  transactMealLibraryEntryMedUtfall,
  TvetydigIdentitet,
} from "./mealLibrary.repository";
import {
  addVariantShoppingBaseItem,
  removeShoppingBaseItem,
  removeVariantShoppingBaseItem,
  updateEntryFields,
  updateShoppingBaseItemField,
  updateVariant,
} from "@domain/mealLibrary/mealLibrary";
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
              { id: "var1", name: "Hjemmelaget", source: "recipe" as const, recipeId: "r1" },
              {
                id: "var2",
                name: "Kjøpetaco",
                source: "shoppingBase" as const,
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
      { id: "var1", name: "Hjemmelaget", source: "recipe", recipeId: "r1" },
      {
        id: "var2",
        name: "Kjøpetaco",
        source: "shoppingBase",
        shoppingBase: [
          { id: "sb1", itemId: "v9", name: "Tacoskjell", amount: "1", unit: "pk", cat: "Tørrvare" },
        ],
      },
    ]);
  });

  it("en fersk handlegrunnlag-kildet variant med TOM shoppingBase (ingen varer lagt til ennå) rundtripper med samme kilde, ikke som en (ugyldig) oppskrift-variant (§Nattvakt-review, PR #18, andre runde)", async () => {
    const created = await createMealLibraryEntry(FAMILY_ID, `Pizza ${randomUUID()}`);

    await transactMealLibraryEntry(FAMILY_ID, created.id, (current) =>
      current
        ? {
            ...current,
            variants: [
              { id: "var1", name: "Kjøpepizza", source: "shoppingBase" as const, shoppingBase: [] },
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
      { id: "var1", name: "Kjøpepizza", source: "shoppingBase", shoppingBase: [] },
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

/**
 * #20 6749312086 (regresjon fra #137): ordinære endringer bevarer felt appen
 * ikke kjenner. Syntetiske data, bare mot emulatoren. Kallene speiler
 * `useMealLibrary`: domenefunksjon inne i `transactMealLibraryEntry`.
 */
describe("transactMealLibraryEntry bevarer råfelt (emulator)", () => {
  const rad = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    itemId: `i-${id}`,
    name: `Vare ${id}`,
    amount: "",
    unit: "",
    cat: "K",
    ...over,
  });
  const raaPost = () => ({
    name: `Syntetisk ${randomUUID()}`,
    notat: "post",
    shoppingBase: [rad("a", { notat: "rad a" }), rad("b", { notat: "rad b" })],
    variants: [
      { id: "v1", name: "Hjemme", source: "recipe", recipeId: "r1", notat: "variant" },
      {
        id: "v2",
        name: "Kjøpt",
        source: "shoppingBase",
        shoppingBase: [rad("c", { notat: "rad c" })],
      },
    ],
  });
  const sti = (id: string) => `families/${FAMILY_ID}/mealLibrary/${id}`;
  const seed = async (verdi: Record<string, unknown>) => {
    const id = randomUUID();
    await getAdminDatabase(adminApp).ref(sti(id)).set(verdi);
    return id;
  };
  const lagret = async (id: string) =>
    (await getAdminDatabase(adminApp).ref(sti(id)).get()).val() as Record<string, unknown> | null;

  it("«Lettvint» bevarer notat på posten, varelinjer, varianter og variantens varelinjer (#137)", async () => {
    const raa = raaPost();
    const id = await seed(raa);
    await transactMealLibraryEntry(FAMILY_ID, id, (c) =>
      c ? updateEntryFields(c, { lettvint: true }) : null,
    );
    expect(await lagret(id)).toEqual({ ...raa, lettvint: true });
  });

  it("endret og fjernet varelinje og omdøpt variant: riktige felt følger riktig objekt", async () => {
    const raa = raaPost();
    const id = await seed(raa);
    await transactMealLibraryEntry(FAMILY_ID, id, (c) =>
      c ? updateShoppingBaseItemField(c, "a", "amount", "2") : null,
    );
    await transactMealLibraryEntry(FAMILY_ID, id, (c) =>
      c ? removeShoppingBaseItem(c, "b") : null,
    );
    await transactMealLibraryEntry(FAMILY_ID, id, (c) =>
      c ? updateVariant(c, "v2", { name: "Butikk" }) : null,
    );
    expect(await lagret(id)).toEqual({
      ...raa,
      shoppingBase: [rad("a", { notat: "rad a", amount: "2" })],
      variants: [raa.variants[0], { ...raa.variants[1], name: "Butikk" }],
    });
  });

  it("tvetydig identitet i en endret samling stopper uten å skrive; uendret samling går", async () => {
    const raa = { name: "Syntetisk", shoppingBase: [rad("a", { notat: "x" }), rad("a")] };
    const id = await seed(raa);
    await expect(
      transactMealLibraryEntry(FAMILY_ID, id, (c) =>
        c ? updateShoppingBaseItemField(c, "a", "unit", "g") : null,
      ),
    ).rejects.toBeInstanceOf(TvetydigIdentitet);
    expect(await lagret(id)).toEqual(raa);

    await transactMealLibraryEntry(FAMILY_ID, id, (c) =>
      c ? updateEntryFields(c, { lettvint: true }) : null,
    );
    expect(await lagret(id)).toEqual({ ...raa, lettvint: true });
  });

  it("avbrudd (undefined) skriver ingenting, og null fjerner posten, som før", async () => {
    const raa = raaPost();
    const id = await seed(raa);
    await transactMealLibraryEntry(FAMILY_ID, id, () => undefined);
    expect(await lagret(id)).toEqual(raa);
    await transactMealLibraryEntry(FAMILY_ID, id, () => null);
    expect(await lagret(id)).toBeNull();
  });

  it("samtidige endringer på samme post: begge lagres, og råfelt bevares", async () => {
    const raa = raaPost();
    const id = await seed(raa);
    await Promise.all([
      transactMealLibraryEntry(FAMILY_ID, id, (c) =>
        c ? updateEntryFields(c, { lettvint: true }) : null,
      ),
      transactMealLibraryEntry(FAMILY_ID, id, (c) =>
        c ? updateShoppingBaseItemField(c, "a", "unit", "g") : null,
      ),
      transactMealLibraryEntry(FAMILY_ID, id, (c) =>
        c ? updateVariant(c, "v2", { name: "Butikk" }) : null,
      ),
    ]);
    expect(await lagret(id)).toEqual({
      ...raa,
      lettvint: true,
      shoppingBase: [rad("a", { notat: "rad a", unit: "g" }), raa.shoppingBase[1]],
      variants: [raa.variants[0], { ...raa.variants[1], name: "Butikk" }],
    });
  });

  it("et felt skrevet utenfor appen mens appen har en utdatert kopi, bevares når transaksjonen prøves på nytt", async () => {
    const raa = raaPost();
    const id = await seed(raa);
    const db = getFirebaseDatabase();
    // Varm lokal kopi, så første kjøring av updateren bygger på den.
    const avmeld = onValue(ref(db, sti(id)), () => undefined);
    await get(ref(db, sti(id)));
    let kjoringer = 0;
    goOffline(db);
    try {
      await getAdminDatabase(adminApp)
        .ref(`${sti(id)}/ekstern`)
        .set("skrevet utenfor");
      const skriving = transactMealLibraryEntry(FAMILY_ID, id, (c) => {
        kjoringer += 1;
        return c ? updateEntryFields(c, { lettvint: true }) : null;
      });
      goOnline(db);
      await skriving;
    } finally {
      goOnline(db);
      avmeld();
    }
    expect(kjoringer).toBeGreaterThan(1);
    expect(await lagret(id)).toEqual({ ...raa, lettvint: true, ekstern: "skrevet utenfor" });
  });
});

/**
 * #20 6754247077: varelinjer i en variant legges til og fjernes per rad-id fra
 * transaksjonens ferske variant (som `useMealLibrary` gjør), ikke som en hel
 * liste fra skjermens verdi. Syntetiske data, bare mot emulatoren.
 */
describe("varelinjer i en variant: per rad-id fra fersk verdi (emulator)", () => {
  const rad = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    itemId: `i-${id}`,
    name: `Vare ${id}`,
    amount: "",
    unit: "",
    cat: "K",
    ...over,
  });
  const vare = (id: string) => ({ itemId: `i-${id}`, name: `Vare ${id}`, cat: "K" });
  const sti = (id: string) => `families/${FAMILY_ID}/mealLibrary/${id}`;
  const seed = async (rader: Record<string, unknown>[]) => {
    const id = randomUUID();
    await getAdminDatabase(adminApp)
      .ref(sti(id))
      .set({
        name: "Syntetisk",
        variants: [
          { id: "v1", name: "Hjemme", source: "recipe", recipeId: "r1" },
          { id: "v2", name: "Kjøpt", source: "shoppingBase", shoppingBase: rader },
        ],
      });
    return id;
  };
  const lagret = async (id: string) =>
    (await getAdminDatabase(adminApp).ref(sti(id)).get()).val() as {
      variants: Record<string, unknown>[];
    } | null;
  // Skriveinngangen hooken bruker: transaksjon med utfall + domenefunksjon.
  const leggTil = (id: string, radId: string, variantId = "v2") =>
    transactMealLibraryEntryMedUtfall(
      FAMILY_ID,
      id,
      (c) => addVariantShoppingBaseItem(c, variantId, radId, vare(radId)),
      "middagMangler",
    );
  const fjern = (id: string, radId: string, variantId = "v2") =>
    transactMealLibraryEntryMedUtfall(
      FAMILY_ID,
      id,
      (c) => removeVariantShoppingBaseItem(c, variantId, radId),
      "middagMangler",
    );

  /**
   * Klienten har en varm, men utdatert kopi: frakoblet mens `ekstern` endrer
   * posten, så første kjøring av transaksjonen bygger på skjermens gamle verdi.
   */
  async function medUtdatertKopi(
    id: string,
    ekstern: () => Promise<unknown>,
    handling: () => Promise<unknown>,
  ) {
    let utfall: unknown;
    const db = getFirebaseDatabase();
    const avmeld = onValue(ref(db, sti(id)), () => undefined);
    await get(ref(db, sti(id)));
    goOffline(db);
    try {
      await ekstern();
      const skriving = handling();
      goOnline(db);
      utfall = await skriving;
    } finally {
      goOnline(db);
      avmeld();
    }
    return utfall;
  }

  it("legg til med utdatert skjermverdi beholder en linje lagt til samtidig (reproduserte tapet)", async () => {
    const id = await seed([rad("c")]);
    await medUtdatertKopi(
      id,
      () =>
        getAdminDatabase(adminApp)
          .ref(`${sti(id)}/variants/1/shoppingBase/1`)
          .set(rad("d")),
      () => leggTil(id, "x"),
    );
    expect((await lagret(id))?.variants[1]?.shoppingBase).toEqual([rad("c"), rad("d"), rad("x")]);
  });

  it("fjern med utdatert skjermverdi fjerner bare sin linje og beholder en linje lagt til samtidig", async () => {
    const id = await seed([rad("c")]);
    await medUtdatertKopi(
      id,
      () =>
        getAdminDatabase(adminApp)
          .ref(`${sti(id)}/variants/1/shoppingBase/1`)
          .set(rad("d")),
      () => fjern(id, "c"),
    );
    expect((await lagret(id))?.variants[1]?.shoppingBase).toEqual([rad("d")]);
  });

  it("samtidig legg til og fjern på samme variant: alle endringer lagres", async () => {
    const id = await seed([rad("c"), rad("d")]);
    expect(await Promise.all([leggTil(id, "x"), fjern(id, "c"), leggTil(id, "y")])).toEqual([
      null,
      null,
      null,
    ]);
    const ider = ((await lagret(id))?.variants[1]?.shoppingBase as { id: string }[]).map(
      (r) => r.id,
    );
    expect([...ider].sort()).toEqual(["d", "x", "y"]);
  });

  it("variant fjernet underveis: stopp med variantMangler, ingenting skrives eller gjenopprettes", async () => {
    const id = await seed([rad("c")]);
    const utfall = await medUtdatertKopi(
      id,
      () =>
        getAdminDatabase(adminApp)
          .ref(`${sti(id)}/variants/1`)
          .remove(),
      () => leggTil(id, "x"),
    );
    expect(utfall).toBe("variantMangler");
    const ut = await lagret(id);
    expect(ut?.variants).toEqual([{ id: "v1", name: "Hjemme", source: "recipe", recipeId: "r1" }]);
  });

  it("kilden byttet til oppskrift underveis: stopp med kildeByttet, kilden byttes ikke tilbake", async () => {
    const id = await seed([rad("c")]);
    const utfall = await medUtdatertKopi(
      id,
      () =>
        getAdminDatabase(adminApp)
          .ref(`${sti(id)}/variants/1`)
          .set({ id: "v2", name: "Kjøpt", source: "recipe", recipeId: "r2" }),
      () => fjern(id, "c"),
    );
    expect(utfall).toBe("kildeByttet");
    expect((await lagret(id))?.variants[1]).toEqual({
      id: "v2",
      name: "Kjøpt",
      source: "recipe",
      recipeId: "r2",
    });
  });

  it("tvetydig variant-id stopper uten skriving, både tillegg og fjerning", async () => {
    const id = randomUUID();
    const verdi = {
      name: "Syntetisk",
      variants: [
        { id: "v2", name: "A", source: "shoppingBase", shoppingBase: [rad("c")] },
        { id: "v2", name: "B", source: "shoppingBase", shoppingBase: [rad("c")] },
      ],
    };
    await getAdminDatabase(adminApp).ref(sti(id)).set(verdi);
    expect(await leggTil(id, "x")).toBe("tvetydigVariant");
    expect(await fjern(id, "c")).toBe("tvetydigVariant");
    expect(await lagret(id)).toEqual(verdi);
  });

  it("tvetydig rad-id stopper fjerning uten skriving, også uten ukjente felt", async () => {
    const id = await seed([rad("c"), rad("c"), rad("d")]);
    const for_ = await lagret(id);
    expect(await fjern(id, "c")).toBe("tvetydigRad");
    expect(await lagret(id)).toEqual(for_);
  });

  it("rad som allerede er fjernet gir radMangler uten skriving; slettet middag gir middagMangler", async () => {
    const id = await seed([rad("d")]);
    const for_ = await lagret(id);
    expect(await fjern(id, "c")).toBe("radMangler");
    expect(await lagret(id)).toEqual(for_);

    await getAdminDatabase(adminApp).ref(sti(id)).remove();
    expect(await leggTil(id, "x")).toBe("middagMangler");
    expect(await lagret(id)).toBeNull();
  });

  it("råfeltvernet fra #138 gjelder: ukjente felt på uendrede linjer og varianten bevares", async () => {
    const id = await seed([rad("c", { notat: "rad c" })]);
    await getAdminDatabase(adminApp)
      .ref(`${sti(id)}/variants/1/notat`)
      .set("variant");
    await leggTil(id, "x");
    expect((await lagret(id))?.variants[1]).toEqual({
      id: "v2",
      name: "Kjøpt",
      source: "shoppingBase",
      notat: "variant",
      shoppingBase: [rad("c", { notat: "rad c" }), rad("x")],
    });
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
