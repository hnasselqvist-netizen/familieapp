/**
 * Kommentar på én vanlig manuell økonomisk hendelse (#59, ordre 7002365160,
 * #141) — EKTE Firebase-emulator, syntetisk familie og syntetiske hendelser.
 * Samme sammensetning som `useHendelseKommentar`: `besluttKommentar` i én
 * betinget helnode-transaksjon på `hendelser`, og en skrivefri, fersk
 * REST-lesing til kontrollen.
 *
 * Hele noden kontrolleres etter hver handling: bare målets `kommentar` og
 * `oppdatert` endres, ukjente felt og de andre hendelsene står, og et stopp
 * skriver og reindekserer ingenting.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken, signOut } from "firebase/auth";
import { goOffline, goOnline, onValue, ref } from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type KommentarForsok,
  type KommentarStopp,
  besluttKommentar,
  normaliserKommentar,
  vurderKommentarNaatilstand,
} from "@domain/forsoning/hendelseKommentar";
import { aktivSesjon } from "./auth.repository";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import {
  type BetingetUtfall,
  lesForsoningNodeFersk,
  transactForsoningNodeBetinget,
} from "./forsoningSkriving.repository";

const FAM = `familie-kommentar-${randomUUID().slice(0, 8)}`;
const FREMMED = `familie-kommentar-fremmed-${randomUUID().slice(0, 8)}`;
const NODE = (fam = FAM) => `families/${fam}/hendelser`;
const NAA = "2026-11-19T08:00:00.000Z";

let adminApp: AdminApp;
let token = "";
const logInn = () => signInWithCustomToken(getFirebaseAuth(), token);
const db = () => getAdminDatabase(adminApp);

const MANUELL = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: null,
  receiptId: null,
  fordelinger: [
    {
      budgetItemId: "b1",
      belop: 250,
      plasseringType: "budget",
      eiere: [{ person: "Felles", prosent: 100 }],
    },
  ],
  dato: "2026-11-01",
  regelId: null,
  kilde: "manuell",
  kommentar: "Gammel",
  opprettet: "2026-11-01T10:00:00.000Z",
  oppdatert: "2026-11-01T10:00:00.000Z",
  ukjentFelt: { nivaa: { a: 1 } },
  ...over,
});
const BANK = {
  id: "hb",
  status: "ferdig",
  transaksjonId: "t1",
  receiptId: null,
  fordelinger: [],
  dato: "2026-11-02",
  kilde: null,
  opprettet: NAA,
  oppdatert: NAA,
};

/** RTDB lagrer ikke `null`: slik noden ser ut etter lesing. */
const somLagret = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(somLagret)
    : typeof v === "object" && v !== null
      ? Object.fromEntries(
          Object.entries(v)
            // RTDB lagrer verken `null` eller tomme lister.
            .filter(([, x]) => x !== null && !(Array.isArray(x) && x.length === 0))
            .map(([k, x]) => [k, somLagret(x)]),
        )
      : v;
/**
 * Et aktivt abonnement på noden, slik appen har (`subscribeHendelser`): da er
 * klientens cache varm før nettet kobles fra, og forsøket beregnes mot den
 * faktiske listen. Returnerer avmeldingen.
 */
const lytt = () =>
  new Promise<() => void>((r) => {
    const av: () => void = onValue(ref(getFirebaseDatabase(), NODE()), (): void => r(av));
  });
const settNode = (liste: unknown, fam = FAM) => db().ref(NODE(fam)).set(liste);
const node = async (fam = FAM) => (await db().ref(NODE(fam)).get()).val() as unknown;

