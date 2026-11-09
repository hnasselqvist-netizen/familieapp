/**
 * Gave- og relasjonsmodulen, S1 (julegaver). Syntetiske personer og beløp.
 */
import { describe, expect, it } from "vitest";
import type { Anledning, Gave, Person } from "@app-types/gaver";
import {
  belopFelt,
  effektivStandard,
  fodselsdatoTekst,
  grupperMottakere,
  historikk,
  iPlanen,
  juleoversikt,
  julAnledningId,
  kanLeggesTil,
  leggTilMottaker,
  lopendeIdeer,
  nyJulAnledning,
  tolkFodselsdato,
  tolkPlanBelop,
  type Grupper,
  UTEN_REGISTER,
} from "./gaver";

const T = "2026-11-02T10:00:00.000Z";

function person(id: string, over: Partial<Person> = {}): Person {
  return {
    id,
    navn: id.toUpperCase(),
    gruppe: "naer",
    unntak: {},
    versjon: 1,
    opprettet: T,
    oppdatert: T,
    ...over,
  };
}

function gave(id: string, personId: string, over: Partial<Gave> = {}): Gave {
  return {
    id,
    personId,
    anledningId: "jul-2026",
    tekst: id,
    status: "ide",
    versjon: 1,
    opprettet: T,
    oppdatert: T,
    ...over,
  };
}

const grupper: Grupper = {
  naer: {
    id: "naer",
    standard: { jul: { budsjett: { type: "belop", belopOre: 50000 } } },
    versjon: 1,
  },
  venner: { id: "venner", standard: { jul: { aktiv: false } }, versjon: 1 },
};

describe("effektivStandard — feltvis arv", () => {
  it("uten lagret gruppe: jul er aktiv og budsjettet ikke satt (ingen oppdiktede beløp)", () => {
    const e = effektivStandard(person("a", { gruppe: "andre" }), grupper, "jul");
    expect(e).toEqual({
      aktiv: true,
      budsjett: { type: "ikke_satt" },
      aktivFra: "standard",
      budsjettFra: "standard",
    });
  });

  it("arver gruppens budsjett og aktiv", () => {
    expect(effektivStandard(person("a"), grupper, "jul")).toMatchObject({
      aktiv: true,
      budsjett: { type: "belop", belopOre: 50000 },
      budsjettFra: "gruppe",
    });
    expect(effektivStandard(person("v", { gruppe: "venner" }), grupper, "jul")).toMatchObject({
      aktiv: false,
      aktivFra: "gruppe",
    });
  });

  it("personunntak false og beløp 0 er ekte valg, ikke arv", () => {
    const e = effektivStandard(
      person("a", { unntak: { jul: { aktiv: false, budsjett: { type: "belop", belopOre: 0 } } } }),
      grupper,
      "jul",
    );
    expect(e).toMatchObject({
      aktiv: false,
      aktivFra: "person",
      budsjett: { type: "belop", belopOre: 0 },
      budsjettFra: "person",
    });
  });

  it("eksplisitt «ikke satt» hos personen overstyrer gruppens beløp", () => {
    const e = effektivStandard(
      person("a", { unntak: { jul: { budsjett: { type: "ikke_satt" } } } }),
      grupper,
      "jul",
    );
    expect(e.budsjett).toEqual({ type: "ikke_satt" });
    expect(e.budsjettFra).toBe("person");
  });

  it("bare manglende felt arver: aktiv fra personen, budsjett fra gruppen", () => {
    const e = effektivStandard(person("a", { unntak: { jul: { aktiv: true } } }), grupper, "jul");
    expect(e).toMatchObject({ aktivFra: "person", budsjettFra: "gruppe" });
    const arv = effektivStandard(
      person("a", { unntak: { jul: { budsjett: { type: "arv" } } } }),
      grupper,
      "jul",
    );
    expect(arv.budsjettFra).toBe("gruppe");
  });

  it("gruppens aktiv=false og budsjett 0 bevares", () => {
    const g: Grupper = {
      naer: {
        id: "naer",
        standard: { jul: { aktiv: false, budsjett: { type: "belop", belopOre: 0 } } },
        versjon: 2,
      },
    };
    expect(effektivStandard(person("a"), g, "jul")).toMatchObject({
      aktiv: false,
      budsjett: { type: "belop", belopOre: 0 },
    });
  });
});

