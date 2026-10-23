/**
 * `handleliste-overgang` mot RTDB-emulatoren (aldri produksjon), ADR 0003
 * (forslag) og #77 review 6356624432 pkt. 3. Den ekte admin-adapteren kjøres
 * med KALD cache (ny app per operasjon), og den bygde CLI-en kjøres som egen
 * prosess. Dekker manglende/array/ugyldig node, avvikende markør, retry,
 * byte-lik bevaring av alle andre rådata, fjerning og samtidig skriving.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { type Database, getDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shoppingPath } from "../store/paths";
import {
  HANDLELISTE_MARKOR,
  kanonisk,
  kjorMarkor,
  kontrollerHandleliste,
} from "./handlelisteOvergang";
import { overgangDb } from "./handlelisteOvergangAdapter";

const DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb";
const ROOT = path.resolve(import.meta.dirname, "../..");
const M = { ...HANDLELISTE_MARKOR };
const OPS = { r1: { tool: "shopping_list_add_items", at: 1, result: ["melk"] } };
const MELK = {
  id: "melk",
  name: "Melk",
  amount: "1",
  cat: "Meieri",
  done: false,
  ukjent: { a: [1, 2] },
};

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  throw new Error("FIREBASE_DATABASE_EMULATOR_HOST mangler — kjør via `npm run test:integration`.");
}

let app: App;
let db: Database;
const familier: string[] = [];
const nyFamilie = () => {
  const f = `it-overgang-${randomUUID()}`;
  familier.push(f);
  return f;
};

/** Ny admin-app per operasjon: transaksjonen starter alltid med kald cache. */
async function kald<T>(fn: (d: Database) => Promise<T>): Promise<T> {
  const a = initializeApp(
    { projectId: "demo-familieapp", databaseURL: DATABASE_URL },
    `kald-${randomUUID()}`,
  );
  try {
    return await fn(getDatabase(a));
  } finally {
    await deleteApp(a);
  }
}
const markor = (familyId: string, modus: "sett" | "fjern", forventetDigest?: string) =>
  kald((d) => kjorMarkor(overgangDb(d), { familyId, modus, apply: true, forventetDigest }));
const les = async (f: string) => (await db.ref(shoppingPath(f)).get()).val() as unknown;
const utenMarkor = (v: unknown) =>
  kanonisk(
    Object.fromEntries(
      Object.entries((v ?? {}) as Record<string, unknown>).filter(([k]) => k !== "_skriver"),
    ),
  );

function cli(args: string[], env: Record<string, string | undefined> = {}) {
  return spawnSync("node", ["dist/handleliste-overgang.js", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FIREBASE_DATABASE_URL: DATABASE_URL,
      MCP_ALLOW_PRODUCTION_DATA: undefined,
      ...env,
    },
  });
}

beforeAll(() => {
  execFileSync("npm", ["run", "--silent", "build:admin"], { cwd: ROOT, stdio: "ignore" });
  app = initializeApp({ projectId: "demo-familieapp", databaseURL: DATABASE_URL }, "overgang-it");
  db = getDatabase(app);
});

afterAll(async () => {
  await Promise.all(familier.map((f) => db.ref(`families/${f}`).remove()));
  await deleteApp(app);
});

