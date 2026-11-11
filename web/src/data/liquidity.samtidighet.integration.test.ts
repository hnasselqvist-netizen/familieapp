/**
 * Samtidige Spillerom-endringer (#59, ordre 6675906923) — EKTE
 * Firebase-emulator, syntetiske poster. Deterministisk konkurranse: klient
 * A (appens SDK) kobles fra (`goOffline`), klient B (Admin SDK, «den andre
 * enheten») skriver, og A sin skriving — basert på A sitt gamle bilde —
 * sendes først når A kobles til igjen. Uten vern overskriver A B sine
 * endringer; med transaksjon på fersk tilstand bevares de.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { get, goOffline, goOnline, ref, set } from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LiquidityPost } from "@app-types/liquidity";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import {
  LikviditetKonflikt,
  regenerateLiquidityPosts,
  setLiquidityPostFulfilled,
  updateLiquidityPost,
} from "./liquidity.repository";
import type { ForecastGroup } from "@app-types/liquidity";
import { generateForecastPosts } from "@domain/liquidity/liquidity";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const STI = `families/${FAMILY_ID}/liquidity`;

let adminApp: AdminApp;
const b = () => getAdminDatabase(adminApp);

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "liquidity-samtidighet-admin",
  );
  const uid = `test-${randomUUID()}`;
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

const manuell = (id: string, o: Partial<LiquidityPost> = {}): LiquidityPost => ({
  id,
  name: id,
  amount: 100,
  direction: "out",
  date: "2026-11-25",
  type: "extra",
  kilde: "manuell",
  ...o,
});
const generert = (id: string): LiquidityPost => ({
  ...manuell(id),
  type: "fast",
  kilde: "generator",
  _genKey: `${id}_2026_10_25`,
});

/** Startbilde felles for scenarioene. */
async function start() {
  await b()
    .ref(STI)
    .set({
      saldo: 5000,
      prognosisDate: "2026-11-30",
      posts: {
        m1: manuell("m1"),
        m2: manuell("m2"),
        m3: manuell("m3"),
        g1: generert("g1"),
      },
    });
  const bilde = (await get(ref(getFirebaseDatabase(), `${STI}/posts`))).val() as Record<
    string,
    LiquidityPost
  >;
  return bilde;
}

/** B sine samtidige endringer mens A er frakoblet. */
async function andreEnhetSkriver() {
  await b()
    .ref(`${STI}/posts/ny`)
    .set(manuell("ny", { name: "Ny fra B" })); // oppretting
  await b().ref(`${STI}/posts/m1/amount`).set(777); // endring
  await b().ref(`${STI}/posts/m2`).update({ status: "oppfylt", oppfyltAt: 1 }); // oppfylt
  await b().ref(`${STI}/posts/m3`).remove(); // legitim sletting
  await b().ref(`${STI}/saldo`).set(6000); // søskenfelt
}

async function lesServer() {
  return (await b().ref(STI).get()).val() as {
    saldo: number;
    posts: Record<string, LiquidityPost>;
  };
}

beforeEach(() => goOnline(getFirebaseDatabase()));

describe("reproduksjon: foreldet hel-skriving av posts (gammel regenerering)", () => {
  it("A sin set av posts fra gammelt bilde sletter/reverserer B sine endringer", async () => {
    const gammelt = await start();
    goOffline(getFirebaseDatabase());
    await andreEnhetSkriver();
    // Som før: regenerering beregnet fra A sitt bilde, skrevet med set.
    const skriving = set(ref(getFirebaseDatabase(), `${STI}/posts`), gammelt);
    goOnline(getFirebaseDatabase());
    await skriving;
    const s = await lesServer();
    expect(s.posts.ny).toBeUndefined(); // oppretting tapt
    expect(s.posts.m1!.amount).toBe(100); // endring reversert
    expect(s.posts.m2!.status).toBeUndefined(); // oppfylt reversert
    expect(s.posts.m3).toBeDefined(); // slettet post gjenoppstått
    expect(s.saldo).toBe(6000); // søskenfelt (utenfor posts) uberørt
  });
});

const GRUPPER = [
  {
    id: "bolig",
    label: "bolig",
    items: [
      {
        id: "husleie",
        name: "Husleie",
        meta: { automatisk: true, forfallsdag: "20", oppforsel: "fast" },
        months: Array.from({ length: 12 }, () => ({ budget: 9000, spent: 0 })),
      },
    ],
  },
] as unknown as ForecastGroup[];

