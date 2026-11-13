/**
 * Sammenslåing og angring av handlelisteduplikater (Mat #20, ordre
 * 6837116507): avslag og replay skal være skrivefrie, og RTDB-prioritet
 * skal bevares ved en reell endring. Kontrolleres med `exportVal()` mot
 * emulatoren. Admin-SDK-en er den andre klienten som endrer noden mellom
 * lesing og commit. Syntetiske data.
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
import {
  type SammenslaingsPlan,
  angreSammenslaing,
  anvendSammenslaing,
  lagPlan,
  stabil,
} from "@domain/shopping/handlelisteDuplikater";
import type { ShoppingItem } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import { skrivHandlelisteNode } from "./shopping.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const T0 = "2026-11-12T22:00:00.000Z";
const STI = `families/${FAMILY_ID}/shopping`;

let adminApp: AdminApp;
let admin: AdminDatabase;

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "1",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
const A = rad("a", { amount: "1" });
const B = rad("b", { amount: "2" });
const EGG = rad("x", { name: "Egg", itemId: "v-egg" });
const MARKOR = { av: "react", siden: "2026-10-20" };
const OPS = { req1: { tool: "shopping_list_add_items", at: 1 } };
const KV = { "op-gml": { lagt: { g: { name: "G" } } } };

/** Node med prioritet på rot, urørte poster og metadata — ikke på radene som slås sammen. */
const NODE = () => ({
  ".priority": 1,
  a: { ...A, ".priority": 5 },
  b: { ...B },
  x: { ...EGG, ".priority": "p-x", d: { y: 1, ".priority": 2 } },
  _skriver: { ...MARKOR, ".priority": 8 },
  _ops: { ...OPS, ".priority": 9 },
  _reactForsok: { ...KV, ".priority": 4 },
});

const eksport = async () => (await admin.ref(STI).get()).exportVal() as Record<string, unknown>;
const settNode = (node: unknown) => admin.ref(STI).set(node);
const plan = (opId = "op-1"): SammenslaingsPlan => {
  const p = lagPlan([A, B], "a", "sum", opId, T0);
  if (!p.kan) throw new Error(p.grunn);
  return p.plan;
};
const slaaSammen = (p: SammenslaingsPlan) =>
  skrivHandlelisteNode(FAMILY_ID, (raw) => anvendSammenslaing(raw, p));
const angre = (beholdId: string, opId: string) =>
  skrivHandlelisteNode(FAMILY_ID, (raw) => angreSammenslaing(raw, beholdId, opId));

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
    "integration-test-admin-duplikater-prioritet",
  );
  admin = getAdminDatabase(adminApp);
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  await signInWithCustomToken(
    getFirebaseAuth(),
    await getAdminAuth(adminApp).createCustomToken(uid),
  );
});

beforeEach(() => admin.ref(STI).remove());

afterAll(async () => {
  await admin.ref(`families/${FAMILY_ID}`).remove();
  await deleteApp(adminApp);
});

