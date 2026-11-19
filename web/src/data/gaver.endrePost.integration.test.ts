/**
 * `endrePost` (gaver, relasjoner, relasjonsgrupper, anledninger) — EKTE
 * Firebase-emulator, syntetiske data (#20, ordre 7013713991).
 *
 * Dataintegritet i råform: et stopp (konflikt, replay, slettet post) skal
 * ikke sende noen skriving, og en faktisk endring skal bare endre feltene i
 * endringen. Prioriteter på posten, på nøstede objekter og på primitive
 * blader, og ukjente felt, kontrolleres med `exportVal()`. Alle REST-kall mot
 * familienoden telles.
 */
import { randomUUID } from "node:crypto";
import { goOffline, goOnline } from "firebase/database";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Endring } from "@app-types/gaver";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import {
  type GaveNode,
  endrePost,
  gaveVakt,
  sammeVersjon,
  skrivIdFor,
  subscribeAnledninger,
  subscribeGaver,
} from "./gaver.repository";

const FAMILY_ID = "familie1";
const ANNEN_FAMILIE = "familie-uten-tilgang-gaver";
const FAM = `families/${FAMILY_ID}`;
const T = "2026-11-19T10:00:00.000Z";
const TID = "2026-11-19T17:00:00.000Z";

let adminApp: AdminApp;
let token = "";
const loggInn = async () => signInWithCustomToken(getFirebaseAuth(), token);
const db = () => getAdminDatabase(adminApp);
const eksport = async (node: GaveNode, id: string, fam = FAMILY_ID) =>
  (await db().ref(`families/${fam}/${node}/${id}`).get()).exportVal() as unknown;

/** Gave med prioritet på posten, på primitive blader og på nøstede objekter. */
const GAVE = (over: Record<string, unknown> = {}) => ({
  ".priority": "rot",
  personId: "pA",
  anledningId: "jul-2026",
  tekst: { ".value": "Bok", ".priority": 3 },
  status: "kjopt",
  planlagtOre: { ".value": 30000, ".priority": 4 },
  valgt: { ".value": true, ".priority": 1 },
  fremtidig: { ".priority": 9, a: 1, b: { ".priority": "nb", c: { ".value": 2, ".priority": 7 } } },
  versjon: 3,
  opprettet: T,
  oppdatert: T,
  ...over,
});

/** Anledning med prioriteter på posten, på `mottakere` og per mottaker. */
const ANLEDNING = (over: Record<string, unknown> = {}) => ({
  ".priority": 1,
  type: "jul",
  aar: 2026,
  mottakere: {
    ".priority": "m",
    pA: {
      ".priority": 5,
      budsjett: { ".priority": 6, type: "belop", belopOre: 50000 },
      x: { ".value": 1, ".priority": 2 },
    },
    pB: { ".priority": 8, budsjett: { type: "ikke_satt" } },
  },
  ukjent: { z: { ".value": true, ".priority": 2 } },
  versjon: 2,
  opprettet: T,
  oppdatert: T,
  ...over,
});

async function ny(node: GaveNode, verdi: unknown, fam = FAMILY_ID) {
  const id = randomUUID();
  await db().ref(`families/${fam}/${node}/${id}`).set(verdi);
  return id;
}

/** Forventet eksport etter en faktisk endring av gaven: metadata + gitte felt. */
const etter = (
  base: Record<string, unknown>,
  felt: Record<string, unknown>,
  skrivId: string,
  versjon: number,
) => ({ ...base, ...felt, versjon, oppdatert: TID, sisteSkriving: skrivId });

/**
 * Teller REST-kall mot familienoden. `foerPut` kjøres før første PUT (en
 * annen klient skriver mellom lesing og skriving). `mistSvar` sender første
 * PUT til serveren og kaster i stedet for å levere svaret. `hengGet` holder
 * GET til fristen. `holdPut` holder første PUT før den når serveren, til
 * `slippPut()`. `underGet` kjøres før første GET-svar leveres.
 */
