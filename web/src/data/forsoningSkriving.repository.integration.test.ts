/**
 * Datalag-/integrasjonstest mot en EKTE Firebase Emulator Suite-instans
 * (RTDB + Auth) — aldri produksjon eller en Hosting-forhåndsvisning.
 * Kjøres via `npm run test:integration`.
 *
 * Låser sameksistenskontrakten (ADR 0002) for den felles forsoningsskriveren
 * på `transaksjoner`, `hendelser` og `receipts` — samme kontrakt som
 * `rules.repository.integration.test.ts` låser for `rules` — og kjører
 * «Bruk resultatet» (`brukKjorRegler`) ende-til-ende mot emulatoren.
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
import { brukKjorRegler } from "@domain/forsoning/brukKjorRegler";
import { forhandsvisKjorRegler } from "@domain/forsoning/kjorReglerForhandsvisning";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import { getFirebaseAuth, getFirebaseDatabase } from "./firebase";
import { subscribeHendelser } from "./forsoning.repository";
import {
  type ForsoningNode,
  forsoningNodePath,
  transactForsoningNode,
} from "./forsoningSkriving.repository";

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const NAA = "2026-10-03T08:00:00.000Z";
const NODER: ForsoningNode[] = ["transaksjoner", "hendelser", "receipts"];

let adminApp: AdminApp;
let admin: AdminDatabase;

type Element = { id: string; [k: string]: unknown };
const el = (id: string, felt: Record<string, unknown> = {}): Element => ({ id, ...felt });

/** Slik legacy `setX` skriver: hele listen som array (`dbSet(…/node, next)`). */
const legacyDbSet = (node: ForsoningNode, liste: unknown[]) =>
  admin.ref(forsoningNodePath(FAMILY_ID, node)).set(liste);
/** Slik legacy leser: `v ? Object.values(v) : []`. */
const legacyRead = async <T = Element>(node: ForsoningNode) => {
  const v = (await admin.ref(forsoningNodePath(FAMILY_ID, node)).get()).val() as object | null;
  return (v ? Object.values(v) : []) as T[];
};
const rawKeys = async (node: ForsoningNode) =>
  Object.keys(
    ((await admin.ref(forsoningNodePath(FAMILY_ID, node)).get()).val() as object | null) ?? {},
  );
const ids = (liste: { id: string }[]) => liste.map((x) => x.id);

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "forsoning-skriving-integration-test-admin",
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

const ryddOpp = () =>
  Promise.all(NODER.map((n) => admin.ref(forsoningNodePath(FAMILY_ID, n)).remove()));
beforeEach(ryddOpp);
afterAll(async () => {
  await ryddOpp();
  await deleteApp(adminApp);
});

describe.each(NODER)("transactForsoningNode (emulator): %s", (node) => {
  it("bevarer array-formen: indeksnøkler, `id` inne i elementet, aldri `node/{id}`", async () => {
    await legacyDbSet(node, [el("a"), el("b"), el("c")]);
    await transactForsoningNode<Element>(FAMILY_ID, node, (prev) =>
      prev.map((x) => (x.id === "b" ? { ...x, endret: NAA } : x)),
    );
    expect(await rawKeys(node)).toEqual(["0", "1", "2"]);
    const etter = await legacyRead(node);
    expect(ids(etter)).toEqual(["a", "b", "c"]);
    expect(etter[1]).toEqual({ id: "b", endret: NAA });

    await transactForsoningNode<Element>(FAMILY_ID, node, (prev) =>
      prev.filter((x) => x.id !== "a"),
    );
    expect(await rawKeys(node)).toEqual(["0", "1"]);
    expect(ids(await legacyRead(node))).toEqual(["b", "c"]);
  });

  it("tom node → array; tom liste fjerner noden (som legacy `dbSet([])`); `undefined`-felt droppes", async () => {
    await transactForsoningNode<Element>(FAMILY_ID, node, (prev) => [
      ...prev,
      el("ny", { tom: undefined, null: null }),
    ]);
    expect(await rawKeys(node)).toEqual(["0"]);
    expect(await legacyRead(node)).toEqual([{ id: "ny" }]);
    await transactForsoningNode<Element>(FAMILY_ID, node, () => []);
    expect((await admin.ref(forsoningNodePath(FAMILY_ID, node)).get()).exists()).toBe(false);
  });

  it("legacy `dbSet` MENS React-transaksjonen pågår → updateren kjøres på nytt mot fersk verdi", async () => {
    await legacyDbSet(node, [el("a"), el("b")]);
    const db = getFirebaseDatabase();
    const { onValue, ref } = await import("firebase/database");
    const unsubscribe = onValue(ref(db, forsoningNodePath(FAMILY_ID, node)), () => {});
    await new Promise((r) => setTimeout(r, 300));
    goOffline(db);

    const sett: string[][] = [];
    const tx = transactForsoningNode<Element>(FAMILY_ID, node, (prev) => {
      sett.push(ids(prev));
      return [...prev, el("react")];
    });
    await legacyDbSet(node, [...(await legacyRead(node)), el("legacy")]);
    goOnline(db);
    await tx;
    unsubscribe();

    expect(sett[0]).toEqual(["a", "b"]);
    expect(sett.at(-1)).toEqual(["a", "b", "legacy"]);
    expect(ids(await legacyRead(node))).toEqual(["a", "b", "legacy", "react"]);
  });

  it("rollback: legacy leser alt React skrev, og skriver videre uten tap eller duplikat", async () => {
    await legacyDbSet(node, [el("a"), el("b")]);
    await transactForsoningNode<Element>(FAMILY_ID, node, (prev) => [...prev, el("react-ny")]);
    const legacyListe = await legacyRead(node);
    expect(ids(legacyListe)).toEqual(["a", "b", "react-ny"]);
    await legacyDbSet(
      node,
      legacyListe.filter((x) => x.id !== "a"),
    );
    const etter = await legacyRead(node);
    expect(ids(etter)).toEqual(["b", "react-ny"]);
    expect(await rawKeys(node)).toEqual(["0", "1"]);
  });
});

