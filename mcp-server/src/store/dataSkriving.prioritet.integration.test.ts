/**
 * Firebase-prioriteter i generell MCP-skriving (`data_skriv`) — KARAKTERISERING
 * mot en EKTE RTDB-emulator, syntetiske data (#27, ordre 7027957835). Ingen
 * runtimeendring; rettingsgrunnlaget står i
 * `docs/arkitektur/mcp-skriving-prioriteter.md`.
 *
 * Familien seedes med prioritet på familieroten, en urørt domenenode
 * (`budget`), målposten (`mealLibrary/m1`), nøstede objekter og blader, og på
 * de beskyttede `members`, `_mcp` (et ukjent felt, en eksisterende
 * kvittering under `_mcp/ops` og `vannmerke`) og `shopping/_skriver`.
 *
 * Hva som måles (review 5987048510):
 *  - utfallet av hvert kall til den ekte `transactFamily` (`committed`);
 *  - `value`-hendelser på familien OBSERVERT fra en separat forbindelse,
 *    etter at lytterens første tilbakekall er mottatt. For en commit ventes
 *    det til minst én hendelse er observert; ellers brukes et fast
 *    observasjonsvindu. Fravær av hendelser i vinduet er en observasjon,
 *    ikke et bevis på at ingenting ble sendt;
 *  - faktisk `exportVal()` før og etter, lest fra den separate forbindelsen.
 * Hva som IKKE måles: nettverksforespørsler, updater-kjøringer eller
 * interne transaksjonsforsøk i SDK-et. Et stopp kommuniserer fortsatt med
 * serveren (lesing og transaksjonsforsøk); målingen sier bare at ingen
 * transaksjon committet og at eksporten er uendret.
 *
 * Testene beskriver dagens oppførsel og er grønne. Ønsket oppførsel etter en
 * retting er merket `it.fails`: de feiler i dag (og passerer derfor CI), og
 * må gjøres om til vanlige tester i rettings-PR-en.
 */
import { randomUUID } from "node:crypto";
import { type App, deleteApp, initializeApp } from "firebase-admin/app";
import { type Database, getDatabase } from "firebase-admin/database";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { FamilyContext } from "../auth/authorize";
import { hentData, skrivData } from "../data/dataSkriving";
import type { SkriveInn } from "../data/skriving";
import { versjonAv } from "../data/versjon";
import { FirebaseAdminStore } from "./firebaseAdminStore";
import type { NodeUpdater } from "./types";

const DATABASE_URL = "http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb";

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  throw new Error("FIREBASE_DATABASE_EMULATOR_HOST mangler — kjør via `npm run test:integration`.");
}

const apper: App[] = [];
function nyForbindelse(): Database {
  const app = initializeApp(
    { projectId: "demo-familieapp", databaseURL: DATABASE_URL },
    `prioritet-it-${randomUUID()}`,
  );
  apper.push(app);
  return getDatabase(app);
}
afterAll(async () => {
  await Promise.all(apper.map((a) => deleteApp(a)));
});

const UID = "uid-pri";
const NAA = Date.parse("2026-11-20T02:00:00Z");

/** Prioritet på alle nivåer, også urørte domener og beskyttede felt. */
const FAMILIE = () => ({
  ".priority": "rot",
  members: { ".priority": 7, [UID]: { ".value": true, ".priority": 1 } },
  _mcp: {
    ".priority": 2,
    annet: { ".value": "x", ".priority": 4 },
    vannmerke: { ".value": "2026-10-01", ".priority": 14 },
    ops: {
      ".priority": 15,
      // En eksisterende kvittering (ikke utløpt, beskjæres ikke).
      "2026-11-19_gammel01": {
        ".priority": 16,
        fp: "fp-gammel",
        sub: "sub-pri",
        uid: UID,
        client: "it",
        at: 1,
        skrivinger: { "0": { sti: "budget/mat", type: "set", foer: "a", etter: "b" } },
      },
    },
  },
  budget: { ".priority": 5, mat: { ".value": 4000, ".priority": 6 } },
  mealLibrary: {
    ".priority": "ml",
    m1: {
      ".priority": 8,
      navn: { ".value": "Taco", ".priority": 9 },
      detaljer: { ".priority": 10, a: { ".value": 1, ".priority": 11 }, b: 2 },
    },
    m2: { ".priority": 12, navn: "Suppe" },
  },
  shopping: {
    _skriver: { ".priority": 13, app: "web-v2", versjon: 1 },
    a: { id: "a", name: "Melk" },
  },
});