function rest(
  valg: {
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
  let heng = valg.hengGet ?? false;
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
    if (!String(input).includes("/families/")) return ekte(input, init);
    const m = init?.method ?? "GET";
    kall.push(m);
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
    stopp: () => {
      heng = false;
    },
    slippPut: () => {
      slipp();
      return holdtSvar!;
    },
  };
}

const status = (
  id: string,
  endring: Endring,
  versjon = 3,
  fristMs = 2_000,
  vakt: (raa: Record<string, unknown> | null) => boolean = gaveVakt(versjon),
) =>
  endrePost(FAMILY_ID, "gaver", id, { vakt, endring, grunn: String(versjon), tid: TID, fristMs });

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "gaver-endrepost-test-admin",
  );
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await db().ref(`${FAM}/members/${uid}`).set(true);
  token = await getAdminAuth(adminApp).createCustomToken(uid);
  await loggInn();
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (!getFirebaseAuth().currentUser) await loggInn();
});

afterAll(async () => {
  for (const n of ["gaver", "anledninger", "relasjoner", "relasjonsgrupper"]) {
    await db().ref(`${FAM}/${n}`).remove();
  }
  await db().ref(`families/${ANNEN_FAMILIE}`).remove();
  await deleteApp(adminApp);
});

describe("endrePost: stopp sender ingen skriving (emulator)", () => {
  it("konflikt (annen versjon): EndretAvAndre, bare GET, eksporten uendret", async () => {
    const id = await ny("gaver", GAVE({ versjon: 4 }));
    const foer = await eksport("gaver", id);
    const r = rest();
    await expect(status(id, { status: "gitt" })).rejects.toMatchObject({ name: "EndretAvAndre" });
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport("gaver", id)).toEqual(foer);
  });

  it("ukjent status (fra en nyere versjon): EndretAvAndre, bare GET, eksporten uendret", async () => {
    const id = await ny("gaver", GAVE({ status: "levert" }));
    const foer = await eksport("gaver", id);
    const r = rest();
    await expect(status(id, { status: "ide" })).rejects.toMatchObject({ name: "EndretAvAndre" });
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport("gaver", id)).toEqual(foer);
  });

  it("replay (egen skrivId lagret): «allerede», bare GET, eksporten uendret", async () => {
    const id = randomUUID();
    const skrivId = skrivIdFor("gaver", id, "3", { status: "gitt" });
    await db()
      .ref(`${FAM}/gaver/${id}`)
      .set(GAVE({ status: "gitt", versjon: 4, sisteSkriving: skrivId }));
    const foer = await eksport("gaver", id);
    const r = rest();
    await expect(status(id, { status: "gitt" })).resolves.toBe("allerede");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport("gaver", id)).toEqual(foer);
  });

  it("slettet post: EndretAvAndre, ikke gjenopprettet — også når vakten godtar en tom post", async () => {
    const id = randomUUID();
    const r = rest();
    await expect(status(id, { status: "gitt" })).rejects.toMatchObject({ name: "EndretAvAndre" });
    await expect(status(id, { status: "gitt" }, 0, 2_000, sammeVersjon(0))).rejects.toMatchObject({
      name: "EndretAvAndre",
    });
    // Som `leggTilMottaker`: vakten godtar at mottakeren mangler.
    await expect(
      endrePost(FAMILY_ID, "anledninger", id, {
        vakt: () => true,
        endring: { "mottakere/pC": { budsjett: { type: "ikke_satt" } } },
        grunn: "mottaker:pC:null",
        tid: TID,
        fristMs: 2_000,
      }),
    ).rejects.toMatchObject({ name: "EndretAvAndre" });
    expect(r.kall).toEqual(["GET", "GET", "GET"]);
    expect(await eksport("gaver", id)).toBeNull();
    expect(await eksport("anledninger", id)).toBeNull();
  });

  it("gruppe som lagres første gang (`nyHvisMangler`, versjon 0): opprettes; finnes den allerede, konflikt", async () => {
    const gruppe = `g-${randomUUID()}`;
    const valg = {
      vakt: sammeVersjon(0),
      endring: { "standard/jul/aktiv": true } as Endring,
      grunn: "0",
      tid: TID,
      fristMs: 2_000,
      nyHvisMangler: true,
    };
    await expect(endrePost(FAMILY_ID, "relasjonsgrupper", gruppe, valg)).resolves.toBe("lagret");
    expect(await eksport("relasjonsgrupper", gruppe)).toEqual({
      standard: { jul: { aktiv: true } },
      versjon: 1,
      oppdatert: TID,
      sisteSkriving: skrivIdFor("relasjonsgrupper", gruppe, "0", valg.endring),
    });
    // En annen fane med samme utgangspunkt (versjon 0) og en annen endring.
    await expect(
      endrePost(FAMILY_ID, "relasjonsgrupper", gruppe, {
        ...valg,
        endring: { "standard/jul/aktiv": false },
      }),
    ).rejects.toMatchObject({ name: "EndretAvAndre" });
  });

  it("utdatert cache (aktivt abonnement, klienten frakoblet): fersk serververdi avgjør, ingen skriving", async () => {
    const id = await ny("gaver", GAVE());
    let sett = 0;
    const av = subscribeGaver(FAMILY_ID, (g) => {
      if (g.some((x) => x.id === id)) sett += 1;
    });
    await vi.waitFor(() => expect(sett).toBeGreaterThan(0));
    goOffline(getFirebaseDatabase());
    try {
      // Klientens cache viser fortsatt versjon 3; serveren har versjon 4.
      await db().ref(`${FAM}/gaver/${id}`).update({ versjon: 4, tekst: "Annen enhet" });
      const foer = await eksport("gaver", id);
      const r = rest();
      await expect(status(id, { status: "gitt" })).rejects.toMatchObject({
        name: "EndretAvAndre",
      });
      expect(r.kall).toEqual(["GET"]);
      expect(await eksport("gaver", id)).toEqual(foer);
    } finally {
      goOnline(getFirebaseDatabase());
      av();
    }
  });
});

