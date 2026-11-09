/**
 * useGaver → EKTE `data/gaver.repository` → en falsk RTDB i minnet
 * (review 5731352564). Bare Firebase-SDK-et er byttet ut; hooken,
 * endringsbyggerne og repositoryets vakt-/retry-logikk er de ekte.
 * Den falske databasen oppfører seg som RTDB på det som betyr noe her:
 * `null`/tomme objekter lagres ikke, og en transaksjon ser serverens verdi.
 * Emulatortestene (`gaver.repository.integration.test.ts`) låser det samme
 * mot ekte RTDB.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Gave, Person } from "@app-types/gaver";

// ── Falsk RTDB ─────────────────────────────────────────────────────────
type Lytter = { sti: string; cb: (s: { val: () => unknown; exists: () => boolean }) => void };
const db = vi.hoisted(() => ({
  rot: {} as Record<string, unknown>,
  lyttere: [] as Lytter[],
  n: 0,
  /** Deterministisk feil: transaksjoner på stier som matcher, avvises (én gang per oppføring). */
  feil: [] as RegExp[],
}));

function hent(sti: string): unknown {
  let node: unknown = db.rot;
  for (const del of sti.split("/")) {
    if (!node || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[del];
  }
  return node === undefined ? null : JSON.parse(JSON.stringify(node));
}
function rens(v: unknown): unknown {
  if (v === null || v === undefined) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) return v;
  const ut: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const r = rens(x);
    if (r !== undefined) ut[k] = r;
  }
  return Object.keys(ut).length ? ut : undefined;
}
function sett(sti: string, verdi: unknown): void {
  const deler = sti.split("/");
  let node = db.rot;
  for (const del of deler.slice(0, -1)) {
    if (!node[del] || typeof node[del] !== "object") node[del] = {};
    node = node[del] as Record<string, unknown>;
  }
  const r = rens(verdi);
  if (r === undefined) delete node[deler[deler.length - 1]!];
  else node[deler[deler.length - 1]!] = r;
  for (const l of db.lyttere) if (sti.startsWith(l.sti) || l.sti.startsWith(sti)) varsle(l);
}
const snapshot = (sti: string) => ({ val: () => hent(sti), exists: () => hent(sti) !== null });
function varsle(l: Lytter) {
  l.cb(snapshot(l.sti));
}

vi.mock("@data/firebase", () => ({ getFirebaseDatabase: () => ({}) }));
vi.mock("firebase/database", () => ({
  ref: (_db: unknown, sti: string) => ({ sti }),
  push: (r: { sti: string }) => ({ key: `ny${++db.n}`, sti: r.sti }),
  onValue: (r: { sti: string }, cb: Lytter["cb"]) => {
    const l = { sti: r.sti, cb };
    db.lyttere.push(l);
    varsle(l);
    return () => {
      db.lyttere = db.lyttere.filter((x) => x !== l);
    };
  },
  runTransaction: async (r: { sti: string }, fn: (naa: unknown) => unknown) => {
    const i = db.feil.findIndex((m) => m.test(r.sti));
    if (i !== -1) {
      db.feil.splice(i, 1);
      throw new Error("Syntetisk nettverksfeil");
    }
    const neste = fn(hent(r.sti));
    if (neste === undefined) return { committed: false, snapshot: snapshot(r.sti) };
    sett(r.sti, neste);
    return { committed: true, snapshot: snapshot(r.sti) };
  },
}));
vi.mock("./useFamilyId", () => ({ useFamilyId: () => "familie1" }));
vi.mock("@data/budsjettfamilie.repository", () => ({
  subscribeBudsjettGrupper: (_f: string, _n: string, cb: (g: unknown[]) => void) => {
    cb([]);
    return () => {};
  },
}));

// Importeres etter mockene (vitest hoister vi.mock).
const { useGaver } = await import("./useGaver");
const { endrePost, sammeVersjon, EndretAvAndre } = await import("@data/gaver.repository");
const { gaveEndring, personEndring } = await import("@domain/gaver/endringer");

const FAM = "families/familie1";
const utkast = {
  personId: "p1",
  anledningId: "jul-2026",
  tekst: "Bok",
  status: "ide" as const,
  planlagtOre: 25000,
};

