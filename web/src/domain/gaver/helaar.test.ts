import { describe, expect, it } from "vitest";
import type { Anledning, Gave, Person } from "@app-types/gaver";
import { type Grupper, grupperMottakere, UTEN_REGISTER } from "./gaver";
import { bursdagAnledningId, helaarsoversikt, nyBursdagAnledning } from "./helaar";

/**
 * Helårsoversikten (roadmap Gaver punkt 2, #20). Bare syntetiske data.
 * Året avgjøres av anledningen, budsjettet av anledningens øyeblikksbilde
 * eller personens effektive standard, og manglende budsjett er ukjent.
 */
const T = "2026-03-01T10:00:00.000Z";
const kr = (n: number) => ({ type: "belop" as const, belopOre: n * 100 });

const person = (id: string, over: Partial<Person> = {}): Person => ({
  id,
  navn: `Syntetisk ${id}`,
  gruppe: "naer",
  unntak: {},
  versjon: 1,
  opprettet: T,
  oppdatert: T,
  ...over,
});

let n = 0;
const gave = (over: Partial<Gave> & Pick<Gave, "personId">): Gave => ({
  id: `g${++n}`,
  tekst: "Gave",
  status: "gitt",
  versjon: 1,
  opprettet: T,
  oppdatert: T,
  ...over,
});

const jul = (aar: number, mottakere: Anledning["mottakere"]): Anledning => ({
  id: `jul-${aar}`,
  type: "jul",
  aar,
  mottakere,
  versjon: 1,
  opprettet: T,
  oppdatert: T,
});

const bursdag = (personId: string, aar: number, budsjett = kr(0)): Anledning => ({
  id: bursdagAnledningId(personId, aar),
  type: "bursdag",
  aar,
  mottakere: { [personId]: { budsjett } },
  versjon: 1,
  opprettet: T,
  oppdatert: T,
});

const grupper: Grupper = {
  naer: {
    id: "naer",
    standard: { jul: { budsjett: kr(500) }, bursdag: { budsjett: kr(300) } },
    versjon: 1,
  },
  venner: {
    id: "venner",
    standard: { jul: { budsjett: kr(200) }, bursdag: { budsjett: kr(100) } },
    versjon: 1,
  },
};

const finn = (o: ReturnType<typeof helaarsoversikt>, id: string) =>
  o.personer.find((p) => p.personId === id)!;