describe("endrePost: faktisk endring bevarer råform og prioriteter (emulator)", () => {
  it("kald cache: statusendring endrer bare status og metadata; prioriteter på post, blader og nøstede objekter står", async () => {
    const id = await ny("gaver", GAVE());
    const r = rest();
    await expect(status(id, { status: "gitt" })).resolves.toBe("lagret");
    expect(r.kall).toEqual(["GET", "PUT"]);
    const skrivId = skrivIdFor("gaver", id, "3", { status: "gitt" });
    expect(await eksport("gaver", id)).toEqual(etter(GAVE(), { status: "gitt" }, skrivId, 4));
  });

  it("feltsletting og bladerstatning: «valgt» fjernes; et erstattet blad beholder sin prioritet", async () => {
    const id = await ny("gaver", GAVE({ status: "ide" }));
    const endring: Endring = { valgt: undefined, "fremtidig/b/c": 5, tekst: "Ny bok" };
    await expect(status(id, endring)).resolves.toBe("lagret");
    const { valgt: _v, ...uten } = GAVE({ status: "ide" });
    void _v;
    const forventet = etter(
      {
        ...uten,
        tekst: { ".value": "Ny bok", ".priority": 3 },
        fremtidig: {
          ".priority": 9,
          a: 1,
          b: { ".priority": "nb", c: { ".value": 5, ".priority": 7 } },
        },
      },
      {},
      skrivIdFor("gaver", id, "3", endring),
      4,
    );
    expect(await eksport("gaver", id)).toEqual(forventet);
  });

  it("aktivt abonnement: mottakerendring på anledningen; andre mottakere, `mottakere` og posten beholder prioriteter", async () => {
    const id = await ny("anledninger", ANLEDNING());
    let sett = 0;
    const av = subscribeAnledninger(FAMILY_ID, (a) => {
      if (a.some((x) => x.id === id)) sett += 1;
    });
    try {
      await vi.waitFor(() => expect(sett).toBeGreaterThan(0));
      const endring: Endring = {
        "mottakere/pA/fjernet": TID,
        "mottakere/pA/budsjett": { type: "ikke_satt" },
      };
      const r = rest();
      await expect(
        endrePost(FAMILY_ID, "anledninger", id, {
          vakt: sammeVersjon(2),
          endring,
          grunn: "2",
          tid: TID,
          fristMs: 2_000,
        }),
      ).resolves.toBe("lagret");
      expect(r.kall).toEqual(["GET", "PUT"]);
      const base = ANLEDNING();
      const m = base.mottakere as unknown as Record<string, Record<string, unknown>>;
      expect(await eksport("anledninger", id)).toEqual({
        ...base,
        mottakere: {
          ...m,
          pA: { ...m.pA, fjernet: TID, budsjett: { ".priority": 6, type: "ikke_satt" } },
        },
        versjon: 3,
        oppdatert: TID,
        sisteSkriving: skrivIdFor("anledninger", id, "2", endring),
      });
    } finally {
      av();
    }
  });

  it("retry av samme skrivId etter lagret: «allerede», bare GET, ingen ny versjon", async () => {
    const id = await ny("gaver", GAVE());
    await expect(status(id, { status: "gitt" })).resolves.toBe("lagret");
    const foer = await eksport("gaver", id);
    const r = rest();
    await expect(status(id, { status: "gitt" })).resolves.toBe("allerede");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport("gaver", id)).toEqual(foer);
  });

  it("annen klient endrer et annet felt mellom lesing og skriving: 412, ny runde, EndretAvAndre; den andres endring står", async () => {
    const id = await ny("gaver", GAVE());
    const r = rest({
      foerPut: async () => {
        await db().ref(`${FAM}/gaver/${id}`).update({ tekst: "Annen enhet", versjon: 4 });
      },
    });
    await expect(status(id, { status: "gitt" })).rejects.toMatchObject({ name: "EndretAvAndre" });
    expect(r.kall).toEqual(["GET", "PUT", "GET"]);
    const v = (await db().ref(`${FAM}/gaver/${id}`).get()).val() as Record<string, unknown>;
    expect(v).toMatchObject({ tekst: "Annen enhet", status: "kjopt", versjon: 4 });
  });

  it("annen klient endrer bare en prioritet imellom: 412, ny runde, lagret med den nye prioriteten", async () => {
    const id = await ny("gaver", GAVE());
    const r = rest({
      foerPut: async () => {
        await db()
          .ref(`${FAM}/gaver/${id}/fremtidig`)
          .setPriority(42, () => {});
      },
    });
    await expect(status(id, { status: "gitt" })).resolves.toBe("lagret");
    expect(r.kall).toEqual(["GET", "PUT", "GET", "PUT"]);
    const base = GAVE();
    expect(await eksport("gaver", id)).toEqual(
      etter(
        { ...base, fremtidig: { ...(base.fremtidig as object), ".priority": 42 } },
        { status: "gitt" },
        skrivIdFor("gaver", id, "3", { status: "gitt" }),
        4,
      ),
    );
  });

  it("relasjoner og relasjonsgrupper: nøstet endring bevarer ukjente felt og prioriteter", async () => {
    const pid = await ny("relasjoner", {
      ".priority": 3,
      navn: "Syntetisk",
      gruppe: "naer",
      unntak: { jul: { ".priority": 2, aktiv: false, ukjent: { ".value": 1, ".priority": 1 } } },
      versjon: 1,
    });
    await expect(
      endrePost(FAMILY_ID, "relasjoner", pid, {
        vakt: sammeVersjon(1),
        endring: { navn: "Nytt navn", "unntak/jul/aktiv": true },
        grunn: "1",
        tid: TID,
        fristMs: 2_000,
      }),
    ).resolves.toBe("lagret");
    expect(await eksport("relasjoner", pid)).toEqual({
      ".priority": 3,
      navn: "Nytt navn",
      gruppe: "naer",
      unntak: { jul: { ".priority": 2, aktiv: true, ukjent: { ".value": 1, ".priority": 1 } } },
      versjon: 2,
      oppdatert: TID,
      sisteSkriving: skrivIdFor("relasjoner", pid, "1", {
        navn: "Nytt navn",
        "unntak/jul/aktiv": true,
      }),
    });
  });
});