/** Alle prioriteter i en eksport, som sti → prioritet («/» = familieroten). */
function prioriteter(v: unknown, sti = "", ut: Record<string, unknown> = {}) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === ".priority") ut[sti || "/"] = x;
      else if (k !== ".value") prioriteter(x, `${sti}/${k}`, ut);
    }
  }
  return ut;
}

/** Den ekte Firebase-adapteren; teller utfallet av hver `transactFamily`. */
class TellendeStore extends FirebaseAdminStore {
  transaksjoner: { committed: boolean }[] = [];
  override async transactFamily(familyId: string, updater: NodeUpdater) {
    const r = await super.transactFamily(familyId, updater);
    this.transaksjoner.push(r);
    return r;
  }
}

interface Maaling {
  utfall: string[];
  transaksjoner: { committed: boolean }[];
  /** Observerte `value`-hendelser (separat forbindelse) etter lytterens første tilbakekall. */
  observerteHendelser: number;
  foer: unknown;
  etter: unknown;
}

/**
 * Seeder en ny familie, kjører `forbered` (ikke målt) og gjenoppretter da alle
 * prioritetene, og måler deretter `kall` gjennom den faktiske
 * `skrivData` → `FirebaseAdminStore.transactFamily`-veien.
 */
async function maal(
  lag: (lese: FirebaseAdminStore, ctx: FamilyContext) => Promise<SkriveInn[]>,
  valg: { forbered?: number; uid?: string } = {},
): Promise<Maaling> {
  const seed = nyForbindelse();
  const F = `it-pri-${randomUUID()}`;
  const ctx: FamilyContext = {
    familyId: F,
    firebaseUid: valg.uid ?? UID,
    idpSub: "sub-pri",
    clientId: "it",
  };
  const ref = seed.ref(`families/${F}`);
  await ref.set(FAMILIE());
  const opprinnelig = prioriteter((await ref.get()).exportVal());
  const store = new TellendeStore(nyForbindelse());
  const deps = { store, audit: { event: () => {} }, now: () => NAA };
  const kall = await lag(new FirebaseAdminStore(nyForbindelse()), { ...ctx, firebaseUid: UID });
  for (const inn of kall.slice(0, valg.forbered ?? 0)) await skrivData(deps, ctx, inn);
  for (const [sti, p] of Object.entries(opprinnelig)) {
    const r = sti === "/" ? ref : ref.child(sti.slice(1));
    if ((await r.get()).exists()) await r.setPriority(p as string | number, () => {});
  }
  store.transaksjoner = [];
  const foer = (await ref.get()).exportVal() as unknown;
  let observerteHendelser = 0;
  let klar!: () => void;
  const forste = new Promise<void>((r) => (klar = r));
  let startet = false;
  const lytter = ref.on("value", () => {
    if (!startet) {
      startet = true;
      klar();
    } else observerteHendelser += 1;
  });
  // Måleperioden starter først når lytteren har levert sin første verdi.
  await forste;
  const utfall: string[] = [];
  for (const inn of kall.slice(valg.forbered ?? 0)) {
    try {
      utfall.push((await skrivData(deps, ctx, inn)).utfall);
    } catch (e) {
      utfall.push((e as { code?: string }).code ?? String(e));
    }
  }
  if (utfall.includes("committed")) {
    // En commit skal observeres fra den separate forbindelsen.
    await vi.waitFor(() => expect(observerteHendelser).toBeGreaterThanOrEqual(1), {
      timeout: 2_000,
    });
  }
  // Fast observasjonsvindu for sene hendelser (fravær her er bare en observasjon).
  await new Promise((r) => setTimeout(r, 300));
  ref.off("value", lytter);
  const etter = (await ref.get()).exportVal() as unknown;
  return { utfall, transaksjoner: store.transaksjoner, observerteHendelser, foer, etter };
}

const navnVersjon = async (s: FirebaseAdminStore, ctx: FamilyContext, sti: string) =>
  (await hentData(s, ctx, sti)).versjon!;

