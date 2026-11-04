/**
 * Datalag-/integrasjonstest mot en EKTE Firebase Emulator Suite-instans
 * (RTDB + Auth) — aldri produksjon eller en Hosting-forhåndsvisning.
 * Kjøres via `npm run test:integration`.
 *
 * Låser sameksistenskontrakten for `rules` (Kontrolltårn-beslutning
 * 5952884278, designnoten 5952769652): array-form med indeksnøkler og
 * `id` inne i elementet, helnode-transaksjon som kjører på nytt mot
 * fersk verdi, rollback til legacy uten tap/duplikat — og hvorfor React
 * ikke kan aktiveres mens legacy fortsatt skriver noden.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { goOffline, goOnline } from "firebase/database";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import {
  type Database as AdminDatabase,
  getDatabase as getAdminDatabase,
} from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { oppdaterRegel, slaSammenRegler, slettRegel } from "@domain/forsoning/regelsenter";
import { type EndreMalUtfall, endreRegelMal } from "@domain/forsoning/regelMal";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { RegelRecord } from "@app-types/forsoning";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import { rulesPath, subscribeRules, transactRules } from "./rules.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const NAA = "2026-10-02T12:00:00.000Z";

let adminApp: AdminApp;
let admin: AdminDatabase;

const regel = (id: string, felt: Partial<RegelRecord> = {}): RegelRecord => ({
  id,
  pattern: id,
  normalizedPattern: id.toLowerCase(),
  targetType: "budget",
  targetId: "b-mat",
  targetName: "Dagligvarer",
  mode: "suggest",
  timesUsed: 1,
  ...felt,
});

/** Slik legacy `setRules` skriver: hele listen som array (`dbSet(…/rules, next)`). */
const legacyDbSet = (liste: RegelRecord[]) => admin.ref(rulesPath(FAMILY_ID)).set(liste);
/** Slik legacy leser: `v ? Object.values(v) : []`. */
const legacyRead = async () => {
  const v = (await admin.ref(rulesPath(FAMILY_ID)).get()).val() as object | null;
  return (v ? Object.values(v) : []) as RegelRecord[];
};
const rawKeys = async () =>
  Object.keys(((await admin.ref(rulesPath(FAMILY_ID)).get()).val() as object | null) ?? {});
const ids = (liste: RegelRecord[]) => liste.map((r) => r.id);

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "rules-integration-test-admin",
  );
  admin = getAdminDatabase(adminApp);
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await admin.ref(`families/${FAMILY_ID}/members/${uid}`).set(true);
  await signInWithCustomToken(
    getFirebaseAuth(),
    await getAdminAuth(adminApp).createCustomToken(uid),
  );
});

beforeEach(async () => {
  await admin.ref(rulesPath(FAMILY_ID)).remove();
});

afterAll(async () => {
  await admin.ref(rulesPath(FAMILY_ID)).remove();
  await deleteApp(adminApp);
});

