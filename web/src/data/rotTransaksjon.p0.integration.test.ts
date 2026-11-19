/**
 * P0 for periodelåsing (#59, ordre 6995863821): et syntetisk forsøk som
 * reduserer usikkerheten i alternativ A i
 * `docs/arkitektur/periodelaasing-kartlegging.md`. Spørsmålet er hvordan en
 * `runTransaction` på HELE familieroten `families/{f}` oppfører seg mot de
 * eksisterende skriverne. Bare EKTE Firebase-emulator og syntetiske data.
 *
 * Hva som er produksjonskode og hva som er simulert:
 *  - **Produksjonskode:** handlelistens REST-vei med ETag/`if-match`
 *    (`skrivHandlelisteVersjonert`) og node-transaksjonen for
 *    forsoningsnodene (`transactForsoningNode`), begge gjennom appens
 *    `firebase.ts`-singleton.
 *  - **Simulert:** selve rot-transaksjonen (det finnes ingen i `web/`; den
 *    er modellert på MCP-ens `transactFamily`: vent på første rotverdi, kjør
 *    transaksjonen, avslutt lytteren). Simulert er også vanlig `set` og
 *    `update` og «urelaterte» skrivere (separate klientapper eller
 *    admin-SDK-et).
 *
 * Rekkefølgen styres deterministisk med `goOffline`/`goOnline`. En klient
 * som har lest en verdi og så går offline, regner på den gamle verdien.
 * Når den kommer tilbake, sender den skrivingen med en utdatert hash.
 *
 * Korrekthetstestene kjører alltid og er billige. Belastningsmålingene er
 * dyre og kjører bare med `P0_MAALING=1`. De logger tall og har ingen
 * bestått-grense (se resultatnotatet `docs/arkitektur/periodelaasing-p0.md`).
 */
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { type FirebaseApp, deleteApp, initializeApp as initKlient } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithCustomToken } from "firebase/auth";
import {
  type Database,
  connectDatabaseEmulator,
  getDatabase,
  goOffline,
  goOnline,
  onValue,
  ref,
  runTransaction,
  set,
  update,
} from "firebase/database";
import { type App as AdminApp, deleteApp as deleteAdmin, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { KVITTERINGER } from "@domain/shopping/handlelisteInnlegging";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import { transactForsoningNode } from "./forsoningSkriving.repository";
import { type InnleggingsBeslutning, skrivHandlelisteVersjonert } from "./shopping.repository";

if (import.meta.env.VITE_FIREBASE_USE_EMULATOR !== "true") {
  throw new Error("P0 kjører bare mot Firebase-emulatoren.");
}

const FAMILY_ID = "familie1";
/**
 * Belastningsmåling og logging av forløp: bare med `P0_MAALING=1`. Tallene
 * skrives som JSON-linjer til filen i `P0_RAPPORT` (Vitest skjuler
 * konsollutskrift fra beståtte tester).
 */
const MAALING = process.env.P0_MAALING === "1";
const logg = (o: Record<string, unknown>) => {
  const fil = process.env.P0_RAPPORT;
  if (MAALING && fil) appendFileSync(fil, `${JSON.stringify(o)}\n`);
};
const ROT = `families/${FAMILY_ID}`;

let admin: AdminApp;
let token = "";
const klienter: FirebaseApp[] = [];
/** Alle klientforbindelser og lyttere i testene: ryddes i `afterEach`, også ved feil. */
const forbindelser: Database[] = [];
const lyttere = new Set<() => void>();
const adb = () => getAdminDatabase(admin);

/** En egen klientapp (egen websocket og cache), logget inn som samme medlem. */
async function nyKlient(navn: string): Promise<Database> {
  const app = initKlient(
    {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    },
    `p0-${navn}-${randomUUID()}`,
  );
  klienter.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  await signInWithCustomToken(auth, token);
  const db = getDatabase(app);
  connectDatabaseEmulator(db, "127.0.0.1", 9000);
  forbindelser.push(db);
  return db;
}

/** Venter til klienten har en kjent verdi for stien (som `transactFamily`). */
function vent(db: Database, sti: string): Promise<() => void> {
  return new Promise((resolve, reject) => {
    // Tilbakekallet kan komme synkront (verdien er allerede i cachen), før
    // `onValue` har returnert: stoppfunksjonen hentes derfor først ved bruk.
    const boks: { stopp?: () => void } = {};
    const stopp = () => {
      boks.stopp?.();
      lyttere.delete(stopp);
    };
    lyttere.add(stopp);
    boks.stopp = onValue(
      ref(db, sti),
      () => resolve(stopp),
      (e) => reject(e),
    );
  });
}

type Rot = Record<string, unknown>;
interface RotUtfall {
  committed: boolean;
  /**
   * Antall kall til updateren, målt sikkert. Det er IKKE det samme som antall
   * sendinger over nettverket: SDK-et kan kjøre updateren på nytt lokalt
   * (ny lokal verdi) uten en tilsvarende full opplasting.
   */
  kall: number;
  ms: number;
  feil?: string;
  /** Størrelsen på verdien updateren returnerte sist (JSON, byte). */
  bytes: number;
}

/**
 * SIMULERT rot-transaksjon. Updateren legger en markør under `p0/rot` og en
 * post i `transaksjoner`, og bevarer resten av roten urørt. Det er det
 * minste en vernet skriving i alternativ A gjør.
 */
async function rotSkriv(db: Database, markor: string, vedKall?: (n: number) => void) {
  const stopp = await vent(db, ROT);
  let kall = 0;
  let bytes = 0;
  const t0 = performance.now();
  try {
    const r = await runTransaction(
      ref(db, ROT),
      (cur: unknown) => {
        kall += 1;
        vedKall?.(kall);
        // Ukjent rot: avbryt (`undefined`). `null` ville slettet hele familien.
        if (cur === null || typeof cur !== "object") return undefined;
        const rot = { ...(cur as Rot) };
        const p0 = { ...((rot.p0 as Rot | undefined) ?? {}) };
        p0.rot = { ...((p0.rot as Rot | undefined) ?? {}), [markor]: true };
        rot.p0 = p0;
        const liste = Array.isArray(rot.transaksjoner)
          ? [...(rot.transaksjoner as unknown[])]
          : Object.values((rot.transaksjoner as Rot | undefined) ?? {});
        rot.transaksjoner = [...liste, { id: `rot-${markor}`, kilde: "rot" }];
        bytes = Buffer.byteLength(JSON.stringify(rot));
        return rot;
      },
      { applyLocally: false },
    );
    return { committed: r.committed, kall, ms: performance.now() - t0, bytes } satisfies RotUtfall;
  } catch (e) {
    return {
      committed: false,
      kall,
      ms: performance.now() - t0,
      bytes,
      feil: e instanceof Error ? e.message : String(e),
    } satisfies RotUtfall;
  } finally {
    stopp();
  }
}

/** PRODUKSJONSKODE: node-transaksjon på `transaksjoner` (helnode-array). */
const nodeSkriv = (markor: string) =>
  transactForsoningNode<{ id: string; kilde: string }>(FAMILY_ID, "transaksjoner", (prev) => [
    ...prev,
    { id: `node-${markor}`, kilde: "node" },
  ]);

/** PRODUKSJONSKODE: handlelistens REST-skriving med ETag og `if-match`. */
const restSkriv = (markor: string) =>
  skrivHandlelisteVersjonert(
    FAMILY_ID,
    KVITTERINGER,
    (): InnleggingsBeslutning => ({
      utfall: "anvendt",
      endringer: { [`rest-${markor}`]: { name: `Vare ${markor}`, amount: "1", done: false } },
      kvittering: { opId: `op-${markor}`, verdi: { at: 1 } },
    }),
    { fristMs: 10_000 },
  );

/** Antall forekomster av en id i `transaksjoner` på serveren. */
async function forekomster(id: string): Promise<number> {
  const v = (await adb().ref(`${ROT}/transaksjoner`).get()).val() as unknown;
  const liste = Array.isArray(v) ? v : Object.values((v as Rot | null) ?? {});
  return liste.filter((t) => (t as { id?: string } | null)?.id === id).length;
}

async function startRot(ekstra: Rot = {}) {
  const members = (await adb().ref(`${ROT}/members`).get()).val() as Rot;
  await adb()
    .ref(ROT)
    .set({
      members,
      transaksjoner: [{ id: "t0", kilde: "start" }],
      shopping: { s0: { name: "Melk", amount: "1", done: false } },
      meals: { uke: { man: { name: "Taco" } } },
      ...ekstra,
    });
}

beforeAll(async () => {
  admin = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-p0-rot",
  );
  const uid = `test-p0-${randomUUID()}`;
  await getAdminAuth(admin).createUser({ uid });
  await adb().ref(`${ROT}/members/${uid}`).set(true);
  token = await getAdminAuth(admin).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), token);
});

