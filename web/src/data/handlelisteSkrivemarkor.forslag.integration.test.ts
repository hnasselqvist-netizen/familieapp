/**
 * ADR 0003 (forslag, IKKE deployet): skrivermarkør på `families/{f}/shopping`
 * validert av rules. Reglene i `infra/firebase/forslag/` lastes inn i et EGET
 * emulator-navnerom, så gjeldende `database.rules.json` og de andre
 * integrasjonstestene ikke påvirkes. Appens ekte repository-funksjoner kjøres
 * mot det navnerommet ved at `./firebase` byttes ut for denne filen.
 *
 * Dekker #77 review 6355434985 pkt. 3–4: medlem/ikke-medlem/uautentisert,
 * andre moduler og lovlige multipath-operasjoner, child set/update/remove,
 * helnode null/tom, legacy-helnode (også køet offline), web-transaksjoner,
 * aktiveringsrekkefølge (rules før markør), mislykket markørsteg og retur.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type FirebaseApp,
  deleteApp as deleteClientApp,
  initializeApp as initClient,
} from "firebase/app";
import { type Auth, connectAuthEmulator, getAuth, signInWithCustomToken } from "firebase/auth";
import {
  type Database,
  connectDatabaseEmulator,
  get,
  getDatabase,
  goOffline,
  goOnline,
  ref,
  remove,
  set,
  update,
} from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  type Database as AdminDatabase,
  getDatabase as getAdminDatabase,
} from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  angreSammenslaing,
  anvendSammenslaing,
  lagPlan,
} from "@domain/shopping/handlelisteDuplikater";
import type { ShoppingItem } from "@app-types/shopping";

const NS = "demo-familieapp-forslag-rtdb";
const PROJECT_ID = "demo-familieapp";
const DATABASE_URL = `http://127.0.0.1:9000/?ns=${NS}`;
const REPO = path.resolve(import.meta.dirname, "../../..");
const lesJson = (rel: string) => JSON.parse(readFileSync(path.join(REPO, rel), "utf8")) as never;
const GJELDENDE_FIL = "infra/firebase/database.rules.json";
const FORSLAG_FIL = "infra/firebase/forslag/handleliste-skrivemarkor.rules.json";
const MARKOR = lesJson("infra/firebase/forslag/handleliste-skrivemarkor.markor.json") as Record<
  string,
  unknown
>;

// Medlemsklienten som appens repository-funksjoner bruker i denne filen.
const klient = vi.hoisted(() => ({
  db: undefined as Database | undefined,
  auth: undefined as Auth | undefined,
}));
vi.mock("./firebase", () => ({
  getFirebaseDatabase: () => klient.db!,
  getFirebaseAuth: () => klient.auth!,
}));

const {
  createShoppingItem,
  removeShoppingItem,
  toggleShoppingItemDone,
  transactShoppingNode,
  updateShoppingItemField,
} = await import("./shopping.repository");
const { spreadYearlyAmount } = await import("./budsjettfamilie.repository");

const F = "familie1";
const STI = `families/${F}/shopping`;
const MELK = {
  id: "melk",
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Meieri",
  done: false,
};
const MELK2 = { ...MELK, id: "melk2", amount: "2" };
const OPS = { r1: { tool: "shopping_list_add_items", at: 1, fp: "f", sub: "s", result: ["melk"] } };

let admin: AdminApp;
let adminDb: AdminDatabase;
const klientApper: FirebaseApp[] = [];

async function settRules(fil: string): Promise<void> {
  const res = await fetch(`http://127.0.0.1:9000/.settings/rules.json?ns=${NS}`, {
    method: "PUT",
    headers: { Authorization: "Bearer owner" },
    body: readFileSync(path.join(REPO, fil), "utf8"),
  });
  if (!res.ok) throw new Error(`rules: ${res.status}`);
}

async function nyKlient(uid: string | null, medlem: boolean): Promise<Database> {
  const app = initClient(
    { apiKey: "demo-key", projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `forslag-${randomUUID()}`,
  );
  klientApper.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  const db = getDatabase(app);
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
  if (uid) {
    await getAdminAuth(admin)
      .createUser({ uid })
      .catch(() => undefined);
    if (medlem) await adminDb.ref(`families/${F}/members/${uid}`).set(true);
    await signInWithCustomToken(auth, await getAdminAuth(admin).createCustomToken(uid));
  }
  if (uid && medlem) {
    klient.db = db;
    klient.auth = auth;
  }
  return db;
}

/** Utfallet av en skriving: "ok" eller "nektet" (permission_denied). */
async function utfall(p: Promise<unknown>): Promise<"ok" | "nektet"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    if (String(e).includes("ermission")) return "nektet";
    throw e;
  }
}