describe("rules.repository (emulator): shape", () => {
  it("leser legacy-skrevet array (indeksnøkler, id inne i elementet) i samme rekkefølge som legacy", async () => {
    await legacyDbSet([regel("a"), regel("b"), regel("c")]);
    const seen = await new Promise<RegelRecord[]>((resolve) => {
      const unsubscribe = subscribeRules(FAMILY_ID, (liste) => {
        if (liste.length === 3) {
          unsubscribe();
          resolve(liste);
        }
      });
    });
    expect(ids(seen)).toEqual(ids(await legacyRead()));
  });

  it("transactRules bevarer array-formen: indeksnøkler, `id` inne i elementet, aldri `rules/{id}`", async () => {
    await legacyDbSet([regel("a"), regel("b"), regel("c")]);
    const etter = await transactRules(FAMILY_ID, (prev) =>
      oppdaterRegel(prev, "b", { mode: "auto" }, NAA),
    );
    expect(await rawKeys()).toEqual(["0", "1", "2"]);
    expect(etter.find((r) => r.id === "b")).toMatchObject({ mode: "auto", updatedAt: NAA });
    expect(ids(await legacyRead())).toEqual(["a", "b", "c"]);

    await transactRules(FAMILY_ID, (prev) => slettRegel(prev, "a"));
    expect(await rawKeys()).toEqual(["0", "1"]);
    expect(ids(await legacyRead())).toEqual(["b", "c"]);
  });

  it("transactRules mot tom node skriver en array; tom liste fjerner noden (som legacy `dbSet([])`)", async () => {
    await transactRules(FAMILY_ID, (prev) => [...prev, regel("ny")]);
    expect(await rawKeys()).toEqual(["0"]);
    await transactRules(FAMILY_ID, (prev) => slettRegel(prev, "ny"));
    expect((await admin.ref(rulesPath(FAMILY_ID)).get()).exists()).toBe(false);
  });

  it("slaSammenRegler gjennom transaksjonen: én regel igjen med summert bruk", async () => {
    await legacyDbSet([regel("a", { timesUsed: 4 }), regel("b", { timesUsed: 7 }), regel("c")]);
    await transactRules(FAMILY_ID, (prev) => slaSammenRegler(prev, "a", "b", NAA));
    const etter = await legacyRead();
    expect(ids(etter)).toEqual(["b", "c"]);
    expect(etter[0]).toMatchObject({ timesUsed: 11, updatedAt: NAA });
  });
});

describe("rules.repository (emulator): sameksistens og rollback", () => {
  it("legacy `dbSet` MENS React-transaksjonen pågår → updateren kjøres på nytt mot fersk verdi, begge overlever", async () => {
    await legacyDbSet([regel("a"), regel("b")]);
    const db = getFirebaseDatabase();
    // Varm cache, så frakoblet: React-klienten har et snart utdatert øyeblikksbilde.
    const unsubscribe = subscribeRules(FAMILY_ID, () => {});
    await new Promise((r) => setTimeout(r, 300));
    goOffline(db);

    const sett: string[][] = [];
    const tx = transactRules(FAMILY_ID, (prev) => {
      sett.push(ids(prev));
      return oppdaterRegel(prev, "a", { mode: "auto" }, NAA);
    });
    await legacyDbSet([...(await legacyRead()), regel("legacy")]); // en annen enhet skriver
    goOnline(db);
    await tx;
    unsubscribe();

    expect(sett[0]).toEqual(["a", "b"]); // første forsøk så den utdaterte cachen …
    expect(sett.at(-1)).toEqual(["a", "b", "legacy"]); // … men skrevet ble beregningen fra fersk verdi
    const etter = await legacyRead();
    expect(ids(etter)).toEqual(["a", "b", "legacy"]);
    expect(etter[0]).toMatchObject({ mode: "auto" });
  });

  it("rollback: legacy leser alt React skrev, og skriver videre uten tap eller duplikat", async () => {
    await legacyDbSet([regel("a"), regel("b")]);
    await transactRules(FAMILY_ID, (prev) => [
      ...oppdaterRegel(prev, "a", { active: false }, NAA),
      regel("react-ny"),
    ]);
    const legacyListe = await legacyRead(); // legacy reaktivert
    expect(ids(legacyListe)).toEqual(["a", "b", "react-ny"]);
    expect(legacyListe[0]).toMatchObject({ active: false });

    await legacyDbSet(legacyListe.filter((r) => r.id !== "b")); // legacy `slettRegel`
    const etter = await legacyRead();
    expect(ids(etter)).toEqual(["a", "react-ny"]);
    expect(new Set(ids(etter)).size).toBe(etter.length);
    expect(await rawKeys()).toEqual(["0", "1"]);
  });

  it("DERFOR én aktiv skriver: en senere blind legacy-`dbSet` fra utdatert snapshot overskriver en committet React-endring", async () => {
    await legacyDbSet([regel("a"), regel("b")]);
    const legacySnapshot = await legacyRead(); // legacy sin lokale tilstand
    await transactRules(FAMILY_ID, (prev) => [...prev, regel("react")]);
    await legacyDbSet([...legacySnapshot, regel("legacy")]);
    // React sin regel er borte — CAS på React-siden kan ikke hindre dette.
    // Det er grunnen til at skriving er stengt til R3b-cutover.
    expect(ids(await legacyRead())).toEqual(["a", "b", "legacy"]);
  });
});

