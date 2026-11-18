/**
 * «Slett middag» i Middagsbiblioteket med grunnlagsvern (Mat #20, ordre
 * 6968416205, review 5950868309) — EKTE Firebase-emulator, syntetiske data.
 * Samme sammensetning som `useMealLibrary.slettEntry`: grunnlaget er
 * EKSPORTFORMEN av posten slik abonnementet viste den (med prioriteter,
 * `raattBiblioteksgrunnlag`), og slettingen avgjøres mot en fersk
 * `format=export`-lesing med ETag og sendes som DELETE med `if-match` på
 * eksakt nøkkel (`slettMealLibraryEntryVersjonert` + `slettHvisUendret`).
 *
 * Før rettingen slettet `removeMealLibraryEntry` ubetinget på id. Den første
 * versjonen av vernet så bare `val()`, så prioritetsendringer var usynlige,
 * og et stopp ble verifisert ved å skrive verdien tilbake.
 *
 * Alle REST-kall mot posten telles: et stopp skal aldri gi en skriving.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type SletteUtfall, slettHvisUendret } from "@domain/mealLibrary/sletting";
import type { MealLibraryEntry } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import {
  raattBiblioteksgrunnlag,
  slettMealLibraryEntryVersjonert,
  subscribeMealLibrary,
} from "./mealLibrary.repository";

const FAMILY_ID = "familie1";
const ANNEN_FAMILIE = "familie-uten-tilgang";
const FRIST = { fristMs: 300 };
const sti = (id: string, fam = FAMILY_ID) => `families/${fam}/mealLibrary/${id}`;

let adminApp: AdminApp;
const db = () => getAdminDatabase(adminApp);
/** RTDB har ingen ekte lister: en liste lagres som objekt med indeksnøkler. */
const somRtdb = (v: unknown): unknown =>
  Array.isArray(v)
    ? Object.fromEntries(v.map((x, i) => [String(i), somRtdb(x)]))
    : typeof v === "object" && v !== null
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, somRtdb(x)]))
      : v;
/** Eksportformen (med prioriteter) — «byte for byte». */
const eksport = async (id: string, fam = FAMILY_ID) =>
  (await db().ref(sti(id, fam)).get()).exportVal() as unknown;
const vent = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Råpost med ukjente felt og prioriteter på posten, i en varelinje og i en variant. */
const RAA = () => ({
  ".priority": 2,
  name: "Taco",
  lettvint: true,
  _mcp: { kilde: "test", n: 1 },
  shoppingBase: [
    { id: "sb1", itemId: "v-lefse", name: "Lefser", amount: "8", unit: "", cat: "Brød", x: 1 },
  ],
  variants: [
    { ".priority": 7, id: "v1", name: "Fisketaco", source: "recipe", recipeId: "r1", y: "a" },
    {
      id: "v2",
      name: "Enkel",
      source: "shoppingBase",
      shoppingBase: [{ id: "vs1", itemId: "v-ost", name: "Ost", cat: "Meieri" }],
    },
  ],
});
const ANNEN = () => ({ ".priority": 4, name: "Annen", _mcp: { z: 1 } });

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
  const r = await slettMealLibraryEntryVersjonert(
    fam,
    observert.id,
    (fersk) => slettHvisUendret(fersk, grunnlag),
    "mangler" as const,
    FRIST,
  );
  if (r.type === "stopp") return r.utfall;
  return r.type === "lagret" ? "slettet" : r.type;
}

/**
 * Teller REST-kall mot posten. `foerSletting` kjøres før første DELETE
 * sendes (en annen klient skriver mellom lesing og sletting). `heng` holder
 * første kall med den metoden til `slipp()`, og sender det da uten
 * avbruddssignal (et svar som kommer etter fristen).
 */
function rest(valg: { foerSletting?: () => Promise<void>; heng?: "GET" | "DELETE" } = {}) {
  const ekte = globalThis.fetch;
  const kall: string[] = [];
  let slipp: () => void = () => {};
  const port = new Promise<void>((r) => (slipp = r));
  let holdt = false;
  let foer = valg.foerSletting;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (!String(input).includes("/mealLibrary/")) return ekte(input, init);
    const m = init?.method ?? "GET";
    kall.push(m);
    if (m === "DELETE" && foer) {
      const f = foer;
      foer = undefined;
      await f();
    }
    if (!holdt && m === valg.heng) {
      holdt = true;
      await port;
      const uten: RequestInit = { ...init };
      delete uten.signal;
      return ekte(input, uten);
    }
    return ekte(input, init);
  });
  return { kall, slipp: () => slipp() };
}

async function medTo() {
  const id = randomUUID();
  const annen = randomUUID();
  await db().ref(sti(id)).set(RAA());
  await db().ref(sti(annen)).set(ANNEN());
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

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await db().ref(`families/${FAMILY_ID}`).remove();
  await db().ref(`families/${ANNEN_FAMILIE}`).remove();
  await deleteApp(adminApp);
});

