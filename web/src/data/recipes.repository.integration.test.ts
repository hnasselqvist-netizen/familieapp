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
  goOffline,
  goOnline,
  onValue,
  ref,
  set,
} from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRecipe,
  deleteRecipe,
  subscribeRecipes,
  transactRecipe,
  transactRecipeMedUtfall,
} from "./recipes.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { Recipe, RecipeFields } from "@app-types/recipe";
import {
  getIngredients,
  markRecipeCooked,
  redigerHvisUendret,
  scaleIngredientAmount,
} from "@domain/recipes/recipes";

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

  it("leser en ingrediens sin itemId/kategori tilbake — REGRESJONSTEST: Ingredient↔Vare-koblingen (§Kontrolltårn-handoff, Issue #2)", async () => {
    const created = await createRecipe(
      FAMILY_ID,
      baseRecipe({
        ingredients: [{ name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt", itemId: "v1" }],
      }),
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
    expect(viaSubscription.ingredients[0]?.itemId).toBe("v1");
    expect(viaSubscription.ingredients[0]?.cat).toBe("Kjøtt");
  });

  it("Kokebok-post i formen fra oppskrift-fra-bilde-arbeidsflyten (docs/drift/oppskrift-fra-bilde.md), skrevet utenfor appen, leses og oppdateres som en vanlig oppskrift", async () => {
    // #27 6734076717: ChatGPT skriver via `data_skriv` uten null og tomme
    // lister (avvises der), med `id` lik nøkkelen og grupper. Posten legges
    // derfor inn utenfor appen (Admin SDK = samme lagringsform), og appens
    // egen leser og redigering må godta den uten tap. Syntetiske data.
    const id = randomUUID();
    const post = {
      id,
      name: "Fiskesuppe med safran",
      cat: "Middag",
      time: 40,
      servings: 4,
      url: "",
      source: "image",
      instructions: "Fres løk og gulrot i smør.\n\nTilsett kraft og fløte, og la det småkoke.",
      createdAt: 1794211200000,
      timesCooked: 0,
      ingredientGroups: [
        {
          id: randomUUID(),
          name: "Suppe",
          ingredients: [
            { name: "Torskefilet", amount: "400 g", unit: "g", cat: "Fisk", itemId: "vare-torsk" },
            { name: "Fiskekraft", amount: "0.5 l", unit: "l", cat: "Diverse" },
            { name: "Safran", amount: "", unit: "etter behov", cat: "Diverse" },
          ],
        },
        {
          id: randomUUID(),
          name: "Servering",
          ingredients: [{ name: "Brød", amount: "1 stk", unit: "stk", cat: "Diverse" }],
        },
      ],
    };
    await getAdminDatabase(adminApp).ref(`families/${FAMILY_ID}/recipes/${id}`).set(post);

    const lest = await new Promise<RecipeFields>((resolve) => {
      const unsubscribe = subscribeRecipes(FAMILY_ID, (recipes) => {
        const found = recipes.find((r) => r.id === id);
        if (found) {
          unsubscribe();
          resolve(found);
        }
      });
    });
    // Feltene som utelates, får appens standardverdier.
    expect(lest).toMatchObject({
      name: "Fiskesuppe med safran",
      cat: "Middag",
      time: 40,
      servings: 4,
      source: "image",
      tags: [],
      imageUrl: null,
      lastCooked: null,
      timesCooked: 0,
      ingredients: [],
    });
    expect(lest.ingredientGroups.map((g) => g.name)).toEqual(["Suppe", "Servering"]);
    const ingredienser = getIngredients(lest);
    expect(ingredienser.map((i) => i.name)).toEqual([
      "Torskefilet",
      "Fiskekraft",
      "Safran",
      "Brød",
    ]);
    expect(ingredienser.map((i) => i.itemId)).toEqual([
      "vare-torsk",
      undefined,
      undefined,
      undefined,
    ]);
    // Desimalpunktum skaleres; «etter behov» står urørt.
    expect(scaleIngredientAmount("0.5 l", lest.servings, 8)).toBe("1 l");
    expect(scaleIngredientAmount("", lest.servings, 8)).toBe("");

    // «Bekreft middag» (appens transaksjon) på posten mister ingen felt.
    await transactRecipe(FAMILY_ID, id, (current) =>
      current ? markRecipeCooked(current, 1794300000000) : current,
    );
    const etter = (
      await getAdminDatabase(adminApp).ref(`families/${FAMILY_ID}/recipes/${id}`).get()
    ).val() as Record<string, unknown>;
    expect(etter).toMatchObject({
      name: post.name,
      instructions: post.instructions,
      createdAt: post.createdAt,
      timesCooked: 1,
      lastCooked: 1794300000000,
      ingredientGroups: post.ingredientGroups,
    });
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

/**
 * #20 6736384489: `transactRecipe` skrev tilbake `updater(parseRecipeFields(current))`
 * som hel post, og parseren tar bare med kjente felt. Dermed forsvant det
 * lagrede `id`-feltet (som `index.html` leser) og alle andre ukjente felt ved
 * en ordinær redigering. Kjente felt som manglet på posten, ble `undefined`.
 * Testene går gjennom den ekte transaksjonsinngangen, med samme updatere som
 * appen bruker (`useRecipes.updateRecipe` og `markRecipeCooked`). Syntetiske data.
 */
describe("transactRecipe bevarer lagrede felt utenfor oppdateringen (emulator)", () => {
  const admin = () => getAdminDatabase(adminApp);
  const sti = (id: string) => `families/${FAMILY_ID}/recipes/${id}`;
  const lesRa = async (id: string) =>
    (await admin().ref(sti(id)).get()).val() as Record<string, unknown> | null;
  /** Samme updater som `useRecipes.updateRecipe`. */
  const oppdater = (id: string, patch: Partial<RecipeFields>) =>
    transactRecipe(FAMILY_ID, id, (current) => (current ? { ...current, ...patch } : null));

  const fullPost = (id: string) => ({
    id,
    name: "Syntetisk lasagne",
    cat: "Middag",
    tags: ["helg"],
    time: 60,
    servings: 4,
    url: "",
    imageUrl: "https://example.invalid/bilde.jpg",
    source: "manual",
    instructions: "Lag saus.",
    ingredients: [
      {
        name: "Pasta",
        amount: "250 g",
        unit: "g",
        cat: "Tørrvarer",
        itemId: "v1",
        ekstra: "behold",
      },
    ],
    createdAt: 1790000000000,
    timesCooked: 2,
    lastCooked: 1791000000000,
    lettvint: true,
    variationTags: ["pasta"],
    framtidigFelt: { a: 1, b: "x" },
  });

  it("redigering bevarer lagret id og ukjente felt, og endrer bare det oppdateringen gjelder", async () => {
    const id = randomUUID();
    await admin().ref(sti(id)).set(fullPost(id));
    await oppdater(id, { name: "Lasagne (ny)" });
    expect(await lesRa(id)).toEqual({ ...fullPost(id), name: "Lasagne (ny)" });
  });

  it("«Bekreft middag» (markRecipeCooked) bevarer id og ukjente felt", async () => {
    const id = randomUUID();
    await admin().ref(sti(id)).set(fullPost(id));
    await transactRecipe(FAMILY_ID, id, (c) => (c ? markRecipeCooked(c, 1792000000000) : c));
    expect(await lesRa(id)).toEqual({
      ...fullPost(id),
      timesCooked: 3,
      lastCooked: 1792000000000,
    });
  });

  it("post uten id får ikke id lagt til (ingen tilbakefylling)", async () => {
    const id = randomUUID();
    const { id: _bort, ...utenId } = fullPost(id);
    void _bort;
    await admin().ref(sti(id)).set(utenId);
    await oppdater(id, { time: 75 });
    const etter = await lesRa(id);
    expect(etter).toEqual({ ...utenId, time: 75 });
    expect(etter).not.toHaveProperty("id");
  });

  it("eldre post med numerisk id og uten createdAt/source/instructions/timesCooked kan oppdateres; manglende felt legges ikke til", async () => {
    const id = randomUUID();
    const eldre = {
      id: 4,
      name: "Syntetisk taco",
      cat: "Middag",
      tags: ["favoritt"],
      time: 30,
      servings: 4,
      url: "",
      ingredients: [{ name: "Kjøttdeig", amount: "500g", cat: "Kjøtt" }],
    };
    await admin().ref(sti(id)).set(eldre);
    await transactRecipe(FAMILY_ID, id, (c) => (c ? markRecipeCooked(c, 1792000000000) : c));
    expect(await lesRa(id)).toEqual({ ...eldre, timesCooked: 1, lastCooked: 1792000000000 });
  });

  it("tilsiktet tømming av kjente felt virker som før; id og ukjente felt står", async () => {
    const id = randomUUID();
    await admin().ref(sti(id)).set(fullPost(id));
    // Samme patch-form som RecipeFormModal sender når feltene tømmes.
    await oppdater(id, {
      tags: [],
      imageUrl: null,
      variationTags: [],
      lettvint: false,
      ingredients: [],
      ingredientGroups: [],
      instructions: "",
    });
    const { tags: _t, imageUrl: _i, variationTags: _v, ingredients: _g, ...rest } = fullPost(id);
    void [_t, _i, _v, _g];
    expect(await lesRa(id)).toEqual({ ...rest, lettvint: false, instructions: "" });
  });

  it("updater som returnerer null sletter hele posten, også ukjente felt (uendret semantikk)", async () => {
    const id = randomUUID();
    await admin().ref(sti(id)).set(fullPost(id));
    await transactRecipe(FAMILY_ID, id, () => null);
    expect(await lesRa(id)).toBeNull();
  });
});

describe("Kokebok-redigering med observert grunnlag (#20 6781074174, emulator)", () => {
  const admin = () => getAdminDatabase(adminApp);
  const sti = (id: string) => `families/${FAMILY_ID}/recipes/${id}`;
  const lesRa = async (id: string) =>
    (await admin().ref(sti(id)).get()).val() as Record<string, unknown> | null;

  /** Oppskriften slik skjemaet ser den når det åpnes (samme abonnement som appen). */
  const observer = (id: string) =>
    new Promise<Recipe>((resolve) => {
      const unsubscribe = subscribeRecipes(FAMILY_ID, (recipes) => {
        const found = recipes.find((r) => r.id === id);
        if (found) {
          unsubscribe();
          resolve(found);
        }
      });
    });

  /** Patchen `RecipeFormModal.save` sender: hele skjemaet, med endringene brukeren gjorde. */
  const skjema = (o: Recipe, endring: Partial<RecipeFields>): Partial<RecipeFields> => ({
    name: o.name,
    time: o.time,
    servings: o.servings,
    cat: o.cat,
    tags: o.tags,
    imageUrl: o.imageUrl,
    url: o.url,
    lettvint: o.lettvint ?? false,
    variationTags: o.variationTags ?? [],
    instructions: o.instructions,
    ingredients: o.ingredients,
    ingredientGroups: o.ingredientGroups,
    ...endring,
  });

  /** Samme updater som `useRecipes.updateRecipe` (ordinær redigering før rettingen). */
  const gammelLagring = (id: string, patch: Partial<RecipeFields>) =>
    transactRecipe(FAMILY_ID, id, (current) => (current ? { ...current, ...patch } : null));

  /** Samme kall og samme utfallsmapping som `useRecipes.redigerRecipe`. */
  const rediger = async (observert: Recipe, patch: Partial<RecipeFields>) => {
    const { id, ...felt } = observert;
    const r = await transactRecipeMedUtfall(
      FAMILY_ID,
      id,
      (current) => redigerHvisUendret(current, felt, patch),
      "mangler" as const,
    );
    return r.type === "stopp" ? r.utfall : r.type;
  };

  it("reproduksjon: før rettingen overskrev et skjema åpnet før en annen endring den nyere ingrediensmengden", async () => {
    const { id } = await createRecipe(FAMILY_ID, baseRecipe({ name: "Taco" }));
    const observert = await observer(id);
    await gammelLagring(id, {
      ingredients: [{ name: "Kjøttdeig", amount: "800 g", cat: "Kjøtt" }],
    });

    await gammelLagring(id, skjema(observert, { name: "Fredagstaco" }));

    const etter = await lesRa(id);
    expect(etter?.name).toBe("Fredagstaco");
    // Den nyere mengden fra den andre enheten er tapt.
    expect(etter?.ingredients).toEqual([{ name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt" }]);
  });

  it.each([
    ["ingredienser", { ingredients: [{ name: "Kjøttdeig", amount: "800 g", cat: "Kjøtt" }] }],
    ["porsjoner", { servings: 6 }],
  ])(
    "navneendring med samtidig endring av %s: avvises med «endret», og ingenting skrives",
    async (_, samtidig) => {
      const { id } = await createRecipe(FAMILY_ID, baseRecipe({ name: "Taco" }));
      const observert = await observer(id);
      await gammelLagring(id, samtidig);
      const foer = await lesRa(id);

      expect(await rediger(observert, skjema(observert, { name: "Fredagstaco" }))).toBe("endret");
      expect(await lesRa(id)).toEqual(foer);
    },
  );

  it("slettet mål: avvises med «mangler», og oppskriften gjenopprettes ikke", async () => {
    const { id } = await createRecipe(FAMILY_ID, baseRecipe({ name: "Taco" }));
    const observert = await observer(id);
    await deleteRecipe(FAMILY_ID, id);

    expect(await rediger(observert, skjema(observert, { name: "Fredagstaco" }))).toBe("mangler");
    expect(await lesRa(id)).toBeNull();
  });

  it("vellykket lagring bevarer lagret id og ukjente råfelt (#134), og legger ikke til id", async () => {
    const medId = randomUUID();
    await admin()
      .ref(sti(medId))
      .set({ ...baseRecipe({ name: "Taco" }), id: medId, ukjent: { a: 1 } });
    const utenId = (await createRecipe(FAMILY_ID, baseRecipe({ name: "Suppe" }))).id;

    for (const id of [medId, utenId]) {
      const observert = await observer(id);
      expect(await rediger(observert, skjema(observert, { name: `${observert.name} (ny)` }))).toBe(
        "lagret",
      );
    }
    expect(await lesRa(medId)).toMatchObject({ id: medId, ukjent: { a: 1 }, name: "Taco (ny)" });
    const uten = await lesRa(utenId);
    expect(uten?.name).toBe("Suppe (ny)");
    expect(uten).not.toHaveProperty("id");
  });

  it("«Bekreft middag» er uendret, og en samtidig bekreftelse stopper ikke redigeringen eller går tapt", async () => {
    const { id } = await createRecipe(FAMILY_ID, baseRecipe({ name: "Taco" }));
    const observert = await observer(id);
    await transactRecipe(FAMILY_ID, id, (current) =>
      current ? markRecipeCooked(current, 1794300000000) : current,
    );

    expect(await rediger(observert, skjema(observert, { name: "Fredagstaco" }))).toBe("lagret");
    expect(await lesRa(id)).toMatchObject({
      name: "Fredagstaco",
      lastCooked: 1794300000000,
      timesCooked: 1,
    });
  });

  it("utdatert lokal cache gir ikke et falskt «endret»: utfallet verifiseres mot serveren (review 5851280024)", async () => {
    const db = getFirebaseDatabase();
    const { id } = await createRecipe(FAMILY_ID, baseRecipe({ name: "Taco" }));
    const observert = await observer(id);
    const original = await lesRa(id);
    // Hold et abonnement, så klienten har en lokal cache av noden.
    let sett: Record<string, unknown> | null = null;
    const avmeld = onValue(ref(db, sti(id)), (snap) => {
      sett = snap.val() as Record<string, unknown> | null;
    });
    try {
      // En annen enhet endrer ingrediensene, og klienten ser det.
      await admin()
        .ref(`${sti(id)}/ingredients/0/amount`)
        .set("800 g");
      await vi.waitFor(() =>
        expect((sett?.ingredients as { amount: string }[] | undefined)?.[0]?.amount).toBe("800 g"),
      );
      // Klienten går offline. Endringen tilbakestilles på serveren, men den
      // lokale cachen har fortsatt «800 g».
      goOffline(db);
      await admin().ref(sti(id)).set(original);

      const lagring = rediger(observert, skjema(observert, { name: "Fredagstaco" }));
      goOnline(db);
      expect(await lagring).toBe("lagret");
    } finally {
      goOnline(db);
      avmeld();
    }
    expect(await lesRa(id)).toMatchObject({
      name: "Fredagstaco",
      ingredients: [{ name: "Kjøttdeig", amount: "500 g", cat: "Kjøtt" }],
    });
  });

  it("nytt forsøk fra samme skjema etter en lagring som kan ha gått gjennom, overskriver ikke og stoppes med «endret»", async () => {
    const { id } = await createRecipe(FAMILY_ID, baseRecipe({ name: "Taco" }));
    const observert = await observer(id);
    // Første forsøk nådde serveren, selv om skjemaet ikke fikk vite det.
    expect(await rediger(observert, skjema(observert, { name: "Fredagstaco" }))).toBe("lagret");
    // En annen enhet endrer porsjonene etterpå.
    await admin()
      .ref(`${sti(id)}/servings`)
      .set(6);
    const foer = await lesRa(id);

    // Brukeren prøver igjen fra samme skjema, også med et utvidet utkast.
    expect(await rediger(observert, skjema(observert, { name: "Fredagstaco" }))).toBe("endret");
    expect(await rediger(observert, skjema(observert, { name: "Fredagstaco", time: 30 }))).toBe(
      "endret",
    );
    expect(await lesRa(id)).toEqual(foer);
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