afterEach(() => {
  vi.restoreAllMocks();
  // Rydd også når en assertion eller skriving feilet: ingen lytter eller
  // offline-forbindelse (med ventende skrivinger) lekker inn i neste test.
  for (const stopp of [...lyttere]) stopp();
  for (const db of [getFirebaseDatabase(), ...forbindelser]) goOnline(db);
});

afterAll(async () => {
  await adb().ref(ROT).remove();
  for (const k of klienter) await deleteApp(k);
  await deleteAdmin(admin);
});

describe("P0: rot-transaksjon mot eksisterende skrivere (emulator, syntetisk)", () => {
  it("rot leser først, node-transaksjonen (produksjon) committer imellom: roten prøver på nytt, begge poster står nøyaktig én gang", async () => {
    await startRot();
    const rotDb = await nyKlient("rot-forst");
    const stopp = await vent(rotDb, ROT); // roten er lest
    goOffline(rotDb);
    await nodeSkriv("a"); // node-transaksjonen committer mens roten har gammel verdi
    const ventende = rotSkriv(rotDb, "a");
    goOnline(rotDb);
    const r = await ventende;
    stopp();
    logg({ scenario: "rot først / node-transaksjon", rot: r });
    expect(r.committed).toBe(true);
    expect(r.kall).toBeGreaterThanOrEqual(2); // nytt forsøk mot fersk rot
    expect(await forekomster("node-a")).toBe(1);
    expect(await forekomster("rot-a")).toBe(1);
  });

  it("node-transaksjonen (produksjon) leser først, roten committer imellom: noden prøver på nytt, begge står én gang", async () => {
    await startRot();
    const db = getFirebaseDatabase();
    const stoppNode = await vent(db, `${ROT}/transaksjoner`); // noden er lest
    goOffline(db);
    let nodeKall = 0;
    const node = transactForsoningNode<{ id: string; kilde: string }>(
      FAMILY_ID,
      "transaksjoner",
      (prev) => {
        nodeKall += 1;
        return [...prev, { id: "node-b", kilde: "node" }];
      },
    );
    const rotDb = await nyKlient("node-forst");
    const r = await rotSkriv(rotDb, "b");
    goOnline(db);
    await node;
    stoppNode();
    logg({ scenario: "node først / rot", rot: r, nodeKall });
    expect(r.committed).toBe(true);
    expect(nodeKall).toBeGreaterThanOrEqual(2);
    expect(await forekomster("node-b")).toBe(1);
    expect(await forekomster("rot-b")).toBe(1);
  });

  it("REST med if-match (produksjon) committer mens roten har gammel verdi: roten prøver på nytt og bevarer REST-posten", async () => {
    await startRot();
    const rotDb = await nyKlient("rest-forst");
    const stopp = await vent(rotDb, ROT);
    goOffline(rotDb);
    expect(await restSkriv("c")).toEqual({ utfall: "anvendt" });
    const ventende = rotSkriv(rotDb, "c");
    goOnline(rotDb);
    const r = await ventende;
    stopp();
    logg({ scenario: "REST først / rot", rot: r });
    expect(r.committed).toBe(true);
    expect(r.kall).toBeGreaterThanOrEqual(2);
    const shopping = (await adb().ref(`${ROT}/shopping`).get()).val() as Rot;
    expect(shopping["rest-c"]).toMatchObject({ name: "Vare c" });
    expect(Object.keys((shopping[KVITTERINGER] as Rot) ?? {})).toEqual(["op-c"]);
    expect(await forekomster("rot-c")).toBe(1);
  });

  it("REST (produksjon) har lest med ETag, roten committer imellom uten å endre handlelisten: PUT godtas, ingen ny runde", async () => {
    await startRot();
    const rotDb = await nyKlient("rest-etag");
    const ekte = globalThis.fetch;
    const kall: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const m = init?.method ?? "GET";
      if (String(input).includes("/shopping.json")) kall.push(m);
      if (m === "PUT" && String(input).includes("/shopping.json") && kall.length === 2) {
        // Roten skriver hele familien (med uendret handleliste) før PUT-en sendes.
        expect((await rotSkriv(rotDb, "d")).committed).toBe(true);
      }
      return ekte(input, init);
    });
    expect(await restSkriv("d")).toEqual({ utfall: "anvendt" });
    logg({ scenario: "REST lest / rot uten handlelisteendring", restKall: kall });
    expect(kall).toEqual(["GET", "PUT"]);
    const shopping = (await adb().ref(`${ROT}/shopping`).get()).val() as Rot;
    expect(shopping["rest-d"]).toBeDefined();
    expect(await forekomster("rot-d")).toBe(1);
  });

  it("REST (produksjon) har lest med ETag, roten endrer handlelisten imellom: PUT får 412, ny runde, begge endringer står", async () => {
    await startRot();
    const rotDb = await nyKlient("rest-412");
    const ekte = globalThis.fetch;
    const kall: string[] = [];
    const status: number[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const m = init?.method ?? "GET";
      const erShopping = String(input).includes("/shopping.json");
      if (erShopping) kall.push(m);
      if (m === "PUT" && erShopping && kall.length === 2) {
        // En samtidig rot-skriving som også endrer handlelisten.
        const stopp = await vent(rotDb, ROT);
        await runTransaction(ref(rotDb, ROT), (cur: unknown) => {
          const rot = { ...(cur as Rot) };
          rot.shopping = { ...(rot.shopping as Rot), "rot-e": { name: "Fra roten" } };
          return rot;
        });
        stopp();
      }
      const res = await ekte(input, init);
      if (erShopping && m === "PUT") status.push(res.status);
      return res;
    });
    expect(await restSkriv("e")).toEqual({ utfall: "anvendt" });
    logg({ scenario: "REST lest / rot endrer handlelisten", restKall: kall, putStatus: status });
    expect(status).toEqual([412, 200]);
    const shopping = (await adb().ref(`${ROT}/shopping`).get()).val() as Rot;
    expect(shopping["rest-e"]).toBeDefined();
    expect(shopping["rot-e"]).toBeDefined();
  });

  it("vanlig set/update (simulert) committer mens roten har gammel verdi: roten prøver på nytt og bevarer dem", async () => {
    await startRot();
    const rotDb = await nyKlient("set-forst");
    const annen = await nyKlient("set-skriver");
    const stopp = await vent(rotDb, ROT);
    goOffline(rotDb);
    await set(ref(annen, `${ROT}/meals/uke/tir`), { name: "Suppe" });
    await update(ref(annen, `${ROT}/p0`), { "upd/f": true });
    const ventende = rotSkriv(rotDb, "f");
    goOnline(rotDb);
    const r = await ventende;
    stopp();
    logg({ scenario: "set/update først / rot", rot: r });
    expect(r.committed).toBe(true);
    expect(r.kall).toBeGreaterThanOrEqual(2);
    const rot = (await adb().ref(ROT).get()).val() as Rot;
    expect((rot.meals as { uke: Rot }).uke.tir).toEqual({ name: "Suppe" });
    expect(((rot.p0 as Rot).upd as Rot).f).toBe(true);
    expect(((rot.p0 as Rot).rot as Rot).f).toBe(true);
  });

  it("vanlig set (simulert) sendt fra en klient som var offline mens roten committet: blind skriving vinner på sin sti, roten står ellers", async () => {
    await startRot();
    const annen = await nyKlient("set-etter");
    await vent(annen, ROT);
    goOffline(annen);
    const sen = set(ref(annen, `${ROT}/p0/rot/g`), "overskrevet");
    const rotDb = await nyKlient("set-etter-rot");
    expect((await rotSkriv(rotDb, "g")).committed).toBe(true);
    goOnline(annen);
    await sen;
    const rot = (await adb().ref(ROT).get()).val() as Rot;
    // `set` har ingen versjonsbetingelse: den overskriver rotens verdi på
    // samme sti uten konflikt. Det er dagens semantikk, ikke en ny feil.
    expect(((rot.p0 as Rot).rot as Rot).g).toBe("overskrevet");
    expect(await forekomster("rot-g")).toBe(1);
  });

  it("urelaterte samtidige skrivinger (simulert, annen klient) committer mens roten har gammel verdi: roten tar nytt updater-kall, ingen tapt eller doblet skriving", async () => {
    await startRot();
    const rotDb = await nyKlient("urelatert-rot");
    const annen = await nyKlient("urelatert-skriver");
    const stopp = await vent(rotDb, ROT);
    goOffline(rotDb);
    let rotStartet = false;
    const ventende = rotSkriv(rotDb, "h", () => {
      rotStartet = true;
    });
    await vi.waitFor(() => expect(rotStartet).toBe(true)); // første updater-kall mot gammel rot
    // Tre urelaterte skrivinger, alle awaitet: de er på serveren før roten sender.
    await Promise.all(
      [1, 2, 3].map((n) => set(ref(annen, `${ROT}/meals/uke/u${n}`), { name: `Rett ${n}` })),
    );
    goOnline(rotDb);
    const r = await ventende;
    stopp();
    logg({ scenario: "urelaterte under rot", rot: r, urelaterte: 3 });
    expect(r.committed).toBe(true);
    expect(r.kall).toBeGreaterThanOrEqual(2);
    const meals = (await adb().ref(`${ROT}/meals/uke`).get()).val() as Rot;
    for (const n of [1, 2, 3]) expect(meals[`u${n}`]).toEqual({ name: `Rett ${n}` });
    expect(await forekomster("rot-h")).toBe(1);
  });

  it("vanlig update (simulert) sendt fra en klient som var offline mens roten committet: oppdaterer bare sine barn, roten står", async () => {
    await startRot();
    const annen = await nyKlient("update-etter");
    const stopp = await vent(annen, ROT);
    goOffline(annen);
    const sen = update(ref(annen, `${ROT}/p0`), { "upd/i": true, "rot/i": "overskrevet" });
    const rotDb = await nyKlient("update-etter-rot");
    const r = await rotSkriv(rotDb, "i");
    goOnline(annen);
    await sen;
    stopp();
    logg({ scenario: "update etter rot (annen klient)", rot: r });
    expect(r.committed).toBe(true);
    const p0 = ((await adb().ref(`${ROT}/p0`).get()).val() ?? {}) as Rot;
    expect((p0.upd as Rot).i).toBe(true);
    // Som `set`: `update` har ingen versjonsbetingelse og vinner på sine egne barnestier.
    expect((p0.rot as Rot).i).toBe("overskrevet");
    expect(await forekomster("rot-i")).toBe(1);
  });
});

