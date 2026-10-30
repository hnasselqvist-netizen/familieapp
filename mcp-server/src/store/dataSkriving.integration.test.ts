/**
 * Generell skriving (`data_hent` / `data_skriv`, #27 6509067353) mot en EKTE
 * RTDB-emulator (demo-familieapp) — aldri produksjon. Syntetiske data.
 *
 * Dekker det som bare kan bevises mot ekte RTDB:
 *  - kald Admin SDK-cache: en FERSK Admin-app (egen forbindelse) mot data
 *    seedet fra en annen forbindelse gir verken falsk `not_member`/konflikt
 *    eller ny skriving ved replay;
 *  - versjonen fra `data_hent` (`get()`) er lik den transaksjonen ser;
 *  - tapt svar etter commit + retry, opId-kollisjon, beskjæring/utløp,
 *    forelder-set/slett som berører metadata, samtidige appendringer i
 *    berørte og urørte felt, og tilbakelesing etter en nyere appendring;
 *  - alle skriveformer over ekte MCP-HTTP, familieisolasjon, scope og
 *    medlemskap.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { type Database, getDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import type { FamilyContext } from "../auth/authorize";
import { hentData, skrivData } from "../data/dataSkriving";
import type { SkriveInn, SkriveOpInn } from "../data/skriving";
import { MANGLER, versjonAv } from "../data/versjon";
import { ToolError } from "../handleliste/errors";
import { kanonisk } from "../handleliste/overgangKontroll";
import { createTestIdp, TEST_ISSUER, TEST_RESOURCE } from "../testing/tokens";
import { FirebaseAdminStore } from "./firebaseAdminStore";
import { encodeKey } from "./paths";
import type { NodeUpdater } from "./types";

const DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb";

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  throw new Error("FIREBASE_DATABASE_EMULATOR_HOST mangler — kjør via `npm run test:integration`.");
}

/** Én navngitt Admin-app per forbindelse; `seed` er «appen»/en annen klient. */
const apper: App[] = [];
function nyForbindelse(): Database {
  const app = initializeApp(
    { projectId: "demo-familieapp", databaseURL: DATABASE_URL },
    `skriv-it-${randomUUID()}`,
  );
  apper.push(app);
  return getDatabase(app);
}

let seed: Database;
const annen = `it-skriv-annen-${randomUUID()}`;
let F: string;
let ctx: FamilyContext;

const UID = "uid-s";
const SUB = `google-oauth2|it-skriv-${randomUUID()}`;
const NAA = Date.parse("2026-10-30T12:00:00Z");

const familie = () => ({
  members: { [UID]: true },
  mealLibrary: { m1: { navn: "Taco", porsjoner: 4 }, m2: { navn: "Suppe" } },
  shopping: {
    _skriver: { app: "web-v2", versjon: 1 },
    _ops: { r1: { tool: "x", at: 1 } },
    a: { id: "a", name: "Melk", amount: "1" },
  },
  transaksjoner: [{ id: "t0", belop: -12.5 }, { id: "t1" }],
  budget: { mat: 4000 },
});

beforeAll(async () => {
  seed = nyForbindelse();
  await seed
    .ref(`families/${annen}`)
    .set({ members: { "uid-x": true }, hemmelig: "Annen familie" });
});

beforeEach(async () => {
  F = `it-skriv-${randomUUID()}`;
  ctx = { familyId: F, firebaseUid: UID, idpSub: SUB, clientId: "it" };
  await seed.ref(`families/${F}`).set(familie());
});

afterAll(async () => {
  await seed.ref(`families/${annen}`).remove();
  await Promise.all(apper.map((a) => deleteApp(a)));
});

const deps = (store: FirebaseAdminStore | FirebaseAdminStoreMedKrok, logg: string[] = []) => ({
  store,
  audit: { event: (e: string) => void logg.push(e) },
  now: () => NAA,
});
const fersk = () => new FirebaseAdminStore(nyForbindelse());
const les = async (sti = "") =>
  (await seed.ref(`families/${F}${sti ? `/${sti}` : ""}`).get()).val() as unknown;
const tilstand = async () =>
  kanonisk([(await seed.ref("families").get()).val(), (await seed.ref("mcp").get()).val()]);

