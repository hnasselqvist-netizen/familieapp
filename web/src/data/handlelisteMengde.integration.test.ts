/**
 * Manuell mengde i React-Handlelisten (Mat #20, ordre 6914072575) mot
 * emulatoren med syntetiske data. Klient A er appens klient-SDK; klient B
 * (admin-SDK) handler samtidig. Kontrolleres med `exportVal()`, så
 * prioritet, historikk og reserverte metadata telles.
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
  lagMengdePlan,
  lesMengde,
  synligMengde,
  vurderMengde,
} from "@domain/shopping/handlelisteMengde";
import type { ShoppingItem } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import {
  lesHandlelistestatus,
  settHandlelistemengde,
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

/** Samme sammensetning som `useShoppingList.settMengde`: utkast fra raden A så. */
const lagre = (rad: ShoppingItem, ny: string, foer = synligMengde(rad)) => {
  const plan = lagMengdePlan(rad, foer, ny);
  return settHandlelistemengde(
    FAMILY_ID,
    plan.id,
    plan.ny,
    (raw) => vurderMengde(raw, plan),
    `«${plan.navn}» er ikke lenger på listen. Mengden er ikke lagret.`,
  );
};
/** Samme sammensetning som `useShoppingList.sjekkMengde`. */
const kontroll = (rad: ShoppingItem, ny: string, foer = synligMengde(rad)) =>
  lesHandlelistestatus(FAMILY_ID, (raw) => lesMengde(raw, lagMengdePlan(rad, foer, ny)));
/** Eksporten med `amount` på `id` satt — alt annet likt. */
const medMengde = (e: Record<string, unknown>, id: string, amount: string) => ({
  ...e,
  [id]: { ...(e[id] as Record<string, unknown>), amount },
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
    "integration-test-admin-handleliste-mengde",
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

describe("samme felt", () => {
  it("A åpner mengden (2), B øker til 3, A lagrer utkast fra gammelt grunnlag: konflikt, B sin mengde står, bare GET", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m/amount`).set("3");
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await lagre(a, "25")).toEqual({
        utfall: "konflikt",
        grunn:
          "Mengden på «Melk» er endret på en annen enhet («2» → «3») mens du redigerte. Mengden er ikke lagret — utkastet ditt står.",
      });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("B endrer mengden mellom A sin lesing og skriving: 412, ny vurdering, konflikt uten overskriving", async () => {
    const a = await sett("m");
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/m/amount`).set("7");
      },
    });
    try {
      expect(await lagre(a, "25")).toMatchObject({ utfall: "konflikt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200"]);
    expect((await eksport()).m).toMatchObject({ amount: "7" });
  });
});

describe("urelaterte felt og råfelt", () => {
  it("uendret grunnlag: bare `amount` endres; råfelt, prioritet, historikk, andre rader og metadata består", async () => {
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await lagre(await sett("m"), "25")).toEqual({ utfall: "anvendt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 200"]);
    expect(stabil(await eksport())).toBe(stabil(medMengde(foer, "m", "25")));
  });

  it("B endrer kategori og status før lesing, og en annen rad mellom lesing og skriving: alle B sine endringer består", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m`).update({ cat: "Diverse", done: true });
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/b/amount`).set("9");
      },
    });
    try {
      expect(await lagre(a, "25")).toEqual({ utfall: "anvendt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200", "PUT 200"]);
    const etter = await eksport();
    expect(etter.m).toMatchObject({ amount: "25", cat: "Diverse", done: true, ".priority": 5 });
    expect(etter.b).toMatchObject({ amount: "9", ".priority": "p-b" });
  });
});

