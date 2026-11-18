/**
 * Basisvarenes felles versjonsbetingede vei (`kjorBasisvareVersjonert`,
 * merking og fjerning) bundet til innloggingen som startet forsøket (Mat #20,
 * ordre 6984494940; som #178–#180) — EKTE Firebase-emulator, syntetiske
 * nøkler.
 *
 * Før rettingen leste `basisvareRest` `currentUser` på nytt for hver GET og
 * PUT: ble kontoen byttet (eller avsluttet, eller logget inn på nytt) mens
 * forsøket pågikk, kunne PUT-en sendes på vegne av en annen sesjon — også i
 * runden etter 412.
 *
 * To syntetiske medlemmer A og B i samme familie. Alle REST-kall mot
 * `staples/` telles; basisvaren og andre nøkler skal stå byte for byte.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { vurderBasisvareFjerning } from "@domain/shopping/basisvareFjerning";
import { vurderBasisvareMerking } from "@domain/shopping/basisvareMerking";
import { getFirebaseAuth } from "./firebase";
import { fjernBasisvareVersjonert, merkBasisvareVersjonert } from "./staples.repository";

const FAMILY_ID = "familie1";
const STI = `families/${FAMILY_ID}/staples`;
/** Lang nok frist til at sesjonsbyttet skjer før den, så utfallet viser byttet. */
const LANG = { fristMs: 8_000 };

let adminApp: AdminApp;
let tokenA = "";
let tokenB = "";
const b = () => getAdminDatabase(adminApp);
const somA = async () => signInWithCustomToken(getFirebaseAuth(), tokenA);
const eksport = async () => (await b().ref(STI).get()).exportVal() as unknown;

/** Handlingene som testes: begge går gjennom samme kjerne. */
const HANDLINGER = {
  merking: {
    start: () => ({ salt: { ".value": true, ".priority": 3 }, ost: true }),
    kjor: () => merkBasisvareVersjonert(FAMILY_ID, "melk", vurderBasisvareMerking, LANG),
    /** En samtidig endring mellom GET og PUT som gir 412. */
    samtidig: () =>
      b()
        .ref(`${STI}/salt`)
        .setPriority(9, () => {}),
    /** Etter samtidig endring står den andre nøkkelens nye prioritet, og «melk» finnes ikke. */
    sporSamtidig: (e: Record<string, unknown>) => {
      expect(e.melk).toBeUndefined();
    },
  },
  fjerning: {
    start: () => ({ melk: true, salt: { ".value": true, ".priority": 3 }, ost: true }),
    kjor: () => fjernBasisvareVersjonert(FAMILY_ID, "melk", vurderBasisvareFjerning, LANG),
    samtidig: () =>
      b()
        .ref(`${STI}/melk`)
        .setPriority(7, () => {}),
    sporSamtidig: (e: Record<string, unknown>) => {
      expect(e.melk).toEqual({ ".value": true, ".priority": 7 });
    },
  },
} as const;
type Navn = keyof typeof HANDLINGER;
const NAVN: Navn[] = ["merking", "fjerning"];

/**
 * Teller REST-kall mot `staples/`. `hengGet` holder første GET til
 * `slipp()`. `foerPut` kjøres før første PUT sendes, `etterPut` med svaret på
 * første PUT før det leveres til kjernen.
 */
function rest(
  valg: {
    hengGet?: boolean;
    foerPut?: () => Promise<void>;
    etterPut?: (res: Response) => Promise<void>;
  } = {},
) {
  const ekte = globalThis.fetch;
  const kall: string[] = [];
  let slipp: () => void = () => {};
  const port = new Promise<void>((r) => (slipp = r));
  let getHoldt = false;
  let putSett = false;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (!String(input).includes("/staples/")) return ekte(input, init);
    const m = init?.method ?? "GET";
    kall.push(m);
    if (m === "GET" && valg.hengGet && !getHoldt) {
      getHoldt = true;
      await port;
      const uten: RequestInit = { ...init };
      delete uten.signal;
      return ekte(input, uten);
    }
    if (m === "PUT" && !putSett) {
      putSett = true;
      await valg.foerPut?.();
      const res = await ekte(input, init);
      await valg.etterPut?.(res);
      return res;
    }
    return ekte(input, init);
  });
  return { kall, slipp: () => slipp() };
}

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-staples-sesjon",
  );
  // To syntetiske medlemmer av samme familie: A starter handlingen, B overtar sesjonen.
  for (const hvem of ["A", "B"] as const) {
    const uid = `test-${hvem}-${randomUUID()}`;
    await getAdminAuth(adminApp).createUser({ uid });
    await b().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
    const t = await getAdminAuth(adminApp).createCustomToken(uid);
    if (hvem === "A") tokenA = t;
    else tokenB = t;
  }
  await somA();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await somA();
});