const node = async () => (await adminDb.ref(STI).get()).val() as Record<string, unknown> | null;
/** Det legacy `setShopping` skriver: hele noden fra `Object.values`, nøklet på `id`. */
const legacyHelnode = (raa: Record<string, unknown>) =>
  Object.fromEntries(Object.values(raa).map((i) => [String((i as { id?: unknown }).id), i]));

let medlem: Database;
let ikkeMedlem: Database;
let anonym: Database;

beforeAll(async () => {
  admin = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    `forslag-admin-${randomUUID()}`,
  );
  adminDb = getAdminDatabase(admin);
  await settRules(FORSLAG_FIL);
  medlem = await nyKlient(`medlem-${randomUUID()}`, true);
  ikkeMedlem = await nyKlient(`fremmed-${randomUUID()}`, false);
  anonym = await nyKlient(null, false);
});

beforeEach(async () => {
  await settRules(FORSLAG_FIL);
  await adminDb.ref(STI).set({ _skriver: MARKOR, _ops: OPS, melk: MELK });
  await adminDb.ref(`families/${F}/freezer`).remove();
});

afterAll(async () => {
  await adminDb.ref("families").remove();
  await Promise.all(klientApper.map((a) => deleteClientApp(a)));
  await deleteApp(admin);
});

describe("forslagsfilen", () => {
  it("er gjeldende rules med nøyaktig én endring: shopping får eget vern, foreldre-.write er fjernet", () => {
    const gjeldende = (
      lesJson(GJELDENDE_FIL) as { rules: { families: { $familyId: Record<string, string> } } }
    ).rules.families.$familyId;
    const forslag = (
      lesJson(FORSLAG_FIL) as { rules: { families: { $familyId: Record<string, unknown> } } }
    ).rules.families.$familyId;
    const M = gjeldende[".write"]!;
    expect(Object.keys(forslag).sort()).toEqual(["$annet", ".read", "shopping"]);
    expect(forslag[".read"]).toBe(gjeldende[".read"]);
    expect(forslag[".write"]).toBeUndefined();
    expect(forslag.$annet).toEqual({ ".write": M });
    const shopping = forslag.shopping as Record<string, unknown>;
    expect(shopping[".write"]).toBe(`${M} && newData.exists()`);
    const S = "newData.child('_skriver')";
    expect(String(shopping[".validate"]).split(" && ")).toEqual([
      `${S}.hasChildren(['versjon', 'name', 'cat', 'amount', 'done'])`,
      `${S}.child('versjon').val() === 'web-v2'`,
      `${S}.child('name').isString()`,
      `${S}.child('name').val().length > 0`,
      `${S}.child('cat').isString()`,
      `${S}.child('amount').isString()`,
      `${S}.child('done').val() === true`,
      `!${S}.child('id').exists()`,
    ]);
    expect(shopping._skriver).toEqual({
      versjon: { ".validate": true },
      name: { ".validate": true },
      cat: { ".validate": true },
      amount: { ".validate": true },
      done: { ".validate": true },
      $annet: { ".validate": false },
    });
  });
});

