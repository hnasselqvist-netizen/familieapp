/**
 * «Merk som fullført»/«Merk som ikke fullført» i React-Handlelisten (Mat
 * #20, ordre 6908431056) mot emulatoren med syntetiske data. Klient A er
 * appens klient-SDK; klient B (admin-SDK) handler samtidig. Kontrolleres med
 * `exportVal()`, så prioritet, historikk og reserverte metadata telles.
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
import { lagStatusPlan, vurderStatus } from "@domain/shopping/handlelisteStatus";
import type { ShoppingItem } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import {
  lesHandlelistestatus,
  settHandlelistestatus,
  subscribeShoppingList,
} from "./shopping.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const STI = `families/${FAMILY_ID}/shopping`;

let adminApp: AdminApp;
let admin: AdminDatabase;
let uid: string;

const NODE = () => ({
  ".priority": 1,
  m: {
    id: "m",
    itemId: "v-melk",
    name: "Melk",
    amount: "2",
    cat: "Ost og meieri",
    done: false,
    ukjentFelt: { x: 1 },
    sammenslaing: { opId: "op-1", tidspunkt: "t", kilder: { d: { name: "Melk" } } },
    ".priority": 5,
  },
  b: {
    id: "b",
    itemId: "v-brod",
    name: "Brød",
    amount: "1",
    cat: "Brød og bakst",
    done: true,
    ".priority": "p-b",
  },
  _skriver: { av: "react", ".priority": 8 },
  _ops: { r1: { tool: "x", at: 1 } },
});

/** Det klient A ser: raden fra et aktivt abonnement (kald cache etterpå). */
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
const eksport = async () => (await admin.ref(STI).get()).exportVal() as Record<string, unknown>;

/** Samme sammensetning som `useShoppingList.settStatus`. */
const merk = (rad: ShoppingItem, maal: boolean) => {
  const plan = lagStatusPlan(rad, maal);
  return settHandlelistestatus(
    FAMILY_ID,
    plan.id,
    plan.maal,
    (raw) => vurderStatus(raw, plan),
    `«${plan.navn}» er ikke lenger på listen. Ingenting er endret.`,
  );
};
/** Eksporten med `done` på `id` satt til `done` — alt annet likt. */
const medDone = (e: Record<string, unknown>, id: string, done: boolean) => ({
  ...e,
  [id]: { ...(e[id] as Record<string, unknown>), done },
});

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
    "integration-test-admin-handleliste-status",
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

describe("målstatus: begge retninger, bare `done` endres", () => {
  it("«Merk som fullført» og «Merk som ikke fullført»: råfelt, prioritet, historikk, andre rader og metadata består", async () => {
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await merk(await sett("m"), true)).toEqual({ utfall: "anvendt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 200"]);
    expect(stabil(await eksport())).toBe(stabil(medDone(foer, "m", true)));

    expect(await merk(await sett("b"), false)).toEqual({ utfall: "anvendt" });
    expect(stabil(await eksport())).toBe(stabil(medDone(medDone(foer, "m", true), "b", false)));
  });
});

describe("samtidige valg", () => {
  for (const [rad, maal] of [
    ["m", true],
    ["b", false],
  ] as const) {
    it(`A og B ser samme status og velger begge ${maal ? "fullført" : "ikke fullført"} (${rad}): skrivefri no-op, ingen reversering`, async () => {
      const a = await sett(rad);
      await admin.ref(`${STI}/${rad}/done`).set(maal); // B sitt valg
      const foer = await eksport();
      const f = fangFetch();
      try {
        expect(await merk(a, maal)).toEqual({ utfall: "allerede" });
      } finally {
        f.gjenopprett();
      }
      expect(f.kall).toEqual(["GET 200"]);
      expect(stabil(await eksport())).toBe(stabil(foer));
    });
  }

  it("raskt dobbeltklikk (to samtidige forsøk med samme mål): ender på målet, aldri reversert", async () => {
    const a = await sett("m");
    const foer = await eksport();
    const u = await Promise.all([merk(a, true), merk(a, true)]);
    expect(u.map((x) => x.utfall).sort()).toEqual(["allerede", "anvendt"]);
    expect(stabil(await eksport())).toBe(stabil(medDone(foer, "m", true)));
  });

  it("urelatert feltendring på samme rad mellom lesing og skriving: 412, ny runde, begge endringene består", async () => {
    const a = await sett("m");
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/m/amount`).set("5");
      },
    });
    try {
      expect(await merk(a, true)).toEqual({ utfall: "anvendt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200", "PUT 200"]);
    expect((await eksport()).m).toMatchObject({ amount: "5", done: true, ".priority": 5 });
  });

  it("endring i en annen rad før lesing: består urørt", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/b/amount`).set("9");
    expect(await merk(a, true)).toEqual({ utfall: "anvendt" });
    expect((await eksport()).b).toMatchObject({ amount: "9", done: true, ".priority": "p-b" });
  });
});

describe("radidentitet", () => {
  it("posten er borte: gjenoppstår aldri, entydig melding, ingen skriving", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m`).remove();
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await merk(a, true)).toEqual({
        utfall: "konflikt",
        grunn: "«Melk» er ikke lenger på listen. Ingenting er endret.",
      });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect((await eksport()).m).toBeUndefined();
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("posten er byttet ut med en annen vare under samme nøkkel: status settes ikke", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m`).update({ name: "Lettmelk", itemId: "v-lettmelk" });
    const foer = await eksport();
    expect(await merk(a, true)).toMatchObject({
      utfall: "konflikt",
      grunn: expect.stringMatching(/«Melk» er endret på en annen enhet \(nå «Lettmelk»\)/),
    });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("nektet (ikke medlem): `avvist`, ingenting endret", async () => {
    const a = await sett("m");
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    const foer = await eksport();
    expect(await merk(a, true)).toEqual({ utfall: "avvist" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});

describe("tapt svar og skrivefri kontroll", () => {
  it("tapt svar etter PUT 200: ukjent; nektet kontroll er fortsatt uavklart; senere kontroll viser statusen uten å skrive eller reversere", async () => {
    const a = await sett("m");
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await merk(a, true)).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    const lagret = await eksport();
    expect(lagret.m).toMatchObject({ done: true });

    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    expect(await lesHandlelistestatus(FAMILY_ID, "m")).toEqual({ utfall: "avvist" });
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);

    const g = fangFetch();
    try {
      expect(await lesHandlelistestatus(FAMILY_ID, "m")).toEqual({ utfall: "lest", done: true });
    } finally {
      g.gjenopprett();
    }
    expect(g.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(lagret));
  });

  it("tapt svar før serveren: ingenting endret; kontrollen viser uendret status og at en borte post er borte", async () => {
    const a = await sett("m");
    const foer = await eksport();
    const ekte = globalThis.fetch;
    const spion = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if ((init?.method ?? "GET") === "PUT") throw new TypeError("Failed to fetch");
      return ekte(input, init);
    });
    try {
      expect(await merk(a, true)).toEqual({ utfall: "ukjent" });
    } finally {
      spion.mockRestore();
    }
    expect(stabil(await eksport())).toBe(stabil(foer));
    expect(await lesHandlelistestatus(FAMILY_ID, "m")).toEqual({ utfall: "lest", done: false });
    await admin.ref(`${STI}/m`).remove();
    expect(await lesHandlelistestatus(FAMILY_ID, "m")).toEqual({ utfall: "borte" });
  });
});