/** Utfallet av et løfte som kan avvises: ingen feil skjules. */
async function utfall(p: Promise<unknown>): Promise<{ ok: true } | { ok: false; feil: string }> {
  try {
    await p;
    return { ok: true };
  } catch (e) {
    return { ok: false, feil: e instanceof Error ? e.message : String(e) };
  }
}

/** Serverens faktiske tilstand for markørene i ett forløp (admin-lesing). */
async function server(markor: string) {
  const rot = (await adb().ref(ROT).get()).val() as Rot;
  const p0 = (rot.p0 as Rot | undefined) ?? {};
  return {
    rotMarkor: ((p0.rot as Rot | undefined) ?? {})[markor] === true,
    rotPost: await forekomster(`rot-${markor}`),
    nodePost: await forekomster(`node-${markor}`),
    set: ((rot.meals as { uke?: Rot } | undefined)?.uke ?? {})[`set-${markor}`] ?? null,
    update: ((p0.upd as Rot | undefined) ?? {})[markor] ?? null,
  };
}

/**
 * Samme `Database`-instans (appens singleton), slik én React-klient ville
 * hatt både rot-transaksjonen og de eksisterende skriverne. Klienten er
 * offline mens begge operasjonene startes, så rekkefølgen er deterministisk.
 * Ingenting sendes før `goOnline`.
 */
