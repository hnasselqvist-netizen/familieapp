/**
 * Full lesing (`data_nokler` / `data_les`, #27 6362495145) mot en EKTE
 * RTDB-emulator (demo-familieapp) — aldri produksjon. Syntetiske data.
 *
 *  1. Skrivevakten på en ekte Admin-`Database`: set/update/remove/push/
 *     transaction (m.fl.) avvises via ref, child, root, parent og
 *     spørring, og ingenting endres.
 *  2. Over ekte MCP-HTTP med Firebase-adapteren: hele familienoden leses
 *     tilbake identisk (nestede og ukjente felt, arrays, glisne arrays,
 *     lange tekster, mange barn), en annen familie kan ikke nås, scope og
 *     medlemskap kreves, og databasen er kanonisk uendret etterpå.
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
import { kanonisk } from "../handleliste/overgangKontroll";
import { type DataLes, lesAlt, normaliser } from "../testing/dataTraversering";
import { createTestIdp, TEST_ISSUER, TEST_RESOURCE } from "../testing/tokens";
import { FirebaseAdminStore } from "./firebaseAdminStore";
import { encodeKey } from "./paths";
import { SKRIVEMETODER, SkrivingAvvist, skrivebeskyttet } from "./skrivebeskyttet";

const DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb";

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  throw new Error("FIREBASE_DATABASE_EMULATOR_HOST mangler — kjør via `npm run test:integration`.");
}

let app: App;
let db: Database;
const egen = `it-data-${randomUUID()}`;
const annen = `it-data-${randomUUID()}`;
const sub = `google-oauth2|it-data-${randomUUID()}`;

const SYNTETISK = {
  members: { "uid-d": true },
  transaksjoner: [
    { id: "t0", belop: -12.5, ukjentFelt: { dypt: { liste: [1, "to", { tre: true }] } } },
    { id: "t1", korrigeringslogg: [{ handling: "merket_dublett", tidspunkt: "2026-10-01" }] },
    { id: "t2", saldoKorrigering: { type: "dublett", tidligere: { status: "behandlet" } } },
  ],
  hendelser: { 0: { id: "h0" }, 5: { id: "h5" }, 9: { id: "h9" } },
  receipts: { r1: { imageUrl: `data:image/png;base64,${"QUJD".repeat(3_000)}`, total: 99 } },
  mealLibrary: Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`m${String(i).padStart(2, "0")}`, { navn: `Rett ${i}` }]),
  ),
  budget: { "2026": { mat: 4000, "-0": "rar nøkkel", "01": true } },
  nyNodeAppenIkkeKjenner: { a: { b: { c: { d: "dypt" } } } },
};

beforeAll(async () => {
  app = initializeApp({ projectId: "demo-familieapp", databaseURL: DATABASE_URL }, "data-it");
  db = getDatabase(app);
  await db.ref(`families/${egen}`).set(SYNTETISK);
  await db.ref(`families/${annen}`).set({ members: { "uid-x": true }, hemmelig: "Annen familie" });
  await db.ref(`mcp/principals/${encodeKey(sub)}`).set({ firebaseUid: "uid-d", familyId: egen });
});

afterAll(async () => {
  await Promise.all([
    db.ref(`families/${egen}`).remove(),
    db.ref(`families/${annen}`).remove(),
    db.ref(`mcp/principals/${encodeKey(sub)}`).remove(),
  ]);
  await deleteApp(app);
});

const tilstand = async () =>
  kanonisk([
    (await db.ref(`families/${egen}`).get()).val(),
    (await db.ref(`families/${annen}`).get()).val(),
    (await db.ref(`mcp/principals/${encodeKey(sub)}`).get()).val(),
  ]);

describe("skrivevakten på en ekte Admin-Database", () => {
  it("avviser alle skrivemetoder via ref, child, root, parent og spørring; ingenting endres", async () => {
    const foer = await tilstand();
    const vakt = skrivebeskyttet(db);
    const ref = vakt.ref(`families/${egen}/transaksjoner`);
    const veier = [
      ref,
      ref.child("0"),
      ref.root,
      ref.parent!,
      ref.orderByKey().ref,
      vakt.ref(`families/${egen}`).child("transaksjoner").orderByKey().limitToFirst(1).ref,
    ];
    for (const r of veier) {
      for (const m of SKRIVEMETODER) {
        const metode = (r as unknown as Record<string, (...a: unknown[]) => unknown>)[m]!;
        expect(() => metode({ ødelagt: true })).toThrow(SkrivingAvvist);
      }
    }
    // Lesing virker gjennom den samme vakten.
    expect((await ref.child("0/id").get()).val()).toBe("t0");
    expect(await tilstand()).toBe(foer);
  });
});

describe("data_nokler / data_les over ekte MCP-HTTP mot emulatoren", () => {
  let idp: Awaited<ReturnType<typeof createTestIdp>>;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    idp = await createTestIdp();
    const handler = createApp({
      store: new FirebaseAdminStore(db),
      resource: { resourceUrl: TEST_RESOURCE, issuer: TEST_ISSUER },
      audience: TEST_RESOURCE.href,
      getKey: idp.getKey,
      audit: { event: () => {} },
    });
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  async function klient(scope = "data:read") {
    const client = new Client({ name: "it", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: {
          headers: { Authorization: `Bearer ${await idp.sign({ scope }, { sub })}` },
        },
      }),
    );
    return client;
  }

  it("data_nokler: alle toppnoder i familien, grunt", async () => {
    const client = await klient();
    const r = await client.callTool({ name: "data_nokler", arguments: { sti: "" } });
    expect(r.structuredContent).toEqual({
      sti: "",
      type: "node",
      nokler: Object.keys(SYNTETISK).sort(),
      neste: null,
      totalt: Object.keys(SYNTETISK).length,
    });
    await client.close();
  });

  it("data_les: hele familienoden leses tilbake identisk; databasen er uendret", async () => {
    const foer = await tilstand();
    const client = await klient();
    const les: DataLes = async (args) => {
      const r = await client.callTool({ name: "data_les", arguments: args });
      expect(r.isError).toBeFalsy();
      return r.structuredContent as Awaited<ReturnType<DataLes>>;
    };
    // Små sider og liten byte-grense: sidedeling, forStor og tekstdeler brukes alle.
    const alt = await lesAlt(les, "", { antall: 4, maksBytes: 2_000 });
    expect(normaliser(alt)).toEqual(normaliser((await db.ref(`families/${egen}`).get()).val()));
    expect(normaliser(alt)).toEqual(normaliser(SYNTETISK));
    expect(JSON.stringify(alt)).not.toContain("Annen familie");
    expect(await tilstand()).toBe(foer);
    await client.close();
  });

  it("en annen familie kan ikke nås; uten data:read eller medlemskap gis ingen data", async () => {
    const client = await klient();
    const r = await client.callTool({
      name: "data_les",
      arguments: { sti: "hemmelig", familyId: annen },
    });
    expect(r.structuredContent).toEqual({ sti: "hemmelig", type: "mangler" });
    const ugyldig = await client.callTool({ name: "data_les", arguments: { sti: `../${annen}` } });
    expect(ugyldig.isError).toBe(true);
    await client.close();

    const utenScope = await klient("shopping:read forvaltning:read");
    const nei = await utenScope.callTool({ name: "data_nokler", arguments: { sti: "" } });
    expect(JSON.stringify(nei)).toContain("insufficient_scope");
    expect(JSON.stringify(nei)).not.toContain("transaksjoner");
    await utenScope.close();

    await db.ref(`families/${egen}/members/uid-d`).remove();
    const tidligereMedlem = await klient();
    const ikkeMedlem = await tidligereMedlem.callTool({ name: "data_les", arguments: { sti: "" } });
    expect(JSON.stringify(ikkeMedlem)).toContain("not_member");
    expect(JSON.stringify(ikkeMedlem)).not.toContain("t0");
    await tidligereMedlem.close();
    await db.ref(`families/${egen}/members/uid-d`).set(true);
  });
});
