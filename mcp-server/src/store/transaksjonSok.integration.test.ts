/**
 * Transaksjonssøket (`transaksjon_sok`, #27/#59) mot en EKTE RTDB-emulator
 * (demo-familieapp) — aldri produksjon. Syntetiske data.
 *
 * Beviser det som bare kan bevises mot ekte RTDB: legacy-arrayene slik Admin
 * SDK-et faktisk leser dem (også med hull), at versjonen i treffet er lik
 * `data_hent` sin, at bare egen familie leses, og at databasen er kanonisk
 * uendret etterpå.
 */
import { randomUUID } from "node:crypto";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";
import { afterAll, describe, expect, it } from "vitest";
import type { FamilyContext } from "../auth/authorize";
import { hentData } from "../data/dataSkriving";
import { hentOgSok } from "../forvaltning/transaksjonSok";
import { kanonisk } from "../handleliste/overgangKontroll";
import { FirebaseAdminStore } from "./firebaseAdminStore";

if (!process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
  throw new Error("FIREBASE_DATABASE_EMULATOR_HOST mangler — kjør via `npm run test:integration`.");
}

const app = initializeApp(
  {
    projectId: "demo-familieapp",
    databaseURL: "http://127.0.0.1:9000/?ns=demo-familieapp-default-rtdb",
  },
  `sok-it-${randomUUID()}`,
);
const db = getDatabase(app);
afterAll(() => deleteApp(app));

const F = `it-sok-${randomUUID()}`;
const ANNEN = `it-sok-annen-${randomUUID()}`;
const ctx: FamilyContext = { familyId: F, firebaseUid: "u1", idpSub: "s", clientId: "it" };

const felles = (belop: number) => [
  {
    plasseringId: "p",
    plasseringType: "budget",
    plasseringNavn: "Felleskost",
    belop,
    eiere: [{ person: "Felles", prosent: 100 }],
  },
];

describe("transaksjonssøk mot ekte RTDB", () => {
  it("legacy-arrayer (også med hull), kombinerte filtre, paginering, versjon = data_hent, ingen skriving", async () => {
    await db.ref(`families/${F}`).set({
      members: { u1: true },
      // Indeks 2 mangler: RTDB lagrer {0,1,3,4}, Admin SDK leser en array med hull.
      transaksjoner: {
        0: {
          id: "t0",
          dato: "2026-09-15",
          tekst: "FELLESFORBUNDET",
          belop: 450,
          retning: "ut",
          konto: "eivind",
        },
        1: {
          id: "t1",
          dato: "2026-09-20",
          tekst: "Skruvat AS",
          belop: 899,
          retning: "ut",
          konto: "eivind",
        },
        3: {
          id: "t3",
          dato: "2026-09-22",
          tekst: "Skruvat AS",
          belop: 50,
          retning: "ut",
          konto: "eivind",
        },
        4: {
          id: "t4",
          dato: "2026-09-25",
          tekst: "Rema",
          belop: 300,
          retning: "ut",
          konto: "helen",
        },
      },
      hendelser: [
        {
          id: "h0",
          status: "ferdig",
          transaksjonId: "t0",
          fordelinger: felles(450),
          dato: "2026-09-15",
        },
        {
          id: "h1",
          status: "ferdig",
          transaksjonId: "t1",
          fordelinger: felles(899),
          dato: "2026-09-20",
        },
        {
          id: "h3",
          status: "pa_vent",
          transaksjonId: "t3",
          fordelinger: felles(50),
          dato: "2026-09-22",
        },
      ],
    });
    await db.ref(`families/${ANNEN}`).set({
      members: { u2: true },
      transaksjoner: [{ id: "x", dato: "2026-09-30", tekst: "Skruvat AS", konto: "eivind" }],
    });
    const foer = kanonisk((await db.ref("families").get()).val());
    const store = new FirebaseAdminStore(db);

    const side1 = await hentOgSok(store, ctx, { konto: "eivind", ansvar: "Felles", antall: 2 });
    expect(side1.treff.map((t) => t.sti)).toEqual(["transaksjoner/3", "transaksjoner/1"]);
    expect(side1.antallTreff).toBe(3);
    const side2 = await hentOgSok(store, ctx, {
      konto: "eivind",
      ansvar: "Felles",
      antall: 2,
      etter: side1.neste!,
    });
    expect(side2).toMatchObject({ antallTreff: 3, neste: null });
    expect(side2.treff.map((t) => t.sti)).toEqual(["transaksjoner/0"]);

    const kombinert = await hentOgSok(store, ctx, {
      konto: "eivind",
      ansvar: "Felles",
      tekst: "skruvat",
      status: ["ferdig"],
    });
    expect(kombinert.treff.map((t) => [t.id, t.status, t.hendelse?.sti])).toEqual([
      ["t1", "ferdig", "hendelser/1"],
    ]);
    const t1 = kombinert.treff[0]!;
    expect((await hentData(store, ctx, t1.sti)).versjon).toBe(t1.versjon);
    expect((await hentData(store, ctx, t1.hendelse!.sti)).versjon).toBe(t1.hendelse!.versjon);

    expect((await hentOgSok(store, ctx, { tekst: "finnes ikke" })).treff).toEqual([]);
    expect(kanonisk((await db.ref("families").get()).val())).toBe(foer);

    await db.ref(`families/${F}`).remove();
    await db.ref(`families/${ANNEN}`).remove();
  });
});
