/**
 * Firebase Admin-adapteren mot en EKTE RTDB-emulator (demo-familieapp) —
 * aldri produksjon eller en Hosting-forhåndsvisning. Kjøres via
 * `npm run test:integration`, som starter emulatoren rundt kommandoen.
 *
 *  1. Samme kontrakttest som in-memory-faken (storeContract.ts).
 *  2. Full HTTP-flyt read → search → add → read-back + replay med den
 *     ekte adapteren under.
 *  3. Shape: det MCP-flaten skriver i `families/{f}/shopping|items` er
 *     nøyaktig appens form (samme fem/to felt), og ingenting lekker inn
 *     under `families/` utover det.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { type Database, getDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { createTestIdp, TEST_ISSUER, TEST_RESOURCE } from "../testing/tokens";
import { FirebaseAdminStore } from "./firebaseAdminStore";
import { encodeKey } from "./paths";
import { runStoreContract } from "./storeContract";

const DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb";

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  throw new Error(
    "FIREBASE_DATABASE_EMULATOR_HOST mangler — kjør via `npm run test:integration` (emulator), aldri mot ekte RTDB.",
  );
}

let app: App;
let db: Database;
const families: string[] = [];
const subs: string[] = [];

beforeAll(() => {
  app = initializeApp({ projectId: "demo-familieapp", databaseURL: DATABASE_URL }, "mcp-it");
  db = getDatabase(app);
});

afterAll(async () => {
  await Promise.all([
    ...families.flatMap((f) => [
      db.ref(`families/${f}`).remove(),
      db.ref(`mcp/actions/${f}`).remove(),
    ]),
    ...subs.map((s) => db.ref(`mcp/principals/${encodeKey(s)}`).remove()),
  ]);
  await deleteApp(app);
});

const newFamilyId = () => {
  const id = `mcp-it-${randomUUID()}`;
  families.push(id);
  return id;
};

runStoreContract("FirebaseAdminStore (RTDB-emulator)", () => ({
  store: new FirebaseAdminStore(db),
  newFamilyId,
  seed: {
    member: async (f, uid) => void (await db.ref(`families/${f}/members/${uid}`).set(true)),
    principal: async (sub, link) => {
      subs.push(sub);
      await db.ref(`mcp/principals/${encodeKey(sub)}`).set(link);
    },
    shoppingRaw: async (f, id, raw) => void (await db.ref(`families/${f}/shopping/${id}`).set(raw)),
    item: async (f, id, fields) => void (await db.ref(`families/${f}/items/${id}`).set(fields)),
  },
}));

describe("HTTP-flyt med ekte Admin-adapter på emulatoren", () => {
  let server: Server;
  let baseUrl: string;
  let idp: Awaited<ReturnType<typeof createTestIdp>>;
  let familyId: string;
  const sub = `google-oauth2|it-${randomUUID()}`;

  beforeAll(async () => {
    idp = await createTestIdp();
    familyId = newFamilyId();
    subs.push(sub);
    await db.ref(`mcp/principals/${encodeKey(sub)}`).set({ firebaseUid: "uid-it", familyId });
    await db.ref(`families/${familyId}`).set({
      members: { "uid-it": true },
      items: { "v-melk": { name: "Melk", cat: "Ost og meieri" } },
      shopping: {
        a: { itemId: "v-melk", name: "Melk", amount: "2", cat: "Ost og meieri", done: false },
      },
    });

    const handler = createApp({
      store: new FirebaseAdminStore(db),
      resource: { resourceUrl: TEST_RESOURCE, issuer: TEST_ISSUER },
      audience: TEST_RESOURCE.href,
      getKey: idp.getKey,
      audit: { event: () => {} },
    });
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("read → search → add → read-back, replay, og appens nøyaktige Firebase-shape", async () => {
    const client = new Client({ name: "it", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${await idp.sign({}, { sub })}` } },
      }),
    );
    const call = async (name: string, args: Record<string, unknown>) =>
      (await client.callTool({ name, arguments: args })).structuredContent as Record<
        string,
        unknown
      >;

    expect((await call("shopping_list_get", {})).items).toHaveLength(1);
    expect((await call("items_search", { query: "melk" })).items).toEqual([
      { id: "v-melk", name: "Melk", cat: "Ost og meieri" },
    ]);

    const requestId = randomUUID();
    const args = {
      requestId,
      items: [
        { name: "Melk", amount: "3" },
        { name: "Kanel", cat: "Tørrvarer" },
      ],
    };
    const add = await call("shopping_list_add_items", args);
    expect(add.replayed).toBe(false);
    const replay = await call("shopping_list_add_items", args);
    expect(replay.replayed).toBe(true);
    expect(replay.results).toEqual(add.results);

    const family = (await db.ref(`families/${familyId}`).get()).val() as {
      shopping: Record<string, Record<string, unknown>>;
      items: Record<string, Record<string, unknown>>;
    };
    // Kun appens egne noder under families/{f} — markører/koblinger bor under mcp/.
    expect(Object.keys(family).sort()).toEqual(["items", "members", "shopping"]);
    expect(family.shopping.a).toEqual({
      itemId: "v-melk",
      name: "Melk",
      amount: "5",
      cat: "Ost og meieri",
      done: false,
    });
    const kanelEntry = Object.entries(family.shopping).find(([, e]) => e.name === "Kanel");
    expect(kanelEntry?.[1]).toEqual({
      itemId: expect.any(String),
      name: "Kanel",
      amount: "",
      cat: "Tørrvarer",
      done: false,
    });
    expect(family.items[kanelEntry![1].itemId as string]).toEqual({
      name: "Kanel",
      cat: "Tørrvarer",
    });

    const record = (await db.ref(`mcp/actions/${familyId}/${requestId}`).get()).val();
    expect(record).toMatchObject({
      status: "committed",
      idpSub: sub,
      firebaseUid: "uid-it",
      clientId: "chatgpt-client",
    });
    await client.close();
  });
});
