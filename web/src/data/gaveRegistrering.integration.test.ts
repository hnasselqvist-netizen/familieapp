/**
 * Etterregistrering av gaver (Gaver punkt 2) gjennom den FAKTISKE
 * registreringsinngangen mot
 * en EKTE Firebase Emulator Suite-instans — aldri produksjon. Syntetiske
 * data. Testen står i hookens sted og gjør nøyaktig det
 * `useGaver.registrerGave`/`fullforBursdag` gjør: domenet bygger verdiene
 * (`registreringsverdier`, `bursdagVerdi`), datalaget skriver dem
 * (`registrerGaveOgAnledning`, `opprettPost`). Review 5820769716: gave og
 * bursdag skal være konsistente ved feil, retry og samtidighet.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Person } from "@app-types/gaver";
import { bursdagVerdi, helaarsoversikt, registreringsverdier } from "@domain/gaver/helaar";
import { getFirebaseAuth } from "./firebase";
import {
  EndretAvAndre,
  opprettPost,
  parseAnledninger,
  parseGaver,
  registrerGaveOgAnledning,
} from "./gaver.repository";

type Register = { personer: Person[]; grupper: Record<string, never> };
type Utkast = Parameters<typeof registreringsverdier>[1];
type Anl = Parameters<typeof registreringsverdier>[2];

/** Det `useGaver.registrerGave` gjør. */
async function registrerGave(
  familyId: string,
  register: Register,
  id: string,
  utkast: Utkast,
  anledning: Anl,
  tid = T,
) {
  const v = registreringsverdier(register, utkast, anledning, tid);
  await registrerGaveOgAnledning(familyId, id, v.gave, v.anledning);
}

/** Det `useGaver.fullforBursdag` gjør. */
async function fullforBursdag(
  familyId: string,
  register: Register,
  personId: string,
  aar: number,
  tid = T,
) {
  const p = register.personer.find((x) => x.id === personId)!;
  const { id, verdi } = bursdagVerdi(p, aar, register.grupper, tid);
  await opprettPost(familyId, "anledninger", id, verdi);
}

const FAMILY_ID = "familie1";
const PROJECT_ID = import.meta.env.VITE_FIREBASE_PROJECT_ID;
const DATABASE_URL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
const FAM = `families/${FAMILY_ID}`;
const NODER = ["relasjonsgrupper", "relasjoner", "anledninger", "gaver"] as const;
const T = "2026-11-02T10:00:00.000Z";

let adminApp: AdminApp;
const admin = () => getAdminDatabase(adminApp);
const les = async (sti: string) => (await admin().ref(`${FAM}/${sti}`).get()).val();

beforeAll(async () => {
  adminApp = initializeApp(
    { projectId: PROJECT_ID, databaseURL: DATABASE_URL },
    "gaveregistrering-integration-test-admin",
  );
  const uid = `test-${randomUUID()}`;
  await getAdminAuth(adminApp).createUser({ uid });
  await admin().ref(`${FAM}/members/${uid}`).set(true);
  const customToken = await getAdminAuth(adminApp).createCustomToken(uid);
  await signInWithCustomToken(getFirebaseAuth(), customToken);
});

beforeEach(async () => {
  for (const n of NODER) await admin().ref(`${FAM}/${n}`).remove();
});

afterAll(async () => {
  for (const n of NODER) await admin().ref(`${FAM}/${n}`).remove();
  await deleteApp(adminApp);
});

const belop = (kr: number) => ({ type: "belop" as const, belopOre: kr * 100 });
const person = (budsjettKr: number): Person => ({
  id: "p1",
  navn: "Syntetisk A",
  gruppe: "naer",
  unntak: { bursdag: { budsjett: belop(budsjettKr) } },
  versjon: 1,
  opprettet: T,
  oppdatert: T,
});
const register = (budsjettKr: number) => ({ personer: [person(budsjettKr)], grupper: {} });
const gitt = {
  personId: "p1",
  tekst: "Syntetisk skjerf",
  status: "gitt" as const,
  planlagtOre: 15000,
  kjopsdato: "2025-12-28",
};
const BURSDAG = { type: "bursdag" as const, aar: 2026 };

