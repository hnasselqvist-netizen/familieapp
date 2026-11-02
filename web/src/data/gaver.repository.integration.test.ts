/**
 * Datalag-/integrasjonstest for gave- og relasjonsmodulen (S1) mot en EKTE
 * Firebase Emulator Suite-instans — aldri produksjon
 * (`npm run test:integration`). Syntetiske data.
 *
 * Låser:
 *  - null-semantikk: «arv», «ikke satt», `false` og beløp 0 overlever en
 *    ekte RTDB-rundtur;
 *  - `jul-<år>` er create-if-absent: retry og en annen enhet gir den
 *    lagrede anledningen, aldri reset;
 *  - versjonsvakt per post: en skriving fra et gammelt skjema overskriver
 *    ikke en annen enhets endring, og retry av egen skriving er idempotent;
 *  - ukjente felt bevares, og bare posten selv skrives (ingen helnode);
 *  - arkivering rører ikke gavene.
 */
import { randomUUID } from "node:crypto";
import { signInWithCustomToken } from "firebase/auth";
import { type App as AdminApp, deleteApp, initializeApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getDatabase as getAdminDatabase } from "firebase-admin/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Person } from "@app-types/gaver";
import { juleoversikt, nyJulAnledning } from "@domain/gaver/gaver";
import { getFirebaseAuth } from "./firebase";
import {
  EndretAvAndre,
  endrePost,
  opprettPost,
  parseAnledning,
  parseGaver,
  parseGrupper,
  parsePersoner,
  sammeVersjon,
  subscribePersoner,
} from "./gaver.repository";

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
    "gaver-integration-test-admin",
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

const nyPerson = (navn: string, over: Record<string, unknown> = {}) => ({
  navn,
  gruppe: "naer",
  versjon: 1,
  opprettet: T,
  oppdatert: T,
  ...over,
});

