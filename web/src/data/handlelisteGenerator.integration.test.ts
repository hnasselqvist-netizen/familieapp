/**
 * Handlelistegeneratoren fra Middagsplan, «Legg til N varer» (Mat #20,
 * ordre 6843084184), mot emulatoren med syntetiske data. Admin-SDK-en er
 * den andre klienten. Kontrolleres med `exportVal()`, så prioritet og
 * reserverte metadata telles med.
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
  type GeneratorPlan,
  anvendGeneratorPlan,
  lagGeneratorPlan,
} from "@domain/shopping/handlelisteGenerator";
import { KVITTERINGER } from "@domain/shopping/handlelisteInnlegging";
import type { ShoppingItem, ShoppingListEntry } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import { skrivHandlelisteVersjonert } from "./shopping.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const STI = `families/${FAMILY_ID}/shopping`;

let adminApp: AdminApp;
let admin: AdminDatabase;

const MELK = {
  id: "m",
  itemId: "v-melk",
  name: "Melk",
  amount: "2",
  cat: "Ost og meieri",
  done: false,
};
const BROD = {
  id: "b",
  itemId: "v-brod",
  name: "Brød",
  amount: "1 pk",
  cat: "Brød og bakst",
  done: false,
};
const NODE = () => ({
  ".priority": 1,
  m: { ...MELK, ".priority": 5 },
  b: { ...BROD, ".priority": "p-b" },
  _skriver: { av: "react", ".priority": 8 },
  _ops: { r1: { tool: "x", at: 1 }, ".priority": 9 },
});
const LISTE: ShoppingItem[] = [MELK, BROD];
const NYE: ShoppingListEntry[] = [
  { itemId: "v-melk", name: "Melk", amount: "3", cat: "Ost og meieri", done: false },
  { itemId: "v-egg", name: "Egg", amount: "6", cat: "Ost og meieri", done: false },
];

const eksport = async () => (await admin.ref(STI).get()).exportVal() as Record<string, unknown>;
const lesNode = async () =>
  (await admin.ref(STI).get()).val() as Record<string, Record<string, unknown>>;

let uid: string;

/** Samme sammensetning som `useShoppingList.leggTilFraGenerator`. */
const leggTil = (plan: GeneratorPlan, gjentak = false) =>
  skrivHandlelisteVersjonert(FAMILY_ID, KVITTERINGER, (raw) =>
    anvendGeneratorPlan(raw, plan, gjentak),
  );
/** Den bekreftede gjennomgangen: planen fra listen Helen så, med stabil opId. */
const plan = (opId = "op-gen-1", entries: ShoppingListEntry[] = NYE, liste = LISTE) =>
  lagGeneratorPlan(liste, entries, opId);
const egg = (n: Record<string, Record<string, unknown>>) =>
  Object.values(n).filter((r) => r?.name === "Egg");

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
    "integration-test-admin-handlelistegenerator",
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
  await admin.ref(STI).remove();
});

afterAll(async () => {
  await admin.ref(`families/${FAMILY_ID}`).remove();
  await deleteApp(adminApp);
});