describe("«Bruk resultatet» ende-til-ende (emulator)", () => {
  const tolv = () => Array.from({ length: 12 }, () => ({ budget: 0, spent: 0 }));
  const budgetGroups: BudsjettGruppe[] = [
    {
      id: "mat",
      label: "Mat",
      items: [{ id: "dagligvarer", name: "Dagligvarer", months: tolv() }],
    },
  ];
  const tx = (id: string, felt: Partial<TransaksjonRecord> = {}): TransaksjonRecord => ({
    id,
    dato: "2026-09-10",
    tekst: "REMA 1000",
    belop: 250,
    retning: "ut",
    konto: "felleskonto",
    status: "ny",
    ...felt,
  });
  const rules: RegelRecord[] = [
    {
      id: "r-rema",
      pattern: "rema 1000",
      normalizedPattern: "rema 1000",
      targetType: "budget",
      targetId: "dagligvarer",
      targetName: "Dagligvarer",
      mode: "auto",
    },
  ];

  it("skriver hendelsen og pekeren i legacy-form, og legacy leser resultatet", async () => {
    const transaksjoner = [tx("t-1"), tx("t-2", { tekst: "Ukjent" })];
    const hendelser: HendelseRecord[] = [];
    await legacyDbSet("transaksjoner", transaksjoner);
    const data = {
      transaksjoner,
      hendelser,
      rules,
      budgetGroups,
      incomeGroups: [],
      sparingGroups: [],
    };
    const plan = forhandsvisKjorRegler(transaksjoner, hendelser, rules, budgetGroups, [], []).plan;
    let n = 0;
    const utfall = await brukKjorRegler(plan, data, {
      transactHendelser: (u) => transactForsoningNode(FAMILY_ID, "hendelser", u),
      transactTransaksjoner: (u) => transactForsoningNode(FAMILY_ID, "transaksjoner", u),
      newId: () => `h-${++n}`,
      naa: NAA,
    });
    expect(utfall).toEqual({
      status: "skrevet",
      resultat: { auto: 1, forslagSkrevet: 0, forslagPaaVent: 0, malMangler: 0 },
    });

    expect(await rawKeys("hendelser")).toEqual(["0"]);
    const lagret = await legacyRead<HendelseRecord>("hendelser");
    expect(lagret).toHaveLength(1);
    expect(lagret[0]).toMatchObject({
      id: "h-1",
      status: "ferdig",
      transaksjonId: "t-1",
      regelId: "r-rema",
      opprettet: NAA,
    });
    const t = await legacyRead<TransaksjonRecord>("transaksjoner");
    expect(t.map((x) => [x.id, x.hendelseId ?? null])).toEqual([
      ["t-1", "h-1"],
      ["t-2", null],
    ]);

    // React-leseren ser det samme.
    const sett = await new Promise<HendelseRecord[]>((resolve) => {
      const unsubscribe = subscribeHendelser(FAMILY_ID, (liste) => {
        if (liste.length === 1) {
          unsubscribe();
          resolve(liste);
        }
      });
    });
    expect(ids(sett)).toEqual(["h-1"]);
  });

  it("kjøres to ganger på samme godkjente plan: andre runde endrer ingenting (ingen dobbel hendelse)", async () => {
    const transaksjoner = [tx("t-1")];
    await legacyDbSet("transaksjoner", transaksjoner);
    const data = {
      transaksjoner,
      hendelser: [],
      rules,
      budgetGroups,
      incomeGroups: [],
      sparingGroups: [],
    };
    const plan = forhandsvisKjorRegler(transaksjoner, [], rules, budgetGroups, [], []).plan;
    const deps = {
      transactHendelser: (u: (p: HendelseRecord[]) => HendelseRecord[]) =>
        transactForsoningNode(FAMILY_ID, "hendelser", u),
      transactTransaksjoner: (u: (p: TransaksjonRecord[]) => TransaksjonRecord[]) =>
        transactForsoningNode(FAMILY_ID, "transaksjoner", u),
      newId: () => randomUUID(),
      naa: NAA,
    };
    await brukKjorRegler(plan, data, deps);
    const forsteHendelseId = (await legacyRead<HendelseRecord>("hendelser"))[0]!.id;
    // Samme utdaterte klientdata (to faner som trykker samtidig).
    await brukKjorRegler(plan, data, deps);
    const hendelser = await legacyRead<HendelseRecord>("hendelser");
    expect(hendelser).toHaveLength(1);
    expect((await legacyRead<TransaksjonRecord>("transaksjoner"))[0]!.hendelseId).toBe(
      forsteHendelseId,
    );
  });
});