describe("«Slett middag» med grunnlagsvern (emulator)", () => {
  it("uendret post (med prioriteter): slettes med én GET og én DELETE; en annen post står byte for byte", async () => {
    const { id, annen, observert } = await medTo();
    const r = rest();
    expect(await slett(observert)).toBe("slettet");
    expect(r.kall).toEqual(["GET", "DELETE"]);
    expect(await eksport(id)).toBeNull();
    expect(await eksport(annen)).toEqual(somRtdb(ANNEN()));
  });

  type Endring = [string, (id: string) => Promise<void>];
  it.each<Endring>([
    [
      "topp-prioritet",
      (id) =>
        db()
          .ref(sti(id))
          .setPriority(9, () => {}),
    ],
    [
      "nøstet prioritet (variant)",
      (id) =>
        db()
          .ref(`${sti(id)}/variants/0`)
          .setPriority(8, () => {}),
    ],
    [
      "ny nøstet prioritet (varelinje)",
      (id) =>
        db()
          .ref(`${sti(id)}/shoppingBase/0`)
          .setPriority(1, () => {}),
    ],
    [
      "ukjent toppfelt",
      (id) =>
        db()
          .ref(`${sti(id)}/_mcp/n`)
          .set(2),
    ],
    [
      "ukjent felt i en varelinje",
      (id) =>
        db()
          .ref(`${sti(id)}/shoppingBase/0/x`)
          .set(2),
    ],
    [
      "variantnavn",
      (id) =>
        db()
          .ref(`${sti(id)}/variants/0/name`)
          .set("Kyllingtaco"),
    ],
    [
      "ukjent felt i en variant",
      (id) =>
        db()
          .ref(`${sti(id)}/variants/0/y`)
          .set("b"),
    ],
    [
      "erstattet post på samme nøkkel",
      (id) =>
        db()
          .ref(sti(id))
          .set({ name: "Taco", shoppingBase: [{ id: "ny", name: "Lefser", cat: "Brød" }] }),
    ],
  ])(
    "endret etter at bekreftelsen åpnet (%s): `endret` med bare GET; ny tilstand står byte for byte",
    async (_navn, endre) => {
      const { id, annen, observert } = await medTo();
      await endre(id);
      const foer = await eksport(id);
      const r = rest();
      expect(await slett(observert)).toBe("endret");
      expect(r.kall).toEqual(["GET"]);
      expect(await eksport(id)).toEqual(foer);
      expect(await eksport(annen)).toEqual(somRtdb(ANNEN()));
    },
  );

  it("endring mellom lesing og sletting (bare prioritet): DELETE avvises (412), ny lesing gir `endret`; rå konflikt med prioritet står", async () => {
    const { id, annen, observert } = await medTo();
    const r = rest({
      foerSletting: () =>
        db()
          .ref(`${sti(id)}/variants/0`)
          .setPriority(3, () => {}),
    });
    const foventet = {
      ...RAA(),
      variants: [{ ...RAA().variants[0]!, ".priority": 3 }, RAA().variants[1]!],
    };
    expect(await slett(observert)).toBe("endret");
    expect(r.kall).toEqual(["GET", "DELETE", "GET"]);
    expect(await eksport(id)).toEqual(somRtdb(foventet));
    expect(await eksport(annen)).toEqual(somRtdb(ANNEN()));
  });

  it("allerede borte: `mangler` med bare GET; posten gjenopprettes ikke", async () => {
    const { id, annen, observert } = await medTo();
    await db().ref(sti(id)).remove();
    const r = rest();
    expect(await slett(observert)).toBe("mangler");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(id)).toBeNull();
    expect(await eksport(annen)).toEqual(somRtdb(ANNEN()));
  });

  it("uten observert grunnlag (ikke fra abonnementet): `endret` med bare GET, ingenting slettet", async () => {
    const { id } = await medTo();
    const uten: MealLibraryEntry = { id, name: "Taco" };
    expect(raattBiblioteksgrunnlag(uten)).toBeUndefined();
    const r = rest();
    expect(await slett(uten)).toBe("endret");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(id)).toEqual(somRtdb(RAA()));
  });

  it("familiegrensen: en familie uten medlemskap gir `avvist`, ingen skriving, ingenting slettet", async () => {
    const { observert } = await medTo();
    await db().ref(sti(observert.id, ANNEN_FAMILIE)).set(RAA());
    const r = rest();
    expect(await slett(observert, ANNEN_FAMILIE)).toBe("avvist");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(observert.id, ANNEN_FAMILIE)).toEqual(somRtdb(RAA()));
  });
});

describe("«Slett middag»: avgrenset ventetid (emulator)", () => {
  it("lesingen henger: `ikkeLest` etter fristen; en sen lesing starter ingen sletting", async () => {
    const { id, observert } = await medTo();
    const r = rest({ heng: "GET" });
    expect(await slett(observert)).toBe("ikkeLest");
    r.slipp();
    await vent(500);
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(id)).toEqual(somRtdb(RAA()));
  });

  it("slettingen er sendt og henger: `ukjent`, ingen automatisk ny sletting; serveren kan ha slettet", async () => {
    const { id, annen, observert } = await medTo();
    const r = rest({ heng: "DELETE" });
    expect(await slett(observert)).toBe("ukjent");
    expect(r.kall).toEqual(["GET", "DELETE"]);
    r.slipp();
    await vi.waitFor(async () => expect(await eksport(id)).toBeNull());
    expect(r.kall).toEqual(["GET", "DELETE"]);
    expect(await eksport(annen)).toEqual(somRtdb(ANNEN()));
  });
});