describe("helaarsoversikt — bursdag og jul per person", () => {
  it("jul og bursdag summeres hver for seg; en idé som ikke er valgt, teller ikke", () => {
    const a = person("a");
    const o = helaarsoversikt(
      2026,
      [a],
      grupper,
      [jul(2026, { a: { budsjett: kr(500) } }), bursdag("a", 2026, kr(300))],
      [
        gave({ personId: "a", anledningId: "bursdag-a-2026", planlagtOre: 25000 }),
        gave({ personId: "a", anledningId: "jul-2026", status: "kjopt", planlagtOre: 30000 }),
        gave({ personId: "a", anledningId: "jul-2026", status: "ide", planlagtOre: 99900 }),
        gave({
          personId: "a",
          anledningId: "jul-2026",
          status: "ide",
          valgt: true,
          planlagtOre: 5000,
        }),
      ],
    );
    const p = finn(o, "a");
    expect(p.bursdag.verdiOre).toBe(25000);
    expect(p.jul.verdiOre).toBe(35000);
    expect(p.verdiOre).toBe(60000);
    expect(p.budsjett).toEqual({ type: "kjent", belopOre: 80000 });
    expect(p.romOre).toBe(20000);
    expect(o.verdiOre).toBe(60000);
    expect(o.kjentBudsjettOre).toBe(80000);
  });

  it("personoverstyring fra «Personer» vinner over gruppen før anledningen er startet", () => {
    const b = person("b", {
      gruppe: "venner",
      unntak: { jul: { budsjett: kr(600) }, bursdag: { budsjett: kr(400) } },
    });
    const c = person("c", { gruppe: "venner" });
    const o = helaarsoversikt(2026, [b, c], grupper, [], []);
    expect(finn(o, "b").bursdag).toMatchObject({ budsjett: kr(400), budsjettFra: "person" });
    expect(finn(o, "b").jul).toMatchObject({ budsjett: kr(600), budsjettFra: "person" });
    expect(finn(o, "b").budsjett).toEqual({ type: "kjent", belopOre: 100000 });
    // Uten unntak: gruppens standard. Ingen antakelse om like beløp.
    expect(finn(o, "c").bursdag).toMatchObject({ budsjett: kr(100), budsjettFra: "gruppe" });
    expect(finn(o, "c").budsjett).toEqual({ type: "kjent", belopOre: 30000 });
  });

  it("personoverstyring «arv» gir gruppens beløp; eksplisitt 0 er et ekte budsjett", () => {
    const d = person("d", { unntak: { bursdag: { budsjett: { type: "arv" } } } });
    const e = person("e", { unntak: { bursdag: { budsjett: kr(0) }, jul: { budsjett: kr(0) } } });
    const o = helaarsoversikt(2026, [d, e], grupper, [], []);
    expect(finn(o, "d").bursdag).toMatchObject({ budsjett: kr(300), budsjettFra: "gruppe" });
    expect(finn(o, "e").budsjett).toEqual({ type: "kjent", belopOre: 0 });
    expect(finn(o, "e").romOre).toBe(0);
  });

  it("startet anledning: øyeblikksbildet gjelder, ikke dagens personvalg", () => {
    const a = person("a", { unntak: { bursdag: { budsjett: kr(999) } } });
    const o = helaarsoversikt(
      2026,
      [a],
      grupper,
      [bursdag("a", 2026, kr(123)), jul(2026, { a: { budsjett: kr(456) } })],
      [],
    );
    expect(finn(o, "a").bursdag).toMatchObject({ budsjett: kr(123), budsjettFra: "anledning" });
    expect(finn(o, "a").jul).toMatchObject({ budsjett: kr(456), budsjettFra: "anledning" });
  });

  it("manglende budsjett vises som ukjent, aldri som 0", () => {
    const a = person("a");
    const o = helaarsoversikt(
      2026,
      [a],
      {},
      [jul(2026, { a: { budsjett: kr(500) } })],
      [gave({ personId: "a", anledningId: "bursdag-a-2026", planlagtOre: 20000 })],
    );
    const p = finn(o, "a");
    expect(p.bursdag.budsjett).toEqual({ type: "ikke_satt" });
    expect(p.budsjett).toEqual({ type: "ukjent", mangler: ["bursdag"] });
    expect(p.romOre).toBeNull();
    expect(o.kjentBudsjettOre).toBe(0);
    expect(o.antallUkjentBudsjett).toBe(1);
  });

  it("årsskille: anledningen avgjør året, ikke kjøpsdatoen", () => {
    const a = person("a");
    const gaver = [
      // Bursdag 2026, kjøpt i desember 2025: teller i 2026.
      gave({
        personId: "a",
        anledningId: "bursdag-a-2026",
        planlagtOre: 10000,
        kjopsdato: "2025-12-28",
      }),
      // Jul 2025, kjøpt i januar 2026: teller ikke i 2026.
      gave({ personId: "a", anledningId: "jul-2025", planlagtOre: 20000, kjopsdato: "2026-01-03" }),
      // Bursdag 2027, kjøpt i 2026: teller ikke i 2026.
      gave({
        personId: "a",
        anledningId: "bursdag-a-2027",
        planlagtOre: 40000,
        kjopsdato: "2026-11-30",
      }),
    ];
    const anl = [jul(2025, { a: { budsjett: kr(500) } })];
    const o2026 = helaarsoversikt(2026, [a], grupper, anl, gaver);
    expect(finn(o2026, "a").verdiOre).toBe(10000);
    expect(finn(o2026, "a").bursdag.gaver.map((g) => g.kjopsdato)).toEqual(["2025-12-28"]);
    const o2025 = helaarsoversikt(2025, [a], grupper, anl, gaver);
    expect(finn(o2025, "a").jul.verdiOre).toBe(20000);
    expect(finn(o2025, "a").bursdag.verdiOre).toBe(0);
    expect(finn(helaarsoversikt(2027, [a], grupper, anl, gaver), "a").bursdag.verdiOre).toBe(40000);
  });

  it("over budsjett gir negativt rom; gaver uten beløp telles for seg", () => {
    const a = person("a");
    const o = helaarsoversikt(
      2026,
      [a],
      grupper,
      [jul(2026, { a: { budsjett: kr(500) } }), bursdag("a", 2026, kr(300))],
      [
        gave({ personId: "a", anledningId: "jul-2026", planlagtOre: 90000 }),
        gave({ personId: "a", anledningId: "bursdag-a-2026" }),
      ],
    );
    expect(finn(o, "a").romOre).toBe(-10000);
    expect(finn(o, "a").utenBelop).toBe(1);
    expect(o.utenBelop).toBe(1);
  });

  it("ikke med: utenfor juleplanen eller fjernet teller ikke i budsjettet, men gaven teller", () => {
    const a = person("a", { unntak: { jul: { aktiv: false }, bursdag: { aktiv: false } } });
    const b = person("b");
    const o = helaarsoversikt(
      2026,
      [a, b],
      grupper,
      [jul(2026, { b: { budsjett: kr(500), fjernet: T } })],
      [gave({ personId: "b", anledningId: "jul-2026", planlagtOre: 10000 })],
    );
    expect(finn(o, "a").budsjett).toEqual({ type: "ingen" });
    expect(finn(o, "a").romOre).toBeNull();
    expect(finn(o, "b").jul.med).toBe(false);
    expect(finn(o, "b").jul.verdiOre).toBe(10000);
    // Bursdag er fortsatt med (gruppens 300), så rommet er 300 - 100.
    expect(finn(o, "b").romOre).toBe(20000);
  });

  it("arkiverte og ukjente personer tas med bare når de har noe i året", () => {
    const arkivert = person("x", { arkivert: T });
    const arkivertMedGave = person("y", { arkivert: T });
    const o = helaarsoversikt(
      2026,
      [arkivert, arkivertMedGave],
      grupper,
      [],
      [
        gave({ personId: "y", anledningId: "bursdag-y-2026", planlagtOre: 100 }),
        gave({ personId: "borte", anledningId: "jul-2026", planlagtOre: 200 }),
        gave({ personId: "x", anledningId: "bursdag-x-2025", planlagtOre: 300 }),
      ],
    );
    expect(o.personer.map((p) => p.personId).sort()).toEqual(["borte", "y"]);
    expect(finn(o, "y").budsjett).toEqual({ type: "ingen" });
    expect(finn(o, "borte")).toMatchObject({ person: null, navn: "Ukjent person" });
    expect(grupperMottakere(o.personer).map((g) => g.id)).toEqual(["naer", UTEN_REGISTER]);
  });

  it("sortert etter gruppe og navn, og gruppert med samme gruppering som juleplanen", () => {
    const o = helaarsoversikt(
      2026,
      [
        person("v", { gruppe: "venner", navn: "Ås" }),
        person("n2", { navn: "Berit" }),
        person("n1", { navn: "Anne" }),
      ],
      grupper,
      [],
      [],
    );
    expect(o.personer.map((p) => p.personId)).toEqual(["n1", "n2", "v"]);
    expect(grupperMottakere(o.personer).map((g) => [g.id, g.mottakere.length])).toEqual([
      ["naer", 2],
      ["venner", 1],
    ]);
  });
});

describe("nyBursdagAnledning", () => {
  it("én per person og år, med budsjettet fra arven som øyeblikksbilde", () => {
    const b = person("b", { gruppe: "venner", unntak: { bursdag: { budsjett: kr(400) } } });
    expect(nyBursdagAnledning(b, 2026, grupper, T)).toEqual({
      id: "bursdag-b-2026",
      type: "bursdag",
      aar: 2026,
      mottakere: { b: { budsjett: kr(400) } },
      versjon: 1,
      opprettet: T,
      oppdatert: T,
    });
    const c = person("c", { gruppe: "venner" });
    expect(nyBursdagAnledning(c, 2026, grupper, T).mottakere).toEqual({ c: { budsjett: kr(100) } });
    expect(nyBursdagAnledning(c, 2026, {}, T).mottakere).toEqual({
      c: { budsjett: { type: "ikke_satt" } },
    });
  });
});