describe("nyJulAnledning — øyeblikksbilde", () => {
  it("stabil id og mottakere fra arven; arkiverte og inaktive er ikke med", () => {
    const a = nyJulAnledning(
      2026,
      [
        person("a"),
        person("b", { arkivert: T }),
        person("v", { gruppe: "venner" }),
        person("u", { gruppe: "utvidet" }),
      ],
      grupper,
      T,
    );
    expect(a.id).toBe(julAnledningId(2026));
    expect(a.id).toBe("jul-2026");
    expect(a.mottakere).toEqual({
      a: { budsjett: { type: "belop", belopOre: 50000 } },
      u: { budsjett: { type: "ikke_satt" } },
    });
    expect(a.versjon).toBe(1);
  });

  it("tom personliste gir en gyldig anledning uten mottakere", () => {
    expect(nyJulAnledning(2026, [], grupper, T).mottakere).toEqual({});
  });
});

describe("leggTilMottaker og kanLeggesTil", () => {
  const anl = nyJulAnledning(2026, [person("a")], grupper, T);

  it("person lagt til etter oppstart foreslås, men legges ikke til automatisk", () => {
    const ny = person("n");
    const { foreslatt, ovrige } = kanLeggesTil(
      anl,
      [person("a"), ny, person("v", { gruppe: "venner" })],
      grupper,
    );
    expect(foreslatt.map((p) => p.id)).toEqual(["n"]);
    expect(ovrige.map((p) => p.id)).toEqual(["v"]);
    expect(anl.mottakere.n).toBeUndefined();
  });

  it("ny mottaker får budsjettet fra arven", () => {
    expect(leggTilMottaker(anl, person("n"), grupper)).toEqual({
      budsjett: { type: "belop", belopOre: 50000 },
    });
  });

  it("tilbake etter fjerning beholder øyeblikksbildet, ikke dagens arv", () => {
    const fjernet: Anledning = {
      ...anl,
      mottakere: { a: { budsjett: { type: "belop", belopOre: 12300 }, fjernet: T } },
    };
    expect(leggTilMottaker(fjernet, person("a"), grupper)).toEqual({
      budsjett: { type: "belop", belopOre: 12300 },
    });
    expect(kanLeggesTil(fjernet, [person("a")], grupper).foreslatt).toEqual([]);
  });
});

