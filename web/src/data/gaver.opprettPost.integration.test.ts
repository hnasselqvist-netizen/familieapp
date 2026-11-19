/**
 * `opprettPost` (create-if-absent) og `registrerGaveOgAnledning` — EKTE
 * Firebase-emulator, syntetiske data (#20, ordre 7021325054).
 *
 * En eksisterende post skal aldri skrives: fersk serververdi avgjør, og hele
 * eksportformen (prioriteter på rot, objekter og blader, ukjente felt,
 * glisne nøkler) står. En manglende post opprettes atomisk; en samtidig
 * oppretting overskrives aldri. Alle REST-kall mot familienoden telles som
 * «METODE node».
 */
import { randomUUID } from "node:crypto";
import { goOffline, goOnline } from "firebase/database";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import {
  type GaveNode,
  opprettNy,
  opprettPost,
  registrerGaveOgAnledning,
  skrivIdFor,
  subscribeAnledninger,
} from "./gaver.repository";

const FAMILY_ID = "familie1";
const FAMILIE_B = "familie-b-opprett";
const FAM = `families/${FAMILY_ID}`;
const T = "2026-11-19T10:00:00.000Z";

let adminApp: AdminApp;
let token = "";
const loggInn = async () => signInWithCustomToken(getFirebaseAuth(), token);
const db = () => getAdminDatabase(adminApp);
const eksport = async (node: GaveNode, id: string, fam = FAMILY_ID) =>
  (await db().ref(`families/${fam}/${node}/${id}`).get()).exportVal() as unknown;

/** Eksisterende anledning med prioriteter overalt, ukjente felt og glisne nøkler. */
const RAA_ANLEDNING = {
  ".priority": 1,
  type: "bursdag",
  aar: 2026,
  mottakere: {
    ".priority": "m",
    p1: {
      ".priority": 5,
      budsjett: { ".priority": 6, type: "belop", belopOre: 40000 },
      x: { ".value": 1, ".priority": 2 },
    },
  },
  glisne: { "0": "a", "2": { ".value": "c", ".priority": 3 } },
  ukjent: { z: { ".value": true, ".priority": 2 } },
  versjon: 4,
  opprettet: T,
  oppdatert: T,
};

/** Det en klient ville forsøkt å opprette (et annet øyeblikksbilde). */
const NY_ANLEDNING = {
  type: "bursdag",
  aar: 2026,
  mottakere: { p1: { budsjett: { type: "belop", belopOre: 99900 } } },
  versjon: 1,
  opprettet: T,
  oppdatert: T,
};

const GAVE = (personId = "p1") => ({
  personId,
  tekst: "Bok",
  status: "gitt",
  planlagtOre: 30000,
  versjon: 1,
  opprettet: T,
  oppdatert: T,
});

const skrivIdNy = (node: GaveNode, id: string, verdi: Record<string, unknown>) => {
  const { opprettet: _o, oppdatert: _u, ...rest } = verdi;
  void _o;
  void _u;
  return skrivIdFor(node, id, "ny", rest);
};

/**
 * Teller REST-kall mot familienoden som «METODE node». `noder` begrenser
 * fangsten (feilene under) til de nodene. `foerPut`: en annen klient skriver
 * mellom lesing og første PUT. `mistSvar`: første PUT når serveren, men
 * svaret tapes. `hengGet`: GET henger til fristen. `holdPut`: første PUT
 * holdes før den når serveren, til `slippPut()`. `underGet`: kjøres før
 * første GET-svar leveres.
 */