describe("tilgang", () => {
  it("medlem leser; ikke-medlem og uautentisert verken leser eller skriver", async () => {
    expect((await get(ref(medlem, STI))).val()).toMatchObject({ melk: MELK });
    for (const db of [ikkeMedlem, anonym]) {
      expect(await utfall(get(ref(db, STI)))).toBe("nektet");
      expect(await utfall(set(ref(db, `${STI}/x`), MELK))).toBe("nektet");
      expect(await utfall(set(ref(db, `families/${F}/freezer/x`), { a: 1 }))).toBe("nektet");
      expect(await utfall(set(ref(db, `families/${F}/members/x`), true))).toBe("nektet");
    }
    expect(await node()).toEqual({ _skriver: MARKOR, _ops: OPS, melk: MELK });
  });
});

describe("andre moduler og multipath", () => {
  it("medlem skriver andre moduler som før (ingen arvet .write på familienoden trengs)", async () => {
    expect(await utfall(set(ref(medlem, `families/${F}/freezer/x`), { name: "Erter" }))).toBe("ok");
  });

  it("appens ekte multipath-update fra roten (budsjett) går gjennom", async () => {
    await adminDb.ref(`families/${F}/budget/g1/i1`).set({ name: "Mat" });
    await spreadYearlyAmount(F, "budget", "g1", "i1", 1200);
    expect((await adminDb.ref(`families/${F}/budget/g1/i1/months/11/budget`).get()).val()).toBe(
      100,
    );
  });

  it("multipath på tvers av shopping-post og annen modul går gjennom når markøren står", async () => {
    expect(
      await utfall(
        update(ref(medlem), {
          [`${STI}/ny`]: { ...MELK, id: "ny" },
          [`families/${F}/freezer/y`]: { a: 1 },
        }),
      ),
    ).toBe("ok");
  });

  it("multipath som erstatter hele shopping uten markør avvises atomisk — også den andre stien", async () => {
    expect(
      await utfall(
        update(ref(medlem), { [STI]: { melk: MELK }, [`families/${F}/freezer/z`]: { a: 1 } }),
      ),
    ).toBe("nektet");
    expect((await adminDb.ref(`families/${F}/freezer/z`).get()).exists()).toBe(false);
  });
});

describe("web v2 sine ekte skriveveier", () => {
  it("opprett, feltendring (transaksjon), avhuking og fjerning per post går gjennom; markør og _ops urørt", async () => {
    const ny = await createShoppingItem(F, {
      itemId: null,
      name: "Egg",
      amount: "6",
      cat: "Meieri",
      done: false,
    });
    await updateShoppingItemField(F, ny.id, "amount", "12");
    await toggleShoppingItemDone(F, ny.id);
    await removeShoppingItem(F, "melk");
    const n = await node();
    expect(n!._skriver).toEqual(MARKOR);
    expect(n!._ops).toEqual(OPS);
    expect(n![ny.id]).toMatchObject({ name: "Egg", amount: "12", done: true });
    expect(n!.melk).toBeUndefined();
  });

  it("fjerning av siste vare går gjennom — noden står igjen med markøren", async () => {
    await adminDb.ref(STI).set({ _skriver: MARKOR, melk: MELK });
    await removeShoppingItem(F, "melk");
    expect(await node()).toEqual({ _skriver: MARKOR });
  });

  it("sammenslå og angre (helnode-transaksjon) bevarer markøren", async () => {
    await adminDb.ref(STI).set({ _skriver: MARKOR, melk: MELK, melk2: MELK2 });
    const p = lagPlan(
      [MELK, MELK2] as ShoppingItem[],
      "melk",
      "sum",
      "op-1",
      "2026-10-23T08:00:00.000Z",
    );
    if (!p.kan) throw new Error(p.grunn);
    expect(await transactShoppingNode(F, (raw) => anvendSammenslaing(raw, p.plan))).toEqual({
      utfall: "anvendt",
    });
    expect((await node())!._skriver).toEqual(MARKOR);
    expect(await transactShoppingNode(F, (raw) => angreSammenslaing(raw, "melk", "op-1"))).toEqual({
      utfall: "anvendt",
    });
    const n = await node();
    expect(n!._skriver).toEqual(MARKOR);
    expect(n!.melk2).toEqual(MELK2);
  });
});