describe("radidentitet", () => {
  it("fjernet rad: gjenoppstår aldri, entydig melding, bare GET", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m`).remove();
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await lagre(a, "25")).toEqual({
        utfall: "konflikt",
        grunn: "«Melk» er ikke lenger på listen. Mengden er ikke lagret.",
      });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("erstattet rad under samme nøkkel (med samme mengde): konflikt, ingenting skrevet", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m`).update({ name: "Egg", itemId: "v-egg" });
    const foer = await eksport();
    expect(await lagre(a, "25")).toMatchObject({
      utfall: "konflikt",
      grunn: expect.stringMatching(/«Melk» er endret på en annen enhet \(nå «Egg»\)/),
    });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("nektet (ikke medlem): `avvist`, ingenting endret", async () => {
    const a = await sett("m");
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    const foer = await eksport();
    expect(await lagre(a, "25")).toEqual({ utfall: "avvist" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});

describe("overlappende forsøk", () => {
  it("to samtidige utkast fra samme grunnlag: ett lagres, det andre gir konflikt — aldri stille overskriving", async () => {
    const a = await sett("m");
    const u = await Promise.all([lagre(a, "3"), lagre(a, "4")]);
    expect(u.map((x) => x.utfall).sort()).toEqual(["anvendt", "konflikt"]);
    const vinner = u[0]!.utfall === "anvendt" ? "3" : "4";
    expect((await eksport()).m).toMatchObject({ amount: vinner });
  });

  it("eldre, forsinket forsøk etter en nyere lagring: konflikt, den nyere mengden står", async () => {
    const a = await sett("m");
    expect(await lagre(a, "4")).toEqual({ utfall: "anvendt" });
    expect(await lagre(a, "4 l", "2")).toMatchObject({ utfall: "konflikt" });
    expect((await eksport()).m).toMatchObject({ amount: "4" });
  });
});

describe("manglende og tom mengde", () => {
  it("eldre rad uten mengde vises som tom; lagring bygger på tom førverdi og setter bare `amount`", async () => {
    await admin.ref(`${STI}/m/amount`).remove();
    const a = await sett("m");
    expect(synligMengde(a)).toBe("");
    const foer = await eksport();
    expect(await lagre(a, "1")).toEqual({ utfall: "anvendt" });
    expect(stabil(await eksport())).toBe(stabil(medMengde(foer, "m", "1")));
  });

  it("tom mengde er gyldig å lagre; manglende og tom regnes som samme verdi (skrivefri no-op)", async () => {
    expect(await lagre(await sett("m"), "")).toEqual({ utfall: "anvendt" });
    expect((await eksport()).m).toMatchObject({ amount: "" });
    await admin.ref(`${STI}/m/amount`).remove();
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await lagre(await sett("m"), "", "")).toEqual({ utfall: "allerede" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("uleselig mengde (objekt): konflikt, overskrives ikke", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m/amount`).set({ x: 1 });
    const foer = await eksport();
    expect(await lagre(a, "25")).toMatchObject({ utfall: "konflikt" });
    expect(await kontroll(a, "25")).toEqual({ utfall: "misformet" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});

describe("tapt svar og skrivefri kontroll", () => {
  it("tapt svar etter PUT 200: ukjent; nektet kontroll er uavklart; senere kontroll leser mengden uten å skrive eller sende utkastet på nytt", async () => {
    const a = await sett("m");
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await lagre(a, "25")).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    const lagret = await eksport();
    expect(lagret.m).toMatchObject({ amount: "25" });

    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    expect(await kontroll(a, "25")).toEqual({ utfall: "avvist" });
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);

    const g = fangFetch();
    try {
      expect(await kontroll(a, "25")).toEqual({ utfall: "lest", mengde: "25" });
    } finally {
      g.gjenopprett();
    }
    expect(g.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(lagret));
  });

  it("tapt svar → raden erstattet under samme nøkkel med samme mengde: kontrollen gir `erstattet`, bare GET", async () => {
    const a = await sett("m");
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await lagre(a, "25")).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    await admin.ref(`${STI}/m`).update({ name: "Egg", itemId: "v-egg" });
    const foer = await eksport();
    const g = fangFetch();
    try {
      expect(await kontroll(a, "25")).toEqual({
        utfall: "erstattet",
        grunn: "«Melk» er endret på en annen enhet (nå «Egg»).",
      });
    } finally {
      g.gjenopprett();
    }
    expect(g.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("tapt svar før serveren: ingenting lagret; kontrollen viser førverdien", async () => {
    const a = await sett("m");
    const foer = await eksport();
    const ekte = globalThis.fetch;
    const spion = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if ((init?.method ?? "GET") === "PUT") throw new TypeError("Failed to fetch");
      return ekte(input, init);
    });
    try {
      expect(await lagre(a, "25")).toEqual({ utfall: "ukjent" });
    } finally {
      spion.mockRestore();
    }
    expect(stabil(await eksport())).toBe(stabil(foer));
    expect(await kontroll(a, "25")).toEqual({ utfall: "lest", mengde: "2" });
  });
});
