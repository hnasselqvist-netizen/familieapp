/**
 * «Lagre notat» på en bibliotekmiddag (Mat #20, ordre 6998241717) — EKTE
 * Firebase-emulator, syntetiske data. Samme sammensetning som
 * `useMealLibrary.lagreNotat`/`sjekkNotat`: en fersk `format=export`-lesing
 * med ETag, `besluttNotat` mot kilden utkastet startet fra, og PUT av posten
 * i eksportform med `if-match` på eksakt nøkkel.
 *
 * Alle REST-kall mot posten telles: et stopp eller en oppfølging skal aldri
 * gi en skriving. Prioriteter og ukjente felt kontrolleres byte for byte.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { updateEntryFields } from "@domain/mealLibrary/mealLibrary";
import {
  type NotatUtfall,
  besluttNotat,
  normaliserNotat,
  vurderNotatOppfolging,
} from "@domain/mealLibrary/notat";
import { getFirebaseAuth } from "./firebase";
import {
  lesMealLibraryEntryEksport,
  skrivMealLibraryEntryVersjonert,
  transactMealLibraryEntry,
} from "./mealLibrary.repository";

const FAMILY_ID = "familie1";
const ANNEN_FAMILIE = "familie-uten-tilgang-notat";
const sti = (id: string, fam = FAMILY_ID) => `families/${fam}/mealLibrary/${id}`;

let adminApp: AdminApp;
let tokenA = "";
const somA = async () => signInWithCustomToken(getFirebaseAuth(), tokenA);
const db = () => getAdminDatabase(adminApp);
/** RTDB har ingen ekte lister: en liste lagres som objekt med indeksnøkler. */
const somRtdb = (v: unknown): unknown =>
  Array.isArray(v)
    ? Object.fromEntries(v.map((x, i) => [String(i), somRtdb(x)]))
    : typeof v === "object" && v !== null
      ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, somRtdb(x)]))
      : v;
const eksport = async (id: string, fam = FAMILY_ID) =>
  (await db().ref(sti(id, fam)).get()).exportVal() as unknown;

/** Råpost med prioriteter og ukjente felt på posten, i en varelinje og i en variant. */
const RAA = (notat?: unknown) => ({
  ".priority": 2,
  name: "Taco",
  lettvint: true,
  _mcp: { kilde: "test", n: 1 },
  shoppingBase: [{ ".priority": 5, id: "sb1", name: "Lefser", amount: "8", cat: "Brød", x: 1 }],
  variants: [{ ".priority": 7, id: "v1", name: "Fisketaco", source: "recipe", recipeId: "r1" }],
  ...(notat !== undefined ? { notat } : {}),
});

/** Samme sammensetning som `useMealLibrary.lagreNotat`. */
async function lagre(
  id: string,
  kilde: string | undefined,
  tekst: string,
  fam = FAMILY_ID,
  fristMs = 2_000,
): Promise<NotatUtfall> {
  const utkast = normaliserNotat(tekst);
  const r = await skrivMealLibraryEntryVersjonert(
    fam,
    id,
    (fersk) => besluttNotat(fersk, kilde, utkast),
    "mangler" as const,
    { fristMs },
  );
  return r.type === "stopp" ? r.utfall : r.type;
}

/** Samme sammensetning som `useMealLibrary.sjekkNotat`. */
async function sjekk(id: string, kilde: string | undefined, tekst: string) {
  const r = await lesMealLibraryEntryEksport(FAMILY_ID, id, { fristMs: 2_000 });
  return r.type === "lest"
    ? vurderNotatOppfolging(r.eksport, kilde, normaliserNotat(tekst))
    : r.type;
}

/**
 * Teller REST-kall mot posten. `foerPut` kjøres før første PUT sendes (en
 * annen klient skriver mellom lesing og skriving). `mistSvar` sender første
 * PUT til serveren, men kaster i stedet for å levere svaret (tapt svar).
 * `hengGet` holder første GET til fristen har gått.
 */
function rest(valg: { foerPut?: () => Promise<void>; mistSvar?: boolean; hengGet?: boolean } = {}) {
  const ekte = globalThis.fetch;
  const kall: string[] = [];
  const status: number[] = [];
  let foer = valg.foerPut;
  let mist = valg.mistSvar ?? false;
  let heng = valg.hengGet ?? false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (!String(input).includes("/mealLibrary/")) return ekte(input, init);
    const m = init?.method ?? "GET";
    kall.push(m);
    if (m === "GET" && heng) {
      heng = false;
      return new Promise<Response>((_, avvis) =>
        init?.signal?.addEventListener("abort", () =>
          avvis(new DOMException("aborted", "AbortError")),
        ),
      );
    }
    if (m === "PUT" && foer) {
      const f = foer;
      foer = undefined;
      await f();
    }
    const res = await ekte(input, init);
    if (m === "PUT") status.push(res.status);
    if (m === "PUT" && mist) {
      mist = false;
      throw new TypeError("Failed to fetch");
    }
    return res;
  });
  return { kall, status };
}

