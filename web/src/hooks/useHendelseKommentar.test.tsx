/**
 * #59, ordre 7002365160 (#141): kommentarforsøk er bundet til familie og
 * INNLOGGINGSSESJON. Ekte `useHendelseKommentar`, `auth.repository` og
 * `useAuthSesjon`; bare Firebase Auth-instansen og forsoningsskriveren er
 * erstattet, så testen kan bytte mellom to ulike User-objekter med SAMME uid.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { besluttKommentar } from "@domain/forsoning/hendelseKommentar";
import { FamilyIdProvider } from "./useFamilyId";

const auth = vi.hoisted(() => ({
  currentUser: null as { uid: string } | null,
  lyttere: new Set<() => void>(),
}));
const settBruker = (b: { uid: string } | null) => {
  auth.currentUser = b;
  act(() => auth.lyttere.forEach((f) => f()));
};
const lytt = (_a: unknown, cb: (u: unknown) => void) => {
  const f = () => cb(auth.currentUser);
  auth.lyttere.add(f);
  return () => auth.lyttere.delete(f);
};
vi.mock("firebase/auth", () => ({
  onIdTokenChanged: lytt,
  onAuthStateChanged: lytt,
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@data/firebase", () => ({ getFirebaseAuth: () => auth }));

const skriv = vi.hoisted(() => vi.fn());
const les = vi.hoisted(() => vi.fn());
vi.mock("@data/forsoningSkriving.repository", () => ({
  kjorNodeVersjonert: skriv,
  lesForsoningNodeFersk: les,
}));
const aktiv = vi.hoisted(() => ({ verdi: true }));
vi.mock("./forsoningAktivering", () => ({ forsoningSkrivingAktiv: () => aktiv.verdi }));

const { useHendelseKommentar, nullstillKommentarForsok, oppdaterKommentarForsok } =
  await import("./useHendelseKommentar");
const { aktivSesjon } = await import("@data/auth.repository");

let familie = "familie1";
const omslag = ({ children }: { children: ReactNode }) => (
  <FamilyIdProvider value={familie}>{children}</FamilyIdProvider>
);
const MAAL = { id: "h1", kilde: "Gammel" };
const HENDELSE = {
  id: "h1",
  kilde: "manuell",
  transaksjonId: null,
  receiptId: null,
  kommentar: "Gammel",
  oppdatert: "x",
};
const forsokFra = (kontekst: string) => ({
  kontekst,
  hendelseId: "h1",
  kilde: "Gammel",
  sendt: "Ny",
});

beforeEach(() => {
  skriv.mockReset().mockResolvedValue({ type: "lagret" });
  les.mockReset().mockResolvedValue({ type: "lest", eksport: [{ ...HENDELSE, kommentar: "Ny" }] });
  familie = "familie1";
  aktiv.verdi = true;
  auth.currentUser = { uid: "u1" };
  nullstillKommentarForsok();
});

describe("useHendelseKommentar", () => {
  it("lagrer via den versjonerte REST-kjøringen med sesjonen, og beslutningen er `besluttKommentar` med tidspunktet for forsøket", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-19T08:00:00.000Z"));
    const { result } = renderHook(() => useHendelseKommentar(), { wrapper: omslag });
    expect(await result.current.lagre(result.current.kontekst, MAAL, "  Ny ")).toBe("lagret");
    vi.useRealTimers();
    expect(skriv).toHaveBeenCalledWith("familie1", "hendelser", expect.any(Function), {
      sesjon: aktivSesjon(),
    });
    const beslutt = skriv.mock.calls[0]![2] as (p: unknown[]) => unknown;
    expect(beslutt([HENDELSE])).toEqual(
      besluttKommentar([HENDELSE], MAAL, "Ny", "2026-11-19T08:00:00.000Z"),
    );
    expect(beslutt([HENDELSE])).toEqual({
      type: "skriv",
      eksport: [{ ...HENDELSE, kommentar: "Ny", oppdatert: "2026-11-19T08:00:00.000Z" }],
    });
  });

  it("utfallene fra datalaget mappes uten å endre betydning", async () => {
    const { result } = renderHook(() => useHendelseKommentar(), { wrapper: omslag });
    const k = result.current.kontekst;
    for (const [r, u] of [
      [{ type: "stopp", utfall: "konflikt" }, "konflikt"],
      [{ type: "avvist" }, "avvist"],
      [{ type: "byttet" }, "byttet"],
      [{ type: "ikkeLest" }, "ikkeLest"],
      [{ type: "ukjent" }, "ukjent"],
    ] as const) {
      skriv.mockResolvedValueOnce(r);
      expect(await result.current.lagre(k, MAAL, "Ny")).toBe(u);
    }
  });

  it("ny innlogging med SAMME uid gir ny kontekst; tokenfornyelse gjør det ikke", () => {
    const { result } = renderHook(() => useHendelseKommentar(), { wrapper: omslag });
    const k1 = result.current.kontekst;
    settBruker(auth.currentUser);
    expect(result.current.kontekst).toBe(k1);
    settBruker(null);
    settBruker({ uid: "u1" });
    expect(result.current.kontekst).not.toBe(k1);
  });

  it("en gammel funksjon før ny tegning sender og leser ingenting for forrige sesjon", async () => {
    const { result } = renderHook(() => useHendelseKommentar(), { wrapper: omslag });
    const gammel = result.current;
    const k1 = gammel.kontekst;
    auth.currentUser = { uid: "u1" }; // ny innlogging, ingen varsel ennå
    expect(await gammel.lagre(k1, MAAL, "Ny")).toBe("byttet");
    expect(await gammel.sjekk(forsokFra(k1))).toBe("byttet");
    expect(skriv).not.toHaveBeenCalled();
    expect(les).not.toHaveBeenCalled();
  });

  it("familiebytte med samme hendelses-id: gammel kontekst avvises; ny skriver i ny familie", async () => {
    const { result, rerender } = renderHook(() => useHendelseKommentar(), { wrapper: omslag });
    const gammel = result.current;
    familie = "familie2";
    rerender();
    expect(await gammel.lagre(gammel.kontekst, MAAL, "Ny")).toBe("byttet");
    expect(skriv).not.toHaveBeenCalled();
    expect(await result.current.lagre(result.current.kontekst, MAAL, "Ny")).toBe("lagret");
    expect(skriv.mock.calls[0]![0]).toBe("familie2");
  });

  it("kontrollen leser fersk og vurderer mot DET SENDTE forsøket", async () => {
    const { result } = renderHook(() => useHendelseKommentar(), { wrapper: omslag });
    expect(await result.current.sjekk(forsokFra(result.current.kontekst))).toBe("likSendt");
    expect(les).toHaveBeenCalledWith("familie1", "hendelser", { sesjon: aktivSesjon() });
  });

  it("skriveporten av: `stengt` uten skriving", async () => {
    aktiv.verdi = false;
    const { result } = renderHook(() => useHendelseKommentar(), { wrapper: omslag });
    expect(await result.current.lagre(result.current.kontekst, MAAL, "Ny")).toBe("stengt");
    expect(skriv).not.toHaveBeenCalled();
  });

  it("forsøkene overlever ny montering, og vises bare i sin egen kontekst", () => {
    const a = renderHook(() => useHendelseKommentar(), { wrapper: omslag });
    const k1 = a.result.current.kontekst;
    act(() => oppdaterKommentarForsok(k1, "h1", (l) => [...l, forsokFra(k1)]));
    a.unmount();
    const b = renderHook(() => useHendelseKommentar(), { wrapper: omslag });
    expect(b.result.current.forsokFor("h1")).toEqual([forsokFra(k1)]);
    settBruker(null);
    settBruker({ uid: "u1" });
    expect(b.result.current.forsokFor("h1")).toEqual([]);
  });
});