const FAKTISKE: [string, (s: FirebaseAdminStore, c: FamilyContext) => Promise<SkriveInn[]>][] = [
  [
    "set på et blad",
    async (s, c) => [
      {
        opId: "2026-11-20_pset00001",
        ops: [
          {
            sti: "mealLibrary/m1/navn",
            type: "set",
            verdi: "Fisketaco",
            forventet: await navnVersjon(s, c, "mealLibrary/m1/navn"),
          },
        ],
      },
    ],
  ],
  [
    "update av et barn",
    async (s, c) => [
      {
        opId: "2026-11-20_pupd00001",
        ops: [
          {
            sti: "mealLibrary/m1",
            type: "update",
            verdi: { navn: "Ny" },
            forventet: { navn: await navnVersjon(s, c, "mealLibrary/m1/navn") },
          },
        ],
      },
    ],
  ],
  [
    "slett av en post",
    async (s, c) => [
      {
        opId: "2026-11-20_pdel00001",
        ops: [
          {
            sti: "mealLibrary/m2",
            type: "slett",
            forventet: await navnVersjon(s, c, "mealLibrary/m2"),
          },
        ],
      },
    ],
  ],
  [
    "atomisk flersti (set + slett)",
    async (s, c) => [
      {
        opId: "2026-11-20_pfle00001",
        ops: [
          {
            sti: "mealLibrary/m1/navn",
            type: "set",
            verdi: "X",
            forventet: await navnVersjon(s, c, "mealLibrary/m1/navn"),
          },
          {
            sti: "mealLibrary/m2",
            type: "slett",
            forventet: await navnVersjon(s, c, "mealLibrary/m2"),
          },
        ],
      },
    ],
  ],
];

/** Alle nøstede prioriteter i seedet (alt unntatt familieroten). */
const NOSTEDE = Object.keys(prioriteter(FAMILIE())).filter((k) => k !== "/");

describe("data_skriv: faktisk endring (karakterisering av dagens oppførsel)", () => {
  it.each(FAKTISKE)(
    "%s: ett transactFamily-kall med committed=true og observert hendelse; familierotens prioritet står, ALLE nøstede prioriteter i hele familien forsvinner — også i urørte domener og beskyttede felt",
    async (_navn, lag) => {
      const m = await maal(lag);
      expect(m.utfall).toEqual(["committed"]);
      expect(m.transaksjoner).toEqual([{ committed: true }]);
      expect(m.observerteHendelser).toBeGreaterThanOrEqual(1);
      const foer = prioriteter(m.foer);
      const etter = prioriteter(m.etter);
      expect(Object.keys(foer).sort()).toEqual(["/", ...NOSTEDE].sort());
      expect(etter).toEqual({ "/": "rot" });
      // Verdiene i urørte domener og beskyttede felt står (bare prioriteten går tapt).
      const v = m.etter as Record<string, Record<string, unknown>>;
      expect(v.budget).toEqual({ mat: 4000 });
      expect(v.members).toEqual({ [UID]: true });
      expect(v.shopping!._skriver).toEqual({ app: "web-v2", versjon: 1 });
    },
  );

  it("OBSERVERT (ikke ønsket kontrakt): `_mcp` bygges om ved commit — det ukjente feltet forsvinner med verdi; eksisterende kvittering og vannmerke beholder verdien, men mister prioriteten", async () => {
    const m = await maal(FAKTISKE[0]![1]);
    const foer = (m.foer as Record<string, Record<string, unknown>>)._mcp!;
    const mcp = (m.etter as Record<string, Record<string, unknown>>)._mcp!;
    expect(foer).toHaveProperty("annet");
    expect(Object.keys(mcp).sort()).toEqual(["ops", "vannmerke"]);
    expect(Object.keys(mcp.ops as object).sort()).toEqual([
      "2026-11-19_gammel01",
      "2026-11-20_pset00001",
    ]);
    expect(mcp.vannmerke).toBe("2026-10-01");
    expect(
      (mcp.ops as Record<string, Record<string, unknown>>)["2026-11-19_gammel01"],
    ).toMatchObject({ fp: "fp-gammel", at: 1 });
    const p = prioriteter(m.etter);
    expect(p["/_mcp"]).toBeUndefined();
    expect(p["/_mcp/vannmerke"]).toBeUndefined();
    expect(p["/_mcp/ops/2026-11-19_gammel01"]).toBeUndefined();
  });
});

