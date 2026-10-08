/**
 * Datalag-/integrasjonstest mot en EKTE Firebase Emulator Suite-instans —
 * aldri produksjon eller en Hosting-forhåndsvisning (`npm run test:integration`).
 * Låser at saldokontroller skrives målrettet til sin egen node og aldri
 * rører transaksjonene.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getFirebaseAuth } from "./firebase";
import { lagreSaldokontroll, subscribeSaldokontroller } from "./saldokontroller.repository";
import type { SaldoKontroll } from "@app-types/avstemming";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const FAM = `families/${FAMILY_ID}`;

let adminApp: AdminApp;
const admin = () => getAdminDatabase(adminApp);

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "saldokontroller-integration-test-admin",
  );
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await admin().ref(`${FAM}/members/${uid}`).set(true);
  const customToken = await getAdminAuth(adminApp).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), customToken);
});

afterAll(async () => {
  await admin().ref(`${FAM}/saldokontroller`).remove();
  await admin().ref(`${FAM}/transaksjoner`).remove();
  await deleteApp(adminApp);
});

const kontroll = (o: Partial<SaldoKontroll>): SaldoKontroll => ({
  konto: "felleskonto",
  maaned: "2026-09",
  dato: "2026-09-30",
  faktiskSaldo: 1234.5,
  registrert: "2026-10-08T12:00:00.000Z",
  oppdatert: "2026-10-08T12:00:00.000Z",
  grunnlag: { antall: 3, nettoOre: -12_345 },
  ...o,
});

function venterPaa(pred: (k: SaldoKontroll[]) => boolean) {
  return new Promise<SaldoKontroll[]>((resolve) => {
    const unsub = subscribeSaldokontroller(FAMILY_ID, (k) => {
      if (pred(k)) {
        unsub();
        resolve(k);
      }
    });
  });
}

describe("saldokontroller.repository (emulator)", () => {
  it("skriver per konto og måned, erstatter idempotent og rører ikke transaksjonene", async () => {
    const transaksjoner = [{ id: "t1", dato: "2026-09-10", belop: 10, retning: "ut" }];
    await admin().ref(`${FAM}/transaksjoner`).set(transaksjoner);

    await lagreSaldokontroll(FAMILY_ID, kontroll({}));
    await lagreSaldokontroll(FAMILY_ID, kontroll({ konto: "MC", faktiskSaldo: -7000 }));
    await lagreSaldokontroll(FAMILY_ID, kontroll({ faktiskSaldo: 999 })); // samme konto/måned

    const node = (await admin().ref(`${FAM}/saldokontroller`).get()).val();
    expect(Object.keys(node).sort()).toEqual(["MC", "felleskonto"]);
    expect(node.felleskonto["2026-09"]).toMatchObject({ faktiskSaldo: 999, konto: "felleskonto" });
    expect(node.MC["2026-09"]).toMatchObject({ faktiskSaldo: -7000 });

    const lest = await venterPaa((k) => k.length === 2);
    expect(lest.map((k) => [k.konto, k.faktiskSaldo]).sort()).toEqual([
      ["MC", -7000],
      ["felleskonto", 999],
    ]);
    expect((await admin().ref(`${FAM}/transaksjoner`).get()).val()).toEqual(transaksjoner);
  });

  it("rå kontoverdier med ugyldige nøkkeltegn lagres trygt og leses tilbake med original konto", async () => {
    await lagreSaldokontroll(FAMILY_ID, kontroll({ konto: "1234.56.78901", faktiskSaldo: 1 }));
    const lest = await venterPaa((k) => k.some((x) => x.konto === "1234.56.78901"));
    expect(lest.find((x) => x.konto === "1234.56.78901")).toMatchObject({ faktiskSaldo: 1 });
    expect(
      (await admin().ref(`${FAM}/saldokontroller/1234_56_78901/2026-09/konto`).get()).val(),
    ).toBe("1234.56.78901");
  });
});
