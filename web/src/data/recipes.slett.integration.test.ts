/**
 * «Slett» i Kokeboken med eksportgrunnlag, ETag og frist (Mat #20, ordre
 * 6970785122; mønster fra Middagsbibliotekets #177) — EKTE Firebase-emulator,
 * syntetiske data. Samme sammensetning som `useRecipes.slettRecipe`:
 * grunnlaget er EKSPORTFORMEN av oppskriften slik abonnementet viste den (med
 * prioriteter, `eksportGrunnlag`), og slettingen avgjøres mot en fersk
 * `format=export`-lesing med ETag og sendes som DELETE med `if-match` på eksakt
 * familie/oppskrift (`slettRecipeVersjonert` + `slettHvisUendret`). 412 er
 * konflikt: posten står, og ingen ny runde startes.
 *
 * Før rettingen (#151) var grunnlaget `val()`, så prioritetsendringer var
 * usynlige; et stopp ble verifisert med en transaksjon som skrev verdien
 * tilbake, og det var ingen frist.
 *
 * Alle REST-kall mot oppskriften telles: et stopp skal aldri gi en skriving.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type SletteUtfall, slettHvisUendret } from "@domain/recipes/recipes";
import type { Recipe } from "@app-types/recipe";
import { getFirebaseAuth } from "./firebase";
import { eksportGrunnlag, slettRecipeVersjonert, subscribeRecipes } from "./recipes.repository";

const FAMILY_ID = "familie1";
const ANNEN_FAMILIE = "familie-uten-tilgang";
const FRIST = { fristMs: 300 };
const sti = (id: string, fam = FAMILY_ID) => `families/${fam}/recipes/${id}`;

let adminApp: AdminApp;
let tokenA = "";
let tokenB = "";
/** Logg inn som bruker A (den som starter slettingen i testene). */
const somA = async () => signInWithCustomToken(getFirebaseAuth(), tokenA);
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

/** Råoppskrift med ukjent felt og prioriteter på posten og i en ingredienslinje. */
const RAA = () => ({
  ".priority": 3,
  name: "Lasagne",
  cat: "Middag",
  tags: ["ovn"],
  time: 60,
  servings: 4,
  url: "",
  source: "quick",
  instructions: "Lag den.",
  ingredients: [
    { ".priority": 5, name: "Kjøttdeig", amount: "400", unit: "g", itemId: "v-kd" },
    { name: "Lasagneplater", amount: "1", unit: "pk" },
  ],
  timesCooked: 2,
  createdAt: 1,
  _mcp: { n: 1 },
});
const ANNEN = () => ({ ".priority": 1, name: "Annen", cat: "Middag", createdAt: 2, _x: 1 });

/** Oppskriften slik abonnementet viste den — objektet detaljen bruker ved «Slett». */
function observer(id: string): Promise<Recipe> {
  return new Promise((resolve) => {
    const av = subscribeRecipes(FAMILY_ID, (rs) => {
      const r = rs.find((x) => x.id === id);
      if (r) {
        av();
        resolve(r);
      }
    });
  });
}

/** Samme sammensetning som `useRecipes.slettRecipe`. */
async function slett(
  observert: Recipe,
  fam = FAMILY_ID,
  frist: { fristMs: number } = FRIST,
): Promise<SletteUtfall> {
  const grunnlag = eksportGrunnlag(observert);
  const r = await slettRecipeVersjonert(
    fam,
    observert.id,
    (fersk) => slettHvisUendret(fersk, grunnlag),
    frist,
  );
  if (r.type === "stopp") return r.utfall;
  if (r.type === "konflikt") return "endret";
  return r.type === "lagret" ? "slettet" : r.type;
}

/**
 * Teller REST-kall mot oppskriften. `foerSletting` kjøres før første DELETE
 * (en annen klient skriver mellom GET og DELETE). `heng` holder første kall
 * med den metoden til `slipp()`, og sender det da uten avbruddssignal.
 */
function rest(valg: { foerSletting?: () => Promise<void>; heng?: "GET" | "DELETE" } = {}) {
  const ekte = globalThis.fetch;
  const kall: string[] = [];
  let slipp: () => void = () => {};
  const port = new Promise<void>((r) => (slipp = r));
  let holdt = false;
  let foer = valg.foerSletting;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (!String(input).includes("/recipes/")) return ekte(input, init);
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
    "integration-test-admin-recipes-slett",
  );
  // To syntetiske medlemmer av samme familie: A starter slettingen, B overtar sesjonen.
  for (const hvem of ["A", "B"] as const) {
    const uid = `test-${hvem}-${randomUUID()}`;
    await getAdminAuth(adminApp).createUser({ uid });
    await db().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
    const t = await getAdminAuth(adminApp).createCustomToken(uid);
    if (hvem === "A") tokenA = t;
    else tokenB = t;
  }
  await somA();
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await db().ref(`families/${FAMILY_ID}`).remove();
  await db().ref(`families/${ANNEN_FAMILIE}`).remove();
  await deleteApp(adminApp);
});

