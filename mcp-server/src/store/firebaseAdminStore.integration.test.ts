/**
 * Firebase Admin-adapteren mot en EKTE RTDB-emulator (demo-familieapp) —
 * aldri produksjon eller en Hosting-forhåndsvisning. Kjøres via
 * `npm run test:integration`, som starter emulatoren rundt kommandoen.
 *
 *  1. Samme kontrakttest som in-memory-faken (storeContract.ts).
 *  2. Full HTTP-flyt read → search → add → read-back + replay med den
 *     ekte adapteren under.
 *  3. Shape: det MCP-flaten skriver i `families/{f}/shopping|items` er
 *     appens form (+ eget `id` i nye poster), metadata ligger kun i
 *     `shopping/_ops`, og ingenting annet lekker inn under `families/`.
 *  4. Transaksjonen mot ekte RTDB: en endring beregnet fra et utdatert
 *     øyeblikksbilde skrives aldri (frakoblet klient med varm cache), og
 *     legacy-seedens array-form håndteres.
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
import { HandlelisteService } from "../handleliste/service";
import { FirebaseAdminStore } from "./firebaseAdminStore";
import { encodeKey, shoppingPath } from "./paths";
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
      db.ref(`mcp/actionsByDay/${f}`).remove(),
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
    raw: async (path, value) => void (await db.ref(path).set(value)),
    read: async (path) => (await db.ref(path).get()).val(),
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
    // Kun appens egne noder under families/{f}; metadata kun i shopping/_ops.
    expect(Object.keys(family).sort()).toEqual(["items", "members", "shopping"]);
    expect(Object.keys(family.shopping).filter((k) => k.startsWith("_"))).toEqual(["_ops"]);
    expect(family.shopping.a).toEqual({
      itemId: "v-melk",
      name: "Melk",
      amount: "5",
      cat: "Ost og meieri",
      done: false,
    });
    const kanelEntry = Object.entries(family.shopping).find(([, e]) => e.name === "Kanel");
    expect(kanelEntry?.[1]).toEqual({
      id: kanelEntry![0],
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
    expect(family.shopping._ops![requestId]).toMatchObject({
      tool: "shopping_list_add_items",
      sub,
      uid: "uid-it",
      client: "chatgpt-client",
    });

    // Legacy-lesingen etter cutover-filteret (`_`-nøkler hoppes over) ser kun varer.
    const legacyRead = Object.entries(family.shopping)
      .filter(([k]) => !k.startsWith("_"))
      .map(([, v]) => v);
    expect(legacyRead.every((e) => typeof e.name === "string")).toBe(true);

    const record = (await db.ref(`mcp/actions/${familyId}/${requestId}`).get()).val();
    expect(record).toMatchObject({
      requestId,
      idpSub: sub,
      firebaseUid: "uid-it",
      clientId: "chatgpt-client",
    });
    await client.close();
  });
});

const ctxFor = (familyId: string) => ({
  familyId,
  firebaseUid: "uid-it",
  idpSub: "google-oauth2|it",
  clientId: "it",
});

describe("handleliste-transaksjonen mot ekte RTDB", () => {
  it("frakoblet klient med UTDATERT cache: updaterens stale verdi skrives aldri — appens endring overlever", async () => {
    const familyId = newFamilyId();
    const path = `${shoppingPath(familyId)}/a`;
    await db.ref(path).set({ id: "a", itemId: "v", name: "Melk", amount: "2", cat: "Diverse" });

    // Egen tilkobling for MCP-siden, med varm (snart utdatert) cache.
    const mcpApp = initializeApp(
      { projectId: "demo-familieapp", databaseURL: DATABASE_URL },
      `mcp-it-stale-${randomUUID()}`,
    );
    const mcpDb = getDatabase(mcpApp);
    const warm = mcpDb.ref(shoppingPath(familyId));
    const listener = warm.on("value", () => {});
    await new Promise<void>((resolve) => warm.once("value", () => resolve()));
    mcpDb.goOffline();

    // Appen (annen tilkobling) endrer SAMME vare mens MCP er frakoblet.
    await db.ref(`${path}/amount`).set("10");

    const seen: string[] = [];
    const store = new FirebaseAdminStore(mcpDb);
    const tx = store.transactShopping(familyId, (current) => {
      const node = (current ?? {}) as Record<string, Record<string, unknown>>;
      const amount = String(node.a?.amount ?? "");
      seen.push(amount);
      return { ...node, a: { ...node.a, amount: String(Number(amount) + 3) } };
    });
    mcpDb.goOnline();
    expect(await tx).toEqual({ committed: true });

    expect(seen[0]).toBe("2"); // første forsøk så den utdaterte cachen …
    expect(seen.at(-1)).toBe("10"); // … men kun beregningen fra fersk verdi ble skrevet
    expect((await db.ref(`${path}/amount`).get()).val()).toBe("13");

    warm.off("value", listener);
    await deleteApp(mcpApp);
  });

  it("gammel array-seed (INIT_SHOPPING, id 1–4) via tjenesten: seed-postene bevares, noden blir objekt", async () => {
    const familyId = newFamilyId();
    const seed = Object.fromEntries(
      ["Melk", "Brød", "Egg", "Smør"].map((name, i) => [
        String(i + 1),
        { id: i + 1, name, amount: "1", cat: "Diverse", done: false },
      ]),
    );
    await db.ref(shoppingPath(familyId)).set(seed);
    expect(Array.isArray((await db.ref(shoppingPath(familyId)).get()).val())).toBe(true);

    const service = new HandlelisteService(new FirebaseAdminStore(db));
    const result = await service.addItems(ctxFor(familyId), {
      requestId: randomUUID(),
      items: [{ name: "Melk", amount: "2" }],
    });
    expect(result.results[0]).toMatchObject({ outcome: "merged", entryId: "1", amount: "3" });

    const node = (await db.ref(shoppingPath(familyId)).get()).val() as Record<string, unknown>;
    expect(Array.isArray(node)).toBe(false);
    expect(Object.keys(node).sort()).toEqual(["1", "2", "3", "4", "_ops"]);
    expect(node["1"]).toEqual({ id: 1, name: "Melk", amount: "3", cat: "Diverse", done: false });
    expect(node["4"]).toEqual(seed["4"]);
  });

  it("tapt svar: retry med samme requestId gir replay, ingen dobbel summering (ekte RTDB)", async () => {
    const familyId = newFamilyId();
    await db.ref(`${shoppingPath(familyId)}/a`).set({ name: "Melk", amount: "2", cat: "Diverse" });
    const store = new FirebaseAdminStore(db);
    const requestId = randomUUID();
    const service = new HandlelisteService(store);
    const input = { requestId, items: [{ name: "Melk", amount: "3" }] };

    const first = await service.addItems(ctxFor(familyId), input);
    // Svaret "går tapt" og arkivet mangler: kun `_ops` kan redde retryen.
    await db.ref(`mcp/actions/${familyId}`).remove();
    const retry = await service.addItems(ctxFor(familyId), input);
    expect(retry.replayed).toBe(true);
    expect(retry.results).toEqual(first.results);
    expect((await db.ref(`${shoppingPath(familyId)}/a/amount`).get()).val()).toBe("5");
  });
});