describe("sammenslåing: skrivefrie avslag og bevart prioritet", () => {
  it("konflikt (kilden endret) skriver ingenting: eksport byte-lik", async () => {
    await settNode(NODE());
    const p = plan();
    await admin.ref(`${STI}/b/amount`).set("5");
    const foer = await eksport();
    expect(await slaaSammen(p)).toMatchObject({ utfall: "konflikt" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("ordinær sammenslåing: prioritet på rot, urørte poster, metadata og målraden bevares", async () => {
    await settNode(NODE());
    const foer = await eksport();
    expect(await slaaSammen(plan())).toEqual({ utfall: "anvendt" });
    const etter = await eksport();
    for (const k of [".priority", "x", "_skriver", "_ops", "_reactForsok"]) {
      expect(stabil(etter[k]), k).toBe(stabil(foer[k]));
    }
    expect(etter.b).toBeUndefined();
    const a = etter.a as Record<string, unknown>;
    expect(a[".priority"]).toBe(5);
    expect(a.amount).toBe("3");
  });

  it("replay etter commit er skrivefri: eksport byte-lik", async () => {
    await settNode(NODE());
    expect(await slaaSammen(plan())).toEqual({ utfall: "anvendt" });
    const foer = await eksport();
    expect(await slaaSammen(plan())).toEqual({ utfall: "allerede" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("kilderad med prioritet (kan ikke gjenopprettes eksakt): stopper før mutasjon", async () => {
    await settNode({ ...NODE(), b: { ...B, ".priority": 3 } });
    const foer = await eksport();
    expect(await slaaSammen(plan())).toMatchObject({ utfall: "konflikt" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("målrad med prioritet dypere inne: stopper før mutasjon", async () => {
    await settNode({ ...NODE(), a: { ...A, detalj: { z: 1, ".priority": 6 } } });
    const foer = await eksport();
    expect(await slaaSammen(plan())).toMatchObject({ utfall: "konflikt" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("prioritetsendring hos en annen klient mellom lesing og commit: 412, ny runde, begge bevart", async () => {
    await settNode(NODE());
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/x`).setPriority("ny-p", () => undefined);
      },
    });
    try {
      expect(await slaaSammen(plan())).toEqual({ utfall: "anvendt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200", "PUT 200"]);
    const etter = await eksport();
    expect((etter.x as Record<string, unknown>)[".priority"]).toBe("ny-p");
    expect((etter.a as Record<string, unknown>).amount).toBe("3");
  });

  it("kilden endres hos en annen klient mellom lesing og commit: 412, så konflikt uten skriving", async () => {
    await settNode(NODE());
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/b/amount`).set("9");
      },
    });
    try {
      expect(await slaaSammen(plan())).toMatchObject({ utfall: "konflikt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200"]);
    const etter = await eksport();
    expect((etter.b as Record<string, unknown>).amount).toBe("9");
    expect((etter.a as Record<string, unknown>).sammenslaing).toBeUndefined();
  });

  it("tapt svar: ukjent; gjentak med samme opId gir allerede og én virkning", async () => {
    await settNode(NODE());
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await slaaSammen(plan())).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    const foer = await eksport();
    expect((foer.a as Record<string, unknown>).amount).toBe("3");
    expect(await slaaSammen(plan())).toEqual({ utfall: "allerede" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});

describe("angring: skrivefrie avslag og bevart prioritet", () => {
  const sammenslatt = async () => {
    await settNode(NODE());
    expect(await slaaSammen(plan())).toEqual({ utfall: "anvendt" });
  };

  it("ordinær angring: radene gjenopprettes eksakt; prioritet på rot, urørte poster, metadata og målrad bevares", async () => {
    await sammenslatt();
    const foer = await eksport();
    expect(await angre("a", "op-1")).toEqual({ utfall: "anvendt" });
    const etter = await eksport();
    for (const k of [".priority", "x", "_skriver", "_ops", "_reactForsok"]) {
      expect(stabil(etter[k]), k).toBe(stabil(foer[k]));
    }
    expect(etter.b).toEqual(B);
    const a = etter.a as Record<string, unknown>;
    expect(a[".priority"]).toBe(5);
    expect(a.amount).toBe("1");
    expect(a.sammenslaingAngret).toEqual({ "op-1": true });
  });

  it("replay av angring og konflikt (raden endret etter sammenslåing) er skrivefrie", async () => {
    await sammenslatt();
    expect(await angre("a", "op-1")).toEqual({ utfall: "anvendt" });
    let foer = await eksport();
    expect(await angre("a", "op-1")).toEqual({ utfall: "allerede" });
    expect(stabil(await eksport())).toBe(stabil(foer));

    await settNode(NODE());
    expect(await slaaSammen(plan("op-2"))).toEqual({ utfall: "anvendt" });
    await admin.ref(`${STI}/a/amount`).set("7");
    foer = await eksport();
    expect(await angre("a", "op-2")).toMatchObject({ utfall: "konflikt" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("tapt svar på angring: gjentak gir allerede og én virkning", async () => {
    await sammenslatt();
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await angre("a", "op-1")).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    const foer = await eksport();
    expect(foer.b).toEqual(B);
    expect(await angre("a", "op-1")).toEqual({ utfall: "allerede" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});

describe("gjentak og reserverte nøkler (review 5883585162)", () => {
  it("gjentak av sammenslåing uten historikk: ubekreftet, ingen PUT, eksport byte-lik", async () => {
    await settNode(NODE());
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(
        await skrivHandlelisteNode(FAMILY_ID, (raw) => anvendSammenslaing(raw, plan(), true)),
      ).toMatchObject({ utfall: "ubekreftet" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("gjentak av angring som ikke er utført: ubekreftet, ingen PUT", async () => {
    await settNode(NODE());
    expect(await slaaSammen(plan())).toEqual({ utfall: "anvendt" });
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(
        await skrivHandlelisteNode(FAMILY_ID, (raw) => angreSammenslaing(raw, "a", "op-1", true)),
      ).toMatchObject({ utfall: "ubekreftet" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("syntetisk lagret historikk med reservert kilde (`kilder._ops`, `_ops` fraværende): konflikt før PUT, eksport uendret", async () => {
    await settNode(NODE());
    expect(await slaaSammen(plan())).toEqual({ utfall: "anvendt" });
    await admin.ref(`${STI}/_ops`).remove();
    await admin.ref(`${STI}/a/sammenslaing/kilder`).set({ _ops: { req9: { tool: "falsk" } } });
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await angre("a", "op-1")).toMatchObject({ utfall: "konflikt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    const etter = await eksport();
    expect(etter._ops).toBeUndefined();
    expect(stabil(etter)).toBe(stabil(foer));
  });

  it("adapteren avviser enhver endring av reserverte nøkler, uansett beslutning", async () => {
    await settNode(NODE());
    const foer = await eksport();
    for (const k of ["_ops", "_skriver", "_reactForsok", "_ny"]) {
      const f = fangFetch();
      try {
        expect(
          await skrivHandlelisteNode(FAMILY_ID, (raw) => ({
            utfall: "anvendt",
            node: { ...(raw as Record<string, unknown>), [k]: { endret: true } },
          })),
          k,
        ).toMatchObject({ utfall: "konflikt" });
      } finally {
        f.gjenopprett();
      }
      expect(f.kall, k).toEqual(["GET 200"]);
    }
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("ordinær historikk er uendret kompatibel: sammenslå → angre virker", async () => {
    await settNode(NODE());
    expect(await slaaSammen(plan())).toEqual({ utfall: "anvendt" });
    expect(await angre("a", "op-1")).toEqual({ utfall: "anvendt" });
    expect((await eksport()).b).toEqual(B);
  });
});