beforeEach(() => {
  db.rot = {};
  db.lyttere = [];
  db.feil = [];
});

async function lastet() {
  const h = renderHook(() => useGaver());
  await waitFor(() => expect(h.result.current.status).toBe("loaded"));
  return h;
}

describe("useGaver mot ekte repository", () => {
  it("P1: identisk retry av ny gave lykkes uten å skrive på nytt", async () => {
    const h = await lastet();
    await act(() => h.result.current.handlinger.lagreGave("g1", utkast, null));
    await act(() => h.result.current.handlinger.lagreGave("g1", utkast, null));
    expect(hent(`${FAM}/gaver/g1`)).toMatchObject({ tekst: "Bok", versjon: 1 });
  });

  it("P1: retry med endret utkast gir konflikt; lagret post er urørt", async () => {
    const h = await lastet();
    await act(() => h.result.current.handlinger.lagreGave("g1", utkast, null));
    const foer = hent(`${FAM}/gaver/g1`);
    await expect(
      h.result.current.handlinger.lagreGave("g1", { ...utkast, tekst: "Annet" }, null),
    ).rejects.toBeInstanceOf(EndretAvAndre);
    expect(hent(`${FAM}/gaver/g1`)).toEqual(foer);
  });

  it("P1: A oppretter, B endrer, A prøver igjen → konflikt, ikke stille overskriving", async () => {
    const h = await lastet();
    await act(() => h.result.current.handlinger.lagreGave("g1", utkast, null));
    await endrePost("familie1", "gaver", "g1", {
      vakt: sammeVersjon(1),
      endring: gaveEndring({ ...utkast, tekst: "Nyere endring", status: "kjopt" }),
      grunn: "1",
      tid: "t",
    });
    await expect(h.result.current.handlinger.lagreGave("g1", utkast, null)).rejects.toBeInstanceOf(
      EndretAvAndre,
    );
    expect(hent(`${FAM}/gaver/g1`)).toMatchObject({ tekst: "Nyere endring", status: "kjopt" });

    // «Lagre min versjon likevel» = eksplisitt endring mot den lagrede versjonen.
    await waitFor(() =>
      expect(h.result.current.data!.gaver.find((g) => g.id === "g1")?.versjon).toBe(2),
    );
    const lagret = h.result.current.data!.gaver.find((g) => g.id === "g1") as Gave;
    await act(() => h.result.current.handlinger.lagreGave("g1", utkast, lagret));
    expect(hent(`${FAM}/gaver/g1`)).toMatchObject({ tekst: "Bok", status: "ide", versjon: 3 });
  });

  it("P1: samme for ny person", async () => {
    const h = await lastet();
    const p = { navn: "A", gruppe: "naer" as const, jul: {} };
    await act(() => h.result.current.handlinger.lagrePerson("p1", p, null));
    await endrePost("familie1", "relasjoner", "p1", {
      vakt: sammeVersjon(1),
      endring: personEndring({ ...p, navn: "A fra B" }),
      grunn: "1",
      tid: "t",
    });
    await expect(h.result.current.handlinger.lagrePerson("p1", p, null)).rejects.toBeInstanceOf(
      EndretAvAndre,
    );
    expect(hent(`${FAM}/relasjoner/p1`)).toMatchObject({ navn: "A fra B" });
  });

  it("P2: vanlig navneendring bevarer ukjente underfelt", async () => {
    sett(`${FAM}/relasjoner/p1`, {
      navn: "A",
      gruppe: "naer",
      versjon: 1,
      unntak: { jul: { aktiv: true, fremtidig: "behold", budsjett: { type: "ikke_satt", z: 1 } } },
    });
    const h = await lastet();
    const p = h.result.current.data!.personer[0] as Person;
    await act(() =>
      h.result.current.handlinger.lagrePerson(
        "p1",
        { navn: "A2", gruppe: "naer", jul: { aktiv: true, budsjett: { type: "ikke_satt" } } },
        p,
      ),
    );
    expect(hent(`${FAM}/relasjoner/p1`)).toMatchObject({
      navn: "A2",
      unntak: { jul: { aktiv: true, fremtidig: "behold", budsjett: { type: "ikke_satt", z: 1 } } },
    });
  });

  it("P2: gruppestandard og gjenoppretting av mottaker bevarer ukjente felt", async () => {
    sett(`${FAM}/relasjonsgrupper/naer`, {
      versjon: 1,
      standard: { jul: { aktiv: true, fremtidig: "behold" } },
    });
    sett(`${FAM}/relasjoner/p1`, { navn: "A", gruppe: "naer", versjon: 1 });
    sett(`${FAM}/anledninger/jul-2026`, {
      type: "jul",
      aar: 2026,
      versjon: 1,
      mottakere: { p1: { budsjett: { type: "ikke_satt" }, fjernet: "t", fremtidig: "behold" } },
    });
    const h = await lastet();
    await act(() =>
      h.result.current.handlinger.lagreGruppeStandard(
        "naer",
        { aktiv: false, budsjett: { type: "belop", belopOre: 0 } },
        1,
      ),
    );
    expect(hent(`${FAM}/relasjonsgrupper/naer`)).toMatchObject({
      standard: {
        jul: { aktiv: false, fremtidig: "behold", budsjett: { type: "belop", belopOre: 0 } },
      },
    });
    const d = h.result.current.data!;
    await act(() => h.result.current.handlinger.leggTilMottaker(d.anledninger[0]!, d.personer[0]!));
    expect(hent(`${FAM}/anledninger/jul-2026/mottakere/p1`)).toEqual({
      budsjett: { type: "ikke_satt" },
      fremtidig: "behold",
    });
  });

  it("P2-3: løpende idé uten anledning kan opprettes og deretter brukes til jul", async () => {
    const h = await lastet();
    const { anledningId: _a, ...uten } = utkast;
    void _a;
    await act(() => h.result.current.handlinger.lagreGave("g1", uten, null));
    expect(hent(`${FAM}/gaver/g1`)).not.toHaveProperty("anledningId");
    const g = h.result.current.data!.gaver[0]!;
    await act(() => h.result.current.handlinger.flyttGave(g, "jul-2026"));
    expect(hent(`${FAM}/gaver/g1`)).toMatchObject({ anledningId: "jul-2026", versjon: 2 });
  });
});

