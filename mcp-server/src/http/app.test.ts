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
import type { KontrollRapport } from "../forvaltning/cutoverKontroll";
import { MemoryStore } from "../store/memoryStore";
import { type DataLes, lesAlt, normaliser } from "../testing/dataTraversering";
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
    writesEnabled: true,
    dataWritesEnabled: true,
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

  it("GET /health → 200 uten auth (ikke /healthz: Cloud Run reserverer stier på «z»)", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /mcp → 405 (stateless, ingen SSE-strøm)", async () => {
    const res = await fetch(`${baseUrl}/mcp`, { headers: { Authorization: "Bearer x" } });
    expect(res.status).toBe(405);
  });
});

describe("MCP: verktøykontrakten", () => {
  it("tools/list eksponerer nøyaktig de ni godkjente verktøyene med riktige hint", async () => {
    const client = await connect(await idp.sign());
    const { tools } = await client.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual([
      "data_hent",
      "data_les",
      "data_nokler",
      "data_skriv",
      "forvaltning_cutover_kontroll",
      "items_search",
      "shopping_cutover_kontroll",
      "shopping_list_add_items",
      "shopping_list_get",
    ]);
    expect(byName.forvaltning_cutover_kontroll?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
    expect(byName.shopping_cutover_kontroll?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: true,
    });
    for (const navn of ["data_les", "data_nokler", "data_hent"]) {
      expect(byName[navn]?.annotations).toMatchObject({
        readOnlyHint: true,
        idempotentHint: true,
      });
    }
    expect(byName.shopping_list_get?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.items_search?.annotations).toMatchObject({ readOnlyHint: true });
    expect(byName.shopping_list_add_items?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(byName.shopping_list_add_items?.annotations?.idempotentHint).toBeUndefined();
    expect(byName.data_skriv?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
    expect(byName.data_skriv?.annotations?.idempotentHint).toBeUndefined();
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
      forvaltning_cutover_kontroll: "forvaltning:read",
      shopping_cutover_kontroll: "shopping:read",
      data_nokler: "data:read",
      data_les: "data:read",
      data_hent: "data:read",
      data_skriv: "data:write",
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

  it("intern feil lekker ikke detaljer til klienten, og loggen får bare feilklassen", async () => {
    const client = await connect(await idp.sign());
    store.failNextShoppingRead();
    const result = await client.callTool({ name: "shopping_list_get", arguments: {} });
    expect(errorPayload(result)).toMatchObject({ error: "internal_error", retryable: true });
    expect(JSON.stringify(result)).not.toContain("Simulert");
    // Meldingen kan inneholde dataverdier (#85-review 5709352689): bare klassen logges.
    expect(logLines).toContainEqual(
      expect.objectContaining({ name: "tool_call", error: "internal_error", feilklasse: "Error" }),
    );
    expect(JSON.stringify(logLines)).not.toContain("Simulert lesefeil");
    await client.close();
  });

  it("intern feil i data_hent med en canary i SDK-feilen: canary havner verken i svaret eller loggen", async () => {
    const client = await connect(await idp.sign({ scope: "data:read" }));
    const ekte = store.lesNode.bind(store);
    store.lesNode = async () => {
      throw new Error("synthetic-secret-in-sdk-error https://x.invalid/?verdi=hemmelig");
    };
    try {
      const result = await client.callTool({ name: "data_hent", arguments: { sti: "" } });
      expect(errorPayload(result).error).toBe("internal_error");
      expect(JSON.stringify(result)).not.toContain("synthetic-secret");
      expect(JSON.stringify(logLines)).not.toContain("synthetic-secret");
      expect(JSON.stringify(logLines)).not.toContain("hemmelig");
    } finally {
      store.lesNode = ekte;
    }
    await client.close();
  });
});

describe("Skrivesperre (standard)", () => {
  it("uten writesEnabled: kun leseverktøyene (inkl. cutover-kontrollen) i tools/list, og add kan ikke kalles", async () => {
    const handler = createApp({
      store,
      resource: { resourceUrl: TEST_RESOURCE, issuer: TEST_ISSUER },
      audience: TEST_RESOURCE.href,
      getKey: idp.getKey,
      audit: { event: () => {} },
    });
    const sperret = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => sperret.listen(0, "127.0.0.1", resolve));
    try {
      const client = new Client({ name: "test-client", version: "0.0.0" });
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${(sperret.address() as AddressInfo).port}/mcp`),
          { requestInit: { headers: { Authorization: `Bearer ${await idp.sign()}` } } },
        ),
      );
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "data_hent",
        "data_les",
        "data_nokler",
        "forvaltning_cutover_kontroll",
        "items_search",
        "shopping_cutover_kontroll",
        "shopping_list_get",
      ]);
      // Generell skriving er like sperret: data_skriv finnes ikke og kan ikke kalles.
      const skriv = await client.callTool({
        name: "data_skriv",
        arguments: {
          opId: "2026-10-30_sperret01",
          ops: [{ sti: "x", type: "set", verdi: 1, forventet: "mangler" }],
        },
      });
      expect(skriv.isError).toBe(true);
      expect(store.get("families/familie1/x")).toBeNull();

      const result = await client.callTool({
        name: "shopping_list_add_items",
        arguments: { requestId: "8e6c3f5d-2a7b-4c9d-9e0f-4a5b6c7d8e9f", items: [{ name: "Egg" }] },
      });
      expect(result.isError).toBe(true);
      expect(entryIds()).toEqual(["a"]);
      expect(store.get("mcp/actions/familie1")).toBeNull();
      await client.close();
    } finally {
      await new Promise<void>((resolve) => sperret.close(() => resolve()));
    }
  });
});

describe("forvaltning_cutover_kontroll (Issue #34)", () => {
  const LEST = "2026-10-04T18:00:00.000Z";
  const forsoning = {
    transaksjoner: [
      { id: "t1", belop: 99, retning: "ut", status: "ny", hendelseId: "h1" },
      { id: "t2", belop: 10, retning: "ut", status: "ny" },
    ],
    hendelser: [
      {
        id: "h1",
        status: "ferdig",
        transaksjonId: "t1",
        receiptId: null,
        regelId: null,
        fordelinger: [],
      },
      {
        id: "msoknxe09eop",
        status: "ferdig",
        transaksjonId: "msoknxe01b83",
        regelId: "msok68ov1ag1",
        fordelinger: [{ plasseringId: "drivstoff_helen", plasseringType: "budget", belop: -9.27 }],
      },
    ],
    receipts: [{ id: "k1", imageUrl: "data:image/png;base64,AAAA", transactionId: "t2" }],
    rules: [{ id: "r1", mode: "auto" }],
  };
  const kontrollToken = () => idp.sign({ scope: "forvaltning:read" });
  const kall = (client: Client, args: Record<string, unknown> = {}) =>
    client.callTool({ name: "forvaltning_cutover_kontroll", arguments: args });

  let app: Server;
  let url: string;
  beforeAll(async () => {
    const handler = createApp({
      store,
      resource: { resourceUrl: TEST_RESOURCE, issuer: TEST_ISSUER },
      audience: TEST_RESOURCE.href,
      getKey: idp.getKey,
      audit: { event: () => {} },
      now: () => new Date(LEST),
    });
    app = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(app.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => new Promise<void>((resolve) => app.close(() => resolve())));
  beforeEach(() => {
    for (const [node, verdi] of Object.entries(forsoning))
      store.set(`families/familie1/${node}`, verdi);
  });

  async function koble(token: string) {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }

  it("rapporterer struktur, bilder og fortegn — og skriver ingenting noe sted", async () => {
    const foer = JSON.stringify([store.get("families"), store.get("mcp")]);
    const client = await koble(await kontrollToken());
    const result = await kall(client);
    expect(result.isError).toBeFalsy();
    const r = structured<KontrollRapport>(result);
    expect(r).toMatchObject({
      format: 1,
      lest: LEST,
      vurdering: { strukturOk: true, merknader: [] },
      noder: {
        transaksjoner: { form: "array", antall: 2 },
        hendelser: { form: "array", antall: 2 },
        receipts: { form: "array", antall: 1 },
        rules: { form: "array", antall: 1 },
      },
      kvitteringsbilder: { drive: 0, base64: 1 },
      fortegn: [
        { id: "msoknxe09eop", resultat: "allerede_korrekt", belop: -9.27 },
        { id: "msoknxe0960s", resultat: "finnes_ikke" },
      ],
    });
    expect(JSON.stringify([store.get("families"), store.get("mcp")])).toBe(foer);
    await client.close();
  });

  it("før/etter: grunnlaget fra første kall gir nøyaktig endring i andre kall", async () => {
    const client = await koble(await kontrollToken());
    const foer = structured<KontrollRapport>(await kall(client));
    store.set("families/familie1/transaksjoner/1/status", "ignorert");
    const etter = structured<KontrollRapport>(
      await kall(client, { forrige: foer.sammenligningsgrunnlag, endretEtter: LEST }),
    );
    expect(etter.sammenligning?.noder.transaksjoner).toMatchObject({
      antallFor: 2,
      antallEtter: 2,
      endret: true,
    });
    expect(etter.sammenligning?.noder.transaksjoner.uforklarteBotter).toHaveLength(1);
    expect(etter.sammenligning?.noder.hendelser.endret).toBe(false);
    await client.close();
  });

  it("krever forvaltning:read — shopping-scopes gir insufficient_scope og ingen data", async () => {
    const client = await koble(await idp.sign());
    const result = await kall(client);
    expect(result.isError).toBe(true);
    expect(errorPayload(result).error).toBe("insufficient_scope");
    expect((result._meta as Record<string, string[]>)["mcp/www_authenticate"]?.[0]).toContain(
      'scope="forvaltning:read"',
    );
    expect(JSON.stringify(result)).not.toContain("msoknxe09eop");
    await client.close();
  });

  it("forvaltning:read gir ikke tilgang til handlelisten", async () => {
    const client = await koble(await kontrollToken());
    const result = await client.callTool({ name: "shopping_list_get", arguments: {} });
    expect(errorPayload(result).error).toBe("insufficient_scope");
    await client.close();
  });

  it("ugyldig forrige-grunnlag og endretEtter avvises før noe leses", async () => {
    const client = await koble(await kontrollToken());
    for (const args of [{ forrige: { lest: "x" } }, { endretEtter: "i går" }]) {
      expect((await kall(client, args)).isError).toBe(true);
    }
    await client.close();
  });
});

describe("shopping_cutover_kontroll", () => {
  const LEST = "2026-10-23T08:00:00.000Z";
  const MARKOR = {
    versjon: "web-v2",
    name: "Handlelisten redigeres i den nye appen",
    cat: "Diverse",
    amount: "",
    done: true,
  };
  type Rapport = {
    format: number;
    lest: string;
    form: string;
    markor: string;
    antallVarer: number;
    antallSammenslatt: number;
    antallHistorikkUavklart: number;
    undefinedForm: string;
    digestUtenMarkor: string;
    stopp: string[];
    stoppKoder: string[];
  };

  let app: Server;
  let url: string;
  beforeAll(async () => {
    const handler = createApp({
      store,
      resource: { resourceUrl: TEST_RESOURCE, issuer: TEST_ISSUER },
      audience: TEST_RESOURCE.href,
      getKey: idp.getKey,
      audit: { event: (name, fields) => logLines.push({ name, ...fields }) },
      now: () => new Date(LEST),
    });
    app = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(app.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => new Promise<void>((resolve) => app.close(() => resolve())));
  beforeEach(() => {
    // En annen familie med HELT annen handleliste: må aldri påvirke svaret.
    store.set("families/familie2", {
      members: { "uid-2": true },
      shopping: { x: { name: "Hemmelig", sammenslaing: "x" }, _skriver: { versjon: "v0" } },
    });
  });

  async function koble(token: string) {
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );
    return client;
  }
  const kall = (client: Client, args: Record<string, unknown> = {}) =>
    client.callTool({ name: "shopping_cutover_kontroll", arguments: args });
  const tilstand = () => JSON.stringify([store.get("families"), store.get("mcp")]);

  it("egen familie fra koblingen: tellinger og digest, aldri navn — og ingenting skrives", async () => {
    const foer = tilstand();
    const client = await koble(await idp.sign({ scope: "shopping:read" }));
    const result = await kall(client);
    expect(result.isError).toBeFalsy();
    const r = structured<Rapport>(result);
    expect(r).toMatchObject({
      format: 2,
      lest: LEST,
      form: "objekt",
      markor: "mangler",
      antallVarer: 1,
      antallSammenslatt: 0,
      antallHistorikkUavklart: 0,
      undefinedForm: "mangler",
      stopp: [],
      stoppKoder: [],
      legacyIdentitet: { antallOppforinger: 1, ok: expect.any(Boolean) },
    });
    expect(r.digestUtenMarkor).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/Melk|Ost og meieri|Hemmelig/);
    expect(tilstand()).toBe(foer);
    await client.close();
  });

  it("argumenter kan ikke velge familie eller sti: svaret gjelder fortsatt egen familie", async () => {
    const client = await koble(await idp.sign());
    const egen = structured<Rapport>(await kall(client));
    const forsok = await kall(client, {
      familyId: "familie2",
      path: "families/familie2/shopping",
    });
    expect(forsok.isError).toBeFalsy();
    expect(structured<Rapport>(forsok)).toEqual(egen);
    expect(JSON.stringify(forsok)).not.toContain("Hemmelig");
    await client.close();
  });

  it("presise stoppkoder: ugyldig struktur, markøravvik og uavklart historikk; navnløs historikk telles", async () => {
    const client = await koble(await idp.sign());
    const tilfeller: [unknown, Partial<Rapport>][] = [
      ["tekst", { form: "ugyldig", stoppKoder: ["ugyldig_form"] }],
      [
        { _skriver: { versjon: "web-v2" }, a: { name: "Melk" } },
        { markor: "feil", stoppKoder: ["markor_avvik"] },
      ],
      [
        { _skriver: MARKOR, x: { sammenslaing: { opId: "p" } } },
        { markor: "ok", antallSammenslatt: 1, stoppKoder: [] },
      ],
      [
        { x: { name: "Melk", sammenslaing: "x" } },
        { antallHistorikkUavklart: 1, stoppKoder: ["historikk_uavklart"] },
      ],
    ];
    for (const [node, forventet] of tilfeller) {
      store.set("families/familie1/shopping", node);
      const foer = tilstand();
      const result = await kall(client);
      expect(result.isError).toBeFalsy();
      const r = structured<Rapport>(result);
      expect(r).toMatchObject(forventet);
      expect(r.stopp).toHaveLength(r.stoppKoder.length);
      expect(JSON.stringify(result)).not.toMatch(/Melk|"p"|web-v2/);
      expect(tilstand()).toBe(foer);
    }
    await client.close();
  });

  it("krever shopping:read — forvaltning:read gir insufficient_scope og ingen data", async () => {
    const client = await koble(await idp.sign({ scope: "forvaltning:read" }));
    const result = await kall(client);
    expect(result.isError).toBe(true);
    expect(errorPayload(result).error).toBe("insufficient_scope");
    expect((result._meta as Record<string, string[]>)["mcp/www_authenticate"]?.[0]).toContain(
      'scope="shopping:read"',
    );
    expect(JSON.stringify(result)).not.toMatch(/digest|antall/);
    await client.close();
  });

  it("ukoblet bruker og fjernet medlemskap gir feil uten data", async () => {
    const ukoblet = await koble(await idp.sign({}, { sub: "google-oauth2|fremmed" }));
    const r1 = await kall(ukoblet);
    expect(errorPayload(r1).error).toBe("not_linked");
    expect(JSON.stringify(r1)).not.toMatch(/digest|antall/);
    await ukoblet.close();

    const client = await koble(await idp.sign());
    store.removeMember("familie1", "uid-1");
    const r2 = await kall(client);
    expect(errorPayload(r2).error).toBe("not_member");
    expect(JSON.stringify(r2)).not.toMatch(/digest|antall/);
    await client.close();
  });

  it("lesefeil gir generell intern feil uten detaljer eller data", async () => {
    const client = await koble(await idp.sign());
    store.failNextShoppingRead();
    const result = await kall(client);
    expect(errorPayload(result)).toMatchObject({ error: "internal_error" });
    expect(JSON.stringify(result)).not.toMatch(/Simulert|Melk|digest/);
    await client.close();
  });
});

describe("full lesing (data_nokler / data_les, data:read)", () => {
  const SYNTETISK = {
    members: { "uid-1": true },
    transaksjoner: [
      { id: "t0", belop: -12.5, ukjentFelt: { dypt: { liste: [1, "to", { tre: true }] } } },
      { id: "t1", korrigeringslogg: [{ handling: "merket_dublett", tidspunkt: "2026-10-01" }] },
    ],
    receipts: { r1: { imageUrl: `data:image/png;base64,${"A".repeat(5_000)}`, total: 99 } },
    mealLibrary: Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [
        `m${String(i).padStart(2, "0")}`,
        { navn: `Rett ${i}` },
      ]),
    ),
    budget: { "2026": { mat: 4000 } },
  };

  beforeEach(() => {
    store.set("families/familie1", SYNTETISK);
    store.set("families/familie2", {
      members: { "uid-2": true },
      hemmelig: { x: "Annen familie" },
    });
  });

  async function verktoy(scope = "data:read") {
    const client = await connect(await idp.sign({ scope }));
    const kall = async (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args });
    return { client, kall };
  }
  const tilstand = () => JSON.stringify([store.get("families"), store.get("mcp")]);

  it("data_nokler finner alle toppnoder, grunt og sidedelt", async () => {
    const { client, kall } = await verktoy();
    const rot = structured<{
      type: string;
      nokler: string[];
      neste: string | null;
      totalt: number;
    }>(await kall("data_nokler", { sti: "" }));
    expect(rot).toEqual({
      sti: "",
      type: "node",
      nokler: ["budget", "mealLibrary", "members", "receipts", "transaksjoner"],
      neste: null,
      totalt: 5,
    });
    const side1 = structured<{ nokler: string[]; neste: string }>(
      await kall("data_nokler", { sti: "mealLibrary", antall: 25 }),
    );
    expect(side1.nokler).toHaveLength(25);
    const side2 = structured<{ nokler: string[]; neste: null }>(
      await kall("data_nokler", { sti: "mealLibrary", antall: 25, etter: side1.neste }),
    );
    expect([...side1.nokler, ...side2.nokler]).toEqual(Object.keys(SYNTETISK.mealLibrary));
    expect(side2.neste).toBeNull();
    await client.close();
  });

  it("data_les gir hele familienoden uten tap — sidedeling, forStor og tekstdeler", async () => {
    const { client, kall } = await verktoy();
    const foer = tilstand();
    const les = async (args: Record<string, unknown>) => {
      const r = await kall("data_les", args);
      expect(r.isError).toBeFalsy();
      return structured<Awaited<ReturnType<DataLes>>>(r);
    };
    // Små sider og liten byte-grense tvinger fram alle tre mekanismene.
    const alt = await lesAlt(les, "", { antall: 3, maksBytes: 1_000 });
    expect(normaliser(alt)).toEqual(normaliser(SYNTETISK));
    expect(alt).not.toHaveProperty("hemmelig");
    expect(tilstand()).toBe(foer);
    await client.close();
  });

  it("enkeltverdi, manglende sti og ugyldig sti", async () => {
    const { client, kall } = await verktoy();
    expect(structured(await kall("data_les", { sti: "transaksjoner/0/belop" }))).toEqual({
      sti: "transaksjoner/0/belop",
      type: "verdi",
      verdi: -12.5,
    });
    expect(structured(await kall("data_les", { sti: "finnes/ikke" }))).toEqual({
      sti: "finnes/ikke",
      type: "mangler",
    });
    for (const sti of ["../familie2", "/hemmelig", "a//b", "mcp.principals"]) {
      const r = await kall("data_les", { sti });
      expect(r.isError).toBe(true);
      expect(errorPayload(r)).toMatchObject({ error: "invalid_path", retryable: false });
      expect(JSON.stringify(r)).not.toContain("Annen familie");
    }
    await client.close();
  });

  it("familien kommer kun fra koblingen; en annen families data kan ikke nås", async () => {
    const { client, kall } = await verktoy();
    const r = await kall("data_les", { sti: "hemmelig", familyId: "familie2" });
    expect(structured(r)).toEqual({ sti: "hemmelig", type: "mangler" });
    expect(
      JSON.stringify(await kall("data_nokler", { sti: "", familyId: "familie2" })),
    ).not.toContain("hemmelig");
    await client.close();
  });

  it("uten data:read: insufficient_scope med utfordring, og ingen data", async () => {
    const { client, kall } = await verktoy("shopping:read forvaltning:read");
    for (const name of ["data_les", "data_nokler"]) {
      const r = await kall(name, { sti: "" });
      expect(r.isError).toBe(true);
      expect(errorPayload(r)).toMatchObject({ error: "insufficient_scope" });
      expect(JSON.stringify(r._meta)).toContain('scope=\\"data:read\\"');
      expect(JSON.stringify(r)).not.toMatch(/transaksjoner|Rett 1/);
    }
    await client.close();
  });

  it("medlemskap fjernet eller kobling deaktivert: ingen data", async () => {
    const { client, kall } = await verktoy();
    store.removeMember("familie1", "uid-1");
    expect(errorPayload(await kall("data_les", { sti: "" }))).toMatchObject({
      error: "not_member",
    });
    store.addMember("familie1", "uid-1");
    store.principals.set("google-oauth2|123", {
      firebaseUid: "uid-1",
      familyId: "familie1",
      disabled: true,
    });
    expect(errorPayload(await kall("data_nokler", { sti: "" }))).toMatchObject({
      error: "link_disabled",
    });
    await client.close();
  });
});

describe("generell skriving (data_hent / data_skriv, data:write)", () => {
  beforeEach(() => {
    store.set("families/familie1", {
      members: { "uid-1": true },
      mealLibrary: { m1: { navn: "Taco" } },
      shopping: { _skriver: { app: "web-v2" }, a: { name: "Melk" } },
    });
    store.set("families/familie2", { members: { "uid-2": true }, hemmelig: "Annen familie" });
  });

  async function verktoy(scope = "data:read data:write") {
    const client = await connect(await idp.sign({ scope }));
    const kall = async (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args });
    return { client, kall };
  }

  it("data_hent → data_skriv → replay over MCP; bare egen familie endres", async () => {
    const { client, kall } = await verktoy();
    const hentet = structured<{ versjon: string; verdi: unknown }>(
      await kall("data_hent", { sti: "mealLibrary/m1" }),
    );
    expect(hentet.verdi).toEqual({ navn: "Taco" });
    const inn = {
      opId: "2026-10-30_http0001",
      ops: [{ sti: "mealLibrary/m1/navn", type: "set", verdi: "Fisketaco", forventet: "mangler" }],
    };
    // Feil forventet: konflikt med detaljer, ingenting skrevet.
    const konflikt = await kall("data_skriv", inn);
    expect(konflikt.isError).toBe(true);
    expect(errorPayload(konflikt)).toMatchObject({ error: "konflikt", retryable: false });
    expect(JSON.stringify(konflikt)).toContain("faktisk");
    expect(store.get("families/familie1/mealLibrary/m1")).toEqual({ navn: "Taco" });

    const riktig = {
      opId: "2026-10-30_http0002",
      ops: [
        {
          sti: "mealLibrary/m1",
          type: "set",
          verdi: { navn: "Fisketaco" },
          forventet: hentet.versjon,
        },
      ],
    };
    const r = structured<{ utfall: string; tilbakelesing: { ok: boolean } }>(
      await kall("data_skriv", riktig),
    );
    expect(r).toMatchObject({ utfall: "committed", tilbakelesing: { ok: true } });
    expect(store.get("families/familie1/mealLibrary/m1")).toEqual({ navn: "Fisketaco" });
    expect(structured<{ utfall: string }>(await kall("data_skriv", riktig)).utfall).toBe("replay");
    expect(store.get("families/familie2")).toEqual({
      members: { "uid-2": true },
      hemmelig: "Annen familie",
    });
    // Ingen dataverdier i serverloggen.
    expect(JSON.stringify(logLines)).not.toContain("Fisketaco");
    await client.close();
  });

  it("uten data:write: insufficient_scope med utfordring for data:write, og ingen skriving", async () => {
    const { client, kall } = await verktoy("data:read");
    const r = await kall("data_skriv", {
      opId: "2026-10-30_scope001",
      ops: [{ sti: "x", type: "set", verdi: 1, forventet: "mangler" }],
    });
    expect(errorPayload(r).error).toBe("insufficient_scope");
    expect(JSON.stringify(r._meta)).toContain('scope=\\"data:write\\"');
    expect(store.get("families/familie1/x")).toBeNull();
    await client.close();

    // data:write gir ikke lesing: data_hent krever data:read.
    const bareSkriv = await verktoy("data:write");
    const hent = await bareSkriv.kall("data_hent", { sti: "" });
    expect(errorPayload(hent).error).toBe("insufficient_scope");
    expect(JSON.stringify(hent)).not.toContain("Taco");
    await bareSkriv.client.close();
  });

  it("beskyttede felt, ugyldige stier og familyId i argumentene gir ingen skriving utenfor familien", async () => {
    const { client, kall } = await verktoy();
    const foer = JSON.stringify(store.get("families"));
    const forsok = [
      { sti: "members/inntrenger", type: "set", verdi: true, forventet: "mangler" },
      { sti: "shopping/_skriver", type: "slett", forventet: "mangler" },
      { sti: "../familie2/hemmelig", type: "set", verdi: "x", forventet: "mangler" },
    ];
    for (const [i, op] of forsok.entries()) {
      const r = await kall("data_skriv", {
        opId: `2026-10-30_vern000${i}`,
        ops: [op],
        familyId: "familie2",
      });
      expect(r.isError).toBe(true);
      expect(["beskyttet", "invalid_path"]).toContain(errorPayload(r).error);
    }
    expect(JSON.stringify(store.get("families"))).toBe(foer);
    await client.close();
  });

  it("ikke lenger medlem: not_member, ingen skriving", async () => {
    store.removeMember("familie1", "uid-1");
    const { client, kall } = await verktoy();
    const r = await kall("data_skriv", {
      opId: "2026-10-30_medlem01",
      ops: [{ sti: "x", type: "set", verdi: 1, forventet: "mangler" }],
    });
    expect(errorPayload(r).error).toBe("not_member");
    expect(store.get("families/familie1/x")).toBeNull();
    await client.close();
  });
});