async function feil(p: Promise<unknown>): Promise<{ code: string; detaljer?: unknown }> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ToolError || (err as { code?: string }).code) return err as ToolError;
    throw err;
  }
  throw new Error("forventet feil");
}

/** Firebase-adapteren med en krok rundt den ekte transaksjonen (ingen fake). */
class FirebaseAdminStoreMedKrok extends FirebaseAdminStore {
  rundt: ((ekte: () => Promise<{ committed: boolean }>) => Promise<{ committed: boolean }>) | null =
    null;
  override async transactFamily(familyId: string, updater: NodeUpdater) {
    const ekte = () => super.transactFamily(familyId, updater);
    return this.rundt ? this.rundt(ekte) : ekte();
  }
}

async function settTaco(
  store: FirebaseAdminStore,
  opId = "2026-10-30_taco00001",
): Promise<SkriveInn> {
  const h = await hentData(store, ctx, "mealLibrary/m1");
  return {
    opId,
    ops: [
      {
        sti: "mealLibrary/m1/navn",
        type: "set",
        verdi: "Fisketaco",
        forventet: versjonAv((h.verdi as { navn: string }).navn),
      },
    ],
  };
}

describe("kald cache og versjonslikhet mot ekte RTDB", () => {
  it("fersk Admin-app (kald cache), data seedet fra en annen forbindelse: committer uten falsk not_member/konflikt", async () => {
    const h = await hentData(fersk(), ctx, "mealLibrary/m1");
    const r = await skrivData(deps(fersk()), ctx, {
      opId: "2026-10-30_kald00001",
      ops: [
        { sti: "mealLibrary/m1", type: "set", verdi: { navn: "Fisketaco" }, forventet: h.versjon! },
      ],
    });
    expect(r.utfall).toBe("committed");
    expect(r.tilbakelesing).toMatchObject({ ok: true });
    expect(await les("mealLibrary/m1")).toEqual({ navn: "Fisketaco" });
  });

  it("replay fra en annen fersk app: lagret kvittering, ingen ny skriving", async () => {
    const inn = await settTaco(fersk());
    await skrivData(deps(fersk()), ctx, inn);
    const etter = await tilstand();
    const r = await skrivData(deps(fersk()), ctx, inn);
    expect(r.utfall).toBe("replay");
    expect(await tilstand()).toBe(etter);
  });

  it("versjonen fra data_hent (get) er lik den transaksjonen ser — også for lister og roten", async () => {
    const store = fersk();
    const rot = await hentData(store, ctx, "");
    const liste = await hentData(store, ctx, "transaksjoner");
    expect(Array.isArray(liste.verdi)).toBe(true);
    const r = await skrivData(deps(fersk()), ctx, {
      opId: "2026-10-30_versjon01",
      ops: [
        {
          sti: "transaksjoner",
          type: "set",
          verdi: [{ id: "t0", belop: -13 }],
          forventet: liste.versjon!,
        },
      ],
    });
    expect(r.skrivinger[0]!.foer).toBe(liste.versjon);
    // Roten er endret av skrivingen; rotversjonen tar ikke med `_mcp`.
    const rotEtter = await hentData(store, ctx, "");
    expect(rotEtter.versjon).not.toBe(rot.versjon);
    expect(rotEtter.verdi).not.toHaveProperty("_mcp");
    expect(versjonAv(await les(), { rot: true })).toBe(rotEtter.versjon);
  });

  it("medlemskap fjernet fra en annen forbindelse rett før kallet: not_member, ingen skriving", async () => {
    const inn = await settTaco(fersk());
    await seed.ref(`families/${F}/members/${encodeKey(UID)}`).remove();
    const foer = await tilstand();
    expect((await feil(skrivData(deps(fersk()), ctx, inn))).code).toBe("not_member");
    expect(await tilstand()).toBe(foer);
  });
});

