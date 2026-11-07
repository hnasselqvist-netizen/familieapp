/**
 * «Fjern varen» med grunnlagsvern (#20, ordre 6700834307) — EKTE
 * Firebase-emulator, syntetiske poster, ingen mock av transaksjonen.
 *
 * Klient A er appens SDK og bruker nøyaktig samme sammensetning som
 * `useFreezer.removeItem`: posten fra abonnementet (det brukeren så) →
 * `transactFreezerNode` + `fjernHvisUendret`. Deterministisk konkurranse:
 * A kobles fra med sitt gamle bilde, «den andre klienten» (Admin SDK)
 * endrer, og A sin sletting går først når A kobles til igjen.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { goOffline, goOnline } from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FreezerItem, FreezerSamling } from "@app-types/freezer";
import { type SletteAvvisning, fjernHvisUendret } from "@domain/freezer/freezer";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import { subscribeFreezer, transactFreezerNode } from "./freezer.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const STI = `families/${FAMILY_ID}/freezer`;

let adminApp: AdminApp;
let uid: string;
const b = () => getAdminDatabase(adminApp);

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "freezer-fjern-admin",
  );
  uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await b().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  await signInWithCustomToken(
    getFirebaseAuth(),
    await getAdminAuth(adminApp).createCustomToken(uid),
  );
});
afterAll(async () => {
  await b().ref(STI).remove();
  await deleteApp(adminApp);
});
beforeEach(async () => {
  goOnline(getFirebaseDatabase());
  await b().ref(STI).remove();
});

/** Samme sammensetning som `useFreezer.removeItem`. */
const fjern = (observert: FreezerItem) =>
  transactFreezerNode<SletteAvvisning>(FAMILY_ID, observert.id, (current) =>
    fjernHvisUendret(current, observert),
  );

/** Seeder og returnerer A sitt bilde (fra abonnementet) av hver post. */
async function start(data: FreezerSamling): Promise<Record<string, FreezerItem>> {
  await b().ref(STI).set(data);
  const n = Object.keys(data).length;
  const items = await new Promise<FreezerItem[]>((resolve) => {
    const av = subscribeFreezer(FAMILY_ID, (i) => {
      if (i.length === n) {
        av();
        resolve(i);
      }
    });
  });
  return Object.fromEntries(items.map((i) => [i.id, i]));
}
const lesAlt = async () => (await b().ref(STI).get()).val() as FreezerSamling | null;

const react = {
  itemId: "v-laks",
  name: "Laks",
  batches: [{ id: "l1", count: 2, unit: "pk", gramsPerUnit: 400 }],
  sted: "fryser",
};
const legacy = {
  id: "leg-1",
  itemId: "v-erter",
  name: "Erter",
  batches: [{ id: "e1", count: 1, unit: "pose" }],
};
const annen = {
  itemId: "v-brod",
  name: "Brød",
  batches: [{ id: "x", count: 3, unit: "stk" }],
  ukjent: { a: 1 },
};

describe("Fjern varen: grunnlagsvern (emulator)", () => {
  it("uendret React-post uten id-felt og legacy-post med id-felt slettes; andre poster urørt", async () => {
    const sett = await start({ r: react, "leg-1": legacy, annen } as unknown as FreezerSamling);
    expect(await fjern(sett.r!)).toEqual({ type: "lagret" });
    expect(await fjern(sett["leg-1"]!)).toEqual({ type: "lagret" });
    expect(await lesAlt()).toEqual({ annen });
  });

  for (const [hva, sti, verdi] of [
    ["samtidig tillegg av batch", "r/batches/1", { id: "l2", count: 1, unit: "boks" }],
    ["samtidig antallsendring", "r/batches/0/count", 5],
    ["endret ukjent felt", "r/sted", "kjoleskap"],
  ] as const) {
    it(`${hva} etter at brukeren så posten → konflikt, ingen verdiendring`, async () => {
      const sett = await start({ r: react, annen } as unknown as FreezerSamling);
      goOffline(getFirebaseDatabase());
      const a = fjern(sett.r!);
      await b().ref(`${STI}/${sti}`).set(verdi);
      const etterEndring = await lesAlt();
      goOnline(getFirebaseDatabase());
      expect(await a).toEqual({ type: "konflikt", avvisning: { type: "endret", navn: "Laks" } });
      expect(await lesAlt()).toEqual(etterEndring);
    });
  }

  it("posten er allerede fjernet → konflikt, ingen gjenoppretting", async () => {
    const sett = await start({ r: react, annen } as unknown as FreezerSamling);
    goOffline(getFirebaseDatabase());
    const a = fjern(sett.r!);
    await b().ref(`${STI}/r`).remove();
    goOnline(getFirebaseDatabase());
    expect(await a).toEqual({ type: "konflikt", avvisning: { type: "mangler", navn: "Laks" } });
    expect(await lesAlt()).toEqual({ annen });
  });

  it("databasen avviser (ikke medlem) → `avvist`, ingenting fjernet", async () => {
    const sett = await start({ r: react } as unknown as FreezerSamling);
    await b().ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    try {
      expect(await fjern(sett.r!)).toEqual({ type: "avvist" });
      expect(await lesAlt()).toEqual({ r: react });
    } finally {
      await b().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
    }
  });
});
