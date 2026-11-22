/**
 * Firebase-prioriteter og metadata i generell MCP-skriving (`data_skriv`) mot
 * en EKTE RTDB-emulator, syntetiske data (#27, ordre 7030773977). Skrivingen
 * går over betinget REST på familieroten (eksportform + ETag, PUT med
 * `if-match`), se `docs/arkitektur/mcp-skriving-prioriteter.md`.
 *
 * Familien seedes med prioritet på familieroten, en urørt domenenode
 * (`budget`), målposten (`mealLibrary/m1`), nøstede objekter og blader, og på
 * de beskyttede `members`, `_mcp` (et ukjent felt, en eksisterende
 * kvittering under `_mcp/ops` og `vannmerke`) og `shopping/_skriver`.
 *
 * Hva som måles:
 *  - REST-kallene mot familienoden (GET/PUT), telt i `fetch` — dette ER
 *    sendingene fra adapteren (Admin SDK-ets egne lesinger, f.eks.
 *    kvitteringsoppslag og tilbakelesing, går over SDK-forbindelsen og telles
 *    ikke her);
 *  - `value`-hendelser OBSERVERT fra en separat forbindelse, etter at
 *    lytterens første tilbakekall er mottatt (en observasjon, ikke et
 *    sendingstall);
 *  - faktisk `exportVal()` før og etter, lest fra den separate forbindelsen.
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

/** Familien en måling gjelder (REST-kall mot andre stier telles ikke). */
let maalFamilie = "";

/**
 * Teller REST-kall mot familienoden (`kall`). `foerPut` kjøres før første PUT
 * (en annen klient endrer noe mellom lesing og skriving). `mistSvar`: første
 * PUT når serveren, men svaret tapes. `holdPut`: første PUT holdes FØR den når
 * serveren, til `slippPut()`. `hengGet`: GET henger til fristen. `putStatus`:
 * første PUT besvares med denne statusen uten å nå serveren. `utenBody`:
 * første PUT når serveren, men svaret har en uleselig body.
 */
function rest(
  valg: {
    foerPut?: () => Promise<void>;
    mistSvar?: boolean;
    holdPut?: boolean;
    hengGet?: boolean;
    putStatus?: number;
    utenBody?: boolean;
  } = {},
) {
  const ekte = globalThis.fetch;
  const kall: string[] = [];
  let foer = valg.foerPut;
  let mist = valg.mistSvar ?? false;
  let hold = valg.holdPut ?? false;
  let status = valg.putStatus;
  let utenBody = valg.utenBody ?? false;
  let slipp: () => void = () => {};
  const port = new Promise<void>((r) => (slipp = r));
  let holdtSvar: Promise<Response> | null = null;
  const avbrytbar = (init?: RequestInit) =>
    new Promise<Response>((_, avvis) =>
      init?.signal?.addEventListener("abort", () =>
        avvis(new DOMException("aborted", "AbortError")),
      ),
    );
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (!String(input).includes(`/families/${maalFamilie}`)) return ekte(input, init);
    const m = init?.method ?? "GET";
    kall.push(m);
    if (m === "GET" && valg.hengGet) return avbrytbar(init);
    if (m === "PUT" && hold) {
      hold = false;
      const uten: RequestInit = { ...init };
      delete uten.signal;
      holdtSvar = port.then(() => ekte(input, uten));
      return avbrytbar(init);
    }
    if (m === "PUT" && status !== undefined) {
      const s = status;
      status = undefined;
      return new Response(JSON.stringify({ error: "syntetisk" }), { status: s });
    }
    if (m === "PUT" && foer) {
      const f = foer;
      foer = undefined;
      await f();
    }
    const res = await ekte(input, init);
    if (m === "PUT" && mist) {
      mist = false;
      throw new TypeError("Failed to fetch");
    }
    if (m === "PUT" && utenBody && res.ok) {
      utenBody = false;
      return new Response("{ikke json", { status: res.status, headers: res.headers });
    }
    return res;
  });
  return {
    kall,
    slippPut: () => {
      slipp();
      return holdtSvar!;
    },
  };
}

interface Maaling {
  utfall: string[];
  /** REST-kall mot familienoden under målingen (sendinger fra adapteren). */
  kall: string[];
  /** Observerte `value`-hendelser (separat forbindelse) etter lytterens første tilbakekall. */
  observerteHendelser: number;
  foer: unknown;
  etter: unknown;
}