describe("«Legg til N varer»: én logisk operasjon med stabil opId", () => {
  it("lagrer summert mengde og nye rader i én skriving, med kvittering", async () => {
    await admin.ref(STI).set(NODE());
    expect(await leggTil(plan())).toEqual({ utfall: "anvendt" });
    const n = await lesNode();
    expect(n.m!.amount).toBe("5");
    expect(n["op-gen-1-1"]).toMatchObject({
      name: "Egg",
      amount: "6",
      done: false,
      id: "op-gen-1-1",
    });
    expect(n[KVITTERINGER]!["op-gen-1"]).toEqual({
      generator: {
        avtrykk: expect.any(String),
        nye: { "op-gen-1-1": true },
        endret: { m: { fra: "2", til: "5" } },
      },
    });
  });

  it("dobbeltklikk (to samtidige innsendinger av samme opId) gir én virkning", async () => {
    await admin.ref(STI).set(NODE());
    const utfall = await Promise.all([leggTil(plan()), leggTil(plan())]);
    expect(utfall.map((u) => u.utfall).sort()).toEqual(["allerede", "anvendt"]);
    const n = await lesNode();
    expect(n.m!.amount).toBe("5");
    expect(egg(n)).toHaveLength(1);
  });

  it("to klienter med samme forhåndsvisning (ulike opId) samtidig: én lagres, den andre ber om ny gjennomgang", async () => {
    await admin.ref(STI).set(NODE());
    const utfall = await Promise.all([leggTil(plan("op-a")), leggTil(plan("op-b"))]);
    expect(utfall.map((u) => u.utfall).sort()).toEqual(["anvendt", "konflikt"]);
    expect(utfall.find((u) => u.utfall === "konflikt")).toMatchObject({
      grunn: expect.stringMatching(/Se gjennom varene på nytt/),
    });
    const n = await lesNode();
    expect(n.m!.amount).toBe("5");
    expect(egg(n)).toHaveLength(1);
  });

  it("tapt svar etter faktisk lagring: ukjent; «Prøv igjen» sjekker skrivefritt; «Send på nytt» gir allerede", async () => {
    await admin.ref(STI).set(NODE());
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await leggTil(plan())).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 200"]);
    const foer = await eksport();
    expect((foer.m as Record<string, unknown>).amount).toBe("5");

    const g = fangFetch();
    try {
      expect(await leggTil(plan(), true)).toEqual({ utfall: "allerede" });
      expect(await leggTil(plan())).toEqual({ utfall: "allerede" });
    } finally {
      g.gjenopprett();
    }
    expect(g.kall).toEqual(["GET 200", "GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it.each([
    ["bare økning", [NYE[0]!], (n: Record<string, Record<string, unknown>>) => n.m!.amount === "5"],
    [
      "bare nye rader",
      [NYE[1]!],
      (n: Record<string, Record<string, unknown>>) => egg(n).length === 1,
    ],
  ] as const)(
    "tapt svar etter PUT 200, %s: kvitteringen overlever RTDB, gjentak og ny innsending gir allerede uten PUT (review 5912682963 pkt. 1)",
    async (_navn, entries, lagret) => {
      await admin.ref(STI).set(NODE());
      const p = plan("op-gen-en", [...entries]);
      const f = fangFetch({ tapSvar: true });
      try {
        expect(await leggTil(p)).toEqual({ utfall: "ukjent" });
      } finally {
        f.gjenopprett();
      }
      expect(f.kall).toEqual(["GET 200", "PUT 200"]);
      expect(lagret(await lesNode())).toBe(true);
      const foer = await eksport();

      const g = fangFetch();
      try {
        expect(await leggTil(p, true)).toEqual({ utfall: "allerede" });
        expect(await leggTil(p)).toEqual({ utfall: "allerede" });
      } finally {
        g.gjenopprett();
      }
      expect(g.kall).toEqual(["GET 200", "GET 200"]);
      expect(stabil(await eksport())).toBe(stabil(foer));
    },
  );

  it("samme opId med en annen ny rad etter lagring: konflikt uten PUT, lagret tilstand urørt (review 5912984107 pkt. 2)", async () => {
    await admin.ref(STI).set(NODE());
    expect(await leggTil(plan("op-gen-likt", [NYE[1]!]))).toEqual({ utfall: "anvendt" });
    const foer = await eksport();
    const annen = plan("op-gen-likt", [
      { itemId: "v-gulrot", name: "Gulrot", amount: "6", cat: "Frukt og grønt", done: false },
    ]);
    const f = fangFetch();
    try {
      expect(await leggTil(annen)).toMatchObject({ utfall: "konflikt" });
      expect(await leggTil(annen, true)).toMatchObject({ utfall: "konflikt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("svaret tapt FØR serveren: «Prøv igjen» er ubekreftet og skriver ingenting", async () => {
    await admin.ref(STI).set(NODE());
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await leggTil(plan(), true)).toMatchObject({ utfall: "ubekreftet" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("nektet oppfølging (ikke medlem): avvist, ingenting skrevet; senere «Prøv igjen» bekrefter", async () => {
    await admin.ref(STI).set(NODE());
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await leggTil(plan())).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    const foer = await eksport();
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    expect(await leggTil(plan(), true)).toEqual({ utfall: "avvist" });
    expect(await leggTil(plan())).toEqual({ utfall: "avvist" });
    expect(stabil(await eksport())).toBe(stabil(foer));
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
    expect(await leggTil(plan(), true)).toEqual({ utfall: "allerede" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("kandidaten endres hos en annen klient mellom lesing og commit: 412, ny runde, konflikt uten skriving", async () => {
    await admin.ref(STI).set(NODE());
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/m/amount`).set("4");
      },
    });
    try {
      expect(await leggTil(plan())).toMatchObject({ utfall: "konflikt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200"]);
    const n = await lesNode();
    expect(n.m!.amount).toBe("4");
    expect(egg(n)).toHaveLength(0);
    expect(n[KVITTERINGER]).toBeUndefined();
  });

  it("urørt post endres hos en annen klient mellom lesing og commit: 412, ny runde, begge bevart", async () => {
    await admin.ref(STI).set(NODE());
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) {
          await admin.ref(`${STI}/b/amount`).set("3 pk");
          await admin.ref(`${STI}/b`).setPriority("ny-p", () => undefined);
        }
      },
    });
    try {
      expect(await leggTil(plan())).toEqual({ utfall: "anvendt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200", "PUT 200"]);
    const etter = await eksport();
    expect(etter.b).toMatchObject({ amount: "3 pk", ".priority": "ny-p" });
    expect((etter.m as Record<string, unknown>).amount).toBe("5");
  });

  it("forhåndsvisningen avviker fra fersk liste (ny kandidat lagt til): konflikt, ingenting skrevet", async () => {
    await admin.ref(STI).set({ ...NODE(), e: { name: "Egg", amount: "2", done: false, id: "e" } });
    const foer = await eksport();
    expect(await leggTil(plan())).toMatchObject({
      utfall: "konflikt",
      grunn: expect.stringMatching(/Se gjennom varene på nytt/),
    });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("prioritet, markør, MCP-metadata og urørte poster bevares (exportVal)", async () => {
    await admin.ref(STI).set(NODE());
    const foer = await eksport();
    expect(await leggTil(plan())).toEqual({ utfall: "anvendt" });
    const etter = await eksport();
    for (const k of [".priority", "b", "_skriver", "_ops"]) {
      expect(stabil(etter[k]), k).toBe(stabil(foer[k]));
    }
    expect(etter.m).toEqual({ ...(foer.m as object), amount: "5" });
  });

  it("uendret kandidat (mengdene kan ikke summeres) skrives ikke: prioritet dypt i raden bevares", async () => {
    await admin.ref(STI).set({ ...NODE(), b: { ...BROD, detalj: { x: 1, ".priority": 2 } } });
    const foer = await eksport();
    const p = plan("op-gen-2", [
      { itemId: "v-brod", name: "Brød", amount: "", cat: "Brød og bakst", done: false },
    ]);
    expect(await leggTil(p)).toEqual({ utfall: "allerede" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("eksisterende sammenslåingshistorikk og eldre kvitteringer bevares", async () => {
    const historikk = {
      opId: "op-gml",
      at: "2026-11-01T10:00:00.000Z",
      kilder: { z: { name: "Melk" } },
    };
    await admin.ref(STI).set({
      ...NODE(),
      m: { ...MELK, sammenslaing: historikk, ".priority": 5 },
      [KVITTERINGER]: { "op-eldre": { lagt: { q: { name: "Q" } } }, ".priority": 3 },
    });
    const foer = await eksport();
    const liste = [{ ...MELK, sammenslaing: undefined }, BROD] as ShoppingItem[];
    expect(await leggTil(plan("op-gen-3", NYE, liste))).toEqual({ utfall: "anvendt" });
    const etter = await eksport();
    expect(etter.m).toEqual({ ...(foer.m as object), amount: "5" });
    const kv = etter[KVITTERINGER] as Record<string, unknown>;
    expect(kv["op-eldre"]).toEqual((foer[KVITTERINGER] as Record<string, unknown>)["op-eldre"]);
    expect(kv["op-gen-3"]).toBeDefined();
  });
});