function rest(
  valg: {
    noder?: GaveNode[];
    foerPut?: () => Promise<void>;
    mistSvar?: boolean;
    hengGet?: boolean;
    holdPut?: boolean;
    underGet?: () => Promise<void>;
  } = {},
) {
  const ekte = globalThis.fetch;
  const kall: string[] = [];
  let foer = valg.foerPut;
  let mist = valg.mistSvar ?? false;
  const heng = valg.hengGet ?? false;
  let hold = valg.holdPut ?? false;
  let under = valg.underGet;
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
    const url = String(input);
    if (!url.includes("/families/")) return ekte(input, init);
    const node = /\/families\/[^/]+\/([^/]+)\//.exec(url)?.[1] ?? "?";
    const m = init?.method ?? "GET";
    kall.push(`${m} ${node}`);
    if (valg.noder && !valg.noder.includes(node as GaveNode)) return ekte(input, init);
    if (m === "GET" && heng) return avbrytbar(init);
    if (m === "PUT" && hold) {
      hold = false;
      const uten: RequestInit = { ...init };
      delete uten.signal;
      holdtSvar = port.then(() => ekte(input, uten));
      return avbrytbar(init);
    }
    if (m === "PUT" && foer) {
      const f = foer;
      foer = undefined;
      await f();
    }
    const res = await ekte(input, init);
    if (m === "GET" && under) {
      const u = under;
      under = undefined;
      await u();
    }
    if (m === "PUT" && mist) {
      mist = false;
      throw new TypeError("Failed to fetch");
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

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "gaver-opprettpost-test-admin",
  );
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await db().ref(`${FAM}/members/${uid}`).set(true);
  await db().ref(`families/${FAMILIE_B}/members/${uid}`).set(true);
  token = await getAdminAuth(adminApp).createCustomToken(uid);
  await loggInn();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (!getFirebaseAuth().currentUser) await loggInn();
});

afterAll(async () => {
  for (const n of ["gaver", "anledninger"]) await db().ref(`${FAM}/${n}`).remove();
  await db().ref(`families/${FAMILIE_B}`).remove();
  await deleteApp(adminApp);
});

describe("opprettPost: eksisterende post skrives aldri (emulator)", () => {
  it("kald cache: fersk verdi avgjør, ingen PUT, hele eksportformen står", async () => {
    const id = `bursdag-${randomUUID()}`;
    await db().ref(`${FAM}/anledninger/${id}`).set(RAA_ANLEDNING);
    const foer = await eksport("anledninger", id);
    const r = rest();
    const ut = await opprettPost(FAMILY_ID, "anledninger", id, NY_ANLEDNING);
    expect(ut).toMatchObject({ opprettet: false, identisk: false });
    expect(ut.lagret).toMatchObject({
      mottakere: { p1: { budsjett: { belopOre: 40000 } } },
      versjon: 4,
    });
    expect(r.kall).toEqual(["GET anledninger"]);
    expect(await eksport("anledninger", id)).toEqual(foer);
  });

  it("utdatert cache (abonnement så ingen post, klienten frakoblet): serverens post står, ingen PUT", async () => {
    const id = `bursdag-${randomUUID()}`;
    let sett = 0;
    const av = subscribeAnledninger(FAMILY_ID, () => (sett += 1));
    await vi.waitFor(() => expect(sett).toBeGreaterThan(0));
    goOffline(getFirebaseDatabase());
    try {
      await db().ref(`${FAM}/anledninger/${id}`).set(RAA_ANLEDNING);
      const foer = await eksport("anledninger", id);
      const r = rest();
      const ut = await opprettPost(FAMILY_ID, "anledninger", id, NY_ANLEDNING);
      expect(ut.opprettet).toBe(false);
      expect(r.kall).toEqual(["GET anledninger"]);
      expect(await eksport("anledninger", id)).toEqual(foer);
    } finally {
      goOnline(getFirebaseDatabase());
      av();
    }
  });

  it("replay (egen oppretting lagret): identisk, ingen PUT, eksporten står", async () => {
    const id = `g-${randomUUID()}`;
    await db()
      .ref(`${FAM}/gaver/${id}`)
      .set({ ".priority": 2, ...GAVE(), sisteSkriving: skrivIdNy("gaver", id, GAVE()) });
    const foer = await eksport("gaver", id);
    const r = rest();
    await expect(opprettNy(FAMILY_ID, "gaver", id, GAVE())).resolves.toBe("allerede");
    expect(r.kall).toEqual(["GET gaver"]);
    expect(await eksport("gaver", id)).toEqual(foer);
  });
});