describe("Kokebok «Slett» med eksportgrunnlag (emulator)", () => {
  it("uendret grunnlag med prioriteter: én GET og én DELETE; en annen oppskrift står byte for byte", async () => {
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
      "underprioritet (ingredienslinje)",
      (id) =>
        db()
          .ref(`${sti(id)}/ingredients/0`)
          .setPriority(8, () => {}),
    ],
    [
      "ny underprioritet (ingredienslinje uten)",
      (id) =>
        db()
          .ref(`${sti(id)}/ingredients/1`)
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
      "navn",
      (id) =>
        db()
          .ref(`${sti(id)}/name`)
          .set("Lasagne 2"),
    ],
    ["erstattet oppskrift", (id) => db().ref(sti(id)).set({ name: "Lasagne", createdAt: 1 })],
  ])(
    "endret etter visningen (%s): stopp med bare GET; ny tilstand står byte for byte",
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

  it("endring mellom GET og DELETE (bare underprioritet): 412 er konflikt, ingen ny runde; posten står med ny prioritet", async () => {
    const { id, annen, observert } = await medTo();
    const r = rest({
      foerSletting: () =>
        db()
          .ref(`${sti(id)}/ingredients/0`)
          .setPriority(2, () => {}),
    });
    const forventet = {
      ...RAA(),
      ingredients: [{ ...RAA().ingredients[0]!, ".priority": 2 }, RAA().ingredients[1]!],
    };
    expect(await slett(observert)).toBe("endret");
    expect(r.kall).toEqual(["GET", "DELETE"]);
    expect(await eksport(id)).toEqual(somRtdb(forventet));
    expect(await eksport(annen)).toEqual(somRtdb(ANNEN()));
  });

  it("manglende oppskrift: `mangler` med bare GET; gjenopprettes ikke", async () => {
    const { id, observert } = await medTo();
    await db().ref(sti(id)).remove();
    const r = rest();
    expect(await slett(observert)).toBe("mangler");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(id)).toBeNull();
  });

  it("uten observert grunnlag: `endret` med bare GET, ingenting slettet", async () => {
    const { id } = await medTo();
    const uten = { id, name: "Lasagne" } as Recipe;
    expect(eksportGrunnlag(uten)).toBeUndefined();
    const r = rest();
    expect(await slett(uten)).toBe("endret");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(id)).toEqual(somRtdb(RAA()));
  });

  it("familiegrensen: en familie uten medlemskap gir `avvist` med bare GET, ingenting slettet", async () => {
    const { observert } = await medTo();
    await db().ref(sti(observert.id, ANNEN_FAMILIE)).set(RAA());
    const r = rest();
    expect(await slett(observert, ANNEN_FAMILIE)).toBe("avvist");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(observert.id, ANNEN_FAMILIE)).toEqual(somRtdb(RAA()));
  });
});

describe("Kokebok «Slett»: avgrenset ventetid (emulator)", () => {
  it("lesingen henger: `ikkeLest` etter fristen; et sent svar starter ingen DELETE", async () => {
    const { id, observert } = await medTo();
    const r = rest({ heng: "GET" });
    expect(await slett(observert)).toBe("ikkeLest");
    r.slipp();
    await vent(500);
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(id)).toEqual(somRtdb(RAA()));
  });

  it("DELETE er sendt og henger: `ukjent`, ingen ny DELETE; serveren kan ha slettet", async () => {
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

describe("Kokebok «Slett»: bundet til innloggingen som startet forsøket (review 5952888435)", () => {
  /** Lang nok frist til at sesjonsbyttet skjer før den, så utfallet viser byttet. */
  const LANG = { fristMs: 8_000 };
  afterEach(async () => {
    vi.restoreAllMocks();
    await somA();
  });

  it(
    "A trykker «Slett», sesjonen byttes til B mens GET står ute: ingen DELETE, posten står byte for byte",
    { timeout: 15_000 },
    async () => {
      const { id, annen, observert } = await medTo();
      const r = rest({ heng: "GET" });
      const forsok = slett(observert, FAMILY_ID, LANG); // startet av A
      await vi.waitFor(() => expect(r.kall).toEqual(["GET"]));
      await signInWithCustomToken(getFirebaseAuth(), tokenB); // B tar over sesjonen
      r.slipp();
      expect(await forsok).toBe("byttet");
      expect(r.kall).toEqual(["GET"]);
      expect(await eksport(id)).toEqual(somRtdb(RAA()));
      expect(await eksport(annen)).toEqual(somRtdb(ANNEN()));
    },
  );

  it(
    "utlogging mens tokenet for DELETE hentes: ingen DELETE, posten står byte for byte",
    { timeout: 15_000 },
    async () => {
      const { id, observert } = await medTo();
      const r = rest();
      const bruker = getFirebaseAuth().currentUser!;
      const ekte = bruker.getIdToken.bind(bruker);
      let slipp: () => void = () => {};
      const port = new Promise<void>((res) => (slipp = res));
      let n = 0;
      let deleteTokenBedt = false;
      vi.spyOn(bruker, "getIdToken").mockImplementation(async (f) => {
        n += 1;
        if (n === 2) {
          // Tokenet til DELETE: venter til testen har logget ut.
          deleteTokenBedt = true;
          await port;
        }
        return ekte(f);
      });
      const forsok = slett(observert, FAMILY_ID, LANG);
      await vi.waitFor(() => expect(deleteTokenBedt).toBe(true));
      await signOut(getFirebaseAuth());
      slipp();
      expect(await forsok).toBe("byttet");
      expect(r.kall).toEqual(["GET"]);
      expect(await eksport(id)).toEqual(somRtdb(RAA()));
    },
  );

  it(
    "ny innlogging som samme bruker (ny sesjon) mens GET står ute: også stoppet",
    { timeout: 15_000 },
    async () => {
      const { id, observert } = await medTo();
      const r = rest({ heng: "GET" });
      const forsok = slett(observert, FAMILY_ID, LANG);
      await vi.waitFor(() => expect(r.kall).toEqual(["GET"]));
      await signOut(getFirebaseAuth());
      await somA();
      r.slipp();
      expect(await forsok).toBe("byttet");
      expect(r.kall).toEqual(["GET"]);
      expect(await eksport(id)).toEqual(somRtdb(RAA()));
    },
  );
});