describe("helnode og markør", () => {
  it("legacy-helnode (Object.values → id-nøkler) avvises; noden er uendret", async () => {
    const foer = await node();
    const neste = legacyHelnode({ ...foer!, melk: { ...MELK, done: true } });
    expect(Object.keys(neste).sort()).toEqual(["melk", "undefined"]);
    expect(await utfall(set(ref(medlem, STI), neste))).toBe("nektet");
    expect(await node()).toEqual(foer);
  });

  it("helnode null, tom og uten markør avvises", async () => {
    expect(await utfall(set(ref(medlem, STI), null))).toBe("nektet");
    expect(await utfall(remove(ref(medlem, STI)))).toBe("nektet");
    expect(await utfall(set(ref(medlem, STI), {}))).toBe("nektet");
    expect(await utfall(set(ref(medlem, STI), { melk: MELK }))).toBe("nektet");
    expect((await node())!._skriver).toEqual(MARKOR);
  });

  it("markøren kan ikke fjernes, endres til feil versjon eller få `id`", async () => {
    expect(await utfall(remove(ref(medlem, `${STI}/_skriver`)))).toBe("nektet");
    expect(await utfall(set(ref(medlem, `${STI}/_skriver/versjon`), "legacy"))).toBe("nektet");
    expect(await utfall(set(ref(medlem, `${STI}/_skriver/id`), "_skriver"))).toBe("nektet");
    expect((await node())!._skriver).toEqual(MARKOR);
  });

  it("helnode MED markør (web v2-form) går gjennom", async () => {
    expect(await utfall(set(ref(medlem, STI), { _skriver: MARKOR, melk: MELK }))).toBe("ok");
  });

  it("offline-kø: legacy-helnode køet frakoblet avvises ved gjenoppkobling; serveren er uendret", async () => {
    const foer = await node();
    await get(ref(medlem, STI));
    goOffline(medlem);
    const skriving = utfall(
      set(ref(medlem, STI), legacyHelnode({ ...foer!, melk: { ...MELK, amount: "9" } })),
    );
    goOnline(medlem);
    expect(await skriving).toBe("nektet");
    expect(await node()).toEqual(foer);
  });
});

describe("markørformat (review 6356624432 pkt. 1)", () => {
  const delvise: [string, unknown][] = [
    ["bare versjon", { versjon: "web-v2" }],
    ["name ikke streng", { ...MARKOR, name: 1 }],
    ["tom name", { ...MARKOR, name: "" }],
    ["done false", { ...MARKOR, done: false }],
    ["done mangler", { versjon: "web-v2", name: "x", cat: "Diverse", amount: "" }],
    ["cat ikke streng", { ...MARKOR, cat: 3 }],
    ["amount ikke streng", { ...MARKOR, amount: 0 }],
    ["ekstra felt", { ...MARKOR, ekstra: true }],
    ["med id", { ...MARKOR, id: "_skriver" }],
    ["feil versjon", { ...MARKOR, versjon: "web-v1" }],
  ];

  it.each(delvise)(
    "klientveien avviser delvis/feil markør (%s), både som barn og i helnode",
    async (_n, feil) => {
      await adminDb.ref(STI).set({ _ops: OPS, melk: MELK });
      expect(await utfall(set(ref(medlem, `${STI}/_skriver`), feil))).toBe("nektet");
      expect(await utfall(set(ref(medlem, STI), { _skriver: feil, melk: MELK }))).toBe("nektet");
      expect(await node()).toEqual({ _ops: OPS, melk: MELK });
    },
  );

  it("delvis markør skrevet utenom rules (admin): all klientskriving forblir sperret (fail-closed)", async () => {
    await adminDb.ref(STI).set({ _skriver: { versjon: "web-v2" }, melk: MELK });
    expect(await utfall(toggleShoppingItemDone(F, "melk"))).toBe("nektet");
    expect(
      await utfall(
        createShoppingItem(F, {
          itemId: null,
          name: "Egg",
          amount: "",
          cat: "Diverse",
          done: false,
        }),
      ),
    ).toBe("nektet");
    // Rettes bare ved å sette riktig markør (også via klientveien).
    expect(await utfall(set(ref(medlem, `${STI}/_skriver`), MARKOR))).toBe("ok");
    expect(await utfall(toggleShoppingItemDone(F, "melk"))).toBe("ok");
  });

  it("presis grense: et EKSTRA felt skrevet utenom rules fanges bare av etterkontrollen", async () => {
    // Regelen på `shopping` sjekker de påkrevde feltene ved hver skriving, men
    // kan ikke telle felt. `_skriver/$annet` avviser ekstra felt bare når
    // markøren selv skrives av en klient. Admin-SDK går utenom rules.
    await adminDb.ref(STI).set({ _skriver: { ...MARKOR, ekstra: true }, melk: MELK });
    expect(await utfall(toggleShoppingItemDone(F, "melk"))).toBe("ok");
    expect((await node())!._skriver).toEqual({ ...MARKOR, ekstra: true });
  });
});