describe("opprettPost: manglende post opprettes atomisk (emulator)", () => {
  it("oppretter på eksakt sti med skrivId; ny gave gir «lagret», endret innhold etterpå gir konflikt", async () => {
    const id = `g-${randomUUID()}`;
    const r = rest();
    await expect(opprettNy(FAMILY_ID, "gaver", id, GAVE())).resolves.toBe("lagret");
    expect(r.kall).toEqual(["GET gaver", "PUT gaver"]);
    expect(await eksport("gaver", id)).toEqual({
      ...GAVE(),
      sisteSkriving: skrivIdNy("gaver", id, GAVE()),
    });
    await expect(opprettNy(FAMILY_ID, "gaver", id, GAVE("p2"))).rejects.toMatchObject({
      name: "EndretAvAndre",
      tidligereUkjent: false,
    });
  });

  it("samtidig annen oppretting mellom lesing og skriving: 412, vinneren leses og står uendret", async () => {
    const id = `bursdag-${randomUUID()}`;
    const r = rest({
      foerPut: async () => {
        await db().ref(`${FAM}/anledninger/${id}`).set(RAA_ANLEDNING);
      },
    });
    const ut = await opprettPost(FAMILY_ID, "anledninger", id, NY_ANLEDNING);
    expect(ut).toMatchObject({ opprettet: false, identisk: false });
    expect(ut.lagret).toMatchObject({ versjon: 4 });
    expect(r.kall).toEqual(["GET anledninger", "PUT anledninger", "GET anledninger"]);
    // Vinnerens eksport er nøyaktig det den andre klienten skrev (kanonisk form via samme set).
    await db().ref(`${FAM}/anledninger/tmp-${id}`).set(RAA_ANLEDNING);
    expect(await eksport("anledninger", id)).toEqual(await eksport("anledninger", `tmp-${id}`));
  });
});

describe("opprettPost: frist, sesjon, familie og ukjent utfall (emulator)", () => {
  it("lesingen henger: ikke lagret, ingenting opprettet", async () => {
    const id = `g-${randomUUID()}`;
    const r = rest({ hengGet: true });
    await expect(
      opprettPost(FAMILY_ID, "gaver", id, GAVE(), { fristMs: 300 }),
    ).rejects.toMatchObject({ name: "EndringIkkeLagret" });
    expect(r.kall).toEqual(["GET gaver"]);
    expect(await eksport("gaver", id)).toBeNull();
  });

  it("tapt svar på PUT: ukjent; retry finner egen oppretting («allerede»)", async () => {
    const id = `g-${randomUUID()}`;
    rest({ mistSvar: true });
    await expect(opprettNy(FAMILY_ID, "gaver", id, GAVE())).rejects.toMatchObject({
      name: "UkjentSkriveUtfall",
    });
    vi.restoreAllMocks();
    const r = rest();
    await expect(opprettNy(FAMILY_ID, "gaver", id, GAVE())).resolves.toBe("allerede");
    expect(r.kall).toEqual(["GET gaver"]);
  });

  it("PUT holdt over fristen: ukjent; mislykket retry er fortsatt ukjent; overskrevet av annen klient gir konflikt med tidligere ukjent", async () => {
    const id = `g-${randomUUID()}`;
    const holdt = rest({ holdPut: true });
    await expect(
      opprettPost(FAMILY_ID, "gaver", id, GAVE(), { fristMs: 300 }),
    ).rejects.toMatchObject({ name: "UkjentSkriveUtfall" });
    vi.restoreAllMocks();
    rest({ hengGet: true });
    await expect(
      opprettPost(FAMILY_ID, "gaver", id, GAVE(), { fristMs: 300 }),
    ).rejects.toMatchObject({ name: "UkjentSkriveUtfall" });
    vi.restoreAllMocks();
    // Den holdte PUT-en lander (posten fantes ikke), så endrer en annen klient den.
    expect((await holdt.slippPut()).status).toBe(200);
    await db().ref(`${FAM}/gaver/${id}`).update({ tekst: "Annen", sisteSkriving: "annen" });
    const feil = await opprettNy(FAMILY_ID, "gaver", id, GAVE()).catch((e: unknown) => e);
    expect(feil).toMatchObject({ name: "EndretAvAndre", tidligereUkjent: true });
  });

  it("sesjonsbytte under lesingen: ingen PUT, ikke lagret", async () => {
    const id = `g-${randomUUID()}`;
    const r = rest({
      underGet: async () => {
        await signOut(getFirebaseAuth());
        await loggInn();
      },
    });
    await expect(opprettNy(FAMILY_ID, "gaver", id, GAVE())).rejects.toMatchObject({
      name: "EndringIkkeLagret",
    });
    expect(r.kall).toEqual(["GET gaver"]);
    expect(await eksport("gaver", id)).toBeNull();
  });

  it("samme id og innhold i to familier: B arver ikke As ukjenttilstand, og B avklarer ikke A", async () => {
    const id = `g-${randomUUID()}`;
    const holdt = rest({ holdPut: true });
    await expect(
      opprettPost(FAMILY_ID, "gaver", id, GAVE(), { fristMs: 300 }),
    ).rejects.toMatchObject({ name: "UkjentSkriveUtfall" });
    vi.restoreAllMocks();
    rest({ hengGet: true });
    await expect(
      opprettPost(FAMILIE_B, "gaver", id, GAVE(), { fristMs: 300 }),
    ).rejects.toMatchObject({ name: "EndringIkkeLagret" });
    vi.restoreAllMocks();
    await expect(opprettNy(FAMILIE_B, "gaver", id, GAVE())).resolves.toBe("lagret");
    await expect(opprettNy(FAMILIE_B, "gaver", id, GAVE())).resolves.toBe("allerede");
    rest({ hengGet: true });
    await expect(
      opprettPost(FAMILY_ID, "gaver", id, GAVE(), { fristMs: 300 }),
    ).rejects.toMatchObject({ name: "UkjentSkriveUtfall" });
    vi.restoreAllMocks();
    expect((await holdt.slippPut()).status).toBe(200);
    await expect(opprettNy(FAMILY_ID, "gaver", id, GAVE())).resolves.toBe("allerede");
  });
});

