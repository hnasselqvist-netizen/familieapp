/**
 * Manuell innlegging med varsel (Mat #20, ordre 6830803229) i den EKTE
 * skriveveien mot emulatoren: `skrivHandlelisteVersjonert` (REST med ETag
 * og `if-match`) med domenets rene beslutninger, slik `useShoppingList`
 * kobler dem. Admin-SDK-en spiller «en annen klient» som endrer noden
 * underveis; to samtidige kall fra skriveren er to uavhengige HTTP-
 * forespørsler. Prioriteter kontrolleres med `exportVal()` (review
 * 5880291160 pkt. 1). Syntetiske data.
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
import {
  KVITTERINGER,
  type NyRadPlan,
  type OkningsPlan,
  anvendNyRad,
  anvendOkning,
  lagOkningsPlan,
} from "@domain/shopping/handlelisteInnlegging";
import type { ShoppingItem } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import { skrivHandlelisteVersjonert } from "./shopping.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const STI = `families/${FAMILY_ID}/shopping`;

let adminApp: AdminApp;
let admin: AdminDatabase;

const rad = (id: string, o: Partial<ShoppingItem> = {}): ShoppingItem => ({
  id,
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
  ...o,
});
const OPS = { req1: { tool: "shopping_list_add_items", at: 1, fp: "f", sub: "s", result: ["x"] } };
const lesNode = async () =>
  (await admin.ref(STI).get()).val() as Record<string, Record<string, unknown>> | null;
const settNode = (node: unknown) => admin.ref(STI).set(node);

const nyPlan = (opId: string, o: Partial<NyRadPlan["rad"]> = {}): NyRadPlan => ({
  opId,
  rad: { itemId: "v-melk", name: "Melk", amount: "1", cat: "Ost og meieri", done: false, ...o },
});
const okPlan = (r: ShoppingItem, tillegg: string, opId: string): OkningsPlan => {
  const p = lagOkningsPlan(r, tillegg, opId);
  if (!p.kan) throw new Error(p.grunn);
  return p.plan;
};
const leggTil = (p: NyRadPlan, gjentak = false) =>
  skrivHandlelisteVersjonert(FAMILY_ID, KVITTERINGER, (raw) => anvendNyRad(raw, p, gjentak));
const ok = (p: OkningsPlan, gjentak = false) =>
  skrivHandlelisteVersjonert(FAMILY_ID, KVITTERINGER, (raw) => anvendOkning(raw, p, gjentak));
/**
 * Fanger REST-kallene skriveren gjør. `forPut` kjøres rett før hver PUT
 * sendes (f.eks. en samtidig endring fra en annen klient); `tapSvar` lar
 * PUT-en nå serveren, men kaster i stedet for å gi svaret tilbake.
 */
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
    "integration-test-admin-shopping-innlegging",
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

describe("ny rad uten treff (emulator, kald klient)", () => {
  it("tom liste: raden lagres på opId med kvittering; gjentak gir allerede, ingen ny rad", async () => {
    expect(await leggTil(nyPlan("op-1"))).toEqual({ utfall: "anvendt" });
    const n = await lesNode();
    expect(n!["op-1"]).toEqual({
      itemId: "v-melk",
      name: "Melk",
      amount: "1",
      cat: "Ost og meieri",
      done: false,
      id: "op-1",
    });
    expect(await leggTil(nyPlan("op-1"), true)).toEqual({ utfall: "allerede" });
    expect(stabil(await lesNode())).toBe(stabil(n));
  });

  it("annen vare, fullført rad og annen bekreftet vare med samme navn: ny rad, alt annet urørt", async () => {
    const foer = {
      _ops: OPS,
      f: { ...rad("f"), done: true, ukjent: { fra: "legacy" } },
      a: rad("a", { itemId: "v-annen" }),
      b: rad("b", { name: "Brød", itemId: "v-brod" }),
    };
    await settNode(foer);
    expect(await leggTil(nyPlan("op-2"))).toEqual({ utfall: "anvendt" });
    const n = await lesNode();
    expect(Object.keys(n!).sort()).toEqual(["_ops", KVITTERINGER, "a", "b", "f", "op-2"]);
    for (const k of ["_ops", "a", "b", "f"] as const) expect(stabil(n![k])).toBe(stabil(foer[k]));
  });

  it("varen ble lagt til av en annen klient etter visning: konflikt med treff, ingenting skrives", async () => {
    await settNode({ b: rad("b", { name: "Brød", itemId: "v-brod" }) });
    await admin.ref(`${STI}/x`).set(rad("x", { itemId: null, name: "melk" }));
    const foer = await lesNode();
    expect(await leggTil(nyPlan("op-3"))).toMatchObject({ utfall: "konflikt", treff: true });
    expect(stabil(await lesNode())).toBe(stabil(foer));
  });

  it("to klienter legger til samme vare samtidig: nøyaktig én rad, den andre får konflikt", async () => {
    await settNode({ b: rad("b", { name: "Brød", itemId: "v-brod" }) });
    const [klient, annen] = await Promise.all([leggTil(nyPlan("op-k")), leggTil(nyPlan("op-a"))]);
    const utfall = [klient.utfall, annen.utfall].sort();
    expect(utfall).toEqual(["anvendt", "konflikt"]);
    const n = await lesNode();
    const melk = Object.entries(n!).filter(([k, v]) => !k.startsWith("_") && v.name === "Melk");
    expect(melk).toHaveLength(1);
  });

  it("gjentak uten kvittering er ubekreftet og skriver ingenting", async () => {
    await settNode({ b: rad("b", { name: "Brød", itemId: "v-brod" }) });
    const foer = await lesNode();
    expect(await leggTil(nyPlan("op-4"), true)).toMatchObject({ utfall: "ubekreftet" });
    expect(stabil(await lesNode())).toBe(stabil(foer));
  });

  it("raden fjernet på annen enhet etter lagring: gjentak gjenoppretter den ikke", async () => {
    expect(await leggTil(nyPlan("op-5"))).toEqual({ utfall: "anvendt" });
    await admin.ref(`${STI}/op-5`).remove();
    expect(await leggTil(nyPlan("op-5"), true)).toEqual({ utfall: "allerede" });
    expect((await lesNode())!["op-5"]).toBeUndefined();
  });
});