describe("registrerGave (emulator)", () => {
  it("deterministisk gavefeil: ingen bursdag skrives, og neste registrering får dagens budsjett", async () => {
    // En annen gave ligger allerede på samme id (annen enhet / endret utkast).
    await registrerGave(
      FAMILY_ID,
      register(400),
      "g1",
      { ...gitt, tekst: "Annen" },
      {
        type: "jul",
        aar: 2026,
      },
    );
    await expect(
      registrerGave(FAMILY_ID, register(400), "g1", gitt, BURSDAG, T),
    ).rejects.toBeInstanceOf(EndretAvAndre);
    expect(await les("anledninger")).toBeNull();

    // Budsjettet er endret før neste vellykkede registrering.
    await registrerGave(FAMILY_ID, register(555), "g2", gitt, BURSDAG, T);
    expect(await les("anledninger/bursdag-p1-2026/mottakere/p1/budsjett")).toEqual(belop(555));
    expect(await les("gaver/g1")).toMatchObject({ tekst: "Annen", anledningId: "jul-2026" });
  });

  it("retry: identisk gir ingen duplikat; endret mottaker gir konflikt uten ny bursdag", async () => {
    await registrerGave(FAMILY_ID, register(400), "g1", gitt, BURSDAG, T);
    const foer = { anledninger: await les("anledninger"), gaver: await les("gaver") };
    await registrerGave(FAMILY_ID, register(400), "g1", gitt, BURSDAG, T);
    const annen = {
      personer: [person(400), { ...person(100), id: "p2", navn: "Syntetisk B" }],
      grupper: {},
    };
    await expect(
      registrerGave(FAMILY_ID, annen, "g1", { ...gitt, personId: "p2" }, BURSDAG, T),
    ).rejects.toBeInstanceOf(EndretAvAndre);
    expect({ anledninger: await les("anledninger"), gaver: await les("gaver") }).toEqual(foer);
  });

  it("to enheter registrerer samtidig med ulikt sett budsjett: én bursdag, begge gavene, juleplanen urørt", async () => {
    await admin()
      .ref(`${FAM}/anledninger/jul-2026`)
      .set({ type: "jul", aar: 2026, versjon: 4, mottakere: { p1: { budsjett: belop(500) } } });
    const julFoer = await les("anledninger/jul-2026");
    await Promise.all([
      registrerGave(FAMILY_ID, register(400), "g1", gitt, BURSDAG, T),
      registrerGave(FAMILY_ID, register(1), "g2", { ...gitt, tekst: "Bok" }, BURSDAG, T),
      registrerGave(FAMILY_ID, register(400), "g1", gitt, BURSDAG, T),
    ]);
    const anledninger = parseAnledninger(await les("anledninger"));
    expect(anledninger.map((a) => a.id).sort()).toEqual(["bursdag-p1-2026", "jul-2026"]);
    const bursdag = anledninger.find((a) => a.id === "bursdag-p1-2026")!;
    expect([belop(400), belop(1)]).toContainEqual(bursdag.mottakere.p1!.budsjett);
    expect(await les("anledninger/jul-2026")).toEqual(julFoer);
    const gaver = parseGaver(await les("gaver"));
    expect(gaver.map((g) => g.id).sort()).toEqual(["g1", "g2"]);

    // En senere registrering og fullforBursdag endrer aldri den lagrede bursdagen.
    const lagret = await les("anledninger/bursdag-p1-2026");
    await registrerGave(FAMILY_ID, register(999), "g3", { ...gitt, tekst: "Kort" }, BURSDAG, T);
    await fullforBursdag(FAMILY_ID, register(999), "p1", 2026, T);
    expect(await les("anledninger/bursdag-p1-2026")).toEqual(lagret);

    // Tilbakelesing i oversikten: tre gaver på bursdagen, kjøpsdatoen bevart.
    const o = helaarsoversikt(
      2026,
      [person(400)],
      {},
      parseAnledninger(await les("anledninger")),
      parseGaver(await les("gaver")),
    );
    expect(o.personer[0]!.bursdag.verdiOre).toBe(45000);
    expect(o.personer[0]!.bursdag.gaver.every((g) => g.kjopsdato === "2025-12-28")).toBe(true);
  });
});