describe("P0: samme Database-instans (én klient): rot-transaksjon og eksisterende skrivere", () => {
  type Annen = "set" | "update" | "node";
  const annenSkriv = (db: Database, hva: Annen, markor: string): Promise<unknown> =>
    hva === "set"
      ? set(ref(db, `${ROT}/meals/uke/set-${markor}`), { name: "Suppe" })
      : hva === "update"
        ? update(ref(db, `${ROT}/p0`), { [`upd/${markor}`]: true })
        : nodeSkriv(markor); // PRODUKSJONSKODE

  async function forlop(
    rekkefolge: "rot-forst" | "annen-forst",
    hva: Annen,
    markor: string,
    konkurrent: boolean,
  ) {
    await startRot();
    const db = getFirebaseDatabase();
    // En annen klient (separat forbindelse) som endrer roten mens denne er offline.
    const fremmed = konkurrent ? await nyKlient(`fremmed-${markor}`) : null;
    const stopp = await vent(db, ROT);
    goOffline(db);
    try {
      let rotStartet = false;
      let rot: Promise<RotUtfall>;
      let annen: Promise<unknown>;
      if (rekkefolge === "rot-forst") {
        rot = rotSkriv(db, markor, () => {
          rotStartet = true;
        });
        await vi.waitFor(() => expect(rotStartet).toBe(true));
        annen = annenSkriv(db, hva, markor);
      } else {
        annen = annenSkriv(db, hva, markor);
        rot = rotSkriv(db, markor, () => {
          rotStartet = true;
        });
        await vi.waitFor(() => expect(rotStartet).toBe(true));
      }
      const annenUtfall = utfall(annen);
      if (fremmed) await set(ref(fremmed, `${ROT}/meals/uke/fremmed-${markor}`), { name: "Annen" });
      goOnline(db);
      const r = await rot;
      const a = await annenUtfall;
      const s = await server(markor);
      logg({
        scenario: `samme instans: ${rekkefolge} / ${hva}${konkurrent ? " / konkurrent" : ""}`,
        rot: r,
        annen: a,
        server: s,
      });
      return { rot: r, annen: a, server: s };
    } finally {
      goOnline(db);
      stopp();
    }
  }

  it.each<["rot-forst" | "annen-forst", Annen, boolean]>([
    ["rot-forst", "set", false],
    ["rot-forst", "update", false],
    ["rot-forst", "node", false],
    ["annen-forst", "set", false],
    ["annen-forst", "update", false],
    ["annen-forst", "node", false],
    ["rot-forst", "set", true],
    ["rot-forst", "update", true],
    ["rot-forst", "node", true],
    ["annen-forst", "set", true],
    ["annen-forst", "update", true],
    ["annen-forst", "node", true],
  ])(
    "%s / %s, konkurrent %s: terminalt utfall og faktisk servertilstand",
    async (rekkefolge, hva, konkurrent) => {
      const markor = `${rekkefolge}-${hva}-${konkurrent ? "k" : "u"}`;
      const { rot, annen, server: s } = await forlop(rekkefolge, hva, markor, konkurrent);
      // Ingen dobbel skriving, og serveren samsvarer med det klienten fikk vite.
      expect(s.rotPost).toBe(rot.committed ? 1 : 0);
      expect(s.rotMarkor).toBe(rot.committed);
      if (hva === "node") expect(s.nodePost).toBe(annen.ok ? 1 : 0);
      if (hva === "set") expect(s.set !== null).toBe(annen.ok);
      if (hva === "update") expect(s.update !== null).toBe(annen.ok);
      // Den andre skrivingen lykkes i alle forløpene.
      expect(annen).toEqual({ ok: true });
      if (konkurrent && rekkefolge === "rot-forst" && hva !== "node") {
        // FUNN: en `set`/`update` på en barnesti i SAMME klient mens rot-
        // transaksjonen er sendt, merker roten for avbrudd. Når serveren så
        // avviser rotens skriving som utdatert (en annen klient har endret
        // roten), kjøres den ikke på nytt, men avbrytes av SDK-et med «set».
        // Ingenting fra roten er skrevet.
        expect(rot).toMatchObject({ committed: false, feil: "set" });
      } else {
        // Uten konkurrent godtar serveren rotens første sending. Med
        // konkurrent tar roten et nytt updater-kall og committer.
        expect(rot.committed).toBe(true);
        expect(rot.kall).toBe(konkurrent ? 2 : 1);
      }
    },
  );
});

