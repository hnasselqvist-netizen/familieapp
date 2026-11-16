/**
 * «Fjern fullførte» i React-Handlelisten (Mat #20, ordre 6905636191) mot
 * emulatoren med syntetiske data. Klient A er appens klient-SDK med et
 * aktivt abonnement; klient B (admin-SDK) endrer listen etter at A så den.
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
import {
  lagFjernFullfortePlan,
  vurderFjernFullforte,
} from "@domain/shopping/handlelisteFjernFullforte";
import type { ShoppingItem } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import {
  fjernFullfortePoster,
  sjekkHandlelisteposter,
  subscribeShoppingList,
} from "./shopping.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const STI = `families/${FAMILY_ID}/shopping`;

let adminApp: AdminApp;
let admin: AdminDatabase;
let uid: string;

const rad = (id: string, name: string, done: boolean, prioritet: number | string) => ({
  id,
  itemId: `v-${id}`,
  name,
  amount: "2",
  cat: "Diverse",
  done,
  ".priority": prioritet,
});
const NODE = () => ({
  ".priority": 1,
  m: rad("m", "Melk", true, 5),
  f: rad("f", "Fløte", true, "p-f"),
  b: rad("b", "Brød", false, 7),
  _skriver: { av: "react", ".priority": 8 },
  _ops: { r1: { tool: "x", at: 1 } },
});

/** Det klient A ser: hele listen fra et aktivt abonnement (kald cache etterpå). */
const sett = () =>
  new Promise<ShoppingItem[]>((resolve) => {
    const av = subscribeShoppingList(FAMILY_ID, (rader) => {
      if (rader.length > 0) {
        av();
        resolve(rader);
      }
    });
  });
const eksport = async () => (await admin.ref(STI).get()).exportVal() as Record<string, unknown>;

/** Samme sammensetning som `useShoppingList.fjernFullforte`. */
const fjernFullforte = (liste: ShoppingItem[]) => {
  const plan = lagFjernFullfortePlan(liste);
  return fjernFullfortePoster(
    FAMILY_ID,
    Object.fromEntries(plan.rader.map((r) => [r.id, r.grunnlag])),
    (raw, raaLik) => vurderFjernFullforte(raw, plan, raaLik),
  );
};
const ider = (r: readonly { id: string }[] | undefined) => (r ?? []).map((x) => x.id).sort();

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
    "integration-test-admin-handleliste-fjern-fullforte",
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