describe("gaver-noder (emulator)", () => {
  it("null-semantikk: arv, ikke satt, false og 0 overlever rundturen", async () => {
    await opprettPost(
      FAMILY_ID,
      "relasjoner",
      "p1",
      nyPerson("Syntetisk A", {
        unntak: {
          jul: { aktiv: false, budsjett: { type: "belop", belopOre: 0 } },
          bursdag: { budsjett: { type: "ikke_satt" } },
        },
      }),
    );
    await opprettPost(
      FAMILY_ID,
      "relasjoner",
      "p2",
      nyPerson("Syntetisk B", { unntak: { jul: { budsjett: { type: "arv" } } } }),
    );
    await opprettPost(FAMILY_ID, "relasjonsgrupper", "naer", {
      standard: { jul: { aktiv: false, budsjett: { type: "ikke_satt" } } },
      versjon: 1,
    });

    const personer = parsePersoner(await les("relasjoner"));
    expect(personer.find((p) => p.id === "p1")!.unntak).toEqual({
      jul: { aktiv: false, budsjett: { type: "belop", belopOre: 0 } },
      bursdag: { budsjett: { type: "ikke_satt" } },
    });
    expect(personer.find((p) => p.id === "p2")!.unntak).toEqual({
      jul: { budsjett: { type: "arv" } },
    });
    expect(parseGrupper(await les("relasjonsgrupper")).naer!.standard).toEqual({
      jul: { aktiv: false, budsjett: { type: "ikke_satt" } },
    });
  });

  it("null avvises før skriving i stedet for å forsvinne stille", async () => {
    await opprettPost(FAMILY_ID, "relasjoner", "p1", nyPerson("A"));
    await expect(
      endrePost(FAMILY_ID, "relasjoner", "p1", {
        vakt: sammeVersjon(1),
        endring: { notat: null },
        grunn: "1",
        tid: T,
      }),
    ).rejects.toThrow(/null/);
  });

  it("jul-<år> er create-if-absent: retry og annen enhet gir den lagrede, ingen reset", async () => {
    const personer: Person[] = [
      {
        id: "p1",
        navn: "A",
        gruppe: "naer",
        unntak: {},
        versjon: 1,
        opprettet: T,
        oppdatert: T,
      },
    ];
    const forste = nyJulAnledning(2026, personer, {}, T);
    const { id, ...verdi } = forste;
    const r1 = await opprettPost(FAMILY_ID, "anledninger", id, verdi);
    expect(r1.opprettet).toBe(true);

    // Brukeren endrer mottakerlisten før en annen enhet «starter» på nytt.
    await endrePost(FAMILY_ID, "anledninger", id, {
      vakt: sammeVersjon(1),
      endring: { "mottakere/p1/fjernet": T },
      grunn: "1",
      tid: T,
    });
    const annenEnhet = nyJulAnledning(2026, [...personer, { ...personers0(), id: "p2" }], {}, T);
    const { id: id2, ...verdi2 } = annenEnhet;
    const r2 = await opprettPost(FAMILY_ID, "anledninger", id2, verdi2);
    expect(r2.opprettet).toBe(false);
    const lagret = parseAnledning(id, r2.lagret)!;
    expect(lagret.mottakere).toEqual({ p1: { budsjett: { type: "ikke_satt" }, fjernet: T } });
    expect(lagret.versjon).toBe(2);
    expect(Object.keys((await les("anledninger")) ?? {})).toEqual(["jul-2026"]);
  });

  it("to samtidige oppstarter gir én anledning", async () => {
    const a = nyJulAnledning(2026, [], {}, T);
    const { id, ...verdi } = a;
    const [r1, r2] = await Promise.all([
      opprettPost(FAMILY_ID, "anledninger", id, verdi),
      opprettPost(FAMILY_ID, "anledninger", id, { ...verdi, opprettet: "annen" }),
    ]);
    expect([r1.opprettet, r2.opprettet].filter(Boolean)).toHaveLength(1);
    expect(r1.lagret).toEqual(r2.lagret);
  });

  it("versjonsvakt: gammelt skjema overskriver ikke en annen enhets endring", async () => {
    await opprettPost(FAMILY_ID, "relasjoner", "p1", nyPerson("A"));
    await endrePost(FAMILY_ID, "relasjoner", "p1", {
      vakt: sammeVersjon(1),
      endring: { navn: "A fra enhet 1" },
      grunn: "1",
      tid: T,
    });
    await expect(
      endrePost(FAMILY_ID, "relasjoner", "p1", {
        vakt: sammeVersjon(1),
        endring: { navn: "A fra gammelt skjema" },
        grunn: "1",
        tid: T,
      }),
    ).rejects.toBeInstanceOf(EndretAvAndre);
    expect(await les("relasjoner/p1")).toMatchObject({ navn: "A fra enhet 1", versjon: 2 });
  });

  it("samtidige skrivinger fra samme versjon: nøyaktig én lagres, den andre får konflikt", async () => {
    await opprettPost(FAMILY_ID, "gaver", "g1", {
      personId: "p1",
      tekst: "Bok",
      status: "ide",
      versjon: 1,
      opprettet: T,
      oppdatert: T,
    });
    const resultater = await Promise.allSettled([
      endrePost(FAMILY_ID, "gaver", "g1", {
        vakt: sammeVersjon(1),
        endring: { status: "kjopt" },
        grunn: "1",
        tid: T,
      }),
      endrePost(FAMILY_ID, "gaver", "g1", {
        vakt: sammeVersjon(1),
        endring: { tekst: "Annen bok" },
        grunn: "1",
        tid: T,
      }),
    ]);
    expect(resultater.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const avvist = resultater.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(avvist.reason).toBeInstanceOf(EndretAvAndre);
    expect((await les("gaver/g1")).versjon).toBe(2);
  });

  it("retry av egen skriving er idempotent («allerede»), ikke konflikt", async () => {
    await opprettPost(FAMILY_ID, "gaver", "g1", {
      personId: "p1",
      tekst: "Bok",
      status: "ide",
      versjon: 1,
      opprettet: T,
      oppdatert: T,
    });
    const valg = {
      vakt: sammeVersjon(1),
      endring: { status: "kjopt", planlagtOre: 0 },
      grunn: "1",
      tid: T,
    };
    expect(await endrePost(FAMILY_ID, "gaver", "g1", valg)).toBe("lagret");
    expect(await endrePost(FAMILY_ID, "gaver", "g1", valg)).toBe("allerede");
    const g = parseGaver({ g1: await les("gaver/g1") })[0]!;
    expect(g).toMatchObject({ status: "kjopt", planlagtOre: 0, versjon: 2 });
  });

  it("ukjente felt bevares, og bare posten skrives", async () => {
    await admin()
      .ref(`${FAM}/relasjoner`)
      .set({
        p1: { ...nyPerson("A"), fremtidigFelt: { a: 1 } },
        p2: { ...nyPerson("B"), annet: "urørt" },
      });
    await endrePost(FAMILY_ID, "relasjoner", "p1", {
      vakt: sammeVersjon(1),
      endring: { notat: "Liker te", fodselsdato: undefined },
      grunn: "1",
      tid: T,
    });
    expect(await les("relasjoner/p1")).toMatchObject({
      navn: "A",
      notat: "Liker te",
      fremtidigFelt: { a: 1 },
      versjon: 2,
    });
    expect(await les("relasjoner/p2")).toEqual({ ...nyPerson("B"), annet: "urørt" });
  });

  it("feltsletting med undefined fjerner bare det feltet", async () => {
    await opprettPost(FAMILY_ID, "gaver", "g1", {
      personId: "p1",
      tekst: "Bok",
      status: "ide",
      valgt: true,
      planlagtOre: 25000,
      versjon: 1,
      opprettet: T,
      oppdatert: T,
    });
    await endrePost(FAMILY_ID, "gaver", "g1", {
      vakt: sammeVersjon(1),
      endring: { planlagtOre: undefined, valgt: undefined },
      grunn: "1",
      tid: T,
    });
    const lagret = await les("gaver/g1");
    expect(lagret.planlagtOre).toBeUndefined();
    expect(lagret.valgt).toBeUndefined();
    expect(lagret.tekst).toBe("Bok");
  });

  it("arkivering rører ikke gavene; oversikten for anledningen er uendret", async () => {
    await opprettPost(FAMILY_ID, "relasjoner", "p1", nyPerson("A"));
    const anl = nyJulAnledning(2026, parsePersoner(await les("relasjoner")), {}, T);
    const { id, ...verdi } = anl;
    await opprettPost(FAMILY_ID, "anledninger", id, verdi);
    await opprettPost(FAMILY_ID, "gaver", "g1", {
      personId: "p1",
      anledningId: id,
      tekst: "Skjerf",
      status: "gitt",
      planlagtOre: 30000,
      versjon: 1,
      opprettet: T,
      oppdatert: T,
    });
    const gaverFor = await les("gaver");
    await endrePost(FAMILY_ID, "relasjoner", "p1", {
      vakt: sammeVersjon(1),
      endring: { arkivert: T, gruppe: "venner", navn: "A (nytt navn)" },
      grunn: "1",
      tid: T,
    });
    expect(await les("gaver")).toEqual(gaverFor);
    const o = juleoversikt(
      parseAnledning(id, await les(`anledninger/${id}`))!,
      parsePersoner(await les("relasjoner")),
      parseGaver(await les("gaver")),
    );
    expect(o.mottakere).toHaveLength(1);
    expect(o.mottakere[0]!.gaver.map((g) => g.id)).toEqual(["g1"]);
    expect(o.planlagtOre).toBe(30000);
  });

  it("abonnementet leverer parsede personer", async () => {
    await opprettPost(FAMILY_ID, "relasjoner", "p1", nyPerson("A"));
    const mottatt = await new Promise<Person[]>((resolve) => {
      const stopp = subscribePersoner(FAMILY_ID, (p) => {
        if (p.length === 0) return;
        stopp();
        resolve(p);
      });
    });
    expect(mottatt.map((p) => p.navn)).toEqual(["A"]);
  });
});

function personers0(): Person {
  return {
    id: "p0",
    navn: "Ny",
    gruppe: "naer",
    unntak: {},
    versjon: 1,
    opprettet: T,
    oppdatert: T,
  };
}