describe("markørsteg med ekte admin-transaksjon (kald cache)", () => {
  it("setter markøren; alle andre rådata er byte-like; retry gir «allerede»", async () => {
    const f = nyFamilie();
    await db.ref(shoppingPath(f)).set({ _ops: OPS, undefined: { r0: OPS.r1 }, melk: MELK });
    const foer = await les(f);
    const r = await markor(f, "sett");
    expect(r).toMatchObject({ utfall: "skriv", avvik: [] });
    const etter = (await les(f)) as Record<string, unknown>;
    expect(etter._skriver).toEqual(M);
    expect(utenMarkor(etter)).toBe(kanonisk(foer));
    expect(await markor(f, "sett")).toMatchObject({ utfall: "allerede" });
    expect(kanonisk(await les(f))).toBe(kanonisk(etter));
  });

  it("manglende node: bare markøren skrives", async () => {
    const f = nyFamilie();
    expect(await markor(f, "sett")).toMatchObject({ utfall: "skriv", avvik: [] });
    expect(await les(f)).toEqual({ _skriver: M });
  });

  it("array-node (gammel seed): postene bevares under samme nøkler", async () => {
    const f = nyFamilie();
    await db.ref(shoppingPath(f)).set([null, MELK, { ...MELK, id: 2 }]);
    const foer = await les(f);
    expect(Array.isArray(foer)).toBe(true);
    expect(await markor(f, "sett")).toMatchObject({ utfall: "skriv", avvik: [] });
    const etter = (await les(f)) as Record<string, unknown>;
    expect(Object.keys(etter).sort()).toEqual(["1", "2", "_skriver"]);
    expect(kontrollerHandleliste(etter).digestUtenMarkor).toBe(
      kontrollerHandleliste(foer).digestUtenMarkor,
    );
  });

  it("ugyldig (primitiv) node og avvikende markør nektes; ingenting endres", async () => {
    const f1 = nyFamilie();
    await db.ref(shoppingPath(f1)).set("ødelagt");
    expect(await markor(f1, "sett")).toMatchObject({ utfall: "nekt" });
    expect(await les(f1)).toBe("ødelagt");

    const f2 = nyFamilie();
    const feil = { _skriver: { versjon: "web-v2" }, melk: MELK };
    await db.ref(shoppingPath(f2)).set(feil);
    for (const modus of ["sett", "fjern"] as const) {
      expect(await markor(f2, modus)).toMatchObject({ utfall: "nekt" });
    }
    expect(await les(f2)).toEqual(feil);
  });

  it("fjern: bare nøyaktig markør; resten byte-likt; retry gir «allerede»", async () => {
    const f = nyFamilie();
    await db.ref(shoppingPath(f)).set({ _skriver: M, _ops: OPS, melk: MELK });
    const foer = await les(f);
    expect(await markor(f, "fjern")).toMatchObject({ utfall: "skriv", avvik: [] });
    const etter = await les(f);
    expect(kanonisk(etter)).toBe(utenMarkor(foer));
    expect(await markor(f, "fjern")).toMatchObject({ utfall: "allerede" });
  });

  it("legitim samtidig skriving etter kontrollen: forventet digest nekter; ingen gjenoppretting", async () => {
    const f = nyFamilie();
    await db.ref(shoppingPath(f)).set({ melk: MELK });
    const d = kontrollerHandleliste(await les(f)).digestUtenMarkor;
    await db.ref(`${shoppingPath(f)}/egg`).set({ id: "egg", name: "Egg", done: false });
    const etterSkriving = await les(f);
    expect(await markor(f, "sett", d)).toMatchObject({
      utfall: "nekt",
      grunn: expect.stringMatching(/Undersøk/),
    });
    expect(await les(f)).toEqual(etterSkriving);
  });
});

describe("CLI (bygget dist/handleliste-overgang.js)", () => {
  it("kontroll leser bare og gir tellinger uten navn", async () => {
    const f = nyFamilie();
    await db.ref(shoppingPath(f)).set({ _ops: OPS, melk: MELK });
    const foer = await les(f);
    const r = cli(["kontroll", "--family", f]);
    expect(r.status).toBe(0);
    const ut = JSON.parse(r.stdout) as { target: string; kontroll: Record<string, unknown> };
    expect(ut.target).toBe("emulator");
    expect(ut.kontroll).toMatchObject({ markor: "mangler", antallVarer: 1, antallOps: 1 });
    expect(r.stdout).not.toMatch(/Melk/);
    expect(await les(f)).toEqual(foer);
  });

  it("markor: tørrkjøring skriver ikke; --apply skriver; avvikende markør gir exit 1", async () => {
    const f = nyFamilie();
    await db.ref(shoppingPath(f)).set({ melk: MELK });
    expect(cli(["markor", "--family", f]).status).toBe(0);
    expect(((await les(f)) as Record<string, unknown>)._skriver).toBeUndefined();
    expect(cli(["markor", "--family", f, "--apply"]).status).toBe(0);
    expect(((await les(f)) as Record<string, unknown>)._skriver).toEqual(M);

    const g = nyFamilie();
    await db.ref(shoppingPath(g)).set({ _skriver: { versjon: "x" } });
    expect(cli(["markor", "--family", g, "--apply"]).status).toBe(1);
  });

  it("nekter uten emulator med mindre produksjon er eksplisitt tillatt", () => {
    const r = cli(["kontroll", "--family", "familie1"], {
      FIREBASE_DATABASE_EMULATOR_HOST: undefined,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/Nekter å koble til ekte Realtime Database/);
  });
});
