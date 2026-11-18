/**
 * «Slett middag» i Middagsbiblioteket med grunnlagsvern (Mat #20, ordre
 * 6968416205) — EKTE Firebase-emulator, syntetiske data. Samme sammensetning
 * som `useMealLibrary.slettEntry`: grunnlaget er hele råposten slik
 * abonnementet viste den (`raattBiblioteksgrunnlag`), og slettingen
 * avgjøres atomisk mot den ferske råposten på eksakt nøkkel
 * (`slettMealLibraryEntryMedUtfall` + `slettHvisUendret`).
 *
 * Før rettingen slettet `removeMealLibraryEntry` ubetinget på id, så en post
 * en annen klient hadde endret eller erstattet etter at bekreftelsen åpnet,
 * ble slettet.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type SletteUtfall, slettHvisUendret } from "@domain/mealLibrary/sletting";
import type { MealLibraryEntry } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import {
  raattBiblioteksgrunnlag,
  slettMealLibraryEntryMedUtfall,
  subscribeMealLibrary,
} from "./mealLibrary.repository";

const FAMILY_ID = "familie1";
const ANNEN_FAMILIE = "familie-uten-tilgang";
const sti = (id: string, fam = FAMILY_ID) => `families/${fam}/mealLibrary/${id}`;

let adminApp: AdminApp;
const db = () => getAdminDatabase(adminApp);
const les = async (id: string, fam = FAMILY_ID) => (await db().ref(sti(id, fam)).get()).val();

/** Råpost med ukjente felt på posten, i en varelinje og i en variant. */
const RAA = () => ({
  name: "Taco",
  lettvint: true,
  _mcp: { kilde: "test", n: 1 },
  shoppingBase: [
    { id: "sb1", itemId: "v-lefse", name: "Lefser", amount: "8", unit: "", cat: "Brød", x: 1 },
  ],
  variants: [
    { id: "v1", name: "Fisketaco", source: "recipe", recipeId: "r1", y: "a" },
    {
      id: "v2",
      name: "Enkel",
      source: "shoppingBase",
      shoppingBase: [{ id: "vs1", itemId: "v-ost", name: "Ost", cat: "Meieri" }],
    },
  ],
});

/** Posten slik abonnementet viste den — objektet skjermen fryser i bekreftelsen. */
function observer(id: string): Promise<MealLibraryEntry> {
  return new Promise((resolve) => {
    const av = subscribeMealLibrary(FAMILY_ID, (entries) => {
      const e = entries.find((x) => x.id === id);
      if (e) {
        av();
        resolve(e);
      }
    });
  });
}

/** Samme sammensetning som `useMealLibrary.slettEntry`. */
async function slett(observert: MealLibraryEntry, fam = FAMILY_ID): Promise<SletteUtfall> {
  const grunnlag = raattBiblioteksgrunnlag(observert);
  const r = await slettMealLibraryEntryMedUtfall(
    fam,
    observert.id,
    (raa) => slettHvisUendret(raa, grunnlag),
    "mangler" as const,
  );
  if (r.type === "stopp") return r.utfall;
  return r.type === "lagret" ? "slettet" : r.type;
}

async function medTo() {
  const id = randomUUID();
  const annen = randomUUID();
  await db().ref(sti(id)).set(RAA());
  await db()
    .ref(sti(annen))
    .set({ name: "Annen", _mcp: { z: 1 } });
  return { id, annen, observert: await observer(id) };
}

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-meallibrary-slett",
  );
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await db().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  await signInWithCustomToken(
    getFirebaseAuth(),
    await getAdminAuth(adminApp).createCustomToken(uid),
  );
});

afterAll(async () => {
  await db().ref(`families/${FAMILY_ID}`).remove();
  await db().ref(`families/${ANNEN_FAMILIE}`).remove();
  await deleteApp(adminApp);
});

describe("«Slett middag» med grunnlagsvern (emulator)", () => {
  it("uendret post: slettes; en annen bibliotekspost står byte for byte", async () => {
    const { id, annen, observert } = await medTo();
    expect(await slett(observert)).toBe("slettet");
    expect(await les(id)).toBeNull();
    expect(await les(annen)).toEqual({ name: "Annen", _mcp: { z: 1 } });
  });

  it.each([
    ["ukjent toppfelt", (r: ReturnType<typeof RAA>) => ({ ...r, _mcp: { kilde: "test", n: 2 } })],
    [
      "ukjent felt i en varelinje",
      (r: ReturnType<typeof RAA>) => ({ ...r, shoppingBase: [{ ...r.shoppingBase[0]!, x: 2 }] }),
    ],
    [
      "variant (navn)",
      (r: ReturnType<typeof RAA>) => ({
        ...r,
        variants: [{ ...r.variants[0]!, name: "Kyllingtaco" }, r.variants[1]!],
      }),
    ],
    [
      "ukjent felt i en variant",
      (r: ReturnType<typeof RAA>) => ({
        ...r,
        variants: [{ ...r.variants[0]!, y: "b" }, r.variants[1]!],
      }),
    ],
    [
      "erstattet post på samme nøkkel",
      () => ({ name: "Taco", shoppingBase: [{ id: "ny", name: "Lefser", cat: "Brød" }] }),
    ],
  ])(
    "endret etter at bekreftelsen åpnet (%s): `endret`, ingenting slettet, ny tilstand står",
    async (_navn, endre) => {
      const { id, annen, observert } = await medTo();
      const ny = endre(RAA());
      await db().ref(sti(id)).set(ny);
      expect(await slett(observert)).toBe("endret");
      expect(await les(id)).toEqual(ny);
      expect(await les(annen)).toEqual({ name: "Annen", _mcp: { z: 1 } });
    },
  );

  it("allerede borte: `mangler`, posten gjenopprettes ikke, annen post står", async () => {
    const { id, annen, observert } = await medTo();
    await db().ref(sti(id)).remove();
    expect(await slett(observert)).toBe("mangler");
    expect(await les(id)).toBeNull();
    expect(await les(annen)).toEqual({ name: "Annen", _mcp: { z: 1 } });
  });

  it("uten observert grunnlag (ikke fra abonnementet): `endret`, ingenting slettet", async () => {
    const { id } = await medTo();
    const uten: MealLibraryEntry = { id, name: "Taco" };
    expect(raattBiblioteksgrunnlag(uten)).toBeUndefined();
    expect(await slett(uten)).toBe("endret");
    expect(await les(id)).toEqual(RAA());
  });

  it("familiegrensen: sletting i en familie uten medlemskap gir `avvist`, ingenting slettet", async () => {
    const { observert } = await medTo();
    await db().ref(sti(observert.id, ANNEN_FAMILIE)).set(RAA());
    expect(await slett(observert, ANNEN_FAMILIE)).toBe("avvist");
    expect(await les(observert.id, ANNEN_FAMILIE)).toEqual(RAA());
  });
});