describe("utfall, retry og idempotens mot ekte RTDB", () => {
  it("tapt svar etter commit: kvitteringen finnes → committed; retry → replay; én skriving", async () => {
    const store = new FirebaseAdminStoreMedKrok(nyForbindelse());
    const inn = await settTaco(store);
    store.rundt = async (ekte) => {
      await ekte();
      throw new Error("Simulert tapt svar etter commit");
    };
    const logg: string[] = [];
    const r = await skrivData(deps(store, logg), ctx, inn);
    expect(r.utfall).toBe("committed");
    expect(logg).toContain("data_skriv_ukjent");
    const etter = await tilstand();
    store.rundt = null;
    expect((await skrivData(deps(store), ctx, inn)).utfall).toBe("replay");
    expect(await tilstand()).toBe(etter);
  });

  it("feil før commit: ukjent_utfall (retryable), ingenting skrevet; retry committer", async () => {
    const store = new FirebaseAdminStoreMedKrok(nyForbindelse());
    const inn = await settTaco(store);
    store.rundt = async () => {
      throw new Error("Simulert nettverksfeil før commit");
    };
    const foer = await tilstand();
    expect(await feil(skrivData(deps(store), ctx, inn))).toMatchObject({
      code: "ukjent_utfall",
      retryable: true,
    });
    expect(await tilstand()).toBe(foer);
    store.rundt = null;
    expect((await skrivData(deps(store), ctx, inn)).utfall).toBe("committed");
  });

  it("samme opId mot annet mål eller fra annen principal: idempotency_conflict, ingen skriving", async () => {
    const store = fersk();
    const inn = await settTaco(store);
    await skrivData(deps(store), ctx, inn);
    const etter = await tilstand();
    const annetMaal: SkriveInn = {
      opId: inn.opId,
      ops: [{ sti: "budget/mat", type: "set", verdi: 1, forventet: versjonAv(4000) }],
    };
    expect((await feil(skrivData(deps(store), ctx, annetMaal))).code).toBe("idempotency_conflict");
    expect((await feil(skrivData(deps(store), { ...ctx, idpSub: "annen|sub" }, inn))).code).toBe(
      "idempotency_conflict",
    );
    expect(await tilstand()).toBe(etter);
  });

  it("beskjæring og utløp: gamle kvitteringer fjernes kun i ny skriving; et beskåret opId blir aldri nytt", async () => {
    await seed.ref(`families/${F}/_mcp`).set({
      ops: {
        "2026-09-20_gammel001": { fp: "x", sub: SUB, uid: UID, client: "it", at: 1 },
        "2026-09-30_beholdes1": { fp: "y", sub: SUB, uid: UID, client: "it", at: 2 },
      },
    });
    const store = fersk();
    // Utløpt (eldre enn 30 d) — ingen skriving, ingen beskjæring.
    const foer = await tilstand();
    const gammel: SkriveInn = {
      opId: "2026-09-25_nyogsent1",
      ops: [{ sti: "x", type: "set", verdi: 1, forventet: MANGLER }],
    };
    expect((await feil(skrivData(deps(store), ctx, gammel))).code).toBe("utlopt");
    expect(await tilstand()).toBe(foer);

    await skrivData(deps(store), ctx, {
      opId: "2026-10-30_ny000001",
      ops: [{ sti: "x", type: "set", verdi: 1, forventet: MANGLER }],
    });
    const mcp = (await les("_mcp")) as { ops: Record<string, unknown>; vannmerke: string };
    expect(Object.keys(mcp.ops).sort()).toEqual(["2026-09-30_beholdes1", "2026-10-30_ny000001"]);
    expect(mcp.vannmerke).toBe("2026-09-20");
    // Det beskårne opId-et (uendret, med sin dato) er utløpt — det blir ikke en ny operasjon.
    expect(
      (
        await feil(
          skrivData(deps(store), ctx, {
            opId: "2026-09-20_gammel001",
            ops: [{ sti: "y", type: "set", verdi: 1, forventet: MANGLER }],
          }),
        )
      ).code,
    ).toBe("utlopt");
  });
});