describe("registrerGaveOgAnledning: anledningen venter på bekreftet gave (emulator)", () => {
  const bursdag = (personId: string) => ({
    id: `bursdag-${personId}-2026`,
    verdi: { ...NY_ANLEDNING, mottakere: { [personId]: { budsjett: { type: "ikke_satt" } } } },
  });

  it("ukjent utfall i gavesteget: ingen lesing eller skriving av anledningen", async () => {
    const p = `p-${randomUUID()}`;
    const id = `g-${randomUUID()}`;
    const r = rest({ mistSvar: true });
    await expect(
      registrerGaveOgAnledning(FAMILY_ID, id, GAVE(p), bursdag(p)),
    ).rejects.toMatchObject({ name: "UkjentSkriveUtfall" });
    expect(r.kall).toEqual(["GET gaver", "PUT gaver"]);
    expect(await eksport("anledninger", bursdag(p).id)).toBeNull();
  });

  it("ukjent utfall i anledningssteget: gaven er bekreftet, bursdagen er uavklart; identisk retry fullfører uten ny gave", async () => {
    const p = `p-${randomUUID()}`;
    const id = `g-${randomUUID()}`;
    rest({ noder: ["anledninger"], mistSvar: true });
    const feil = await registrerGaveOgAnledning(FAMILY_ID, id, GAVE(p), bursdag(p)).catch(
      (e: unknown) => e,
    );
    expect(feil).toMatchObject({
      name: "AnledningGjenstar",
      gaveId: id,
      anledningId: bursdag(p).id,
      ukjent: true,
      message: "Gaven er lagret. Vi vet ikke om bursdagen ble lagret.",
    });
    vi.restoreAllMocks();
    const r = rest();
    await registrerGaveOgAnledning(FAMILY_ID, id, GAVE(p), bursdag(p));
    // Gaven «allerede», bursdagen finnes (den tapte PUT-en landet): bare lesinger.
    expect(r.kall).toEqual(["GET gaver", "GET anledninger"]);
    expect(
      Object.keys((await db().ref(`${FAM}/gaver`).get()).val()).filter((k) => k === id),
    ).toEqual([id]);
  });

  it("anledningssteget ikke sendt: gaven lagret, bursdagen sikkert ikke lagret", async () => {
    const p = `p-${randomUUID()}`;
    const id = `g-${randomUUID()}`;
    rest({ noder: ["anledninger"], hengGet: true });
    const feil = await registrerGaveOgAnledning(FAMILY_ID, id, GAVE(p), bursdag(p), {
      fristMs: 300,
    }).catch((e: unknown) => e);
    expect(feil).toMatchObject({
      name: "AnledningGjenstar",
      ukjent: false,
      message: "Gaven er lagret. Bursdagen gjenstår.",
    });
    expect(await eksport("gaver", id)).toMatchObject({ personId: p });
    expect(await eksport("anledninger", bursdag(p).id)).toBeNull();
  });
});
