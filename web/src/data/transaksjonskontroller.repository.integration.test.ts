/**
 * Datalag-/integrasjonstest for «kvalitetssikret» (#59, 6542594363) mot en
 * EKTE Firebase Emulator Suite-instans — aldri produksjon
 * (`npm run test:integration`). Syntetiske data.
 *
 * Låser: kontrollen skrives målrettet til sin egen node under stabil
 * transaksjons-ID, forsoningsnodene røres aldri, sporet bevares ved
 * oppheving/ny kontroll, og en kontroll som er endret et annet sted kan
 * ikke overskrives av en bruker som så en eldre tilstand.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { KontrollMerke, Transaksjonskontroll } from "@app-types/kvalitetssikring";
import { getFirebaseAuth } from "./firebase";
import {
  KontrollEndretAvAndre,
  skrivTransaksjonskontroll,
  subscribeTransaksjonskontroller,
  transaksjonskontrollPath,
} from "./transaksjonskontroller.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const FAM = `families/${FAMILY_ID}`;

let adminApp: AdminApp;
const admin = () => getAdminDatabase(adminApp);

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "transaksjonskontroller-integration-test-admin",
  );
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await admin().ref(`${FAM}/members/${uid}`).set(true);
  const customToken = await getAdminAuth(adminApp).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), customToken);
});

afterAll(async () => {
  await admin().ref(`${FAM}/transaksjonskontroller`).remove();
  await admin().ref(`${FAM}/transaksjoner`).remove();
  await deleteApp(adminApp);
});

const merke = (o: Partial<KontrollMerke> = {}): KontrollMerke => ({
  grunnlag: "a".repeat(64),
  versjon: 1,
  tid: "2026-10-31T11:00:00.000Z",
  av: "uid-helen",
  avNavn: "Helen",
  ...o,
});
const merk =
  (m: KontrollMerke, sporId: string, tid = "t/1.x") =>
  (f: Transaksjonskontroll | null) => ({
    transaksjonId: tid,
    gjeldende: m,
    spor: { ...(f?.spor ?? {}), [sporId]: { ...m, handling: "kvalitetssikret" as const } },
  });
const opphev =
  (m: KontrollMerke, sporId: string, tid = "t/1.x") =>
  (f: Transaksjonskontroll | null) => ({
    transaksjonId: tid,
    gjeldende: null,
    spor: { ...(f?.spor ?? {}), [sporId]: { ...m, handling: "opphevet" as const } },
  });

function lesViaSubscription() {
  return new Promise<Map<string, Transaksjonskontroll>>((resolve) => {
    const unsub = subscribeTransaksjonskontroller(FAMILY_ID, (k) => {
      unsub();
      resolve(k);
    });
  });
}

describe("transaksjonskontroller.repository mot emulatoren", () => {
  it("skriver målrettet under stabil ID, bevarer spor, og rører ikke transaksjonene", async () => {
    // ID med tegn Firebase ikke tillater i nøkler, kodes tapsfritt.
    const tid = "t/1.x";
    const transaksjoner = [{ id: tid, dato: "2026-09-12", belop: 1, retning: "ut" }];
    await admin().ref(`${FAM}/transaksjoner`).set(transaksjoner);

    const m1 = merke();
    await skrivTransaksjonskontroll(FAMILY_ID, tid, null, merk(m1, "s1"));
    let k = (await lesViaSubscription()).get(tid)!;
    expect(k.gjeldende).toEqual(m1);

    // Oppheving: gjeldende null, sporet består.
    const m2 = merke({ tid: "2026-10-31T12:00:00.000Z" });
    await skrivTransaksjonskontroll(FAMILY_ID, tid, m1, opphev(m2, "s2"));
    k = (await lesViaSubscription()).get(tid)!;
    expect(k.gjeldende).toBeNull();
    expect(Object.keys(k.spor).sort()).toEqual(["s1", "s2"]);

    // Ny kontroll etter oppheving: sporet vokser.
    const m3 = merke({ tid: "2026-10-31T13:00:00.000Z", grunnlag: "b".repeat(64) });
    await skrivTransaksjonskontroll(FAMILY_ID, tid, null, merk(m3, "s3"));
    k = (await lesViaSubscription()).get(tid)!;
    expect(k.gjeldende).toEqual(m3);
    expect(Object.keys(k.spor).sort()).toEqual(["s1", "s2", "s3"]);

    // Lagret under den kodede stien, og transaksjonene er urørt.
    expect((await admin().ref(transaksjonskontrollPath(FAMILY_ID, tid)).get()).exists()).toBe(true);
    expect((await admin().ref(`${FAM}/transaksjoner`).get()).val()).toEqual(transaksjoner);
  });

  it("samtidig endring: en eldre tilstand kan ikke overskrive en nyere kontroll", async () => {
    const tid = "t-samtidig";
    const eldre = merke({ tid: "2026-10-31T10:00:00.000Z" });
    await skrivTransaksjonskontroll(FAMILY_ID, tid, null, merk(eldre, "s1", tid));
    // En annen enhet kvalitetssikrer på nytt.
    const nyere = merke({ tid: "2026-10-31T10:05:00.000Z", av: "uid-eivind", avNavn: "Eivind" });
    await skrivTransaksjonskontroll(FAMILY_ID, tid, eldre, merk(nyere, "s2", tid));

    // Brukeren som fortsatt så den eldre kontrollen, prøver å oppheve.
    await expect(
      skrivTransaksjonskontroll(FAMILY_ID, tid, eldre, opphev(merke(), "s3", tid)),
    ).rejects.toBeInstanceOf(KontrollEndretAvAndre);
    // Brukeren som trodde raden var ukontrollert, prøver å merke.
    await expect(
      skrivTransaksjonskontroll(FAMILY_ID, tid, null, merk(merke(), "s4", tid)),
    ).rejects.toBeInstanceOf(KontrollEndretAvAndre);

    const k = (await lesViaSubscription()).get(tid)!;
    expect(k.gjeldende).toEqual(nyere);
    expect(Object.keys(k.spor).sort()).toEqual(["s1", "s2"]);
  });

  it("oppheving av en kontroll som ikke finnes avvises (null-først fra SDK-et)", async () => {
    await expect(
      skrivTransaksjonskontroll(FAMILY_ID, "t-finnes-ikke", merke(), opphev(merke(), "s1")),
    ).rejects.toBeInstanceOf(KontrollEndretAvAndre);
    expect(
      (await admin().ref(transaksjonskontrollPath(FAMILY_ID, "t-finnes-ikke")).get()).exists(),
    ).toBe(false);
  });
});