describe("omfang: rules gjelder ALLE familier (review 6356624432 pkt. 4)", () => {
  const F2 = "familie2";
  const STI2 = `families/${F2}/shopping`;

  it("en familie uten markør er sperret for handleliste-skriving; andre moduler og familier påvirkes ikke", async () => {
    const uid = klient.auth!.currentUser!.uid;
    await adminDb.ref(`families/${F2}`).set({ members: { [uid]: true }, shopping: { melk: MELK } });
    expect(await utfall(toggleShoppingItemDone(F2, "melk"))).toBe("nektet");
    expect(await utfall(set(ref(medlem, `families/${F2}/freezer/x`), { a: 1 }))).toBe("ok");
    // Familien med markør virker samtidig.
    expect(await utfall(toggleShoppingItemDone(F, "melk"))).toBe("ok");
    // Én markør dekker bare sin egen familie.
    expect(await utfall(set(ref(medlem, `${STI2}/_skriver`), MARKOR))).toBe("ok");
    expect(await utfall(toggleShoppingItemDone(F2, "melk"))).toBe("ok");
    await adminDb.ref(`families/${F2}`).remove();
  });
});

describe("aktiveringsrekkefølge (rules før markør)", () => {
  it("uten markør er all handleliste-skriving sperret til markøren settes; så virker web v2", async () => {
    await adminDb.ref(STI).set({ _ops: OPS, melk: MELK });
    expect(await utfall(toggleShoppingItemDone(F, "melk"))).toBe("nektet");
    expect(await utfall(set(ref(medlem, STI), legacyHelnode({ melk: MELK })))).toBe("nektet");
    // Mislykket markørsteg (feil format) endrer ingenting — sperren står.
    expect(await utfall(set(ref(medlem, `${STI}/_skriver`), { versjon: "web-v1" }))).toBe("nektet");
    expect(await utfall(set(ref(medlem, `${STI}/_skriver`), { ...MARKOR, id: "_skriver" }))).toBe(
      "nektet",
    );
    expect(await node()).toEqual({ _ops: OPS, melk: MELK });
    // Riktig markør som barneskriving går gjennom (nye data inneholder den).
    expect(await utfall(set(ref(medlem, `${STI}/_skriver`), MARKOR))).toBe("ok");
    expect(await utfall(toggleShoppingItemDone(F, "melk"))).toBe("ok");
    expect((await node())!.melk).toMatchObject({ done: true });
  });

  it("tom/manglende handleliste: markøren alene kan settes", async () => {
    await adminDb.ref(STI).remove();
    expect(await utfall(set(ref(medlem, `${STI}/_skriver`), MARKOR))).toBe("ok");
    expect(await node()).toEqual({ _skriver: MARKOR });
  });

  it("retur før aktivering: gjeldende rules tilbake → legacy-helnode virker som i dag", async () => {
    await adminDb.ref(STI).set({ _ops: OPS, melk: MELK });
    await settRules(GJELDENDE_FIL);
    expect(
      await utfall(set(ref(medlem, STI), legacyHelnode({ melk: { ...MELK, done: true } }))),
    ).toBe("ok");
    expect(await utfall(toggleShoppingItemDone(F, "melk"))).toBe("ok");
  });
});