// ── Belastningsmåling (bare med P0_MAALING=1): tall, ingen bestått-grense ──

/** Syntetisk fyll: `n` byte fordelt på poster, eventuelt med base64-lignende «kvitteringer». */
function fyll(bytes: number, base64: boolean): Rot {
  const ut: Rot = {};
  const post = base64 ? 200_000 : 2_000;
  const antall = Math.max(1, Math.round(bytes / post));
  const tekst = "x".repeat(post - 50);
  for (let i = 0; i < antall; i += 1)
    ut[`f${i}`] = base64 ? { imageUrl: `data:image/jpeg;base64,${tekst}` } : { t: tekst };
  return ut;
}

describe.runIf(MAALING)("P0-måling: rot-transaksjoner under samtidig skriving", () => {
  // Få, begrunnede eksempler (ingen obligatorisk matrise): en liten og en stor
  // rot (med base64-«kvitteringer», som eldre Bankimport-opplastinger), et
  // aggressivt skrivetempo (hvert 50. ms per skriver) og et roligere (hvert
  // sekund), og en grunnlinje uten andre skrivere.
  const SCENARIER: { mb: number; base64: boolean; skrivere: number; intervallMs: number }[] = [
    { mb: 1, base64: false, skrivere: 2, intervallMs: 50 },
    { mb: 1, base64: false, skrivere: 5, intervallMs: 50 },
    { mb: 10, base64: true, skrivere: 0, intervallMs: 1000 },
    { mb: 10, base64: true, skrivere: 2, intervallMs: 1000 },
    { mb: 10, base64: true, skrivere: 2, intervallMs: 50 },
    { mb: 10, base64: true, skrivere: 5, intervallMs: 50 },
  ];

  it.each(SCENARIER)(
    "rot $mb MB (base64: $base64), $skrivere samtidige skrivere hvert $intervallMs ms",
    { timeout: 600_000 },
    async ({ mb, base64, skrivere, intervallMs }) => {
      await startRot({ fyll: fyll(mb * 1_000_000, base64) });
      const rotDb = await nyKlient(`maal-rot-${mb}-${skrivere}`);
      const andre = await Promise.all(
        Array.from({ length: skrivere }, (_, i) => nyKlient(`maal-${mb}-${skrivere}-${i}`)),
      );
      // Urelaterte skrivere (simulert): hver skriver en liten post per intervall.
      let aktiv = true;
      const sendt: string[] = [];
      const skriverLop = andre.map(async (db, i) => {
        let n = 0;
        while (aktiv) {
          const k = `w${i}-${n}`;
          sendt.push(k);
          await set(ref(db, `${ROT}/meals/last/${k}`), n);
          n += 1;
          await new Promise((r) => setTimeout(r, intervallMs));
        }
      });
      const resultater: RotUtfall[] = [];
      for (let i = 0; i < 5; i += 1)
        resultater.push(await rotSkriv(rotDb, `m${mb}-${skrivere}-${intervallMs}-${i}`));
      aktiv = false;
      await Promise.all(skriverLop);

      const meals = (await adb().ref(`${ROT}/meals/last`).get()).val() as Rot;
      const tapt = sendt.filter((k) => meals?.[k] === undefined);
      const rotDoble = await Promise.all(
        resultater.map((_, i) => forekomster(`rot-m${mb}-${skrivere}-${intervallMs}-${i}`)),
      );
      // Rapport for resultatnotatet.
      logg({
        scenario: { mb, base64, skrivere, intervallMs },
        rotTransaksjoner: resultater.map((r) => ({
          committed: r.committed,
          kall: r.kall,
          ms: Math.round(r.ms),
          feil: r.feil ?? null,
          rotBytes: r.bytes,
        })),
        // Grov beregningsproxy, ikke målt overføring: kall × størrelsen på
        // siste returnerte verdi. Beviser ikke overført eller forsøkt opplasting.
        proxyKallGangerRotMB: Number(
          (resultater.reduce((s, r) => s + r.kall * r.bytes, 0) / 1_000_000).toFixed(1),
        ),
        urelaterteSendt: sendt.length,
        urelaterteTapt: tapt.length,
        rotForekomster: rotDoble,
      });
      expect(tapt).toEqual([]);
      for (let i = 0; i < resultater.length; i += 1) {
        expect(rotDoble[i]).toBe(resultater[i]!.committed ? 1 : 0);
      }
    },
  );
});