describe("useGaver: etterregistrering (helårsoversikten, Gaver punkt 2)", () => {
  const gitt = {
    personId: "p1",
    tekst: "Skjerf",
    status: "gitt" as const,
    planlagtOre: 35000,
    kjopsdato: "2025-12-28",
  };
  const personMedUnntak = () =>
    sett(`${FAM}/relasjoner/p1`, {
      navn: "Syntetisk A",
      gruppe: "naer",
      versjon: 1,
      unntak: { bursdag: { budsjett: { type: "belop", belopOre: 40000 } } },
    });

  it("bursdag: anledningen opprettes med personens budsjett, gaven leses tilbake med kjøpsdato", async () => {
    personMedUnntak();
    const h = await lastet();
    await act(() =>
      h.result.current.handlinger.registrerGave("g1", gitt, { type: "bursdag", aar: 2026 }),
    );
    expect(hent(`${FAM}/anledninger/bursdag-p1-2026`)).toMatchObject({
      type: "bursdag",
      aar: 2026,
      versjon: 1,
      mottakere: { p1: { budsjett: { type: "belop", belopOre: 40000 } } },
    });
    await waitFor(() => expect(h.result.current.data!.gaver).toHaveLength(1));
    expect(h.result.current.data!.gaver[0]).toMatchObject({
      id: "g1",
      personId: "p1",
      anledningId: "bursdag-p1-2026",
      status: "gitt",
      planlagtOre: 35000,
      kjopsdato: "2025-12-28",
      versjon: 1,
    });
    // Ingen juleplan opprettes, og ingenting skrives utenfor gavenodene.
    expect(hent(`${FAM}/anledninger/jul-2026`)).toBeNull();
    expect(Object.keys(hent(FAM) as object).sort()).toEqual(["anledninger", "gaver", "relasjoner"]);
  });

  it("bursdag finnes fra før: den lagrede brukes uendret (ingen reset), og retry gir ikke duplikat", async () => {
    personMedUnntak();
    sett(`${FAM}/anledninger/bursdag-p1-2026`, {
      type: "bursdag",
      aar: 2026,
      versjon: 3,
      mottakere: { p1: { budsjett: { type: "belop", belopOre: 12300 } } },
    });
    const foer = hent(`${FAM}/anledninger/bursdag-p1-2026`);
    const h = await lastet();
    const reg = () =>
      h.result.current.handlinger.registrerGave("g1", gitt, { type: "bursdag", aar: 2026 });
    await act(reg);
    await act(reg);
    expect(hent(`${FAM}/anledninger/bursdag-p1-2026`)).toEqual(foer);
    expect(Object.keys(hent(`${FAM}/gaver`) as object)).toEqual(["g1"]);
  });

  it("konflikt: retry med endret utkast eller etter endring fra en annen enhet avvises", async () => {
    personMedUnntak();
    const h = await lastet();
    await act(() =>
      h.result.current.handlinger.registrerGave("g1", gitt, { type: "bursdag", aar: 2026 }),
    );
    await expect(
      h.result.current.handlinger.registrerGave(
        "g1",
        { ...gitt, planlagtOre: 1 },
        { type: "bursdag", aar: 2026 },
      ),
    ).rejects.toBeInstanceOf(EndretAvAndre);
    expect(hent(`${FAM}/gaver/g1`)).toMatchObject({ planlagtOre: 35000, versjon: 1 });
  });

  it("review 5820769716: gavefeil skriver ingen bursdag; neste registrering får dagens budsjett", async () => {
    personMedUnntak();
    const h = await lastet();
    db.feil.push(/\/gaver\/g1$/);
    await expect(
      h.result.current.handlinger.registrerGave("g1", gitt, { type: "bursdag", aar: 2026 }),
    ).rejects.toThrow("Syntetisk nettverksfeil");
    expect(hent(`${FAM}/anledninger`)).toBeNull();
    expect(hent(`${FAM}/gaver`)).toBeNull();

    // Budsjettet endres før neste forsøk: ingen foreldet snapshot står igjen.
    const p = h.result.current.data!.personer[0] as Person;
    await act(() =>
      h.result.current.handlinger.lagrePerson(
        "p1",
        {
          navn: p.navn,
          gruppe: p.gruppe,
          jul: {},
          bursdag: { budsjett: { type: "belop", belopOre: 55500 } },
        },
        p,
      ),
    );
    await waitFor(() =>
      expect(h.result.current.data!.personer[0]!.unntak.bursdag?.budsjett).toEqual({
        type: "belop",
        belopOre: 55500,
      }),
    );
    await act(() =>
      h.result.current.handlinger.registrerGave("g1", gitt, { type: "bursdag", aar: 2026 }),
    );
    expect(hent(`${FAM}/anledninger/bursdag-p1-2026/mottakere/p1/budsjett`)).toEqual({
      type: "belop",
      belopOre: 55500,
    });
    expect(Object.keys(hent(`${FAM}/gaver`) as object)).toEqual(["g1"]);
  });

  it("review 5820769716: retry med endret mottaker på samme gave-id gir konflikt og ingen ny bursdag", async () => {
    personMedUnntak();
    sett(`${FAM}/relasjoner/p2`, { navn: "Syntetisk B", gruppe: "venner", versjon: 1 });
    const h = await lastet();
    // Første forsøk lagret gaven, men svaret gikk tapt før bursdagen ble lagret.
    db.feil.push(/\/anledninger\/bursdag-p1-2026$/);
    await expect(
      h.result.current.handlinger.registrerGave("g1", gitt, { type: "bursdag", aar: 2026 }),
    ).rejects.toThrow("Syntetisk nettverksfeil");
    expect(hent(`${FAM}/gaver/g1`)).toMatchObject({ personId: "p1" });
    expect(hent(`${FAM}/anledninger`)).toBeNull();

    await expect(
      h.result.current.handlinger.registrerGave(
        "g1",
        { ...gitt, personId: "p2" },
        { type: "bursdag", aar: 2026 },
      ),
    ).rejects.toBeInstanceOf(EndretAvAndre);
    expect(hent(`${FAM}/anledninger`)).toBeNull();
    expect(hent(`${FAM}/gaver/g1`)).toMatchObject({ personId: "p1", versjon: 1 });

    // Identisk retry fullfører bursdagen uten duplikat.
    await act(() =>
      h.result.current.handlinger.registrerGave("g1", gitt, { type: "bursdag", aar: 2026 }),
    );
    expect(Object.keys(hent(`${FAM}/anledninger`) as object)).toEqual(["bursdag-p1-2026"]);
    expect(Object.keys(hent(`${FAM}/gaver`) as object)).toEqual(["g1"]);
  });

  it("review 5820769716: fullforBursdag oppretter manglende bursdag eksplisitt og endrer aldri en eksisterende", async () => {
    personMedUnntak();
    const h = await lastet();
    db.feil.push(/\/anledninger\//);
    await expect(
      h.result.current.handlinger.registrerGave("g1", gitt, { type: "bursdag", aar: 2026 }),
    ).rejects.toThrow();
    await act(() => h.result.current.handlinger.fullforBursdag("p1", 2026));
    const lagret = hent(`${FAM}/anledninger/bursdag-p1-2026`);
    expect(lagret).toMatchObject({
      mottakere: { p1: { budsjett: { type: "belop", belopOre: 40000 } } },
    });
    await act(() => h.result.current.handlinger.fullforBursdag("p1", 2026));
    expect(hent(`${FAM}/anledninger/bursdag-p1-2026`)).toEqual(lagret);
  });

  it("review 5820769716: to samtidige registreringer gir én bursdag og begge gavene", async () => {
    personMedUnntak();
    const h = await lastet();
    const reg = h.result.current.handlinger.registrerGave;
    await act(() =>
      Promise.all([
        reg("g1", gitt, { type: "bursdag", aar: 2026 }),
        reg("g2", { ...gitt, tekst: "Bok" }, { type: "bursdag", aar: 2026 }),
        reg("g1", gitt, { type: "bursdag", aar: 2026 }),
      ]).then(() => undefined),
    );
    expect(Object.keys(hent(`${FAM}/anledninger`) as object)).toEqual(["bursdag-p1-2026"]);
    expect(Object.keys(hent(`${FAM}/gaver`) as object).sort()).toEqual(["g1", "g2"]);
    expect(hent(`${FAM}/anledninger/bursdag-p1-2026`)).toMatchObject({ versjon: 1 });
  });

  it("jul: gaven legges på jul-<år> uten å opprette juleplanen", async () => {
    personMedUnntak();
    const h = await lastet();
    await act(() =>
      h.result.current.handlinger.registrerGave(
        "g1",
        { ...gitt, kjopsdato: "" },
        { type: "jul", aar: 2026 },
      ),
    );
    expect(hent(`${FAM}/gaver/g1`)).toMatchObject({ anledningId: "jul-2026" });
    expect(hent(`${FAM}/gaver/g1`)).not.toHaveProperty("kjopsdato");
    expect(hent(`${FAM}/anledninger`)).toBeNull();
  });

  it("personens og gruppens bursdagsbudsjett lagres versjonert med bare budsjettfeltene", async () => {
    sett(`${FAM}/relasjoner/p1`, {
      navn: "A",
      gruppe: "naer",
      versjon: 1,
      unntak: { bursdag: { aktiv: false, fremtidig: "behold" } },
    });
    const h = await lastet();
    const p = h.result.current.data!.personer[0] as Person;
    await act(() =>
      h.result.current.handlinger.lagrePerson(
        "p1",
        {
          navn: "A",
          gruppe: "naer",
          jul: {},
          bursdag: { budsjett: { type: "belop", belopOre: 0 } },
        },
        p,
      ),
    );
    expect(hent(`${FAM}/relasjoner/p1/unntak/bursdag`)).toEqual({
      aktiv: false,
      fremtidig: "behold",
      budsjett: { type: "belop", belopOre: 0 },
    });
    await act(() =>
      h.result.current.handlinger.lagreGruppeStandard(
        "venner",
        { aktiv: true, budsjett: { type: "ikke_satt" } },
        0,
        { type: "belop", belopOre: 10000 },
      ),
    );
    expect(hent(`${FAM}/relasjonsgrupper/venner/standard/bursdag`)).toEqual({
      budsjett: { type: "belop", belopOre: 10000 },
    });
  });
});