describe("endre målpost (#59, 6643098967)", () => {
  const GRUPPER = {
    budgetGroups: [
      { id: "mat", label: "Mat", items: [{ id: "b-mat", name: "Dagligvarer" }] },
      { id: "fritid", label: "Fritid", items: [{ id: "b-hobby", name: "Hobby" }] },
    ] as unknown as BudsjettGruppe[],
    incomeGroups: [] as BudsjettGruppe[],
    sparingGroups: [
      { id: "spar", label: "Generell sparing", items: [{ id: "s-buffer", name: "Buffer" }] },
    ] as unknown as BudsjettGruppe[],
  };
  const FRA = { type: "budget" as const, id: "b-mat" };

  async function endre(id: string, til: { type: "budget" | "sparing"; id: string }) {
    let utfall: EndreMalUtfall = { status: "regel_slettet" };
    await transactRules(
      FAMILY_ID,
      (prev) => {
        const r = endreRegelMal(prev, id, FRA, til, GRUPPER, NAA);
        utfall = r.utfall;
        return r.regler;
      },
      { applyLocally: false },
    );
    return utfall;
  }

  it("én sammenhengende endring; andre felt, andre regler og array-formen er urørt", async () => {
    const r1 = regel("r1", {
      targetGruppe: "Mat",
      kontoVilkar: "MC",
      eiere: [{ person: "Helen", prosent: 100 }],
      matchType: "starter_med",
      confidence: 70,
      timesUsed: 9,
      lastMatched: "2026-10-01T00:00:00.000Z",
    });
    const r2 = regel("r2");
    await legacyDbSet([r1, r2]);
    expect(await endre("r1", { type: "sparing", id: "s-buffer" })).toMatchObject({
      status: "lagret",
    });
    expect(await legacyRead()).toEqual([
      {
        ...r1,
        targetType: "sparing",
        targetId: "s-buffer",
        targetName: "Buffer",
        targetGruppe: "Generell sparing",
        updatedAt: NAA,
      },
      r2,
    ]);
    expect(await rawKeys()).toEqual(["0", "1"]);
  });

  it("bare serverbekreftet mål når lytterne (applyLocally: false)", async () => {
    await legacyDbSet([regel("r1")]);
    const sett: string[] = [];
    const stopp = subscribeRules(FAMILY_ID, (l) => {
      if (l[0]) sett.push(l[0].targetId);
    });
    goOffline(getFirebaseDatabase());
    const skriving = endre("r1", { type: "budget", id: "b-hobby" });
    await new Promise((res) => setTimeout(res, 200));
    expect(sett).not.toContain("b-hobby");
    goOnline(getFirebaseDatabase());
    expect(await skriving).toMatchObject({ status: "lagret" });
    await expect.poll(() => sett.at(-1)).toBe("b-hobby");
    stopp();
  });

  it("slettet regel gjenopprettes ikke, og noden er uendret", async () => {
    await legacyDbSet([regel("r2")]);
    expect(await endre("r1", { type: "budget", id: "b-hobby" })).toEqual({
      status: "regel_slettet",
    });
    expect(ids(await legacyRead())).toEqual(["r2"]);
  });

  it("ugyldig mål og samtidig endring hos en annen skriver: ingenting skrives", async () => {
    const r1 = regel("r1");
    await legacyDbSet([r1]);
    expect(await endre("r1", { type: "budget", id: "finnes-ikke" })).toEqual({
      status: "mal_ugyldig",
    });
    expect(await legacyRead()).toEqual([r1]);
    // En annen skriver har koblet regelen om siden utkastet ble laget.
    const annen = { ...r1, targetId: "b-hobby", targetName: "Hobby" };
    await legacyDbSet([annen]);
    expect(await endre("r1", { type: "sparing", id: "s-buffer" })).toMatchObject({
      status: "endret_samtidig",
    });
    expect(await legacyRead()).toEqual([annen]);
  });
});
