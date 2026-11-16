/**
 * Navn og kategori i React-Handlelisten (Mat #20, ordre 6921967679) mot
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
  type Felt,
  lagFeltPlan,
  lesFelt,
  synligFelt,
  vurderFelt,
} from "@domain/shopping/handlelisteFelt";
import type { ShoppingItem } from "@app-types/shopping";
import { getFirebaseAuth } from "./firebase";
import {
  lesHandlelistestatus,
  settHandlelistefelt,
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

/** Samme sammensetning som `useShoppingList.settFelt`: endring fra raden A så. */
const lagre = (rad: ShoppingItem, felt: Felt, ny: string, foer = synligFelt(rad, felt)) => {
  const plan = lagFeltPlan(rad, felt, foer, ny);
  return settHandlelistefelt(
    FAMILY_ID,
    plan.id,
    plan.felt,
    plan.ny,
    (raw) => vurderFelt(raw, plan),
    `«${plan.navn}» er ikke lenger på listen. Ingenting er lagret.`,
  );
};
/** Samme sammensetning som `useShoppingList.sjekkFelt`. */
const kontroll = (rad: ShoppingItem, felt: Felt, ny: string, foer = synligFelt(rad, felt)) =>
  lesHandlelistestatus(FAMILY_ID, (raw) => lesFelt(raw, lagFeltPlan(rad, felt, foer, ny)));
