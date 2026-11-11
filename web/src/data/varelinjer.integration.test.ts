/**
 * Beskrivende varelinjer (#59, kvitteringer C) mot en EKTE Firebase
 * Emulator Suite-instans — aldri produksjon (`npm run test:integration`).
 * Syntetiske kvitteringer.
 *
 * Låser:
 *  - bare `varelinjer*` på riktig kvittering endres; alle andre felt
 *    (splits/eiere, matching, kobling, bilde/Drive/vedlegg, ukjente felt)
 *    og alle andre kvitteringer er rått uendret;
 *  - to enheter fra samme grunnlag: nøyaktig én lagres, den andre får
 *    konflikt; identisk retry gir «allerede»;
 *  - en annen editor (`oppdaterKvittering`, forberedt FØR varelinjene ble
 *    lagret) sletter ikke varelinjene;
 *  - verdiene overlever en ekte RTDB-rundtur (0, negative, desimaler).
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { KvitteringRecord, Varelinje } from "@app-types/forsoning";
import { oppdaterKvittering } from "@domain/forsoning/kvitteringSkriving";
import {
  type VarelinjeUtfall,
  lagreVarelinjer,
  parseVarelinjer,
} from "@domain/forsoning/varelinjer";
import { getFirebaseAuth } from "./firebase";
import { forsoningNodePath, transactForsoningNode } from "./forsoningSkriving.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const T = "2026-11-02T10:00:00.000Z";

let adminApp: AdminApp;
const admin = () => getAdminDatabase(adminApp);
const sti = forsoningNodePath(FAMILY_ID, "receipts");
const lesRaa = async () => (await admin().ref(sti).get()).val() as Record<string, unknown>[];

const R1 = {
  id: "r1",
  merchant: "Syntetisk butikk",
  purchaseDate: "2026-11-01",
  total: 291.5,
  allocationMode: "split",
  splits: [
    {
      targetType: "budget",
      targetId: "mat",
      targetName: "Mat",
      amount: 200,
      eiere: [{ person: "Felles", prosent: 100 }],
    },
    {
      targetType: "budget",
      targetId: "hus",
      targetName: "Hus",
      amount: 91.5,
      eiere: [
        { person: "A", prosent: 50 },
        { person: "B", prosent: 50 },
      ],
    },
  ],
  matchingStatus: "matched",
  hendelseId: null,
  transactionId: "t-legacy",
  imageUrl: "data:image/png;base64,AAAA",
  driveFileId: "drive-1",
  driveWebViewLink: "https://drive.example/1",
  vedlegg: [
    {
      sha256: "a".repeat(64),
      type: "image/png",
      storrelse: 10,
      filnavn: "k.png",
      lastetOpp: T,
      av: "S",
    },
  ],
  fremtidigFelt: { nestet: { x: 1 } },
  createdAt: T,
  updatedAt: T,
};
const R2 = { id: "r2", merchant: "Annen", total: 10, ukjent: true };

const linjer: Varelinje[] = [
  {
    id: "l1",
    art: "vare",
    tekst: "Epler",
    mengde: 0.452,
    enhet: "kg",
    enhetsprisOre: 3990,
    belopOre: 1803,
  },
  { id: "l2", art: "vare", tekst: "Kaffe", belopOre: 9990, rabattOre: 2000 },
  { id: "l3", art: "pant", tekst: "Pantelapp", belopOre: -300 },
  { id: "l4", art: "vare", tekst: "Gratis pose", belopOre: 0 },
  { id: "l5", art: "vare", tekst: "Ukjent pris" },
];

async function lagre(
  ny: Varelinje[],
  forventet: number,
  receiptId = "r1",
): Promise<VarelinjeUtfall> {
  let utfall: VarelinjeUtfall = "konflikt";
  await transactForsoningNode<KvitteringRecord>(
    FAMILY_ID,
    "receipts",
    (prev) => {
      const r = lagreVarelinjer(prev, receiptId, ny, forventet, T);
      utfall = r.utfall;
      return r.neste;
    },
    { applyLocally: false },
  );
  return utfall;
}

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "varelinjer-integration-test-admin",
  );
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await admin().ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  const customToken = await getAdminAuth(adminApp).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), customToken);
});

beforeEach(async () => {
  // Slik legacy skriver: hele listen som array.
  await admin().ref(sti).set([R1, R2]);
});

afterAll(async () => {
  await admin().ref(sti).remove();
  await deleteApp(adminApp);
});

describe("varelinjer på receipts (emulator)", () => {
  it("bare varelinjefeltene på r1 endres; alt annet er rått uendret", async () => {
    const foer = await lesRaa();
    expect(await lagre(linjer, 0)).toBe("lagret");
    const etter = await lesRaa();
    const { varelinjer, varelinjerVersjon, varelinjerSkrivId, varelinjerOppdatert, ...resten } =
      etter[0]!;
    expect(resten).toEqual(foer[0]);
    expect(etter[1]).toEqual(foer[1]);
    expect(varelinjerVersjon).toBe(1);
    expect(varelinjerSkrivId).toBeTruthy();
    expect(varelinjerOppdatert).toBe(T);
    // Rundtur: 0, negative og desimaler overlever; manglende felt er fortsatt mangler.
    expect(parseVarelinjer(varelinjer)).toEqual(linjer);
  });

  it("to enheter fra samme grunnlag: nøyaktig én lagres, den andre får konflikt", async () => {
    const [a, b] = await Promise.all([
      lagre([{ id: "x", art: "vare", tekst: "Fra A", belopOre: 100 }], 0),
      lagre([{ id: "y", art: "vare", tekst: "Fra B", belopOre: 200 }], 0),
    ]);
    expect([a, b].sort()).toEqual(["konflikt", "lagret"]);
    const r1 = (await lesRaa())[0]!;
    expect(r1.varelinjerVersjon).toBe(1);
    expect((r1.varelinjer as unknown[]).length).toBe(1);
  });

  it("identisk retry gir «allerede» og skriver ikke en ny versjon", async () => {
    expect(await lagre(linjer, 0)).toBe("lagret");
    expect(await lagre(linjer, 0)).toBe("allerede");
    expect((await lesRaa())[0]!.varelinjerVersjon).toBe(1);
  });

  it("gammelt grunnlag etter en annen enhets lagring gir konflikt, og den lagrede står", async () => {
    await lagre(linjer, 0);
    expect(await lagre([{ id: "z", art: "vare", tekst: "Gammelt skjema" }], 0)).toBe("konflikt");
    expect(parseVarelinjer((await lesRaa())[0]!.varelinjer)).toEqual(linjer);
  });

  it("annen editor forberedt før varelinjelagringen sletter ikke varelinjene", async () => {
    const snapshot = { receipts: [R1 as unknown as KvitteringRecord], hendelser: [] };
    const redigering = oppdaterKvittering(snapshot, "r1", { merchant: "Nytt navn" }, T)!;
    await lagre(linjer, 0);
    await transactForsoningNode<KvitteringRecord>(
      FAMILY_ID,
      "receipts",
      redigering.endring!.receipts!,
      { applyLocally: false },
    );
    const r1 = (await lesRaa())[0]!;
    expect(r1.merchant).toBe("Nytt navn");
    expect(r1.varelinjerVersjon).toBe(1);
    expect(parseVarelinjer(r1.varelinjer)).toEqual(linjer);
    expect(r1.vedlegg).toEqual(R1.vedlegg);
  });

  it("ukjente felt på lagrede linjer bevares ved redigering", async () => {
    await admin()
      .ref(sti)
      .set([
        {
          ...R1,
          varelinjer: [{ id: "l1", art: "vare", tekst: "Epler", fremtidig: "behold" }],
          varelinjerVersjon: 3,
        },
        R2,
      ]);
    expect(await lagre([{ id: "l1", art: "vare", tekst: "Røde epler", belopOre: 1500 }], 3)).toBe(
      "lagret",
    );
    expect((await lesRaa())[0]!.varelinjer).toEqual([
      { id: "l1", art: "vare", tekst: "Røde epler", belopOre: 1500, fremtidig: "behold" },
    ]);
  });

  it("ukjent kvittering gir «mangler» og endrer ingenting", async () => {
    const foer = await lesRaa();
    expect(await lagre(linjer, 0, "finnes-ikke")).toBe("mangler");
    expect(await lesRaa()).toEqual(foer);
  });

  it("null i en linje avvises før noe skrives", async () => {
    const foer = await lesRaa();
    await expect(
      lagre([{ id: "l1", art: "vare", tekst: "x", belopOre: null } as unknown as Varelinje], 0),
    ).rejects.toThrow("varelinjer/0/belopOre");
    expect(await lesRaa()).toEqual(foer);
  });
});