/** Samme sammensetning som `useHendelseKommentar.lagreKommentar`. */
async function lagre(
  id: string,
  kilde: string | undefined,
  tekst: string,
  valg: { fam?: string; fristMs?: number; sesjon?: string } = {},
): Promise<BetingetUtfall<KommentarStopp>> {
  const utkast = normaliserKommentar(tekst);
  return transactForsoningNodeBetinget<unknown, KommentarStopp>(
    valg.fam ?? FAM,
    "hendelser",
    (prev) => besluttKommentar(prev, { id, kilde }, utkast, NAA),
    { fristMs: valg.fristMs ?? 5_000, ...(valg.sesjon ? { sesjon: valg.sesjon } : {}) },
  );
}
async function sjekk(forsok: KommentarForsok) {
  const r = await lesForsoningNodeFersk(FAM, "hendelser", { fristMs: 5_000 });
  return r.type === "lest" ? vurderKommentarNaatilstand(r.liste, forsok) : r.type;
}

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "integration-test-admin-hendelse-kommentar",
  );
  const uid = `test-kommentar-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await db().ref(`families/${FAM}/members/${uid}`).set(true);
  token = await getAdminAuth(adminApp).createCustomToken(uid);
  await logInn();
});

beforeEach(async () => {
  await settNode([MANUELL("h0", { kommentar: "Urørt" }), MANUELL("h1"), BANK]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  goOnline(getFirebaseDatabase());
  if (!getFirebaseAuth().currentUser) await logInn();
});

afterAll(async () => {
  await db().ref(`families/${FAM}`).remove();
  await db().ref(`families/${FREMMED}`).remove();
  await deleteApp(adminApp);
});

describe("kommentar på manuell hendelse (emulator)", () => {
  it("endring: bare `kommentar` og `oppdatert` på målet endres; nøkler, fordelinger, ukjente felt og andre hendelser står", async () => {
    expect(await lagre("h1", "Gammel", "  Ny tekst \n")).toEqual({ type: "skrevet" });
    expect(await node()).toEqual(
      somLagret([
        MANUELL("h0", { kommentar: "Urørt" }),
        MANUELL("h1", { kommentar: "Ny tekst", oppdatert: NAA }),
        BANK,
      ]),
    );
  });

  it("sett der ingen fantes, og tømming som fjerner nøkkelen", async () => {
    await settNode([MANUELL("h1", { kommentar: null })]);
    expect(await lagre("h1", undefined, "Første")).toEqual({ type: "skrevet" });
    expect(await node()).toEqual(
      somLagret([MANUELL("h1", { kommentar: "Første", oppdatert: NAA })]),
    );
    expect(await lagre("h1", "Første", "   ")).toEqual({ type: "skrevet" });
    const etter = (await node()) as Record<string, unknown>[];
    expect(Object.hasOwn(etter[0]!, "kommentar")).toBe(false);
    expect(etter).toEqual(somLagret([MANUELL("h1", { kommentar: null, oppdatert: NAA })]));
  });

  it("identisk normalisert verdi: `allerede`, ingenting endret (heller ikke `oppdatert`)", async () => {
    const foer = await node();
    expect(await lagre("h1", "Gammel", " Gammel ")).toEqual({ type: "stopp", utfall: "allerede" });
    expect(await node()).toEqual(foer);
  });

  it("kommentaren endret av en annen: `konflikt`, den andres kommentar står", async () => {
    await db().ref(`${NODE()}/1/kommentar`).set("Annen enhet");
    const foer = await node();
    expect(await lagre("h1", "Gammel", "Min")).toEqual({ type: "stopp", utfall: "konflikt" });
    expect(await node()).toEqual(foer);
  });

  it("andre felt endret av en annen: skrives på fersk verdi, de andre endringene står", async () => {
    await db().ref(`${NODE()}/1/status`).set("paa_vent");
    await db().ref(`${NODE()}/1/fordelinger/0/belop`).set(99);
    expect(await lagre("h1", "Gammel", "Min")).toEqual({ type: "skrevet" });
    const etter = (await node()) as Record<string, unknown>[];
    expect(etter[1]).toMatchObject({ status: "paa_vent", kommentar: "Min", oppdatert: NAA });
    expect((etter[1]!.fordelinger as { belop: number }[])[0]!.belop).toBe(99);
  });

  it("reindeksering: målet finnes på ny indeks via id", async () => {
    await settNode([BANK, MANUELL("h0", { kommentar: "Urørt" }), MANUELL("hX"), MANUELL("h1")]);
    expect(await lagre("h1", "Gammel", "Min")).toEqual({ type: "skrevet" });
    const etter = (await node()) as Record<string, unknown>[];
    expect(etter.map((h) => [h.id, h.kommentar])).toEqual([
      ["hb", undefined],
      ["h0", "Urørt"],
      ["hX", "Gammel"],
      ["h1", "Min"],
    ]);
  });

  it("duplikat-id: `tvetydig`; slettet hendelse: `mangler` — ingenting skrevet eller gjenopprettet", async () => {
    await settNode([MANUELL("h1"), MANUELL("h1", { kommentar: "Kopi" })]);
    let foer = await node();
    expect(await lagre("h1", "Gammel", "Min")).toEqual({ type: "stopp", utfall: "tvetydig" });
    expect(await node()).toEqual(foer);
    await settNode([MANUELL("h0", { kommentar: "Urørt" })]);
    foer = await node();
    expect(await lagre("h1", "Gammel", "Min")).toEqual({ type: "stopp", utfall: "mangler" });
    expect(await node()).toEqual(foer);
  });

  it("et stopp reindekserer ikke en sparsom node", async () => {
    await settNode({ "0": MANUELL("h0"), "5": MANUELL("h1", { kommentar: "Annen" }) });
    const foer = await node();
    expect(await lagre("h1", "Gammel", "Min")).toEqual({ type: "stopp", utfall: "konflikt" });
    expect(await node()).toEqual(foer);
  });

  it("mellomværende, bankkoblet og kvitteringskoblet avvises (`ikkeBerettiget`) uten skriving", async () => {
    await settNode([
      MANUELL("hm", { mellomvaerende: { avtaleId: "a1", rolle: "kostnad" } }),
      { ...BANK, kommentar: "Bank" },
      MANUELL("hr", { receiptId: "r1" }),
    ]);
    const foer = await node();
    for (const [id, kilde] of [
      ["hm", "Gammel"],
      ["hb", "Bank"],
      ["hr", "Gammel"],
    ] as const) {
      expect(await lagre(id, kilde, "Min")).toEqual({ type: "stopp", utfall: "ikkeBerettiget" });
    }
    expect(await node()).toEqual(foer);
  });

  it("ugyldig lagret form endres aldri", async () => {
    await settNode([MANUELL("h1", { kommentar: 42 })]);
    const foer = await node();
    expect(await lagre("h1", undefined, "Min")).toEqual({ type: "stopp", utfall: "ugyldig" });
    expect(await node()).toEqual(foer);
  });

  it("frakoblet: fristen gir `ukjent`; kontrollen ser kilden; forsøket når likevel frem uendret når nettet kommer tilbake", async () => {
    const av = await lytt();
    goOffline(getFirebaseDatabase());
    expect(await lagre("h1", "Gammel", "Min", { fristMs: 300 })).toEqual({ type: "ukjent" });
    const forsok: KommentarForsok = {
      kontekst: "k",
      hendelseId: "h1",
      kilde: "Gammel",
      sendt: "Min",
    };
    expect(await sjekk(forsok)).toBe("likKilde"); // beviser IKKE at forsøket ikke ble lagret
    goOnline(getFirebaseDatabase());
    await vi.waitFor(async () => expect(await sjekk(forsok)).toBe("likSendt"), { timeout: 5_000 });
    expect(await node()).toEqual(
      somLagret([
        MANUELL("h0", { kommentar: "Urørt" }),
        MANUELL("h1", { kommentar: "Min", oppdatert: NAA }),
        BANK,
      ]),
    );
    av();
  });

  it("frakoblet forsøk der en annen har endret listen imellom: beregnes aldri på nytt etter fristen, og skriver ingenting", async () => {
    const av = await lytt();
    goOffline(getFirebaseDatabase());
    expect(await lagre("h1", "Gammel", "Min", { fristMs: 300 })).toEqual({ type: "ukjent" });
    await db().ref(`${NODE()}/0/status`).set("paa_vent"); // en annen endrer en annen hendelse
    const foer = await node();
    goOnline(getFirebaseDatabase());
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await node()).toEqual(foer);
    av();
  });

  it("ny innlogging med SAMME uid er en ny sesjon: et forsøk bundet til den gamle sender og leser ingenting (`byttet`)", async () => {
    const gammel = aktivSesjon()!;
    await signOut(getFirebaseAuth());
    await logInn();
    expect(aktivSesjon()).not.toBe(gammel);
    const foer = await node();
    expect(await lagre("h1", "Gammel", "Min", { sesjon: gammel })).toEqual({ type: "byttet" });
    expect(await lesForsoningNodeFersk(FAM, "hendelser", { sesjon: gammel })).toEqual({
      type: "byttet",
    });
    expect(await node()).toEqual(foer);
    expect(await lagre("h1", "Gammel", "Min", { sesjon: aktivSesjon()! })).toEqual({
      type: "skrevet",
    });
  });

  it("utlogget: `avvist` før noe sendes; annen familie: `avvist` og ingenting skrevet", async () => {
    await settNode([MANUELL("h1")], FREMMED);
    await signOut(getFirebaseAuth());
    expect(await lagre("h1", "Gammel", "Min")).toEqual({ type: "avvist" });
    await logInn();
    expect(await lagre("h1", "Gammel", "Min", { fam: FREMMED })).toEqual({ type: "avvist" });
    expect(await node(FREMMED)).toEqual(somLagret([MANUELL("h1")]));
    expect(await lesForsoningNodeFersk(FREMMED, "hendelser")).toEqual({ type: "avvist" });
  });
});