describe("beskyttede felt og samtidige endringer mot ekte RTDB", () => {
  it("set/slett på roten og shopping bevarer members, markør, ops og tidligere kvitteringer + nøyaktig én ny", async () => {
    const store = fersk();
    const tidligere = { fp: "z", sub: SUB, uid: UID, client: "it", at: 3 };
    await seed.ref(`families/${F}/_mcp/ops/2026-10-29_tidlig001`).set(tidligere);
    const f = familie();

    const shop = await hentData(store, ctx, "shopping");
    const r1 = await skrivData(deps(store), ctx, {
      opId: "2026-10-30_shopset01",
      ops: [
        {
          sti: "shopping",
          type: "set",
          verdi: { b: { id: "b", name: "Brød" } },
          forventet: shop.versjon!,
        },
      ],
    });
    expect(r1.skrivinger[0]!.bevart).toEqual(["shopping/_skriver", "shopping/_ops"]);
    expect(await les("shopping")).toEqual({
      _skriver: f.shopping._skriver,
      _ops: f.shopping._ops,
      b: { id: "b", name: "Brød" },
    });

    const rot = await hentData(store, ctx, "");
    const r2 = await skrivData(deps(store), ctx, {
      opId: "2026-10-30_rotslett1",
      ops: [{ sti: "", type: "slett", forventet: rot.versjon! }],
    });
    expect(r2.skrivinger[0]!.bevart.sort()).toEqual([
      "_mcp",
      "members",
      "shopping/_ops",
      "shopping/_skriver",
    ]);
    const etter = (await les()) as Record<string, unknown> & {
      _mcp: { ops: Record<string, unknown> };
    };
    expect(Object.keys(etter).sort()).toEqual(["_mcp", "members", "shopping"]);
    expect(etter.members).toEqual(f.members);
    expect(etter.shopping).toEqual({ _skriver: f.shopping._skriver, _ops: f.shopping._ops });
    expect(Object.keys(etter._mcp.ops).sort()).toEqual([
      "2026-10-29_tidlig001",
      "2026-10-30_rotslett1",
      "2026-10-30_shopset01",
    ]);
    expect(etter._mcp.ops["2026-10-29_tidlig001"]).toEqual(tidligere);
    // Lagret form = `etter` i svaret; tilbakelesingen ser det samme.
    expect(r2.tilbakelesing).toEqual({
      ok: true,
      skrivinger: [{ sti: "", versjon: r2.skrivinger[0]!.etter, senereEndret: false }],
    });

    // Rot-set bevarer det samme, og replay av rot-slett skriver ikke.
    const rot2 = await hentData(store, ctx, "");
    await skrivData(deps(store), ctx, {
      opId: "2026-10-30_rotset001",
      ops: [{ sti: "", type: "set", verdi: { nytt: { a: 1 } }, forventet: rot2.versjon! }],
    });
    expect(await les("members")).toEqual(f.members);
    expect(await les("nytt")).toEqual({ a: 1 });
    const foerReplay = await tilstand();
    expect(
      (
        await skrivData(deps(store), ctx, {
          opId: "2026-10-30_rotslett1",
          ops: [{ sti: "", type: "slett", forventet: rot.versjon! }],
        })
      ).utfall,
    ).toBe("replay");
    expect(await tilstand()).toBe(foerReplay);
  });

  it("appendring i et URØRT felt etter lesing: committer, appendringen bevares", async () => {
    const store = fersk();
    const h = await hentData(store, ctx, "mealLibrary/m1");
    await seed.ref(`families/${F}/mealLibrary/m2/navn`).set("Suppe fra appen");
    await skrivData(deps(store), ctx, {
      opId: "2026-10-30_urort0001",
      ops: [
        { sti: "mealLibrary/m1", type: "set", verdi: { navn: "Fisketaco" }, forventet: h.versjon! },
      ],
    });
    expect(await les("mealLibrary")).toEqual({
      m1: { navn: "Fisketaco" },
      m2: { navn: "Suppe fra appen" },
    });
  });

  it("appendring i et BERØRT felt etter lesing: konflikt, appendringen står, ingen kvittering", async () => {
    const store = fersk();
    const h = await hentData(store, ctx, "mealLibrary/m1");
    await seed.ref(`families/${F}/mealLibrary/m1/porsjoner`).set(6);
    const e = await feil(
      skrivData(deps(store), ctx, {
        opId: "2026-10-30_berort001",
        ops: [
          {
            sti: "mealLibrary/m1",
            type: "set",
            verdi: { navn: "Fisketaco" },
            forventet: h.versjon!,
          },
        ],
      }),
    );
    expect(e.code).toBe("konflikt");
    expect(await les("mealLibrary/m1")).toEqual({ navn: "Taco", porsjoner: 6 });
    expect(await les("_mcp")).toBeNull();
  });

  it("appendring midt i transaksjonen (mellom updater-kall og commit) i berørt felt: konflikt, ikke overskrevet", async () => {
    const store = new FirebaseAdminStoreMedKrok(nyForbindelse());
    const inn = await settTaco(store);
    const app = nyForbindelse();
    store.rundt = async (ekte) => {
      // Appen skriver i samme felt idet transaksjonen starter.
      const appSkriving = app.ref(`families/${F}/mealLibrary/m1/navn`).set("Taco fra appen");
      const r = await ekte();
      await appSkriving;
      return r;
    };
    const resultat = await skrivData(deps(store), ctx, inn).then(
      (r) => r.utfall,
      (e: ToolError) => e.code,
    );
    const navn = await les("mealLibrary/m1/navn");
    // Enten kom appen først (konflikt, appens verdi står), eller vi kom først
    // og appen skrev over etterpå — aldri at vår skriving stille overskrev appens.
    if (resultat === "konflikt") expect(navn).toBe("Taco fra appen");
    else expect(resultat).toBe("committed");
    expect(navn).toBe("Taco fra appen");
  });

  it("appendring etter commit, før tilbakelesing: committed + senereEndret", async () => {
    const store = new FirebaseAdminStoreMedKrok(nyForbindelse());
    const inn = await settTaco(store);
    store.rundt = async (ekte) => {
      const r = await ekte();
      await seed.ref(`families/${F}/mealLibrary/m1/navn`).set("Endret etterpå");
      return r;
    };
    const r = await skrivData(deps(store), ctx, inn);
    expect(r.utfall).toBe("committed");
    expect(r.skrivinger[0]!.etter).toBe(versjonAv("Fisketaco"));
    expect(r.tilbakelesing).toEqual({
      ok: true,
      skrivinger: [
        { sti: "mealLibrary/m1/navn", versjon: versjonAv("Endret etterpå"), senereEndret: true },
      ],
    });
  });

  it("forelder som er en enkeltverdi erstattes ikke stille", async () => {
    await seed.ref(`families/${F}/tekst`).set("verdi");
    const foer = await tilstand();
    const e = await feil(
      skrivData(deps(fersk()), ctx, {
        opId: "2026-10-30_forelder1",
        ops: [{ sti: "tekst/barn", type: "set", verdi: 1, forventet: MANGLER }],
      }),
    );
    expect(e.code).toBe("forelder_er_verdi");
    expect(await tilstand()).toBe(foer);
  });
});