/** Eksporten med ett felt på `id` satt — alt annet likt. */
const med = (e: Record<string, unknown>, id: string, felt: string, verdi: string) => ({
  ...e,
  [id]: { ...(e[id] as Record<string, unknown>), [felt]: verdi },
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
    "integration-test-admin-handleliste-felt",
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

describe("samtidig endring i samme felt", () => {
  it("navn: B endrer navnet etter at A så raden; A sitt utkast fra gammelt grunnlag gir konflikt, bare GET", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m/name`).set("Lettmelk");
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await lagre(a, "name", "Helmelk")).toEqual({
        utfall: "konflikt",
        grunn:
          "Navnet på «Melk» er endret på en annen enhet («Melk» → «Lettmelk») mens du redigerte. Ingenting er lagret.",
      });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("kategori: B endrer kategorien; A sitt valg fra gammelt grunnlag gir konflikt, bare GET", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m/cat`).set("Drikke");
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await lagre(a, "cat", "Diverse")).toMatchObject({
        utfall: "konflikt",
        grunn: expect.stringMatching(/Kategorien på «Melk» er endret.*«Ost og meieri» → «Drikke»/),
      });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("navn: B endrer navnet mellom A sin lesing og skriving: 412, ny vurdering, konflikt", async () => {
    const a = await sett("m");
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/m/name`).set("Lettmelk");
      },
    });
    try {
      expect(await lagre(a, "name", "Helmelk")).toMatchObject({ utfall: "konflikt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200"]);
    expect((await eksport()).m).toMatchObject({ name: "Lettmelk" });
  });
});

describe("samtidig endring i to ulike felt", () => {
  it("A lagrer navn mens B endrer kategori (før lesing) og mengde (mellom lesing og skriving): alt består; bare navnet endres av A", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m/cat`).set("Drikke");
    const f = fangFetch({
      forPut: async (n) => {
        if (n === 1) await admin.ref(`${STI}/m/amount`).set("9");
      },
    });
    try {
      expect(await lagre(a, "name", "Helmelk")).toEqual({ utfall: "anvendt" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200", "PUT 412", "GET 200", "PUT 200"]);
    expect((await eksport()).m).toMatchObject({
      name: "Helmelk",
      cat: "Drikke",
      amount: "9",
      itemId: "v-melk",
      ukjentFelt: { x: 1 },
      sammenslaing: { opId: "op-1" },
      ".priority": 5,
    });
  });

  it("uendret grunnlag: bare feltet endres; råfelt, prioritet, historikk, andre rader og metadata er byte for byte like", async () => {
    const foer = await eksport();
    expect(await lagre(await sett("m"), "cat", "Drikke")).toEqual({ utfall: "anvendt" });
    expect(stabil(await eksport())).toBe(stabil(med(foer, "m", "cat", "Drikke")));
  });

  it("rad med varekobling: B gir varen nytt navn, A velger kategori — samme vare, begge består", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m/name`).set("Lettmelk");
    expect(await lagre(a, "cat", "Drikke")).toEqual({ utfall: "anvendt" });
    expect((await eksport()).m).toMatchObject({ name: "Lettmelk", cat: "Drikke" });
  });

  it("rad uten varekobling: endret navn kan være en annen vare — A sitt kategorivalg gir konflikt", async () => {
    await admin.ref(`${STI}/m/itemId`).set(null);
    const a = await sett("m");
    await admin.ref(`${STI}/m/name`).set("Egg");
    const foer = await eksport();
    expect(await lagre(a, "cat", "Drikke")).toMatchObject({
      utfall: "konflikt",
      grunn: expect.stringMatching(/«Melk» er endret på en annen enhet \(nå «Egg»\)/),
    });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});

describe("erstattet eller fjernet rad", () => {
  for (const felt of ["name", "cat"] as const) {
    it(`erstattet vare under samme nøkkel (${felt}): konflikt, ingenting skrevet`, async () => {
      const a = await sett("m");
      await admin.ref(`${STI}/m`).update({ name: "Egg", itemId: "v-egg" });
      const foer = await eksport();
      expect(await lagre(a, felt, felt === "name" ? "Helmelk" : "Drikke")).toMatchObject({
        utfall: "konflikt",
        grunn: expect.stringMatching(/varekoblingen er byttet/),
      });
      expect(stabil(await eksport())).toBe(stabil(foer));
    });
  }

  it("fjernet rad: gjenoppstår aldri, entydig melding, bare GET", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m`).remove();
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await lagre(a, "name", "Helmelk")).toEqual({
        utfall: "konflikt",
        grunn: "«Melk» er ikke lenger på listen. Ingenting er lagret.",
      });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(foer));
  });

  it("nektet (ikke medlem): `avvist`, ingenting endret", async () => {
    const a = await sett("m");
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    const foer = await eksport();
    expect(await lagre(a, "cat", "Drikke")).toEqual({ utfall: "avvist" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});

describe("eldre og tomme verdier", () => {
  it("manglende kategori vises som «Diverse»; nytt valg setter bare `cat`; «Diverse» er skrivefri no-op", async () => {
    await admin.ref(`${STI}/m/cat`).remove();
    const a = await sett("m");
    expect(synligFelt(a, "cat")).toBe("Diverse");
    const foer = await eksport();
    const f = fangFetch();
    try {
      expect(await lagre(a, "cat", "Diverse")).toEqual({ utfall: "allerede" });
    } finally {
      f.gjenopprett();
    }
    expect(f.kall).toEqual(["GET 200"]);
    expect(await lagre(a, "cat", "Drikke")).toEqual({ utfall: "anvendt" });
    expect(stabil(await eksport())).toBe(stabil(med(foer, "m", "cat", "Drikke")));
  });

  it("uleselig kategori (objekt): konflikt, overskrives ikke", async () => {
    const a = await sett("m");
    await admin.ref(`${STI}/m/cat`).set({ x: 1 });
    const foer = await eksport();
    expect(await lagre(a, "cat", "Drikke")).toMatchObject({ utfall: "konflikt" });
    expect(await kontroll(a, "cat", "Drikke")).toEqual({ utfall: "misformet" });
    expect(stabil(await eksport())).toBe(stabil(foer));
  });
});

describe("tapt svar og skrivefri kontroll", () => {
  it("tapt svar etter PUT 200: ukjent; nektet kontroll er uavklart; senere kontroll leser feltet uten å skrive", async () => {
    const a = await sett("m");
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await lagre(a, "name", "Helmelk")).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    const lagret = await eksport();
    expect(lagret.m).toMatchObject({ name: "Helmelk" });

    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    expect(await kontroll(a, "name", "Helmelk")).toEqual({ utfall: "avvist" });
    await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);

    const g = fangFetch();
    try {
      expect(await kontroll(a, "name", "Helmelk")).toEqual({ utfall: "lest", verdi: "Helmelk" });
    } finally {
      g.gjenopprett();
    }
    expect(g.kall).toEqual(["GET 200"]);
    expect(stabil(await eksport())).toBe(stabil(lagret));
  });

  it("tapt svar → raden erstattet under samme nøkkel: kontrollen gir `erstattet`, bare GET", async () => {
    const a = await sett("m");
    const f = fangFetch({ tapSvar: true });
    try {
      expect(await lagre(a, "cat", "Drikke")).toEqual({ utfall: "ukjent" });
    } finally {
      f.gjenopprett();
    }
    await admin.ref(`${STI}/m`).update({ name: "Egg", itemId: "v-egg" });
    const foer = await eksport();
    const g = fangFetch();
    try {
      expect(await kontroll(a, "cat", "Drikke")).toEqual({
        utfall: "erstattet",
        grunn: "«Melk» er endret på en annen enhet (varekoblingen er byttet).",
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
      expect(await lagre(a, "name", "Helmelk")).toEqual({ utfall: "ukjent" });
    } finally {
      spion.mockRestore();
    }
    expect(stabil(await eksport())).toBe(stabil(foer));
    expect(await kontroll(a, "name", "Helmelk")).toEqual({ utfall: "lest", verdi: "Melk" });
  });
});