afterAll(async () => {
  await b().ref(`families/${FAMILY_ID}`).remove();
  await deleteApp(adminApp);
});

describe.each(NAVN)(
  "basisvare-%s bundet til innloggingen som startet forsøket (emulator)",
  (navn) => {
    const h = HANDLINGER[navn];

    it(
      "A starter, sesjonen byttes til B mens GET står ute: `byttet`, ingen PUT, alt står byte for byte",
      { timeout: 15_000 },
      async () => {
        await b().ref(STI).set(h.start());
        const foer = await eksport();
        const r = rest({ hengGet: true });
        const forsok = h.kjor();
        await vi.waitFor(() => expect(r.kall).toEqual(["GET"]));
        await signInWithCustomToken(getFirebaseAuth(), tokenB);
        r.slipp();
        expect(await forsok).toEqual({ utfall: "byttet" });
        expect(r.kall).toEqual(["GET"]);
        expect(await eksport()).toEqual(foer);
      },
    );

    it(
      "utlogging mens tokenet til PUT hentes: `byttet`, ingen PUT, alt står byte for byte",
      { timeout: 15_000 },
      async () => {
        await b().ref(STI).set(h.start());
        const foer = await eksport();
        const r = rest();
        const bruker = getFirebaseAuth().currentUser!;
        const ekte = bruker.getIdToken.bind(bruker);
        let slipp: () => void = () => {};
        const port = new Promise<void>((res) => (slipp = res));
        let n = 0;
        let putTokenBedt = false;
        vi.spyOn(bruker, "getIdToken").mockImplementation(async (f) => {
          n += 1;
          if (n === 2) {
            // Tokenet til PUT: venter til testen har logget ut.
            putTokenBedt = true;
            await port;
          }
          return ekte(f);
        });
        const forsok = h.kjor();
        await vi.waitFor(() => expect(putTokenBedt).toBe(true));
        await signOut(getFirebaseAuth());
        slipp();
        expect(await forsok).toEqual({ utfall: "byttet" });
        expect(r.kall).toEqual(["GET"]);
        expect(await eksport()).toEqual(foer);
      },
    );

    it(
      "ny innlogging som samme bruker (ny sesjon) mens GET står ute: også stoppet, ingen PUT",
      { timeout: 15_000 },
      async () => {
        await b().ref(STI).set(h.start());
        const foer = await eksport();
        const r = rest({ hengGet: true });
        const forsok = h.kjor();
        await vi.waitFor(() => expect(r.kall).toEqual(["GET"]));
        await signOut(getFirebaseAuth());
        await somA();
        r.slipp();
        expect(await forsok).toEqual({ utfall: "byttet" });
        expect(r.kall).toEqual(["GET"]);
        expect(await eksport()).toEqual(foer);
      },
    );

    it(
      "sesjonsbytte etter 412, før ny runde: `byttet`, ingen ny GET/PUT; den samtidige endringen står",
      { timeout: 15_000 },
      async () => {
        await b().ref(STI).set(h.start());
        const r = rest({
          // En annen klient endrer nøkkelen mellom GET og PUT (fjerning), eller
          // ikke — merking skriver på en ny nøkkel, så 412 fremtvinges via melk.
          foerPut: async () => {
            if (navn === "merking") await b().ref(`${STI}/melk`).set(false);
            else await h.samtidig();
          },
          etterPut: async (res) => {
            expect(res.status).toBe(412);
            await signInWithCustomToken(getFirebaseAuth(), tokenB);
          },
        });
        expect(await h.kjor()).toEqual({ utfall: "byttet" });
        expect(r.kall).toEqual(["GET", "PUT"]);
        const e = (await eksport()) as Record<string, unknown>;
        if (navn === "merking") expect(e.melk).toBe(false);
        else h.sporSamtidig(e);
        expect(e.ost).toBe(true);
        expect(e.salt).toEqual({ ".value": true, ".priority": 3 });
      },
    );

    it(
      "uten bytte: én GET og én PUT; andre nøkler står byte for byte",
      { timeout: 15_000 },
      async () => {
        await b().ref(STI).set(h.start());
        const r = rest();
        expect(await h.kjor()).toEqual({ utfall: navn === "merking" ? "merket" : "fjernet" });
        expect(r.kall).toEqual(["GET", "PUT"]);
        const e = (await eksport()) as Record<string, unknown>;
        expect(e.salt).toEqual({ ".value": true, ".priority": 3 });
        expect(e.ost).toBe(true);
      },
    );
  },
);
