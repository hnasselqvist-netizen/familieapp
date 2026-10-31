/**
 * Datalag-/integrasjonstest for mellomværende (#95) mot en EKTE Firebase
 * Emulator Suite-instans — aldri produksjon (`npm run test:integration`).
 * Syntetiske data.
 *
 * Låser:
 *  - avtalen opprettes én gang og overskrives aldri ved retry;
 *  - kostnad og oppgjør skrives som hendelser i dagens array-form via
 *    forsoningens helnode-transaksjon, og bankhendelser/transaksjoner røres
 *    ikke;
 *  - to samtidige bekreftelser av samme måned gir nøyaktig ETT oppgjør, og
 *    den andre ser «allerede oppgjort» (validert mot fersk serververdi).
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { HendelseRecord } from "@app-types/forsoning";
import type { Mellomvaerende } from "@app-types/mellomvaerende";
import { goOffline, goOnline, onValue, ref } from "firebase/database";
import {
  angreOppgjor,
  bekreftOppgjor,
  byggMellomvaerende,
  medKostnadHendelse,
  mellomvaerendeStatus,
  type OppgjorResultat,
  type OppgjorUtfall,
  rettOppgjor,
} from "@domain/mellomvaerende/mellomvaerende";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import { transactForsoningNode } from "./forsoningSkriving.repository";
import {
  mellomvaerenderPath,
  opprettMellomvaerende,
  subscribeMellomvaerender,
} from "./mellomvaerender.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const FAM = `families/${FAMILY_ID}`;

let adminApp: AdminApp;
const admin = () => getAdminDatabase(adminApp);

const AVTALE: Mellomvaerende = byggMellomvaerende(
  {
    navn: "Gave fra mamma",
    motpart: "Mamma",
    opprinneligOre: 329900,
    startMaaned: "2026-10",
    kostnad: {
      postId: "gaver",
      postNavn: "Gaver",
      plasseringType: "budget",
      eiere: [{ person: "Felles", prosent: 100 }],
    },
    oppgjor: {
      postId: "abonnementer",
      postNavn: "Abonnementer",
      plasseringType: "budget",
      eiere: [{ person: "Felles", prosent: 100 }],
    },
    standardBelopOre: 46700,
  },
  "mvtest1",
  "Helen",
  "2026-10-31T12:00:00.000Z",
);

const BANKHENDELSE = {
  id: "h-bank",
  status: "ferdig",
  paaVentAarsak: null,
  transaksjonId: "t-bank",
  receiptId: null,
  fordelinger: [
    {
      plasseringId: "abonnementer",
      plasseringType: "budget",
      plasseringNavn: "Abonnementer",
      belop: 199,
      eiere: [{ person: "Felles", prosent: 100 }],
    },
  ],
  dato: "2026-10-05",
  regelId: null,
  opprettet: "x",
  oppdatert: "x",
};

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "mellomvaerender-integration-test-admin",
  );
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await admin().ref(`${FAM}/members/${uid}`).set(true);
  const customToken = await getAdminAuth(adminApp).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), customToken);
});

beforeEach(async () => {
  await admin().ref(`${FAM}/mellomvaerender`).remove();
  await admin().ref(`${FAM}/hendelser`).set([BANKHENDELSE]);
  await admin()
    .ref(`${FAM}/transaksjoner`)
    .set([{ id: "t-bank", dato: "2026-10-05", tekst: "STREAMING", belop: 199, retning: "ut" }]);
});

afterAll(async () => {
  await admin().ref(`${FAM}/mellomvaerender`).remove();
  await admin().ref(`${FAM}/hendelser`).remove();
  await admin().ref(`${FAM}/transaksjoner`).remove();
  await deleteApp(adminApp);
});

const lesHendelser = async () =>
  (await admin().ref(`${FAM}/hendelser`).get()).val() as HendelseRecord[];

async function bekreft(maaned: string, ore: number): Promise<OppgjorUtfall> {
  let utfall: OppgjorUtfall = "lagret";
  await transactForsoningNode<HendelseRecord>(FAMILY_ID, "hendelser", (prev) => {
    const r = bekreftOppgjor(prev, AVTALE, maaned, ore, "Helen", "2026-10-31T12:30:00.000Z");
    utfall = r.utfall;
    return r.neste;
  });
  return utfall;
}

async function kjor(steg: (prev: HendelseRecord[]) => OppgjorResultat): Promise<OppgjorUtfall> {
  let utfall: OppgjorUtfall = "lagret";
  await transactForsoningNode<HendelseRecord>(
    FAMILY_ID,
    "hendelser",
    (prev) => {
      const r = steg(prev);
      utfall = r.utfall;
      return r.neste;
    },
    { applyLocally: false },
  );
  return utfall;
}

describe("mellomvaerender-node + hendelser (emulator)", () => {
  it("avtalen opprettes én gang; retry overskriver ikke og returnerer den LAGREDE avtalen", async () => {
    expect(await opprettMellomvaerende(FAMILY_ID, AVTALE)).toEqual(AVTALE);
    const retry = await opprettMellomvaerende(FAMILY_ID, {
      ...AVTALE,
      navn: "Endret ved retry",
      opprinneligOre: 400000,
    });
    expect(retry).toEqual(AVTALE);
    const lagret = (
      await admin()
        .ref(`${mellomvaerenderPath(FAMILY_ID)}/mvtest1`)
        .get()
    ).val();
    expect(lagret).toMatchObject({ navn: "Gave fra mamma", opprinneligOre: 329900 });

    const mottatt = await new Promise<Mellomvaerende[]>((resolve) => {
      const stopp = subscribeMellomvaerender(FAMILY_ID, (a) => {
        stopp();
        resolve(a);
      });
    });
    expect(mottatt).toEqual([AVTALE]);
  });

  it("kostnad og oppgjør skrives som array-hendelser; bankdata røres ikke", async () => {
    const transaksjonerFor = (await admin().ref(`${FAM}/transaksjoner`).get()).val();
    const bankFor = (await lesHendelser())[0];
    await transactForsoningNode<HendelseRecord>(FAMILY_ID, "hendelser", (prev) =>
      medKostnadHendelse(prev, AVTALE, "Helen", "2026-10-31T12:00:00.000Z"),
    );
    // Retry av kostnaden: fortsatt én.
    await transactForsoningNode<HendelseRecord>(FAMILY_ID, "hendelser", (prev) =>
      medKostnadHendelse(prev, AVTALE, "Helen", "2026-10-31T12:00:00.000Z"),
    );
    expect(await bekreft("2026-10", 46700)).toBe("lagret");

    const h = await lesHendelser();
    expect(Array.isArray(h)).toBe(true);
    expect(h.map((x) => x.id)).toEqual(["h-bank", "mv-mvtest1-kostnad", "mv-mvtest1-2026-10"]);
    expect(h[0]).toEqual(bankFor);
    expect(h[2]).toMatchObject({
      kilde: "manuell",
      fordelinger: [{ plasseringId: "abonnementer", belop: -467 }],
      mellomvaerende: { id: "mvtest1", rolle: "oppgjor", maaned: "2026-10", belopOre: 46700 },
    });
    // Uten bankobservasjon (RTDB lagrer ikke `null`).
    expect(h[2]!.transaksjonId ?? null).toBeNull();
    expect(mellomvaerendeStatus(AVTALE, h, "2026-10").restOre).toBe(283200);
    expect((await admin().ref(`${FAM}/transaksjoner`).get()).val()).toEqual(transaksjonerFor);
  });

  it("to samtidige bekreftelser av samme måned gir ett oppgjør", async () => {
    await transactForsoningNode<HendelseRecord>(FAMILY_ID, "hendelser", (prev) =>
      medKostnadHendelse(prev, AVTALE, "Helen", "2026-10-31T12:00:00.000Z"),
    );
    const utfall = await Promise.all([bekreft("2026-10", 46700), bekreft("2026-10", 50000)]);
    expect([...utfall].sort()).toEqual(["allerede_oppgjort", "lagret"]);
    const h = await lesHendelser();
    expect(h.filter((x) => x.id === "mv-mvtest1-2026-10")).toHaveLength(1);
    const s = mellomvaerendeStatus(AVTALE, h, "2026-10");
    expect(s.oppgjor).toHaveLength(1);
    expect(s.restOre).toBe(329900 - s.oppgjor[0]!.belopOre);
  });

  it("samtidig rett/rett og rett/angre: bare én vinner, den andre ser «endret annet sted»", async () => {
    await kjor((prev) => ({
      neste: medKostnadHendelse(prev, AVTALE, "Helen", "x"),
      utfall: "lagret",
    }));
    expect(await bekreft("2026-10", 46700)).toBe("lagret");
    // Begge så versjon 1.
    const rr = await Promise.all([
      kjor((p) => rettOppgjor(p, AVTALE, "2026-10", 49900, 1, "A", "t")),
      kjor((p) => rettOppgjor(p, AVTALE, "2026-10", 50000, 1, "B", "t")),
    ]);
    expect([...rr].sort()).toEqual(["endret_annet_sted", "lagret"]);
    let o = mellomvaerendeStatus(AVTALE, await lesHendelser(), "2026-10").oppgjor[0]!;
    expect(o.versjon).toBe(2);
    const ra = await Promise.all([
      kjor((p) => rettOppgjor(p, AVTALE, "2026-10", 46700, 2, "A", "t")),
      kjor((p) => angreOppgjor(p, AVTALE, "2026-10", 2, "B", "t")),
    ]);
    expect([...ra].sort()).toEqual(["endret_annet_sted", "lagret"]);
    o = mellomvaerendeStatus(AVTALE, await lesHendelser(), "2026-10").oppgjor[0]!;
    expect(o.versjon).toBe(3);
    expect(o.spor.map((x) => x.handling)).toHaveLength(3);
  });

  it("applyLocally:false: lyttere ser ikke oppgjøret før serveren har bekreftet (utsatt ack)", async () => {
    const db = getFirebaseDatabase();
    const sett: string[][] = [];
    const stopp = onValue(ref(db, `${FAM}/hendelser`), (snap) =>
      sett.push(
        Object.values((snap.val() ?? {}) as Record<string, HendelseRecord>).map((h) => h.id),
      ),
    );
    await new Promise((r) => setTimeout(r, 200));
    const harOppgjor = () => sett.some((ids) => ids.includes("mv-mvtest1-2026-10"));

    goOffline(db);
    const skriving = kjor((p) => bekreftOppgjor(p, AVTALE, "2026-10", 46700, "Helen", "t"));
    await new Promise((r) => setTimeout(r, 300));
    expect(harOppgjor()).toBe(false);
    goOnline(db);
    expect(await skriving).toBe("lagret");
    await new Promise((r) => setTimeout(r, 200));
    expect(harOppgjor()).toBe(true);

    // Kontroll: med applyLocally:true ville lytteren sett verdien før ack.
    sett.length = 0;
    goOffline(db);
    const spekulativ = transactForsoningNode<HendelseRecord>(
      FAMILY_ID,
      "hendelser",
      (p) => bekreftOppgjor(p, AVTALE, "2026-11", 46700, "Helen", "t").neste,
    );
    await new Promise((r) => setTimeout(r, 300));
    expect(sett.some((ids) => ids.includes("mv-mvtest1-2026-11"))).toBe(true);
    goOnline(db);
    await spekulativ;
    stopp();
  });
});