describe("«Øk antallet» (emulator, kald klient)", () => {
  const melk = rad("m", { amount: "2" });
  const lagret = {
    ...melk,
    ukjent: { fra: "legacy" },
    sammenslaing: { opId: "s1", foer: { name: "Melk" }, kilder: { k: { name: "Melk" } } },
  };

  it("øker bare mengden; andre felt, metadata og historikk bevares; gjentak øker ikke to ganger", async () => {
    const foer = { _ops: OPS, m: lagret, b: rad("b", { name: "Brød", itemId: "v-brod" }) };
    await settNode(foer);
    const p = okPlan(melk, "3", "op-o1");
    expect(await ok(p)).toEqual({ utfall: "anvendt" });
    const n = await lesNode();
    expect(stabil(n!.m)).toBe(stabil({ ...lagret, amount: "5" }));
    expect(stabil(n!._ops)).toBe(stabil(OPS));
    expect(stabil(n!.b)).toBe(stabil(foer.b));
    // Tapt svar → samme forsøk sendes på nytt: kvitteringen hindrer dobbel økning.
    expect(await ok(p, true)).toEqual({ utfall: "allerede" });
    expect(await ok(p)).toEqual({ utfall: "allerede" });
    expect((await lesNode())!.m!.amount).toBe("5");
  });

  const stale: [string, () => Promise<unknown>][] = [
    ["mengde endret", () => admin.ref(`${STI}/m/amount`).set("4")],
    ["huket av", () => admin.ref(`${STI}/m/done`).set(true)],
    ["fjernet", () => admin.ref(`${STI}/m`).remove()],
  ];
  for (const [navn, endre] of stale) {
    it(`målraden ${navn} på annen klient etter visning → konflikt, ingenting skrives`, async () => {
      await settNode({ m: lagret });
      const p = okPlan(melk, "1", `op-${navn}`);
      await endre();
      const foer = await lesNode();
      expect(await ok(p)).toMatchObject({ utfall: "konflikt" });
      expect(stabil(await lesNode())).toBe(stabil(foer));
    });
  }

  it("to klienter øker samme rad samtidig: nøyaktig én økning", async () => {
    await settNode({ m: lagret });
    const [klient, annen] = await Promise.all([
      ok(okPlan(melk, "1", "op-k")),
      ok(okPlan(melk, "1", "op-a")),
    ]);
    expect([klient.utfall, annen.utfall].sort()).toEqual(["anvendt", "konflikt"]);
    expect((await lesNode())!.m!.amount).toBe("3");
  });
});

