/**
 * `add-member`-CLI-en mot RTDB- og Auth-emulatorene (aldri produksjon): den
 * bygde `dist/add-member.js` kjøres som en egen prosess, brukerne ligger i
 * Auth-emulatoren, og resultatet leses tilbake gjennom serverens EGEN
 * adapter — samme `isFamilyMember`-oppslag som `authorize.ts` gjør per kall.
 * Helt til slutt kjøres hele operatørsekvensen: add-member → link-principal.
 */
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { type Auth, getAuth } from "firebase-admin/auth";
import { type Database, getDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FirebaseAdminStore } from "../store/firebaseAdminStore";
import { encodeKey } from "../store/paths";
import { authDirectory, memberDb } from "./memberAdapters";
import { runAddMember } from "./memberAdd";

const DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb";
const ROOT = path.resolve(import.meta.dirname, "../..");
const RUN = Date.now();
const FAMILY = `it-member-${RUN}`;
const GHOST = `it-ghost-${RUN}`;
const SUB = `auth0|it-member-${RUN}`;
const HELEN = { uid: `it-helen-${RUN}`, email: `helen-${RUN}@example.no`, name: "Helen Test" };
const OFF = { uid: `it-off-${RUN}`, email: `off-${RUN}@example.no` };
const REVOKED = { uid: `it-rev-${RUN}`, email: `rev-${RUN}@example.no` };

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error(
    "FIREBASE_DATABASE_EMULATOR_HOST og FIREBASE_AUTH_EMULATOR_HOST mangler — kjør via `npm run test:integration` (emulatorer).",
  );
}

let app: App;
let db: Database;
let auth: Auth;

beforeAll(async () => {
  execFileSync("npm", ["run", "--silent", "build:admin"], { cwd: ROOT, stdio: "ignore" });
  app = initializeApp({ projectId: "demo-familieapp", databaseURL: DATABASE_URL }, "member-it");
  db = getDatabase(app);
  auth = getAuth(app);
  await auth.createUser({
    uid: HELEN.uid,
    email: HELEN.email,
    displayName: HELEN.name,
    password: "passord123",
    emailVerified: true,
  });
  await auth.createUser({ uid: OFF.uid, email: OFF.email, password: "passord123", disabled: true });
  await auth.createUser({ uid: REVOKED.uid, email: REVOKED.email, password: "passord123" });
  await db.ref(`families/${FAMILY}`).set({
    shopping: { a: { id: "a", name: "Melk" } },
    members: { [REVOKED.uid]: false },
  });
});

afterAll(async () => {
  await db.ref(`families/${FAMILY}`).remove();
  await db.ref(`families/${GHOST}`).remove();
  await db.ref(`mcp/principals/${encodeKey(SUB)}`).remove();
  await auth.deleteUsers([HELEN.uid, OFF.uid, REVOKED.uid]);
  await deleteApp(app);
});

function cli(script: string, args: string[], env: Record<string, string | undefined> = {}) {
  const r = spawnSync("node", [script, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, FIREBASE_DATABASE_URL: DATABASE_URL, ...env },
  });
  return { status: r.status, out: r.stdout + r.stderr };
}
const addMember = (args: string[], env?: Record<string, string | undefined>) =>
  cli("dist/add-member.js", args, env);
const linkPrincipal = (args: string[]) => cli("dist/link-principal.js", args);

const byEmail = ["--email", HELEN.email, "--family", FAMILY];
const familyTree = async () => JSON.stringify((await db.ref(`families/${FAMILY}`).get()).val());