describe("endrePost: frist, sesjon og ukjent utfall (emulator)", () => {
  it("lesingen henger: ikke lagret ved fristen, ingen PUT, eksporten uendret", async () => {
    const id = await ny("gaver", GAVE());
    const foer = await eksport("gaver", id);
    const r = rest({ hengGet: true });
    await expect(status(id, { status: "gitt" }, 3, 300)).rejects.toMatchObject({
      name: "EndringIkkeLagret",
    });
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport("gaver", id)).toEqual(foer);
  });

  it("tapt svar på PUT: ukjent utfall; retry med samme skrivId finner den lagret («allerede»)", async () => {
    const id = await ny("gaver", GAVE());
    rest({ mistSvar: true });
    await expect(status(id, { status: "gitt" })).rejects.toMatchObject({
      name: "UkjentSkriveUtfall",
    });
    vi.restoreAllMocks();
    const r = rest();
    await expect(status(id, { status: "gitt" })).resolves.toBe("allerede");
    expect(r.kall).toEqual(["GET"]);
  });

  it("PUT holdt over fristen: ukjent; en mislykket retry avgjør ikke det tidligere forsøket; PUT-en lander og retry gir «allerede»", async () => {
    const id = await ny("gaver", GAVE());
    const holdt = rest({ holdPut: true });
    await expect(status(id, { status: "gitt" }, 3, 300)).rejects.toMatchObject({
      name: "UkjentSkriveUtfall",
    });
    // Retry der lesingen henger: fortsatt ukjent, ikke «ikke lagret».
    vi.restoreAllMocks();
    rest({ hengGet: true });
    await expect(status(id, { status: "gitt" }, 3, 300)).rejects.toMatchObject({
      name: "UkjentSkriveUtfall",
    });
    vi.restoreAllMocks();
    expect((await holdt.slippPut()).status).toBe(200);
    const r = rest();
    await expect(status(id, { status: "gitt" })).resolves.toBe("allerede");
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport("gaver", id)).toEqual(
      etter(GAVE(), { status: "gitt" }, skrivIdFor("gaver", id, "3", { status: "gitt" }), 4),
    );
  });

  it("sesjonsbytte under lesingen (samme uid, ny innlogging): ingen PUT, ikke lagret", async () => {
    const id = await ny("gaver", GAVE());
    const foer = await eksport("gaver", id);
    const r = rest({
      underGet: async () => {
        await signOut(getFirebaseAuth());
        await loggInn();
      },
    });
    await expect(status(id, { status: "gitt" })).rejects.toMatchObject({
      name: "EndringIkkeLagret",
    });
    expect(r.kall).toEqual(["GET"]);
    expect(await eksport("gaver", id)).toEqual(foer);
  });

  it("utlogget: ingenting sendes; annen familie: avvist, ingenting skrevet", async () => {
    const id = await ny("gaver", GAVE());
    const r = rest();
    await signOut(getFirebaseAuth());
    await expect(status(id, { status: "gitt" })).rejects.toMatchObject({
      name: "EndringIkkeLagret",
    });
    expect(r.kall).toEqual([]);
    await loggInn();
    const fremmed = await ny("gaver", GAVE(), ANNEN_FAMILIE);
    const foer = await eksport("gaver", fremmed, ANNEN_FAMILIE);
    await expect(
      endrePost(ANNEN_FAMILIE, "gaver", fremmed, {
        vakt: gaveVakt(3),
        endring: { status: "gitt" },
        grunn: "3",
        tid: TID,
        fristMs: 2_000,
      }),
    ).rejects.toMatchObject({ name: "EndringIkkeLagret" });
    expect(await eksport("gaver", fremmed, ANNEN_FAMILIE)).toEqual(foer);
  });
});
