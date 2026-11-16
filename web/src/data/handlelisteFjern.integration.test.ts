/**
 * «Fjern» på én rad i React-Handlelisten (Mat #20, ordre 6903150917) mot
 * emulatoren med syntetiske data. Klient A er appens klient-SDK med et
 * aktivt abonnement; klient B (admin-SDK) endrer raden etter at A så den.
 * Kontrolleres med `exportVal()`, så prioritet og reserverte metadata telles.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  type Database as AdminDatabase,
  getDatabase as getAdminDatabase,
} from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { stabil } from "@domain/shopping/handlelisteDuplikater";
import { lagFjernPlan, vurderFjerning } from "@domain/shopping/handlelisteFjerning";
import type { ShoppingItem } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import { fjernHandlelistepost, subscribeShoppingList } from "./shopping.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const STI = `families/${FAMILY_ID}/shopping`;

let adminApp: AdminApp;
let admin: AdminDatabase;
let uid: string;

const MELK = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};
const NODE = () => ({
  ".priority": 1,
  m: { ...MELK, ".priority": 5 },
  b: {
    id: "b",
    itemId: "v-brod",
    name: "Brød",
    amount: "1",
    cat: "Brød og bakst",
    done: false,
    ".priority": "p-b",
  },
  _skriver: { av: "react", ".priority": 8 },
  _ops: { r1: { tool: "x", at: 1 } },
});

/** Det klient A ser: raden fra et aktivt abonnement. */
const sett = (id: string) =>
  new Promise<ShoppingItem>((resolve) => {
    const av = subscribeShoppingList(FAMILY_ID, (rader) => {
      const r = rader.find((x) => x.id === id);
      if (r) {
        av();
        resolve(r);
      }
    });
  });
const lesRad = async (id: string) => (await admin.ref(`${STI}/${id}`).get()).val();

/** Samme sammensetning som `useShoppingList.fjernRad`. */
const fjern = (rad: ShoppingItem) => {
  const plan = lagFjernPlan(rad);
  return fjernHandlelistepost(FAMILY_ID, plan.id, (raw) => vurderFjerning(raw, plan));
};
const eksport = async () => (await admin.ref(STI).get()).exportVal() as Record<string, unknown>;

/** Fanger REST-kallene: `forPut` kjøres før hver PUT; `tapSvar` kaster etter at PUT-en nådde serveren. */
function fangFetch(valg: { forPut?: (n: number) => Promise<void>; tapSvar?: boolean } = {}) {
  const ekte = globalThis.fetch;
  const kall: string[] = [];
  let puts = 0;
  const spion = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const metode = init?.method ?? "GET";
    if (metode === "PUT") {
      puts += 1;
      await valg.forPut?.(puts);
    }
    const res = await ekte(input, init);
    kall.push(`${metode} ${res.status}`);
    if (metode === "PUT" && valg.tapSvar) throw new TypeError("Failed to fetch");
    return res;
  });
  return { kall, gjenopprett: () => spion.mockRestore() };
}

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "integration-test-admin-handleliste-fjern",
  );
  admin = getAdminDatabase(adminApp);
  uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  await signInWithCustomToken(
    getFirebaseAuth(),
    await getAdminAuth(adminApp).createCustomToken(uid),
  );
});

beforeEach(async () => {
  await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  await admin.ref(STI).set(NODE());
});

afterAll(async () => {
  await admin.ref(`families/${FAMILY_ID}`).remove();
  await deleteApp(adminApp);
});

describe("«Fjern» etter samtidig endring (to klienter)", () => {
  for (const [hva, endring] of [
    ["mengde", { amount: "3" }],
    ["varekobling", { itemId: "v-melk-2" }],
    ["fullførtstatus", { done: true }],
  ] as const) {
    it(`B endrer ${hva} etter at A så raden: A sin «Fjern» skal ikke slette B sin oppdatering`, async () => {
      const a = await sett("m");
      await admin.ref(`${STI}/m`).update(endring);
      const foer = await eksport();
      const f = fangFetch();
      try {
        expect(await fjern(a)).toMatchObject({
          utfall: "konflikt",
          grunn: expect.stringMatching(/Den er ikke fjernet/),
        });
      } finally {
        f.gjenopprett();
      }
      expect(f.kall).toEqual(["GET 200"]);
      expect(await lesRad("m")).toMatchObject(endring);
      expect(stabil(await eksport())).toBe(stabil(foer));
    });
  }
});

describe("«Fjern» med grunnlagsvern", () => {
  it("uendret rad (aktiv og fullført): slettes; prioritet, markør, MCP-metadata og urørte rader består", async () => {
    await admin
      .ref(`${STI}/f`)
      .set({ ...MELK, id: "f", name: "Fløte", done: true, ".priority": 2 });
    const foer = await eksport();
    expect(await fjern(await sett("m"))).toEqual({ utfall: "anvendt" });
    expect(await fjern(await sett("f"))).toEqual({ utfall: "anvendt" });
    const etter = await eksport();
    expect(etter.m).toBeUndefined();
    expect(etter.f).toBeUndefined();
    for (const k of [".priority", "b", "_skriver", "_ops"]) {
      expect(stabil(etter[k]), k).toBe(stabil(foer[k]));
    }
  });

  it("raden endres hos B mellom A sin lesing og sletting: 412, ny vurdering, konflikt uten skriving", async () => {
    const a = await sett("m");
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/m/amount`).set("4");
      },
    });
    try {
      expect(await fjern(a)).toMatchObject({ utfall: "konflikt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200"]);
    expect(await lesRad("m")).toMatchObject({ amount: "4" });
  });

  it("en annen rad endres samtidig: 412, ny runde, sletting gjennomføres og B sin endring består", async () => {
    const a = await sett("m");
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) {
          await admin.ref(`${STI}/b/amount`).set("2");
          await admin.ref(`${STI}/b`).setPriority("ny-p", () => undefined);
        }
      },
    });
    try {
      expect(await fjern(a)).toEqual({ utfall: "anvendt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200", "PUT 200"]);
    const etter = await eksport();
    expect(etter.m).toBeUndefined();
    expect(etter.b).toMatchObject({ amount: "2", ".priority": "ny-p" });
  });

  it("forsvunnet mål: posten er allerede borte — entydig `allerede`, ingen skriving", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m`).remove();
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await fjern(a)).toEqual({ utfall: "allerede" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("tapt svar etter PUT 200: ukjent; «Prøv igjen» med samme grunnlag gir `allerede` uten ny skriving", async () => {
    const a = await sett("m");
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await fjern(a)).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 200"]);
    const foer = await eksport();
    expect(foer.m).toBeUndefined();
    const g = fangFetch();
    try {
      expect(await fjern(a)).toEqual({ utfall: "allerede" });
    } finally {
      g.gjenopprett();
    }
    expect(g.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("nektet (ikke medlem): `avvist`, ingenting fjernet", async () => {
    const a = await sett("m");
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    const foer = await eksport();
    expect(await fjern(a)).toEqual({ utfall: "avvist" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});