describe("add-member: produksjonsvern", () => {
  it("nekter ekte database og Auth uten MCP_ALLOW_PRODUCTION_DATA", () => {
    const r = addMember(byEmail, {
      FIREBASE_DATABASE_EMULATOR_HOST: "",
      FIREBASE_AUTH_EMULATOR_HOST: "",
      FIREBASE_DATABASE_URL: "https://x-default-rtdb.europe-west1.firebasedatabase.app",
    });
    expect(r.status).toBe(2);
    expect(r.out).toContain("Nekter å koble til ekte Realtime Database og Firebase Auth");
  });

  it("nekter en blanding: emulert database med ekte Auth, og omvendt", () => {
    for (const env of [
      { FIREBASE_AUTH_EMULATOR_HOST: "" },
      { FIREBASE_DATABASE_EMULATOR_HOST: "" },
    ]) {
      const r = addMember(byEmail, { MCP_ALLOW_PRODUCTION_DATA: "true", ...env });
      expect(r.status, JSON.stringify(env)).toBe(2);
      expect(r.out).toContain("må peke samme vei");
    }
  });

  it("nekter at prosjekt-ID fra miljøet ikke stemmer med databasens URL", () => {
    const r = addMember(byEmail, {
      FIREBASE_DATABASE_EMULATOR_HOST: "",
      FIREBASE_AUTH_EMULATOR_HOST: "",
      MCP_ALLOW_PRODUCTION_DATA: "true",
      FIREBASE_DATABASE_URL:
        "https://familieapp-a5d15-default-rtdb.europe-west1.firebasedatabase.app",
      GOOGLE_CLOUD_PROJECT: "et-annet-prosjekt",
    });
    expect(r.status).toBe(2);
    expect(r.out).toContain("stemmer ikke med databasen");
  });

  it("krever --family og enten --email eller --uid", () => {
    expect(addMember(["--email", HELEN.email]).status).toBe(2);
    const r = addMember(["--family", FAMILY]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Oppgi --email");
  });
});

describe("add-member mot emulatorene", () => {
  it("tørrkjøring viser identiteten og skriver ingenting; --apply skriver kun ett medlemskap", async () => {
    const store = new FirebaseAdminStore(db);
    const foer = await familyTree();

    const dry = addMember(byEmail);
    expect(dry.status).toBe(0);
    expect(dry.out).toContain('"action": "create"');
    expect(dry.out).toContain('"dryRun": true');
    expect(dry.out).toContain('"target": "emulator"');
    // Identiteten operatøren skal bekrefte:
    expect(dry.out).toContain(HELEN.email);
    expect(dry.out).toContain(HELEN.name);
    expect(dry.out).toContain('"password"');
    expect(dry.out).toContain(HELEN.uid);
    expect(await familyTree()).toBe(foer);
    expect(await store.isFamilyMember(FAMILY, HELEN.uid)).toBe(false);

    const applied = addMember([...byEmail, "--apply"]);
    expect(applied.status).toBe(0);
    expect(applied.out).toContain('"applied": true');
    expect(await store.isFamilyMember(FAMILY, HELEN.uid)).toBe(true);

    // Nøyaktig én ny node; resten av familien er urørt.
    const etter = JSON.parse(await familyTree()) as { members: Record<string, unknown> };
    expect(etter.members[HELEN.uid]).toBe(true);
    delete etter.members[HELEN.uid];
    expect(JSON.stringify(etter)).toBe(foer);
  });

  it("er idempotent, og --uid og --expect-uid virker", () => {
    expect(addMember([...byEmail, "--apply"]).out).toContain('"action": "unchanged"');
    expect(
      addMember(["--uid", HELEN.uid, "--family", FAMILY, "--expect-uid", HELEN.uid]).status,
    ).toBe(0);
    const feil = addMember([...byEmail, "--expect-uid", "annen", "--apply"]);
    expect(feil.status).toBe(1);
    expect(feil.out).toContain("--expect-uid");
  });

  it("avslår ukjent e-post, deaktivert bruker og tilbaketrukket medlemskap — uten å skrive", async () => {
    const foer = await familyTree();
    for (const [args, forventet] of [
      [["--email", `ukjent-${RUN}@example.no`, "--family", FAMILY, "--apply"], "Fant ingen"],
      [["--email", OFF.email, "--family", FAMILY, "--apply"], "deaktivert"],
      [["--email", REVOKED.email, "--family", FAMILY, "--apply"], "false"],
    ] as [string[], string][]) {
      const r = addMember(args);
      expect(r.status, args.join(" ")).toBe(1);
      expect(r.out).toContain('"action": "refuse"');
      expect(r.out).toContain(forventet);
    }
    expect(await familyTree()).toBe(foer);
  });

  it("oppretter aldri en ny familie", async () => {
    const r = addMember(["--email", HELEN.email, "--family", GHOST, "--apply"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("Oppretter aldri en ny familie");
    expect((await db.ref(`families/${GHOST}`).get()).exists()).toBe(false);
  });

  it("adapterne gir samme svar direkte: e-postoppslag, ukjent bruker og familiesjekk", async () => {
    const dir = authDirectory(auth);
    expect(await dir.byEmail(HELEN.email)).toMatchObject({
      uid: HELEN.uid,
      email: HELEN.email,
      displayName: HELEN.name,
      emailVerified: true,
      disabled: false,
      providers: ["password"],
    });
    expect(await dir.byEmail(`ukjent-${RUN}@example.no`)).toBeNull();
    expect(await dir.byUid("finnes-ikke")).toBeNull();
    const mdb = memberDb(db);
    expect(await mdb.familyExists(FAMILY)).toBe(true);
    expect(await mdb.familyExists(GHOST)).toBe(false);
    expect(
      await runAddMember(mdb, dir, { familyId: FAMILY, email: HELEN.email }, false),
    ).toMatchObject({ action: "unchanged" });
  });
});

describe("hele operatørsekvensen: add-member → link-principal", () => {
  const linkArgs = ["--sub", SUB, "--uid", HELEN.uid, "--family", GHOST];

  it("link-principal nekter før medlemskapet finnes, og lykkes etter add-member", async () => {
    // En ny familie med en ikke-medlem-bruker: link-principal nekter.
    const familie = `it-seq-${RUN}`;
    await db.ref(`families/${familie}/shopping/a`).set({ id: "a", name: "Egg" });
    try {
      const args = ["--sub", SUB, "--uid", HELEN.uid, "--family", familie];
      const foer = linkPrincipal(args);
      expect(foer.status).toBe(1);
      expect(foer.out).toContain('"action": "refuse"');

      expect(addMember(["--email", HELEN.email, "--family", familie, "--apply"]).status).toBe(0);

      const dry = linkPrincipal(args);
      expect(dry.status).toBe(0);
      expect(dry.out).toContain('"action": "create"');
      expect((await db.ref(`mcp/principals/${encodeKey(SUB)}`).get()).exists()).toBe(false);

      expect(linkPrincipal([...args, "--apply"]).status).toBe(0);
      const store = new FirebaseAdminStore(db);
      expect(await store.getPrincipalLink(SUB)).toEqual({
        firebaseUid: HELEN.uid,
        familyId: familie,
        disabled: false,
      });
      expect(await store.isFamilyMember(familie, HELEN.uid)).toBe(true);
    } finally {
      await db.ref(`families/${familie}`).remove();
    }
    expect(linkArgs).toHaveLength(6);
  });
});