describe("«Fjern fullførte»: én versjonsbetinget operasjon", () => {
  it("normal batch: uendrede fullførte rader fjernes samlet; aktive rader, prioriteter, markør og MCP-metadata består", async () => {
    const a = await sett();
    const foer = await eksport();
    const f = fangFetch();
    let u;
    try {
      u = await fjernFullforte(a);
    } finally {
      f.gjenopprett();
    }
    expect(u.utfall).toBe("anvendt");
    expect(ider(u.detaljer?.fjernet)).toEqual(["f", "m"]);
    expect(u.detaljer?.beholdt).toEqual([]);
    expect(u.detaljer?.borte).toEqual([]);
    expect(f.kall).toEqual(["GET 200", "PUT 200"]);
    const etter = await eksport();
    expect(etter.m).toBeUndefined();
    expect(etter.f).toBeUndefined();
    for (const k of [".priority", "b", "_skriver", "_ops"]) {
      expect(stabil(etter[k]), k).toBe(stabil(foer[k]));
    }
  });

  it("B endrer før A sin lesing: endret mengde og tilbakekrysset rad står, nytilkommen fullført rad røres ikke, resten fjernes", async () => {
    await admin.ref(`${STI}/g`).set(rad("g", "Gulrot", true, 3));
    const a = await sett();
    await admin.ref(`${STI}/m/amount`).set("3");
    await admin.ref(`${STI}/f/done`).set(false);
    await admin.ref(`${STI}/n`).set(rad("n", "Nøtter", true, 4));
    const u = await fjernFullforte(a);
    expect(u.utfall).toBe("anvendt");
    expect(ider(u.detaljer?.fjernet)).toEqual(["g"]);
    expect(u.detaljer?.beholdt).toEqual([
      { id: "m", navn: "Melk", grunn: "mengde 2 → 3" },
      { id: "f", navn: "Fløte", grunn: "status fullført → ikke fullført" },
    ]);
    const etter = await eksport();
    expect(etter.g).toBeUndefined();
    expect(etter.m).toMatchObject({ amount: "3", done: true, ".priority": 5 });
    expect(etter.f).toMatchObject({ done: false, ".priority": "p-f" });
    expect(etter.n).toMatchObject({ name: "Nøtter", done: true, ".priority": 4 });
  });

  it("B endrer mellom A sin lesing og skriving: 412, ny vurdering mot fersk tilstand, bare uendrede rader fjernes", async () => {
    const a = await sett();
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/m/amount`).set("4");
      },
    });
    let u;
    try {
      u = await fjernFullforte(a);
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200", "PUT 200"]);
    expect(u.utfall).toBe("anvendt");
    expect(ider(u.detaljer?.fjernet)).toEqual(["f"]);
    expect(ider(u.detaljer?.beholdt)).toEqual(["m"]);
    const etter = await eksport();
    expect(etter.m).toMatchObject({ amount: "4", ".priority": 5 });
    expect(etter.f).toBeUndefined();
  });

  it("historikk og prioritet: lik synlig rad med ny sammenslåingshistorikk eller ny prioritet står", async () => {
    const a = await sett();
    await admin
      .ref(`${STI}/m/sammenslaing`)
      .set({ opId: "op-b", tidspunkt: "t", kilder: { d: {} } });
    await new Promise<void>((ok, feil) =>
      admin.ref(`${STI}/f`).setPriority(9, (e) => (e ? feil(e) : ok())),
    );
    const foer = await eksport();
    const f = fangFetch();
    let u;
    try {
      u = await fjernFullforte(a);
    } finally {
      f.gjenopprett();
    }
    expect(u.utfall).toBe("allerede");
    expect(u.detaljer?.fjernet).toEqual([]);
    expect(ider(u.detaljer?.beholdt)).toEqual(["f", "m"]);
    expect(u.detaljer?.beholdt[0]!.grunn).toMatch(/endret på en annen enhet/);
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("allerede borte: telles for seg; er alle borte, skrives ingenting", async () => {
    const a = await sett();
    await admin.ref(`${STI}/m`).remove();
    const u = await fjernFullforte(a);
    expect(u.utfall).toBe("anvendt");
    expect(ider(u.detaljer?.fjernet)).toEqual(["f"]);
    expect(ider(u.detaljer?.borte)).toEqual(["m"]);

    const foer = await eksport();
    const f = fangFetch();
    let v;
    try {
      v = await fjernFullforte(a);
    } finally {
      f.gjenopprett();
    }
    expect(v.utfall).toBe("allerede");
    expect(ider(v.detaljer?.borte)).toEqual(["f", "m"]);
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("nektet (ikke medlem): `avvist`, ingenting fjernet", async () => {
    const a = await sett();
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    const foer = await eksport();
    expect((await fjernFullforte(a)).utfall).toBe("avvist");
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});

describe("«Fjern fullførte»: tapt svar og skrivefri oppfølging", () => {
  it("tapt svar etter delvis vurdering: ukjent; nektet etterlesing er fortsatt uavklart; senere etterlesing viser hva som er borte og hva som står — uten å skrive", async () => {
    const a = await sett();
    await admin.ref(`${STI}/m/amount`).set("3");
    const f = fangFetch({ tapSvar: true });
    try {
      expect((await fjernFullforte(a)).utfall).toBe("ukjent");
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 200"]);
    const plan = lagFjernFullfortePlan(a).rader.map((r) => r.id);

    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    expect(await sjekkHandlelisteposter(FAMILY_ID, plan)).toEqual({ utfall: "avvist" });
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);

    const foer = await eksport();
    const g = fangFetch();
    try {
      expect(await sjekkHandlelisteposter(FAMILY_ID, plan)).toEqual({
        utfall: "lest",
        borte: ["f"],
        finnes: ["m"],
      });
    } finally {
      g.gjenopprett();
    }
    expect(g.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
    expect(foer.m).toMatchObject({ amount: "3" });
  });

  it("tapt svar før serveren: ingenting fjernet, og etterlesingen sier at radene står", async () => {
    const a = await sett();
    const foer = await eksport();
    const ekte = globalThis.fetch;
    const spion = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if ((init?.method ?? "GET") === "PUT") throw new TypeError("Failed to fetch");
      return ekte(input, init);
    });
    let u;
    try {
      u = await fjernFullforte(a);
    } finally {
      spion.mockRestore();
    }
    expect(u.utfall).toBe("ukjent");
    expect(stabil(await eksport())).toBe(stabil(foer));
    expect(
      await sjekkHandlelisteposter(
        FAMILY_ID,
        lagFjernFullfortePlan(a).rader.map((r) => r.id),
      ),
    ).toEqual({ utfall: "lest", borte: [], finnes: ["m", "f"] });
  });
});
