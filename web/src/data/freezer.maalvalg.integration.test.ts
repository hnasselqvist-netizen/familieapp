/**
 * «Legg til» med målpost valgt ved commit (#20, ordre 6698904630) — EKTE
 * Firebase-emulator, syntetiske poster, ingen mock av transaksjonen.
 *
 * Klient A er appens SDK og bruker nøyaktig samme sammensetning som
 * `useFreezer.addBatch`: lokal liste → `observertMaal`, og
 * `transactFreezerSamling` + `leggTilVedCommit`. Deterministisk
 * konkurranse: A kobles fra (`goOffline`) med sitt gamle bilde, «den andre
 * klienten» (Admin SDK — en annen enhet eller legacy) skriver, og A sin
 * transaksjon går først når A kobles til igjen.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { goOffline, goOnline } from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FreezerBatch, FreezerItem, FreezerSamling } from "@app-types/freezer";
import {
  type MaalvalgAvvisning,
  type ResolvedVare,
  leggTilVedCommit,
  observertMaal,
} from "@domain/freezer/freezer";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import { subscribeFreezer, transactFreezerSamling } from "./freezer.repository";

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
    "freezer-maalvalg-admin",
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

const batch = (
  id: string,
  count = 1,
  unit = "stk",
  gramsPerUnit: number | null = null,
): FreezerBatch => ({
  id,
  count,
  unit,
  gramsPerUnit,
});

/** Samme sammensetning som `useFreezer.addBatch`. */
function leggTil(lokal: FreezerItem[], vare: ResolvedVare, nyBatch: FreezerBatch) {
  const observertId = observertMaal(lokal, vare.name);
  const nyNodeId = randomUUID();
  return transactFreezerSamling<MaalvalgAvvisning>(FAMILY_ID, (samling) => {
    const r = leggTilVedCommit(samling, vare, nyBatch, observertId, nyNodeId);
    return "avvisning" in r ? { avvisning: r.avvisning } : { samling: r.samling };
  });
}

/** Seeder og venter til A sitt abonnement har sett startbildet (A sin lokale liste). */
async function start(data: FreezerSamling | null): Promise<FreezerItem[]> {
  await b().ref(STI).set(data);
  const forventet = Object.keys(data ?? {}).length;
  return new Promise((resolve) => {
    const av = subscribeFreezer(FAMILY_ID, (items) => {
      if (items.length === forventet) {
        av();
        resolve(items);
      }
    });
  });
}

/** Den andre klienten legger til med samme regel, som en egen transaksjon. */
async function annenKlientLeggTil(vare: ResolvedVare, nyBatch: FreezerBatch, nyNodeId: string) {
  await b()
    .ref(STI)
    .transaction((cur: FreezerSamling | null) => {
      const r = leggTilVedCommit(cur, vare, nyBatch, null, nyNodeId);
      return "avvisning" in r ? undefined : r.samling;
    });
}

const lesAlt = async () => (await b().ref(STI).get()).val() as FreezerSamling | null;
const annen = {
  itemId: "v-erter",
  name: "Erter",
  batches: [{ id: "e1", count: 2, unit: "pose" } as FreezerBatch], // som lagret: uten null-felt
  sted: "fryser",
  ukjent: { nested: true },
};