/**
 * Seeder en ny familie, kjører `forbered` (ikke målt) og gjenoppretter da alle
 * prioritetene, og måler deretter `kall` gjennom den faktiske
 * `skrivData` → `FirebaseAdminStore.skrivFamilie`-veien.
 */
async function maal(
  lag: (lese: FirebaseAdminStore, ctx: FamilyContext) => Promise<SkriveInn[]>,
  valg: { forbered?: number; uid?: string; rest?: Parameters<typeof rest>[0] } = {},
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
  maalFamilie = F;
  const store = new FirebaseAdminStore(nyForbindelse());
  const deps = { store, audit: { event: () => {} }, now: () => NAA };
  const kall = await lag(new FirebaseAdminStore(nyForbindelse()), { ...ctx, firebaseUid: UID });
  for (const inn of kall.slice(0, valg.forbered ?? 0)) await skrivData(deps, ctx, inn);
  for (const [sti, p] of Object.entries(opprinnelig)) {
    const r = sti === "/" ? ref : ref.child(sti.slice(1));
    if ((await r.get()).exists()) await r.setPriority(p as string | number, () => {});
  }
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
  const r = rest(valg.rest);
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
  vi.restoreAllMocks();
  const etter = (await ref.get()).exportVal() as unknown;
  return { utfall, kall: r.kall, observerteHendelser, foer, etter };
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

/** Stier som endringen fjerner (prioriteten forsvinner med noden). */
const SLETTET: Record<string, string[]> = {
  "slett av en post": ["/mealLibrary/m2"],
  "atomisk flersti (set + slett)": ["/mealLibrary/m2"],
};

describe("data_skriv: faktisk endring bevarer prioriteter og verdier (#27 7030773977)", () => {
  it.each(FAKTISKE)(
    "%s: én GET og én PUT; alle prioriteter står — på roten, urørte domener, beskyttede felt, søsken, foreldre og endrede blader; bare slettede noder forsvinner",
    async (navn, lag) => {
      const m = await maal(lag);
      expect(m.utfall).toEqual(["committed"]);
      expect(m.kall).toEqual(["GET", "PUT"]);
      expect(m.observerteHendelser).toBeGreaterThanOrEqual(1);
      const foer = prioriteter(m.foer);
      const etter = prioriteter(m.etter);
      const slettet = SLETTET[navn] ?? [];
      const forventet = Object.fromEntries(
        Object.entries(foer).filter(([k]) => !slettet.includes(k)),
      );
      // Den nye kvitteringen har ingen prioritet; alt annet er som før.
      expect(etter).toEqual(forventet);
      const v = m.etter as Record<string, Record<string, unknown>>;
      expect(v.budget).toEqual({ ".priority": 5, mat: { ".value": 4000, ".priority": 6 } });
      expect(v.members).toEqual({ ".priority": 7, [UID]: { ".value": true, ".priority": 1 } });
    },
  );

  it("`_mcp` endres bare på navngitte stier: den nye kvitteringen legges til; ukjent felt, eksisterende kvittering, `ops` og `vannmerke` står med verdi og prioritet", async () => {
    const m = await maal(FAKTISKE[0]![1]);
    const foer = (m.foer as Record<string, Record<string, unknown>>)._mcp!;
    const mcp = (m.etter as Record<string, Record<string, unknown>>)._mcp!;
    expect(mcp.annet).toEqual({ ".value": "x", ".priority": 4 });
    expect(mcp.vannmerke).toEqual(foer.vannmerke);
    const ops = mcp.ops as Record<string, unknown>;
    expect(ops[".priority"]).toBe(15);
    expect(ops["2026-11-19_gammel01"]).toEqual(
      (foer.ops as Record<string, unknown>)["2026-11-19_gammel01"],
    );
    expect(Object.keys(ops).sort()).toEqual([
      ".priority",
      "2026-11-19_gammel01",
      "2026-11-20_pset00001",
    ]);
    expect(mcp[".priority"]).toBe(2);
  });
});

describe("data_skriv: stopp sender ingen PUT", () => {
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
    "%s: bare én GET, ingen PUT, ingen hendelse observert i vinduet, hele eksporten med alle prioriteter står",
    async (_navn, lag, valg, forventet) => {
      const m = await maal(lag, valg);
      expect(m.utfall).toEqual([forventet]);
      expect(m.kall).toEqual(["GET"]);
      expect(m.observerteHendelser).toBe(0);
      expect(m.etter).toEqual(m.foer);
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
