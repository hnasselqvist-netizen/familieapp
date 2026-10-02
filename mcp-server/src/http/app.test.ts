/**
 * Ende-til-ende over ekte HTTP med MCP SDK-ets egen klient: auth-
 * utfordring, metadata, tools/list-kontrakten, og read → search → add →
 * read-back. In-memory-store (samme kontrakt som Admin-adapteren, se
 * storeContract.ts) og lokal test-IdP — ingen nettverk utover localhost.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { MemoryStore } from "../store/memoryStore";
import { createTestIdp, TEST_ISSUER, TEST_RESOURCE } from "../testing/tokens";

let server: Server;
let baseUrl: string;
let store: MemoryStore;
let idp: Awaited<ReturnType<typeof createTestIdp>>;
const logLines: Record<string, unknown>[] = [];
const melkAmount = () => (store.get("families/familie1/shopping/a") as { amount: string }).amount;
const entryIds = () =>
  Object.keys(store.get("families/familie1/shopping") as object).filter((k) => !k.startsWith("_"));

beforeAll(async () => {
  idp = await createTestIdp();
  store = new MemoryStore();
  const handler = createApp({
    store,
    resource: { resourceUrl: TEST_RESOURCE, issuer: TEST_ISSUER },
    audience: TEST_RESOURCE.href,
    getKey: idp.getKey,
    audit: { event: (name, fields) => logLines.push({ name, ...fields }) },
  });
  server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  store.principals.clear();
  store.principals.set("google-oauth2|123", { firebaseUid: "uid-1", familyId: "familie1" });
  store.set("families/familie1", {
    members: { "uid-1": true },
    items: { "v-melk": { name: "Melk", cat: "Ost og meieri" } },
    shopping: {
      a: {
        id: "a",
        itemId: "v-melk",
        name: "Melk",
        amount: "2",
        cat: "Ost og meieri",
        done: false,
      },
    },
  });
  store.set("mcp/actions/familie1", null);
  logLines.length = 0;
});

async function connect(token: string) {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

const structured = <T>(result: unknown) => (result as { structuredContent: T }).structuredContent;
const errorPayload = (result: unknown) =>
  JSON.parse((result as { content: { text: string }[] }).content[0]!.text) as {
    error: string;
    retryable: boolean;
  };

describe("HTTP: auth-grensen", () => {
  it("uten token: 401 + WWW-Authenticate med resource_metadata", async () => {
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://mcp.test.invalid/.well-known/oauth-protected-resource/mcp"',
    );
  });

  it("ugyldig token: 401 invalid_token, og token-strengen logges aldri", async () => {
    const forged = (await idp.sign({}, { audience: "https://annen.invalid/mcp" })) + "";
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${forged}` },
      body: "{}",
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(JSON.stringify(logLines)).not.toContain(forged);
  });

  it("metadata-dokumentet er offentlig på begge stier", async () => {
    for (const path of [
      "/.well-known/oauth-protected-resource/mcp",
      "/.well-known/oauth-protected-resource",
    ]) {
      const res = await fetch(`${baseUrl}${path}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ authorization_servers: [TEST_ISSUER] });
    }
  });

  it("GET /mcp → 405 (stateless, ingen SSE-strøm)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(405);
  });
});

describe("MCP: verktøykontrakten", () => {
  it("tools/list eksponerer nøyaktig de tre godkjente verktøyene med riktige hint", async () => {
    const client = await connect(await idp.sign());
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      "items_search",
      "shopping_list_add_items",
      "shopping_list_get",
    ]);
    expect(byName.shopping_list_get?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.items_search?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.shopping_list_add_items?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(byName.shopping_list_add_items?.annotations?.idempotentHint).toBeUndefined();
    // Ingen verktøy tar imot familyId — den utledes alltid server-side.
    for (const tool of tools) {
      expect(JSON.stringify(tool.inputSchema)).not.toMatch(/family/i);
    }
    await client.close();
  });

  it("tools/list (rå JSON-RPC): securitySchemes på toppnivå OG speilet i _meta, per verktøy", async () => {
    // SDK-klienten stripper ukjente felt ved parsing, så toppnivåfeltet må
    // verifiseres på selve trådformatet — det er det ChatGPT leser.
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${await idp.sign()}`,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: {
        tools: {
          name: string;
          securitySchemes?: unknown;
          _meta?: { securitySchemes?: unknown };
          inputSchema: { properties?: Record<string, unknown> };
        }[];
      };
    };
    const expected: Record<string, string> = {
      shopping_list_get: "shopping:read",
      items_search: "shopping:read",
      shopping_list_add_items: "shopping:write",
    };
    expect(body.result.tools.map((t) => t.name).sort()).toEqual(Object.keys(expected).sort());
    for (const tool of body.result.tools) {
      const scheme = [{ type: "oauth2", scopes: [expected[tool.name]] }];
      expect(tool.securitySchemes).toEqual(scheme);
      expect(tool._meta?.securitySchemes).toEqual(scheme);
      // SDK-ets egen JSON Schema-konvertering er bevart gjennom innpakningen.
      expect(tool.inputSchema.properties).toBeDefined();
    }
  });

  it("read → search → add → read-back", async () => {
    const client = await connect(await idp.sign());

    const before = structured<{ items: { name: string; amount: string }[] }>(
      await client.callTool({ name: "shopping_list_get", arguments: {} }),
    );
    expect(before.items).toEqual([
      { id: "a", name: "Melk", amount: "2", cat: "Ost og meieri", done: false },
    ]);

    const search = structured<{ items: { id: string; name: string }[] }>(
      await client.callTool({ name: "items_search", arguments: { query: "mel" } }),
    );
    expect(search.items).toEqual([{ id: "v-melk", name: "Melk", cat: "Ost og meieri" }]);

    const requestId = "5b3f0c2a-9d4e-4f6a-8b7c-1d2e3f4a5b6c";
    const add = structured<{
      replayed: boolean;
      results: { outcome: string; amount: string }[];
      list: { items: { name: string; amount: string }[] };
    }>(
      await client.callTool({
        name: "shopping_list_add_items",
        arguments: {
          requestId,
          items: [
            { name: "melk", amount: "3" },
            { name: "Kanel", cat: "Tørrvarer" },
          ],
        },
      }),
    );
    expect(add.replayed).toBe(false);
    expect(add.results.map((r) => [r.outcome, r.amount])).toEqual([
      ["merged", "5"],
      ["added", ""],
    ]);
    expect(add.list.items.map((i) => [i.name, i.amount])).toEqual([
      ["Melk", "5"],
      ["Kanel", ""],
    ]);

    const after = structured<{ items: { name: string; amount: string }[] }>(
      await client.callTool({ name: "shopping_list_get", arguments: {} }),
    );
    expect(after.items.map((i) => [i.name, i.amount])).toEqual([
      ["Melk", "5"],
      ["Kanel", ""],
    ]);

    // Plattform-retry med samme argumenter: replay, ingen dobbel summering.
    const retry = structured<{ replayed: boolean }>(
      await client.callTool({
        name: "shopping_list_add_items",
        arguments: {
          requestId,
          items: [
            { name: "melk", amount: "3" },
            { name: "Kanel", cat: "Tørrvarer" },
          ],
        },
      }),
    );
    expect(retry.replayed).toBe(true);
    expect(melkAmount()).toBe("5");
    await client.close();
  });

  it("lese-token uten shopping:write: add gir isError + WWW-Authenticate i _meta, ingenting skrevet", async () => {
    const client = await connect(await idp.sign({ scope: "shopping:read" }));
    const result = await client.callTool({
      name: "shopping_list_add_items",
      arguments: {
        requestId: "6c4a1d3b-0e5f-4a7b-9c8d-2e3f4a5b6c7d",
        items: [{ name: "Egg" }],
      },
    });
    expect(result.isError).toBe(true);
    expect(errorPayload(result).error).toBe("insufficient_scope");
    expect((result._meta as Record<string, string[]>)["mcp/www_authenticate"]?.[0]).toContain(
      'error="insufficient_scope", error_description="Tokenet mangler scope shopping:write.", scope="shopping:write"',
    );
    expect(entryIds()).toEqual(["a"]);
    await client.close();
  });

  it("gyldig token, men ukoblet IdP-bruker: not_linked, ingen data", async () => {
    const client = await connect(await idp.sign({}, { sub: "google-oauth2|fremmed" }));
    const result = await client.callTool({ name: "shopping_list_get", arguments: {} });
    expect(result.isError).toBe(true);
    expect(errorPayload(result).error).toBe("not_linked");
    expect(JSON.stringify(result)).not.toContain("Melk");
    await client.close();
  });

  it("medlemskap fjernet etter at tokenet ble utstedt: neste kall nektes", async () => {
    const client = await connect(await idp.sign());
    store.removeMember("familie1", "uid-1");
    const result = await client.callTool({ name: "shopping_list_get", arguments: {} });
    expect(errorPayload(result).error).toBe("not_member");
    await client.close();
  });

  it("validering: ugyldig kategori, for mange varer og ikke-UUID requestId avvises", async () => {
    const client = await connect(await idp.sign());
    const call = (args: Record<string, unknown>) =>
      client.callTool({ name: "shopping_list_add_items", arguments: args });
    const valid = "7d5b2e4c-1f6a-4b8c-8d9e-3f4a5b6c7d8e";

    for (const args of [
      { requestId: valid, items: [{ name: "Egg", cat: "Elektronikk" }] },
      { requestId: valid, items: Array.from({ length: 21 }, (_, i) => ({ name: `v${i}` })) },
      { requestId: "abc", items: [{ name: "Egg" }] },
      { requestId: valid, items: [{ name: "Egg\nmed linjeskift" }] },
      { requestId: valid, items: [] },
    ]) {
      const result = await call(args);
      expect(result.isError).toBe(true);
    }
    expect(entryIds()).toEqual(["a"]);
    expect(store.get("mcp/actions/familie1")).toBeNull();
    expect(store.get("families/familie1/shopping/_ops")).toBeNull();
    await client.close();
  });

  it("intern feil lekker ikke detaljer til klienten, men logges", async () => {
    const client = await connect(await idp.sign());
    store.failNextShoppingRead();
    const result = await client.callTool({ name: "shopping_list_get", arguments: {} });
    expect(errorPayload(result)).toMatchObject({ error: "internal_error", retryable: true });
    expect(JSON.stringify(result)).not.toContain("Simulert");
    expect(JSON.stringify(logLines)).toContain("Simulert lesefeil");
    await client.close();
  });
});