describe("alle skriveformer over ekte MCP-HTTP mot emulatoren", () => {
  let idp: Awaited<ReturnType<typeof createTestIdp>>;
  let server: Server;
  let url: string;

  beforeAll(async () => {
    idp = await createTestIdp();
    const handler = createApp({
      store: new FirebaseAdminStore(nyForbindelse()),
      resource: { resourceUrl: TEST_RESOURCE, issuer: TEST_ISSUER },
      audience: TEST_RESOURCE.href,
      getKey: idp.getKey,
      audit: { event: () => {} },
      dataWritesEnabled: true,
    });
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(async () => {
    await seed.ref(`mcp/principals/${encodeKey(SUB)}`).set({ firebaseUid: UID, familyId: F });
  });

  async function klient(scope = "data:read data:write") {
    const client = new Client({ name: "it", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: {
          headers: { Authorization: `Bearer ${await idp.sign({ scope }, { sub: SUB })}` },
        },
      }),
    );
    return client;
  }
  const svar = <T>(r: unknown) => (r as { structuredContent: T }).structuredContent;
  const feilkode = (r: unknown) =>
    (JSON.parse((r as { content: { text: string }[] }).content[0]!.text) as { error: string })
      .error;

  it("set, update, slett, nye domener og lister i ett atomisk kall; annen familie og mcp/ urørt", async () => {
    const client = await klient();
    const hent = async (sti: string) =>
      svar<{ versjon: string }>(await client.callTool({ name: "data_hent", arguments: { sti } }))
        .versjon;
    const annenFoer = kanonisk((await seed.ref(`families/${annen}`).get()).val());
    const ops: SkriveOpInn[] = [
      {
        sti: "mealLibrary/m1/navn",
        type: "set",
        verdi: "Fisketaco",
        forventet: await hent("mealLibrary/m1/navn"),
      },
      {
        sti: "budget",
        type: "update",
        verdi: { mat: 4500, klaer: 500 },
        forventet: { mat: await hent("budget/mat"), klaer: MANGLER },
      },
      { sti: "mealLibrary/m2", type: "slett", forventet: await hent("mealLibrary/m2") },
      {
        sti: "oppskrifter/r1",
        type: "set",
        verdi: { navn: "Fra bilde", ingredienser: [{ navn: "Mel", mengde: "2 dl" }], porsjoner: 4 },
        forventet: MANGLER,
      },
    ];
    const r = svar<{ utfall: string; skrivinger: unknown[] }>(
      await client.callTool({
        name: "data_skriv",
        arguments: { opId: "2026-10-30_http00001", ops },
      }),
    );
    expect(r.utfall).toBe("committed");
    expect(r.skrivinger).toHaveLength(5);
    expect(await les("mealLibrary")).toEqual({ m1: { navn: "Fisketaco", porsjoner: 4 } });
    expect(await les("budget")).toEqual({ mat: 4500, klaer: 500 });
    expect(await les("oppskrifter/r1")).toEqual({
      navn: "Fra bilde",
      ingredienser: [{ navn: "Mel", mengde: "2 dl" }],
      porsjoner: 4,
    });
    expect(kanonisk((await seed.ref(`families/${annen}`).get()).val())).toBe(annenFoer);
    await client.close();
  });

  it("ugyldige verdier, prototype-nøkler, beskyttede felt og traversering: ingen skriving", async () => {
    const client = await klient();
    const foer = await tilstand();
    const forsok: [SkriveOpInn, string][] = [
      [{ sti: "x", type: "set", verdi: { a: null }, forventet: MANGLER }, "ugyldig_skriving"],
      [{ sti: "x", type: "set", verdi: { a: {} }, forventet: MANGLER }, "ugyldig_skriving"],
      [
        { sti: "x", type: "set", verdi: JSON.parse('{"__proto__":{"p":1}}'), forventet: MANGLER },
        "ugyldig_skriving",
      ],
      [
        { sti: "x", type: "set", verdi: { constructor: 1 }, forventet: MANGLER },
        "ugyldig_skriving",
      ],
      [{ sti: "members/inntrenger", type: "set", verdi: true, forventet: MANGLER }, "beskyttet"],
      [
        {
          sti: "shopping",
          type: "set",
          verdi: { _skriver: { app: "legacy" } },
          forventet: MANGLER,
        },
        "beskyttet",
      ],
      [{ sti: "_mcp/ops", type: "slett", forventet: MANGLER }, "beskyttet"],
      [
        { sti: `../${annen}/hemmelig`, type: "set", verdi: "x", forventet: MANGLER },
        "invalid_path",
      ],
    ];
    for (const [i, [op, kode]] of forsok.entries()) {
      const r = await client.callTool({
        name: "data_skriv",
        arguments: { opId: `2026-10-30_ugyldig${String(i).padStart(2, "0")}`, ops: [op] },
      });
      expect(r.isError).toBe(true);
      expect(feilkode(r)).toBe(kode);
    }
    expect(await tilstand()).toBe(foer);
    expect(({} as Record<string, unknown>).p).toBeUndefined();
    await client.close();
  });

  it("scope og medlemskap kreves per kall", async () => {
    const lesende = await klient("data:read");
    const r = await lesende.callTool({
      name: "data_skriv",
      arguments: {
        opId: "2026-10-30_scope0001",
        ops: [{ sti: "x", type: "set", verdi: 1, forventet: MANGLER }],
      },
    });
    expect(feilkode(r)).toBe("insufficient_scope");
    await lesende.close();

    await seed.ref(`families/${F}/members/${encodeKey(UID)}`).remove();
    const tidligere = await klient();
    const nei = await tidligere.callTool({
      name: "data_skriv",
      arguments: {
        opId: "2026-10-30_medlem001",
        ops: [{ sti: "x", type: "set", verdi: 1, forventet: MANGLER }],
      },
    });
    expect(feilkode(nei)).toBe("not_member");
    expect(await les("x")).toBeNull();
    await tidligere.close();
  });
});