describe("juleoversikt", () => {
  const personer = [person("a"), person("b"), person("c", { gruppe: "utvidet" })];
  const anl: Anledning = {
    ...nyJulAnledning(2026, personer, grupper, T),
    mottakere: {
      a: { budsjett: { type: "belop", belopOre: 50000 } },
      b: { budsjett: { type: "belop", belopOre: 40000 } },
      c: { budsjett: { type: "ikke_satt" } },
    },
  };

  it("en idé teller ikke som kjøpt; flere ideer gir ikke misvisende sum", () => {
    const o = juleoversikt(anl, personer, [
      gave("g1", "a", { planlagtOre: 30000 }),
      gave("g2", "a", { planlagtOre: 45000 }),
      gave("g3", "a", { planlagtOre: 20000, valgt: true }),
    ]);
    const a = o.mottakere.find((m) => m.personId === "a")!;
    expect(a.ferdig).toBe(false);
    expect(a.planlagtOre).toBe(20000);
    expect(a.alternativer).toBe(2);
    expect(o.antallMangler).toBe(3);
  });

  it("kjøpt og gitt er ferdig og i planen; beløp 0 telles som beløp", () => {
    const o = juleoversikt(anl, personer, [
      gave("g1", "a", { status: "kjopt", planlagtOre: 30000 }),
      gave("g2", "b", { status: "gitt", planlagtOre: 0 }),
      gave("g3", "c", { status: "kjopt" }),
    ]);
    expect(o.antallFerdig).toBe(3);
    expect(o.antallMangler).toBe(0);
    expect(o.planlagtOre).toBe(30000);
    expect(o.iPlanenUtenBelop).toBe(1);
    expect(o.budsjettOre).toBe(90000);
    expect(o.antallUtenBudsjett).toBe(1);
  });

  it("fjernet mottaker vises for seg med gavene, uten å telle i summene", () => {
    const fjernet: Anledning = {
      ...anl,
      mottakere: { ...anl.mottakere, b: { ...anl.mottakere.b!, fjernet: T } },
    };
    const o = juleoversikt(fjernet, personer, [
      gave("g1", "b", { status: "kjopt", planlagtOre: 9900 }),
    ]);
    expect(o.mottakere.map((m) => m.personId)).toEqual(["a", "c"]);
    expect(o.fjernede.map((m) => m.personId)).toEqual(["b"]);
    expect(o.fjernede[0]!.gaver).toHaveLength(1);
    expect(o.planlagtOre).toBe(0);
    expect(o.budsjettOre).toBe(50000);
  });

  it("gaver for personer som ikke er mottakere skjules ikke", () => {
    const o = juleoversikt(anl, personer, [gave("g1", "x", { status: "kjopt" })]);
    expect(o.utenforListen.map((m) => m.personId)).toEqual(["x"]);
    expect(o.utenforListen[0]!.navn).toBe("Ukjent person");
  });

  it("andre anledningers gaver og løpende ideer telles ikke", () => {
    const o = juleoversikt(anl, personer, [
      gave("g1", "a", { anledningId: "jul-2025", status: "gitt", planlagtOre: 1 }),
      gave("g2", "a", { anledningId: undefined, valgt: true, planlagtOre: 1 }),
    ]);
    expect(o.planlagtOre).toBe(0);
    expect(o.antallFerdig).toBe(0);
  });

  it("sorterer etter gruppe og navn", () => {
    const o = juleoversikt(anl, personer, []);
    expect(o.mottakere.map((m) => m.personId)).toEqual(["a", "b", "c"]);
  });
});

describe("historikk — bevart ved arkivering, redigering og gruppebytte", () => {
  const jul25: Anledning = {
    id: "jul-2025",
    type: "jul",
    aar: 2025,
    mottakere: { a: { budsjett: { type: "belop", belopOre: 40000 } } },
    versjon: 3,
    opprettet: T,
    oppdatert: T,
  };
  const gaver = [gave("g1", "a", { anledningId: "jul-2025", status: "gitt", planlagtOre: 35000 })];

  it("arkivert, omdøpt person som har byttet gruppe har samme historikk og øyeblikksbilde", () => {
    const endret = person("a", { navn: "Nytt navn", gruppe: "venner", arkivert: T });
    const o = juleoversikt(jul25, [endret], gaver);
    expect(o.mottakere[0]!.budsjett).toEqual({ type: "belop", belopOre: 40000 });
    expect(o.mottakere[0]!.gaver.map((g) => g.id)).toEqual(["g1"]);
    expect(historikk("a", gaver, [jul25], "jul-2026")).toHaveLength(1);
  });

  it("ny anledning tar ikke med arkivert person, men gammel anledning er uendret", () => {
    const endret = person("a", { arkivert: T });
    expect(nyJulAnledning(2026, [endret], grupper, T).mottakere).toEqual({});
    expect(jul25.mottakere.a).toBeDefined();
  });
});

