/**
 * Datalag-/integrasjonstest — snakker med en EKTE Firebase Emulator
 * Suite-instans (RTDB + Auth), aldri med produksjon eller en
 * Hosting-forhåndsvisning. Kjøres via `npm run test:integration`. Se
 * freezer.repository.integration.test.ts for medlemskaps-/sikkerhets-
 * regeltesten — ikke duplisert her, samme regel gjelder alle stier
 * under `families/{familyId}`.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { get, ref } from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addLiquidityPost,
  regenerateLiquidityPosts,
  removeLiquidityPost,
  saveLiquiditySaldo,
  setLiquidityPostFulfilled,
  subscribeLiquidity,
  updateLiquidityPost,
} from "./liquidity.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import type { LiquidityPost } from "@app-types/liquidity";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;

let adminApp: AdminApp;

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "liquidity-integration-test-admin",
  );

  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await getAdminDatabase(adminApp).ref(`families/${FAMILY_ID}/members/${uid}`).set(true);

  const customToken = await getAdminAuth(adminApp).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), customToken);
});

afterAll(async () => {
  await getAdminDatabase(adminApp).ref(`families/${FAMILY_ID}/liquidity`).remove();
  await deleteApp(adminApp);
});

function waitForLiquidity(predicate: (data: { posts: Record<string, LiquidityPost> }) => boolean) {
  return new Promise<void>((resolve) => {
    const unsubscribe = subscribeLiquidity(FAMILY_ID, (data) => {
      if (predicate(data)) {
        unsubscribe();
        resolve();
      }
    });
  });
}

describe("liquidity.repository (emulator)", () => {
  it("skriver saldo målrettet, uten å røre posts", async () => {
    const id = await addLiquidityPost(FAMILY_ID, {
      name: "Post før saldo-skriving",
      amount: 100,
      direction: "out",
      date: "2026-06-15",
      type: "extra",
    });
    await waitForLiquidity((d) => !!d.posts[id]);

    await saveLiquiditySaldo(FAMILY_ID, 4242);

    const snapshot = await get(ref(getFirebaseDatabase(), `families/${FAMILY_ID}/liquidity`));
    const value = snapshot.val() as { saldo: number; posts: Record<string, LiquidityPost> };
    expect(value.saldo).toBe(4242);
    expect(value.posts[id]).toBeDefined(); // saldo-skrivingen rørte ikke posts
  });

  it("oppretter og fjerner en manuell post på sin egen node", async () => {
    const id = await addLiquidityPost(FAMILY_ID, {
      name: `Post ${randomUUID()}`,
      amount: 250,
      direction: "in",
      date: "2026-06-20",
      type: "inn",
    });
    await waitForLiquidity((d) => !!d.posts[id]);

    await removeLiquidityPost(FAMILY_ID, id);
    await waitForLiquidity((d) => !d.posts[id]);
  });

  it("markerer og avmarkerer en post som oppfylt", async () => {
    const id = await addLiquidityPost(FAMILY_ID, {
      name: `Oppfylt-test ${randomUUID()}`,
      amount: 500,
      direction: "out",
      date: "2026-06-10",
      type: "extra",
    });
    await waitForLiquidity((d) => !!d.posts[id]);

    await setLiquidityPostFulfilled(FAMILY_ID, id, true);
    await waitForLiquidity((d) => d.posts[id]?.status === "oppfylt" && !!d.posts[id].oppfyltAt);

    await setLiquidityPostFulfilled(FAMILY_ID, id, false);
    await waitForLiquidity(
      (d) => d.posts[id]?.status === "aktiv" && d.posts[id].oppfyltAt === undefined,
    );
  });

  it("merker en generert post som manueltOverstyrt ved redigering", async () => {
    const id = randomUUID();
    await getAdminDatabase(adminApp)
      .ref(`families/${FAMILY_ID}/liquidity/posts/${id}`)
      .set({
        id,
        name: "Generert post",
        amount: 100,
        direction: "out",
        date: "2026-06-15",
        type: "fast",
        kilde: "generator",
        _genKey: "test_key",
      } satisfies LiquidityPost);
    await waitForLiquidity((d) => !!d.posts[id]);

    await updateLiquidityPost(FAMILY_ID, id, { amount: 999 });
    await waitForLiquidity((d) => d.posts[id]?.amount === 999);

    const snapshot = await get(
      ref(getFirebaseDatabase(), `families/${FAMILY_ID}/liquidity/posts/${id}`),
    );
    expect((snapshot.val() as LiquidityPost).manueltOverstyrt).toBe(true);
  });

  it("regenerateLiquidityPosts erstatter hele posts-undernoden", async () => {
    const staleId = randomUUID();
    await getAdminDatabase(adminApp)
      .ref(`families/${FAMILY_ID}/liquidity/posts/${staleId}`)
      .set({
        id: staleId,
        name: "Utdatert generert post",
        amount: 1,
        direction: "out",
        date: "2026-06-01",
        type: "fast",
        kilde: "generator",
        _genKey: "utdatert",
      } satisfies LiquidityPost);
    await waitForLiquidity((d) => !!d.posts[staleId]);

    const nyId = randomUUID();
    await regenerateLiquidityPosts(FAMILY_ID, {
      [nyId]: {
        id: nyId,
        name: "Ny generert post",
        amount: 2,
        direction: "out",
        date: "2026-06-02",
        type: "fast",
        kilde: "generator",
        _genKey: "ny",
      },
    });

    await waitForLiquidity((d) => !d.posts[staleId] && !!d.posts[nyId]);
  });
});
