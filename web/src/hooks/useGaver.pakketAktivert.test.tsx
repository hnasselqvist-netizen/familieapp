/**
 * Status «Pakket» i appens aktiverte standardmodus (#20 7038853728, review
 * 5973381911): samme falske RTDB og ekte repository som `useGaver.test.tsx`,
 * med den EKTE aktiveringsbryteren (ingen mock). Rollback-modusen dekkes i
 * `useGaver.test.tsx`.
 *
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
// `endrePost` skriver over versjonert REST (`versjonertPost.ts`, #20 ordre
// 7013713991): samme falske database, lest og skrevet på eksakt sti. Den
// falske databasen har ingen prioriteter, så eksportform = verdiform her;
// prioritetene låses mot ekte RTDB i `gaver.endrePost.integration.test.ts`.
vi.mock("@data/versjonertPost", () => ({
  kjorVersjonertPost: async (
    sti: string,
    beslutt: (eksport: unknown) => { type: "skriv"; eksport: unknown } | { type: "stopp" },
  ) => {
    const i = db.feil.findIndex((m) => m.test(sti));
    if (i !== -1) {
      db.feil.splice(i, 1);
      return { type: "ikkeLest" };
    }
    const b = beslutt(hent(sti));
    if (b.type === "stopp") return b;
    sett(sti, b.eksport);
    return { type: "lagret" };
  },
}));
vi.mock("./useFamilyId", () => ({ useFamilyId: () => "familie1" }));
// Årsbudsjettet i Økonomi svarer aldri: gavemodulen skal verken abonnere på
// det eller vente på det (roadmap Gaver punkt 5).
const budsjettAbonnement = vi.hoisted(() => vi.fn(() => () => {}));
vi.mock("@data/budsjettfamilie.repository", () => ({
  subscribeBudsjettGrupper: budsjettAbonnement,
}));

// Importeres etter mockene (vitest hoister vi.mock).
const { useGaver } = await import("./useGaver");

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

describe("status «Pakket» gjennom hooken, AKTIVERT (aktiveringscommiten)", () => {
  const lagret = (over: Record<string, unknown> = {}) => ({
    personId: "p1",
    anledningId: "jul-2026",
    tekst: "Bok",
    status: "kjopt",
    planlagtOre: 25000,
    fremtidigFelt: { a: 1 },
    versjon: 1,
    ...over,
  });

  it("settGaveStatus «pakket»: bare status endres; ukjente felt og beløp står; tilbake til Kjøpt går også", async () => {
    sett(`${FAM}/gaver/g1`, lagret());
    const h = await lastet();
    const g = () => h.result.current.data!.gaver.find((x) => x.id === "g1")!;
    await act(() => h.result.current.handlinger.settGaveStatus(g(), "pakket"));
    expect(hent(`${FAM}/gaver/g1`)).toMatchObject({
      status: "pakket",
      planlagtOre: 25000,
      fremtidigFelt: { a: 1 },
      versjon: 2,
    });
    await waitFor(() => expect(g().status).toBe("pakket"));
    await act(() => h.result.current.handlinger.settGaveStatus(g(), "kjopt"));
    expect(hent(`${FAM}/gaver/g1`)).toMatchObject({ status: "kjopt", versjon: 3 });
  });

  it("på-modus: en ny gave og en registrering kan opprettes med Pakket", async () => {
    const h = await lastet();
    await act(() =>
      h.result.current.handlinger.lagreGave("g-ny", { ...utkast, status: "pakket" }, null),
    );
    expect(hent(`${FAM}/gaver/g-ny`)).toMatchObject({ status: "pakket", versjon: 1 });
  });
});