describe("data_skriv: stopp committer ikke (karakterisering)", () => {
  const STOPP: [string, Parameters<typeof maal>[0], Parameters<typeof maal>[1], string][] = [
    [
      "konflikt (feil forventet versjon)",
      async () => [
        {
          opId: "2026-11-20_pkon00001",
          ops: [
            {
              sti: "mealLibrary/m1/navn",
              type: "set",
              verdi: "X",
              forventet: versjonAv("Annet"),
            },
          ],
        },
      ],
      {},
      "konflikt",
    ],
    [
      "ikke medlem",
      async (s, c) => [
        {
          opId: "2026-11-20_pikk00001",
          ops: [
            {
              sti: "mealLibrary/m1/navn",
              type: "set",
              verdi: "X",
              forventet: await navnVersjon(s, c, "mealLibrary/m1/navn"),
            },
          ],
        },
      ],
      { uid: "ikke-medlem" },
      "not_member",
    ],
    [
      "replay av en committet opId",
      async (s, c) => {
        const inn: SkriveInn = {
          opId: "2026-11-20_prep00001",
          ops: [
            {
              sti: "mealLibrary/m1/navn",
              type: "set",
              verdi: "R",
              forventet: await navnVersjon(s, c, "mealLibrary/m1/navn"),
            },
          ],
        };
        return [inn, inn];
      },
      { forbered: 1 },
      "replay",
    ],
    [
      "idempotens_konflikt (samme opId, annen payload)",
      async (s, c) => {
        const v = await navnVersjon(s, c, "mealLibrary/m1/navn");
        const op = (verdi: string) => ({
          opId: "2026-11-20_pide00001",
          ops: [{ sti: "mealLibrary/m1/navn", type: "set" as const, verdi, forventet: v }],
        });
        return [op("A"), op("B")];
      },
      { forbered: 1 },
      "idempotency_conflict",
    ],
  ];

  it.each(STOPP)(
    "%s: transactFamily gir committed=false, ingen hendelse observert i vinduet, hele eksporten med alle prioriteter står",
    async (_navn, lag, valg, forventet) => {
      const m = await maal(lag, valg);
      expect(m.utfall).toEqual([forventet]);
      expect(m.transaksjoner.length).toBeGreaterThanOrEqual(1);
      expect(m.transaksjoner.every((t) => !t.committed)).toBe(true);
      expect(m.observerteHendelser).toBe(0);
      expect(m.etter).toEqual(m.foer);
    },
  );
});

describe("ØNSKET etter retting (feiler i dag — `it.fails`)", () => {
  it.fails.each(FAKTISKE)(
    "%s: prioriteter utenfor de endrede stiene står (urørte domener, beskyttede felt, søsken og foreldre)",
    async (_navn, lag) => {
      const m = await maal(lag);
      const foer = prioriteter(m.foer);
      const etter = prioriteter(m.etter);
      for (const sti of [
        "/budget",
        "/budget/mat",
        "/members",
        "/members/uid-pri",
        "/shopping/_skriver",
        "/mealLibrary",
        "/mealLibrary/m1/detaljer",
        "/mealLibrary/m1/detaljer/a",
      ]) {
        expect(etter[sti]).toBe(foer[sti]);
      }
    },
  );

  it.fails(
    "`_mcp`: ukjente felt står med verdi og prioritet, og eksisterende kvittering, `ops` og `vannmerke` beholder prioritetene — bare den nye kvitteringen (og dokumentert beskjæring) endres",
    async () => {
      const m = await maal(FAKTISKE[0]![1]);
      const foer = prioriteter(m.foer);
      const etter = prioriteter(m.etter);
      const mcp = (m.etter as Record<string, Record<string, unknown>>)._mcp!;
      expect(mcp.annet).toEqual({ ".value": "x", ".priority": 4 });
      for (const sti of [
        "/_mcp",
        "/_mcp/annet",
        "/_mcp/vannmerke",
        "/_mcp/ops",
        "/_mcp/ops/2026-11-19_gammel01",
      ]) {
        expect(etter[sti]).toBe(foer[sti]);
      }
    },
  );
});