describe("Legg til: målpost velges ved commit (emulator)", () => {
  it("to samtidige nye med samme navn → én post med begge tilleggene; andre poster og ukjente felt bevares", async () => {
    const lokal = await start({ erter: annen });
    goOffline(getFirebaseDatabase());
    const a = leggTil(lokal, { id: "v-laks-a", name: "Laks" }, batch("a1", 2));
    await annenKlientLeggTil({ id: "v-laks-b", name: "laks" }, batch("b1", 3), "node-b");
    goOnline(getFirebaseDatabase());
    expect(await a).toEqual({ type: "lagret" });

    const f = await lesAlt();
    expect(Object.keys(f ?? {}).sort()).toEqual(["erter", "node-b"]);
    // Begge tilleggene i én post. «stk» uten vekt slås ikke sammen: lagret
    // batch mangler `gramsPerUnit` (null lagres ikke i RTDB), ny har `null` —
    // dagens regel, uendret her (se dokumentet, avsnitt 5).
    expect(f?.["node-b"]).toEqual({
      itemId: "v-laks-b",
      name: "laks",
      batches: [
        { id: "b1", count: 3, unit: "stk" },
        { id: "a1", count: 2, unit: "stk" },
      ],
    });
    expect(f?.erter).toEqual(annen);
  });

  it("foreldet liste uten treff finner eksisterende legacy-post (id-felt, annen itemId) → én node, kobling og felt bevart", async () => {
    const lokal = await start({ erter: annen });
    goOffline(getFirebaseDatabase());
    const a = leggTil(lokal, { id: "v-ny-id", name: "Kjøttdeig" }, batch("a1", 1, "pk", 400));
    await b()
      .ref(`${STI}/leg-1`)
      .set({
        id: "leg-1",
        itemId: "v-legacy-id",
        name: "Kjøttdeig",
        batches: [batch("l1", 2, "pk", 400)],
        sted: "fryser",
      });
    await b().ref(`${STI}/erter/batches/0/count`).set(9); // samtidig endring av en annen post
    goOnline(getFirebaseDatabase());
    expect(await a).toEqual({ type: "lagret" });

    const f = await lesAlt();
    expect(Object.keys(f ?? {}).sort()).toEqual(["erter", "leg-1"]);
    expect(f?.["leg-1"]).toEqual({
      id: "leg-1",
      itemId: "v-legacy-id",
      name: "Kjøttdeig",
      batches: [batch("l1", 3, "pk", 400)],
      sted: "fryser",
    });
    expect(f?.erter?.batches[0]?.count).toBe(9);
  });

  it("flere eksisterende treff → synlig avvisning, ingen verdiendring", async () => {
    const start1 = {
      d1: { itemId: "v1", name: "Brød", batches: [batch("x", 1)] },
      d2: { itemId: "v2", name: "BRØD", batches: [batch("y", 1)] },
      erter: annen,
    };
    const lokal = await start(start1);
    const før = await lesAlt();
    expect(await leggTil(lokal, { id: "v1", name: "brød" }, batch("n", 1))).toEqual({
      type: "konflikt",
      avvisning: { type: "flere-treff", navn: "brød", antall: 2 },
    });
    expect(await lesAlt()).toEqual(før);
  });

  it("observert mål slettet → konflikt; ingen gjenoppliving og ingen tillegg på en annen navnelik post", async () => {
    const lokal = await start({
      obs: { itemId: "v", name: "Laks", batches: [batch("o", 1)] },
      erter: annen,
    });
    goOffline(getFirebaseDatabase());
    const a = leggTil(lokal, { id: "v", name: "Laks" }, batch("n", 1));
    await b().ref(`${STI}/obs`).remove();
    await b()
      .ref(`${STI}/ny-laks`)
      .set({ itemId: "v2", name: "Laks", batches: [batch("z", 4)] });
    goOnline(getFirebaseDatabase());
    expect(await a).toEqual({
      type: "konflikt",
      avvisning: { type: "observert-slettet", navn: "Laks" },
    });
    const f = await lesAlt();
    expect(Object.keys(f ?? {}).sort()).toEqual(["erter", "ny-laks"]);
    expect(f?.["ny-laks"]?.batches[0]?.count).toBe(4);
  });

  it("observert mål omdøpt → konflikt; tillegget havner ikke under feil vare", async () => {
    const lokal = await start({ obs: { itemId: "v", name: "Laks", batches: [batch("o", 1)] } });
    goOffline(getFirebaseDatabase());
    const a = leggTil(lokal, { id: "v", name: "Laks" }, batch("n", 1));
    await b().ref(`${STI}/obs/name`).set("Ørret");
    goOnline(getFirebaseDatabase());
    expect(await a).toEqual({
      type: "konflikt",
      avvisning: { type: "observert-omdopt", navn: "Laks", nyttNavn: "Ørret" },
    });
    expect((await lesAlt())?.obs).toEqual({
      itemId: "v",
      name: "Ørret",
      batches: [{ id: "o", count: 1, unit: "stk" }],
    });
  });

  it("databasen avviser (ikke medlem) → `avvist`, ingenting lagret", async () => {
    const lokal = await start({ erter: annen });
    await b().ref(`families/${FAMILY_ID}/members/${uid}`).remove();
    try {
      expect(await leggTil(lokal, { id: "v", name: "Ny" }, batch("n", 1))).toEqual({
        type: "avvist",
      });
      expect(await lesAlt()).toEqual({ erter: annen });
    } finally {
      await b().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
    }
  });
});
