/**
 * Metadata for kvitteringsfiler (#59, B1) mot EKTE RTDB-emulator — aldri
 * produksjon. Låser skriveveien klienten bruker etter opplasting:
 * helnode-transaksjon på `receipts` med stabil kvitterings-id, bevaring av
 * alle andre felt/kvitteringer og økonomien (hendelser røres ikke), og
 * idempotens ved retry og samtidighet.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KvitteringFil, KvitteringRecord } from "@app-types/forsoning";
import { medKvitteringsfil } from "@domain/forsoning/kvitteringsfil";
import { getFirebaseAuth } from "./firebase";
import { transactForsoningNode } from "./forsoningSkriving.repository";

const FAMILY_ID = "familie1";
const FAM = `families/${FAMILY_ID}`;
let adminApp: AdminApp;
const admin = () => getAdminDatabase(adminApp);

const fil = (sha: string): KvitteringFil => ({
  sha256: sha.repeat(64),
  type: "application/pdf",
  storrelse: 9,
  filnavn: "k.pdf",
  lastetOpp: "2026-10-31T12:00:00Z",
  av: "Helen",
});

beforeAll(async () => {
  adminApp = initializeApp(
    {
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    },
    "kvitteringsfil-integration-admin",
  );
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await admin().ref(`${FAM}/members/${uid}`).set(true);
  await signInWithCustomToken(
    getFirebaseAuth(),
    await getAdminAuth(adminApp).createCustomToken(uid),
  );
});

beforeEach(async () => {
  await admin()
    .ref(`${FAM}/receipts`)
    .set([
      { id: "k2", merchant: "Kiwi", total: 50 },
      {
        id: "k1",
        merchant: "Rema",
        total: 100,
        hendelseId: "h1",
        splits: [{ targetType: "budget", targetId: "mat", targetName: "Mat", amount: 100 }],
        imageUrl: "data:image/png;base64,AAAA",
      },
    ]);
  await admin()
    .ref(`${FAM}/hendelser`)
    .set([{ id: "h1", status: "ferdig", receiptId: "k1", dato: "2026-10-01" }]);
});

afterAll(async () => {
  await admin().ref(`${FAM}/receipts`).remove();
  await admin().ref(`${FAM}/hendelser`).remove();
  await deleteApp(adminApp);
});

const leggTil = (receiptId: string, f: KvitteringFil) =>
  transactForsoningNode<KvitteringRecord>(
    FAMILY_ID,
    "receipts",
    (prev) => medKvitteringsfil(prev, receiptId, f).neste,
    { applyLocally: false },
  );

describe("kvitteringsfil-metadata (emulator)", () => {
  it("skrives på riktig kvittering (stabil id), bevarer alt annet og rører ikke økonomien", async () => {
    const hendelserFor = (await admin().ref(`${FAM}/hendelser`).get()).val();
    await leggTil("k1", fil("a"));
    const r = (await admin().ref(`${FAM}/receipts`).get()).val() as KvitteringRecord[];
    expect(Array.isArray(r)).toBe(true);
    expect(r[0]).toEqual({ id: "k2", merchant: "Kiwi", total: 50 });
    expect(r[1]).toMatchObject({
      id: "k1",
      merchant: "Rema",
      hendelseId: "h1",
      imageUrl: "data:image/png;base64,AAAA",
      vedlegg: [fil("a")],
    });
    expect((await admin().ref(`${FAM}/hendelser`).get()).val()).toEqual(hendelserFor);
  });

  it("retry og samtidige skrivinger av samme fil gir én oppføring; ulike filer bevares begge", async () => {
    await Promise.all([leggTil("k1", fil("a")), leggTil("k1", fil("a")), leggTil("k1", fil("b"))]);
    await leggTil("k1", fil("a"));
    const r = (await admin().ref(`${FAM}/receipts`).get()).val() as KvitteringRecord[];
    expect(
      r
        .find((x) => x.id === "k1")!
        .vedlegg!.map((f) => f.sha256[0])
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("annen redigering av kvitteringen etterpå bevarer filmetadataen", async () => {
    await leggTil("k1", fil("a"));
    await transactForsoningNode<KvitteringRecord>(FAMILY_ID, "receipts", (prev) =>
      prev.map((x) => (x.id === "k1" ? { ...x, merchant: "Rema 1000" } : x)),
    );
    const r = (await admin().ref(`${FAM}/receipts`).get()).val() as KvitteringRecord[];
    expect(r.find((x) => x.id === "k1")).toMatchObject({
      merchant: "Rema 1000",
      vedlegg: [fil("a")],
    });
  });
});