describe("små hjelpere", () => {
  it("iPlanen og løpende ideer", () => {
    expect(iPlanen({ status: "ide" })).toBe(false);
    expect(iPlanen({ status: "ide", valgt: true })).toBe(true);
    expect(iPlanen({ status: "gitt" })).toBe(true);
    const g = [gave("g1", "a", { anledningId: undefined }), gave("g2", "a")];
    expect(lopendeIdeer("a", g).map((x) => x.id)).toEqual(["g1"]);
  });

  it("tolkPlanBelop bevarer 0 og skiller tom fra ugyldig", () => {
    expect(tolkPlanBelop("0")).toBe(0);
    expect(tolkPlanBelop("350,50")).toBe(35050);
    expect(tolkPlanBelop("1 200 kr")).toBe(120000);
    expect(tolkPlanBelop("")).toBeUndefined();
    expect(tolkPlanBelop("-5")).toBeNull();
    expect(tolkPlanBelop("abc")).toBeNull();
    expect(belopFelt(35050)).toBe("350,50");
    expect(belopFelt(0)).toBe("0");
    expect(belopFelt(undefined)).toBe("");
  });

  it("fødselsdato med og uten år", () => {
    expect(tolkFodselsdato("24.12.1980")).toBe("1980-12-24");
    expect(tolkFodselsdato("5.3")).toBe("--03-05");
    expect(tolkFodselsdato("29.02")).toBe("--02-29");
    expect(tolkFodselsdato("31.02.2020")).toBeNull();
    expect(tolkFodselsdato("")).toBeUndefined();
    expect(fodselsdatoTekst("1980-12-24")).toBe("24.12.1980");
    expect(fodselsdatoTekst("--03-05")).toBe("5.3");
  });
});

describe("grupperMottakere (roadmap Gaver punkt 4)", () => {
  const anlFor = (ids: string[]): Anledning => ({
    id: "jul-2026",
    type: "jul",
    aar: 2026,
    mottakere: Object.fromEntries(ids.map((id) => [id, { budsjett: { type: "ikke_satt" } }])),
    versjon: 1,
    opprettet: T,
    oppdatert: T,
  });
  const personer = [
    person("v", { navn: "Vera", gruppe: "venner" }),
    person("a", { navn: "Anne", gruppe: "naer" }),
    person("b", { navn: "Bjørn", gruppe: "naer" }),
    person("u", { navn: "Ulf", gruppe: "utvidet" }),
  ];
  const ids = ["v", "a", "b", "u", "borte"];
  const grupper = (pers: Person[]) =>
    grupperMottakere(juleoversikt(anlFor(ids), pers, []).mottakere).map((g) => ({
      id: g.id,
      navn: g.navn,
      ider: g.mottakere.map((m) => m.personId),
    }));

  it("følger registerets grupperekkefølge og navn; tomme grupper utelates; restgruppen sist", () => {
    expect(grupper(personer)).toEqual([
      { id: "naer", navn: "Nærmeste familie", ider: ["a", "b"] },
      { id: "utvidet", navn: "Utvidet familie", ider: ["u"] },
      { id: "venner", navn: "Venner", ider: ["v"] },
      { id: UTEN_REGISTER, navn: "Ikke i personregisteret", ider: ["borte"] },
    ]);
  });

  it("alle mottakere vises nøyaktig én gang", () => {
    const alle = grupper(personer).flatMap((g) => g.ider);
    expect(alle.sort()).toEqual([...ids].sort());
  });

  it("flytting i registeret flytter mottakeren, uten å endre anledningen", () => {
    const anl = anlFor(ids);
    const før = structuredClone(anl);
    const flyttet = personer.map((p) => (p.id === "a" ? { ...p, gruppe: "andre" as const } : p));
    const res = grupperMottakere(juleoversikt(anl, flyttet, []).mottakere);
    expect(res.map((g) => [g.id, g.mottakere.map((m) => m.personId)])).toEqual([
      ["naer", ["b"]],
      ["utvidet", ["u"]],
      ["venner", ["v"]],
      ["andre", ["a"]],
      [UTEN_REGISTER, ["borte"]],
    ]);
    expect(anl).toEqual(før);
  });

  it("ukjent gruppe-id fra eldre data mistes ikke: egen gruppe før restgruppen", () => {
    const rare = [...personer, person("x", { navn: "Xena", gruppe: "gammel" as never })];
    const res = grupperMottakere(juleoversikt(anlFor([...ids, "x"]), rare, []).mottakere);
    expect(res.map((g) => g.id)).toEqual(["naer", "utvidet", "venner", "gammel", UTEN_REGISTER]);
  });

  it("ingen mottakere gir ingen grupper", () => {
    expect(grupperMottakere([])).toEqual([]);
  });
});
