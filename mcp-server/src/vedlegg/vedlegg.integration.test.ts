/**
 * Vedleggstjenesten (#59, B1) mot Auth- og RTDB-EMULATOREN med ekte
 * Firebase ID-tokens og falskt objektlager — aldri produksjon.
 *
 * Låser autorisasjonen som skal gjelde ved aktivering: verifisert token med
 * tilbakekallingssjekk og dagens medlemskap i NETTOPP familien i stien —
 * annen familie, fjernet medlem, deaktivert bruker, tilbakekalt økt og
 * ugyldig token avvises, og ingenting lagres eller leses for dem.
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Database, getDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { firebaseToken, rtdbMedlemskap } from "./firebaseAdaptere";
import { lagVedleggHandler } from "./http";
import { MinneObjektlager } from "./minneObjektlager";

const DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb";
const RUN = Date.now();
const FAM = `it-vedlegg-${RUN}`;
const ANNEN = `it-vedlegg-annen-${RUN}`;
const HELEN = `it-vh-${RUN}`;
const FJERNET = `it-vf-${RUN}`;
const AV = `it-vd-${RUN}`;
const TILBAKEKALT = `it-vt-${RUN}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const SHA = createHash("sha256").update(PNG).digest("hex");

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error("Kjør via `npm run test:integration` (RTDB- og Auth-emulator).");
}

let app: App;
let db: Database;
let auth: Auth;
let server: Server;
let base: string;
const lager = new MinneObjektlager();

/** Ekte ID-token fra Auth-emulatoren (custom token → signInWithCustomToken). */
async function idToken(uid: string): Promise<string> {
  const custom = await auth.createCustomToken(uid);
  const r = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  );
  return ((await r.json()) as { idToken: string }).idToken;
}

const post = (fam: string, token: string) =>
  fetch(`${base}/api/vedlegg/${fam}/r1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: PNG,
  });
const hent = (fam: string, token: string) =>
  fetch(`${base}/api/vedlegg/${fam}/r1/${SHA}`, { headers: { Authorization: `Bearer ${token}` } });

beforeAll(async () => {
  app = initializeApp({ projectId: "demo-familieapp", databaseURL: DATABASE_URL }, "vedlegg-it");
  db = getDatabase(app);
  auth = getAuth(app);
  for (const uid of [HELEN, FJERNET, AV, TILBAKEKALT]) await auth.createUser({ uid });
  await db.ref(`families/${FAM}/members`).set({
    [HELEN]: true,
    [FJERNET]: true,
    [AV]: true,
    [TILBAKEKALT]: true,
  });
  await db.ref(`families/${ANNEN}/members`).set({ annen: true });
  const handler = lagVedleggHandler({
    token: firebaseToken(auth),
    medlemskap: rtdbMedlemskap(db),
    lager,
    maksBytes: 1024,
  });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.ref(`families/${FAM}`).remove();
  await db.ref(`families/${ANNEN}`).remove();
  for (const uid of [HELEN, FJERNET, AV, TILBAKEKALT]) await auth.deleteUser(uid).catch(() => {});
  await deleteApp(app);
});

describe("vedleggstjenesten mot emulatoren", () => {
  it("medlem med gyldig ID-token laster opp og henter originalbytes; RTDB røres ikke", async () => {
    const t = await idToken(HELEN);
    const foer = (await db.ref(`families/${FAM}`).get()).val();
    const r = await post(FAM, t);
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ sha256: SHA, type: "image/png", status: "opprettet" });
    const h = await hent(FAM, t);
    expect(h.status).toBe(200);
    expect(new Uint8Array(await h.arrayBuffer())).toEqual(PNG);
    expect((await db.ref(`families/${FAM}`).get()).val()).toEqual(foer);
  });

  it("annen familie i stien → 403 (familien i forespørselen stoles ikke på alene)", async () => {
    const t = await idToken(HELEN);
    expect((await post(ANNEN, t)).status).toBe(403);
    expect((await hent(ANNEN, t)).status).toBe(403);
  });

  it("fjernet medlem → 403 med en gang, også med et ellers gyldig token", async () => {
    const t = await idToken(FJERNET);
    expect((await hent(FAM, t)).status).toBe(200);
    await db.ref(`families/${FAM}/members/${FJERNET}`).remove();
    expect((await hent(FAM, t)).status).toBe(403);
    expect((await post(FAM, t)).status).toBe(403);
  });

  it("tilbakekalt økt og deaktivert bruker → 401 før utløp; ugyldig token → 401", async () => {
    const tilbake = await idToken(TILBAKEKALT);
    const av = await idToken(AV);
    expect((await hent(FAM, tilbake)).status).toBe(200);
    // Tilbakekalling gjelder tokens utstedt FØR tidspunktet (sekundoppløsning).
    await new Promise((r) => setTimeout(r, 1100));
    await auth.revokeRefreshTokens(TILBAKEKALT);
    expect((await hent(FAM, tilbake)).status).toBe(401);
    await auth.updateUser(AV, { disabled: true });
    expect((await hent(FAM, av)).status).toBe(401);
    expect((await hent(FAM, "ikke.et.token")).status).toBe(401);
    expect(lager.skrivinger).toBe(1);
  });
});