describe("prioritet og skrivefrie avslag (review 5880291160 pkt. 1)", () => {
  /** Node med prioritet på rot, poster, metadata og dypt i en post. */
  const MED_PRIORITET = {
    ".priority": 1,
    m: { ...rad("m"), ".priority": 7, detalj: { x: 1, ".priority": 2 } },
    b: { ...rad("b", { name: "Brød", itemId: "v-brod" }), ".priority": "p-b" },
    _ops: { ...OPS, ".priority": 9 },
  };
  const eksport = async () => (await admin.ref(STI).get()).exportVal() as unknown;

  it("konflikt (treff) skriver ingenting: eksportform med prioriteter er byte-lik", async () => {
    await settNode(MED_PRIORITET);
    const foer = await eksport();
    expect(await leggTil(nyPlan("op-p1"))).toMatchObject({ utfall: "konflikt", treff: true });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("ubekreftet gjentak og konflikt i økning skriver ingenting", async () => {
    await settNode(MED_PRIORITET);
    const foer = await eksport();
    expect(await leggTil(nyPlan("op-p2", { name: "Egg", itemId: "v-egg" }), true)).toMatchObject({
      utfall: "ubekreftet",
    });
    expect(await ok(okPlan(rad("m", { amount: "9" }), "1", "op-p3"))).toMatchObject({
      utfall: "konflikt",
    });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("økning bevarer prioritet på rot, urørte poster, metadata, kvitteringer og målraden selv", async () => {
    const node = {
      ".priority": 1,
      m: { ...rad("m"), ".priority": 7 },
      b: {
        ...rad("b", { name: "Brød", itemId: "v-brod" }),
        ".priority": "p-b",
        d: { x: 1, ".priority": 2 },
      },
      _ops: { ...OPS, ".priority": 9 },
      [KVITTERINGER]: { gammel: { lagt: { g: { name: "G" } }, ".priority": 4 } },
    };
    await settNode(node);
    const foer = (await eksport()) as Record<string, Record<string, unknown>>;
    expect(await ok(okPlan(rad("m"), "3", "op-p4"))).toEqual({ utfall: "anvendt" });
    const etter = (await eksport()) as Record<string, Record<string, unknown>>;
    expect(stabil(etter.b)).toBe(stabil(foer.b));
    expect(stabil(etter._ops)).toBe(stabil(foer._ops));
    expect(foer._ops![".priority"]).toBe(9);
    expect(etter[".priority"]).toBe(1);
    expect(etter.m).toEqual({ ...rad("m"), amount: "5", ".priority": 7 });
    expect(etter[KVITTERINGER]!.gammel).toEqual(node[KVITTERINGER].gammel);
    expect(etter[KVITTERINGER]!["op-p4"]).toEqual({ okt: { m: { fra: "2", til: "5" } } });
  });

  it("målrad med prioritet dypere inne: stopper uten skriving", async () => {
    await settNode(MED_PRIORITET);
    const foer = await eksport();
    expect(await ok(okPlan(rad("m"), "1", "op-p5"))).toMatchObject({ utfall: "konflikt" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("samtidig prioritetsendring mellom lesing og skriving: 412, ny runde, begge bevart", async () => {
    await settNode(MED_PRIORITET);
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/b`).setPriority("ny-p", () => undefined);
      },
    });
    try {
      expect(await leggTil(nyPlan("op-p6", { name: "Egg", itemId: "v-egg" }))).toEqual({
        utfall: "anvendt",
      });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200", "PUT 200"]);
    const etter = (await eksport()) as Record<string, Record<string, unknown>>;
    expect(etter.b![".priority"]).toBe("ny-p");
    expect(stabil(etter.m)).toBe(stabil(MED_PRIORITET.m));
    expect(etter["op-p6"]).toMatchObject({ name: "Egg", id: "op-p6" });
  });

  it("samtidig ny rad med samme vare mellom lesing og skriving: 412, så konflikt med treff", async () => {
    await settNode({ b: rad("b", { name: "Brød", itemId: "v-brod" }) });
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/annen`).set(rad("annen", { amount: "1" }));
      },
    });
    try {
      expect(await leggTil(nyPlan("op-p7"))).toMatchObject({ utfall: "konflikt", treff: true });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200"]);
    expect(Object.keys((await lesNode())!).sort()).toEqual(["annen", "b"]);
  });

  it("tapt svar på skrivingen: ukjent; gjentak med samme opId gir allerede, én økning", async () => {
    await settNode({ m: rad("m") });
    const p = okPlan(rad("m"), "1", "op-p8");
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await ok(p)).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    expect((await lesNode())!.m!.amount).toBe("3");
    expect(await ok(p, true)).toEqual({ utfall: "allerede" });
    expect((await lesNode())!.m!.amount).toBe("3");
  });

  it("lesing som feiler: ikkeLest, ingenting skrevet", async () => {
    await settNode(MED_PRIORITET);
    const foer = await eksport();
    const spion = vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));
    try {
      expect(await leggTil(nyPlan("op-p9", { name: "Egg", itemId: "v-egg" }))).toEqual({
        utfall: "ikkeLest",
      });
    } finally {
      spion.mockRestore();
    }
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});
