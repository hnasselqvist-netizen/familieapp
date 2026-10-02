/**
 * Operatør-CLI-en mot RTDB-emulatoren (aldri produksjon): den bygde
 * `dist/link-principal.js` kjøres som en egen prosess, og koblingen den
 * skriver leses tilbake gjennom serverens EGEN adapter — samme oppslag
 * som `authorize.ts` gjør per kall.
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { type Database, getDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FirebaseAdminStore } from "../store/firebaseAdminStore";
import { encodeKey } from "../store/paths";

const DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb";
const ROOT = path.resolve(import.meta.dirname, "../..");
const FAMILY = `it-link-${Date.now()}`;
const SUB = `auth0|it-${Date.now()}`;

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  throw new Error("FIREBASE_DATABASE_EMULATOR_HOST mangler — kjør via `npm run test:integration`.");
}

let app: App;
let db: Database;

beforeAll(async () => {
  execFileSync("npm", ["run", "--silent", "build:admin"], { cwd: ROOT, stdio: "ignore" });
  app = initializeApp({ projectId: "demo-familieapp", databaseURL: DATABASE_URL }, "link-it");
  db = getDatabase(app);
  await db.ref(`families/${FAMILY}/members/uid-1`).set(true);
});

afterAll(async () => {
  await db.ref(`families/${FAMILY}`).remove();
  await db.ref(`mcp/principals/${encodeKey(SUB)}`).remove();
  await deleteApp(app);
});

function cli(args: string[], env: Record<string, string | undefined> = {}) {
  const r = spawnSync("node", ["dist/link-principal.js", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, FIREBASE_DATABASE_URL: DATABASE_URL, ...env },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}

const base = ["--sub", SUB, "--uid", "uid-1", "--family", FAMILY];

describe("link-principal CLI mot emulatoren", () => {
  it("nekter ekte database uten MCP_ALLOW_PRODUCTION_DATA", () => {
    const r = cli(base, {
      FIREBASE_DATABASE_EMULATOR_HOST: "",
      FIREBASE_DATABASE_URL: "https://x.firebaseio.com",
    });
    expect(r.status).toBe(2);
    expect(r.out).toContain("Nekter å koble til ekte Realtime Database");
  });

  it("tørrkjøring → --apply → serverens adapter finner koblingen", async () => {
    const store = new FirebaseAdminStore(db);
    const dry = cli(base);
    expect(dry.status).toBe(0);
    expect(dry.out).toContain('"action": "create"');
    expect(await store.getPrincipalLink(SUB)).toBeNull();

    expect(cli([...base, "--apply"]).status).toBe(0);
    expect(await store.getPrincipalLink(SUB)).toEqual({
      firebaseUid: "uid-1",
      familyId: FAMILY,
      disabled: false,
    });
    expect(await store.isFamilyMember(FAMILY, "uid-1")).toBe(true);

    expect(cli([...base, "--disable", "--apply"]).status).toBe(0);
    expect((await store.getPrincipalLink(SUB))?.disabled).toBe(true);
  });

  it("nekter å koble en som ikke er medlem", () => {
    const r = cli(["--sub", `${SUB}-x`, "--uid", "fremmed", "--family", FAMILY, "--apply"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain('"action": "refuse"');
  });
});