describe("vern: regenerering i transaksjon på gjeldende posts", () => {
  it("B sin oppretting, endring, oppfylt og sletting bevares; søskenfelt uberørt; generatoren regner på fersk tilstand", async () => {
    await start();
    goOffline(getFirebaseDatabase());
    await andreEnhetSkriver();
    const sett: string[][] = [];
    const skriving = regenerateLiquidityPosts(FAMILY_ID, (gjeldende) => {
      sett.push(Object.keys(gjeldende).sort());
      return generateForecastPosts(
        GRUPPER,
        gjeldende,
        new Date(2026, 10, 10),
        new Date(2026, 10, 30),
        [],
        [],
      );
    });
    goOnline(getFirebaseDatabase());
    await skriving;
    const s = await lesServer();
    expect(s.posts.ny?.name).toBe("Ny fra B");
    expect(s.posts.m1!.amount).toBe(777);
    expect(s.posts.m2!.status).toBe("oppfylt");
    expect(s.posts.m3).toBeUndefined();
    expect(s.saldo).toBe(6000);
    expect(s.posts.g1).toBeUndefined(); // ikke-overstyrt generert post erstattes som før
    const gen = Object.values(s.posts).filter((p) => p.kilde === "generator");
    expect(gen.map((p) => p._genKey)).toEqual(["husleie_2026_10_20"]);
    // Siste (committede) kjøring så B sine endringer.
    expect(sett.at(-1)).toEqual(["g1", "m1", "m2", "ny"]);
  });

  it("overstyrt generert post endret av B bevares", async () => {
    await start();
    await b().ref(`${STI}/posts/g1`).update({ manueltOverstyrt: true, amount: 1 });
    goOffline(getFirebaseDatabase());
    await b().ref(`${STI}/posts/g1/amount`).set(2);
    const skriving = regenerateLiquidityPosts(FAMILY_ID, (g) =>
      generateForecastPosts([], g, new Date(2026, 10, 10), new Date(2026, 10, 30), [], []),
    );
    goOnline(getFirebaseDatabase());
    await skriving;
    expect((await lesServer()).posts.g1!.amount).toBe(2);
  });
});

describe("vern: redigering med grunnlag", () => {
  it("samme felt endret av B: konflikt, ingenting skrives", async () => {
    await start();
    goOffline(getFirebaseDatabase());
    await b().ref(`${STI}/posts/m1/amount`).set(777);
    const skriving = updateLiquidityPost(FAMILY_ID, "m1", { amount: 150 }, { amount: 100 });
    goOnline(getFirebaseDatabase());
    await expect(skriving).rejects.toMatchObject({ name: "LikviditetKonflikt", grunn: "konflikt" });
    expect((await lesServer()).posts.m1!.amount).toBe(777);
  });

  it("ulike felt: B sitt navn og A sitt beløp bevares begge", async () => {
    await start();
    goOffline(getFirebaseDatabase());
    await b().ref(`${STI}/posts/m1/name`).set("Navn fra B");
    const skriving = updateLiquidityPost(FAMILY_ID, "m1", { amount: 150 }, { amount: 100 });
    goOnline(getFirebaseDatabase());
    await skriving;
    const m1 = (await lesServer()).posts.m1!;
    expect(m1.name).toBe("Navn fra B");
    expect(m1.amount).toBe(150);
  });

  it("post slettet av B: redigering avvises og posten gjenoppstår ikke", async () => {
    await start();
    goOffline(getFirebaseDatabase());
    await b().ref(`${STI}/posts/m3`).remove();
    const skriving = updateLiquidityPost(FAMILY_ID, "m3", { amount: 150 }, { amount: 100 });
    goOnline(getFirebaseDatabase());
    await expect(skriving).rejects.toBeInstanceOf(LikviditetKonflikt);
    expect((await lesServer()).posts.m3).toBeUndefined();
  });

  it("oppfylt på post slettet av B gjenoppliver den ikke", async () => {
    await start();
    goOffline(getFirebaseDatabase());
    await b().ref(`${STI}/posts/m3`).remove();
    const skriving = setLiquidityPostFulfilled(FAMILY_ID, "m3", true);
    goOnline(getFirebaseDatabase());
    await skriving;
    expect((await lesServer()).posts.m3).toBeUndefined();
  });
});