async function ny(notat?: unknown) {
  const id = randomUUID();
  await db().ref(sti(id)).set(RAA(notat));
  return id;
}

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-meallibrary-notat",
  );
  const uid = `test-notat-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await db().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  tokenA = await getAdminAuth(adminApp).createCustomToken(uid);
  await somA();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (!getFirebaseAuth().currentUser) await somA();
});

afterAll(async () => {
  await db().ref(`families/${FAMILY_ID}`).remove();
  await db().ref(`families/${ANNEN_FAMILIE}`).remove();
  await deleteApp(adminApp);
});

describe("«Lagre notat» på bibliotekmiddag (emulator)", () => {
  it("nytt notat: én GET og én PUT; bare `notat` er lagt til, linjeskift bevart, prioriteter og ukjente felt står", async () => {
    const id = await ny();
    const r = rest();
    expect(await lagre(id, undefined, "Dobbel porsjon\r\nFrys halvparten")).toBe("lagret");
    expect(r.kall).toEqual(["GET", "PUT"]);
    expect(await eksport(id)).toEqual(
      somRtdb({ ...RAA(), notat: "Dobbel porsjon\nFrys halvparten" }),
    );
  });

  it("endring og tømming: tømming fjerner nøkkelen; en prioritet på notatet bevares", async () => {
    const id = await ny({ ".value": "Gammelt", ".priority": 9 });
    expect(await lagre(id, "Gammelt", "Nytt")).toBe("lagret");
    expect(await eksport(id)).toEqual(
      somRtdb({ ...RAA(), notat: { ".value": "Nytt", ".priority": 9 } }),
    );
    expect(await lagre(id, "Nytt", "  \n ")).toBe("lagret");
    const e = (await eksport(id)) as Record<string, unknown>;
    expect(Object.hasOwn(e, "notat")).toBe(false);
    expect(e).toEqual(somRtdb(RAA()));
  });

  it("samtidig endret notat: `konflikt`, bare GET, ingenting endret", async () => {
    const id = await ny("Fra annen enhet");
    const foer = await eksport(id);
    const r = rest();
    expect(await lagre(id, "Det jeg så", "Mitt")).toBe("konflikt");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(id)).toEqual(foer);
  });

  it("et annet felt (og en prioritet) endres mellom lesing og skriving: 412, ny runde, begge endringer står", async () => {
    const id = await ny();
    const r = rest({
      foerPut: async () => {
        await db()
          .ref(`${sti(id)}/name`)
          .set("Taco deluxe");
        await new Promise<void>((ok) =>
          db()
            .ref(`${sti(id)}/variants/0`)
            .setPriority(11, () => ok()),
        );
      },
    });
    expect(await lagre(id, undefined, "Mitt")).toBe("lagret");
    expect(r.kall).toEqual(["GET", "PUT", "GET", "PUT"]);
    expect(r.status).toEqual([412, 200]);
    const forventet = RAA() as Record<string, unknown>;
    expect(await eksport(id)).toEqual(
      somRtdb({
        ...forventet,
        name: "Taco deluxe",
        variants: [{ ...(forventet.variants as object[])[0], ".priority": 11 }],
        notat: "Mitt",
      }),
    );
  });

  it("notatet endres av en annen mellom lesing og skriving: 412, ny runde gir `konflikt`, den andres notat står", async () => {
    const id = await ny();
    const r = rest({
      foerPut: () =>
        db()
          .ref(`${sti(id)}/notat`)
          .set("Den andres"),
    });
    expect(await lagre(id, undefined, "Mitt")).toBe("konflikt");
    expect(r.kall).toEqual(["GET", "PUT", "GET"]);
    expect(r.status).toEqual([412]);
    expect(await eksport(id)).toEqual(somRtdb({ ...RAA(), notat: "Den andres" }));
  });

  it("manglende middag: `mangler`, bare GET, ingenting gjenopprettet", async () => {
    const id = randomUUID();
    const r = rest();
    expect(await lagre(id, undefined, "Mitt")).toBe("mangler");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(id)).toBeNull();
  });

  it("slettet mellom lesing og skriving: 412, ny runde gir `mangler`; middagen gjenopprettes ikke", async () => {
    const id = await ny();
    const r = rest({ foerPut: () => db().ref(sti(id)).remove() });
    expect(await lagre(id, undefined, "Mitt")).toBe("mangler");
    expect(r.kall).toEqual(["GET", "PUT", "GET"]);
    expect(await eksport(id)).toBeNull();
  });

  it("ugyldig lagret notat: `ugyldig`, bare GET, råformen står byte for byte", async () => {
    const id = await ny({ tekst: "fra et annet verktøy" });
    const foer = await eksport(id);
    const r = rest();
    expect(await lagre(id, undefined, "Mitt")).toBe("ugyldig");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(id)).toEqual(foer);
  });

  it("tapt svar på PUT: `ukjent`; skrivefri oppfølging bekrefter `lagret`; nytt forsøk gir `allerede` uten skriving", async () => {
    const id = await ny("Gammelt");
    const r1 = rest({ mistSvar: true });
    expect(await lagre(id, "Gammelt", "Mitt")).toBe("ukjent");
    expect(r1.kall).toEqual(["GET", "PUT"]);
    vi.restoreAllMocks();

    const r2 = rest();
    expect(await sjekk(id, "Gammelt", "Mitt")).toBe("lagret");
    expect(r2.kall).toEqual(["GET"]);
    expect(await lagre(id, "Gammelt", "Mitt")).toBe("allerede");
    expect(r2.kall).toEqual(["GET", "GET"]);
    expect(await eksport(id)).toEqual(somRtdb({ ...RAA(), notat: "Mitt" }));
  });

  it("skrivefri oppfølging skiller `ikkeLagret`, `endret` og `mangler`", async () => {
    const id = await ny("Gammelt");
    const r = rest();
    expect(await sjekk(id, "Gammelt", "Mitt")).toBe("ikkeLagret");
    await db()
      .ref(`${sti(id)}/notat`)
      .set("Annet");
    expect(await sjekk(id, "Gammelt", "Mitt")).toBe("endret");
    expect(await sjekk(randomUUID(), "Gammelt", "Mitt")).toBe("mangler");
    expect(r.kall.every((m) => m === "GET")).toBe(true);
  });

  it("lesingen henger: `ikkeLest` ved fristen, ingen PUT", async () => {
    const id = await ny();
    const foer = await eksport(id);
    const r = rest({ hengGet: true });
    expect(await lagre(id, undefined, "Mitt", FAMILY_ID, 300)).toBe("ikkeLest");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport(id)).toEqual(foer);
  });

  it("utlogget: `avvist` før noe sendes; annen familie: `avvist`", async () => {
    const id = await ny();
    const r = rest();
    await signOut(getFirebaseAuth());
    expect(await lagre(id, undefined, "Mitt")).toBe("avvist");
    expect(r.kall).toEqual([]);
    await somA();
    const fremmed = randomUUID();
    await db().ref(sti(fremmed, ANNEN_FAMILIE)).set(RAA());
    expect(await lagre(fremmed, undefined, "Mitt", ANNEN_FAMILIE)).toBe("avvist");
    expect(await eksport(fremmed, ANNEN_FAMILIE)).toEqual(somRtdb(RAA()));
  });
});

describe("andre endringer av middagen bevarer notatet (emulator)", () => {
  it("vanlig feltendring (`updateEntryFields`) bevarer et gyldig notat", async () => {
    const id = await ny("Husk lime");
    await transactMealLibraryEntry(FAMILY_ID, id, (cur) =>
      cur ? updateEntryFields(cur, { lettvint: false }) : null,
    );
    const v = (await db().ref(sti(id)).get()).val() as Record<string, unknown>;
    expect(v.notat).toBe("Husk lime");
    expect(v.lettvint).toBe(false);
  });

  it.each<[string, unknown]>([
    ["tall", 42],
    ["objekt", { tekst: "x" }],
    ["tom streng", ""],
  ])("vanlig feltendring bevarer en ugyldig lagret notat-råform (%s) uendret", async (_n, raa) => {
    const id = randomUUID();
    // RTDB lagrer ikke tom streng som fravær; den lagres som "" og skal stå.
    await db().ref(sti(id)).set({ name: "Taco", lettvint: true, notat: raa });
    await transactMealLibraryEntry(FAMILY_ID, id, (cur) =>
      cur ? updateEntryFields(cur, { lettvint: false }) : null,
    );
    const v = (await db().ref(sti(id)).get()).val() as Record<string, unknown>;
    expect(v.notat).toEqual(raa);
    expect(v.lettvint).toBe(false);
  });
});