/**
 * Forutsetninger for rettingsforslaget (`docs/arkitektur/mcp-skriving-prioriteter.md`),
 * målt uten å endre runtime: hva SDK-et og REST-API-et faktisk tillater.
 */
describe("forutsetninger for retting (emulator)", () => {
  it("Admin SDK-transaksjon: updateren ser val()-form uten prioriteter, men en returnert verdi i eksportform (`.priority`/`.value`) lagres med prioritetene", async () => {
    const db = nyForbindelse();
    const ref = db.ref(`families/it-pri-sdk-${randomUUID()}`);
    await ref.set(FAMILIE());
    const eksport = (await ref.get()).exportVal() as Record<string, unknown>;
    let sett: unknown;
    const r = await ref.transaction(
      (naa: unknown) => {
        sett = naa;
        return naa === null ? null : { ...eksport, budget: { ".priority": 5, mat: 4100 } };
      },
      undefined,
      false,
    );
    expect(r.committed).toBe(true);
    expect(prioriteter(sett)).toEqual({});
    const etter = prioriteter((await ref.get()).exportVal());
    expect(etter["/members/uid-pri"]).toBe(1);
    expect(etter["/mealLibrary/m1/detaljer/a"]).toBe(11);
    expect(etter["/budget"]).toBe(5);
    expect(etter["/budget/mat"]).toBeUndefined();
  });

  it("RTDB-REST med Admin-legitimasjon: GET `format=export` med ETag på familieroten, PUT med `if-match` bevarer prioritetene; en mellomliggende prioritetsendring gir 412 og ingen skriving", async () => {
    const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST!;
    const F = `it-pri-rest-${randomUUID()}`;
    const seed = nyForbindelse();
    await seed.ref(`families/${F}`).set(FAMILIE());
    const url = (eksport: boolean) => {
      const u = new URL(`http://${host}/families/${F}.json`);
      u.searchParams.set("ns", "demo-familieapp-default-rtdb");
      if (eksport) u.searchParams.set("format", "export");
      return u;
    };
    const auth = { Authorization: "Bearer owner" };
    const get = await fetch(url(true), { headers: { ...auth, "X-Firebase-ETag": "true" } });
    const etag = get.headers.get("ETag")!;
    const eksport = (await get.json()) as Record<string, Record<string, unknown>>;
    const neste = {
      ...eksport,
      mealLibrary: {
        ...eksport.mealLibrary,
        m1: { ...eksport.mealLibrary!.m1!, navn: { ".value": "Fisketaco", ".priority": 9 } },
      },
    };
    // En annen klient endrer bare en prioritet: ETag-en endres, PUT avvises.
    await seed.ref(`families/${F}/budget`).setPriority(55, () => {});
    const avvist = await fetch(url(false), {
      method: "PUT",
      headers: { ...auth, "if-match": etag },
      body: JSON.stringify(neste),
    });
    expect(avvist.status).toBe(412);
    expect(prioriteter((await seed.ref(`families/${F}`).get()).exportVal())["/budget"]).toBe(55);
    // Ny runde mot fersk ETag lykkes, og alle prioriteter står.
    const get2 = await fetch(url(true), { headers: { ...auth, "X-Firebase-ETag": "true" } });
    const e2 = (await get2.json()) as Record<string, Record<string, unknown>>;
    const ok = await fetch(url(false), {
      method: "PUT",
      headers: { ...auth, "if-match": get2.headers.get("ETag")! },
      body: JSON.stringify({
        ...e2,
        mealLibrary: {
          ...e2.mealLibrary,
          m1: { ...e2.mealLibrary!.m1!, navn: { ".value": "Fisketaco", ".priority": 9 } },
        },
      }),
    });
    expect(ok.status).toBe(200);
    const etter = prioriteter((await seed.ref(`families/${F}`).get()).exportVal());
    expect(etter).toEqual({ ...prioriteter(FAMILIE()), "/budget": 55 });
    expect((await seed.ref(`families/${F}/mealLibrary/m1/navn`).get()).val()).toBe("Fisketaco");
  });
});
