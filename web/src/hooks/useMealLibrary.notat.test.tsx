/**
 * Mat #20, review 5969643874: notatforsøk er bundet til familie og
 * INNLOGGINGSSESJON, ikke bare uid. Ekte `useMealLibrary`, ekte
 * `auth.repository` og ekte `useAuthSesjon`; bare Firebase Auth-instansen og
 * REST-datalaget er erstattet, så testen kan bytte `currentUser` mellom to
 * ULIKE User-objekter med SAMME uid, slik en utlogging og ny innlogging gjør.
 */
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyIdProvider } from "./useFamilyId";

type Bruker = { uid: string };
const auth = vi.hoisted(() => ({
  currentUser: null as { uid: string } | null,
  lyttere: new Set<() => void>(),
}));
/** Bytter `currentUser` og varsler som Firebase gjør ved innlogging og tokenfornyelse. */
const settBruker = (b: Bruker | null) => {
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
vi.mock("@data/mealLibrary.repository", () => ({
  skrivMealLibraryEntryVersjonert: skriv,
  lesMealLibraryEntryEksport: les,
  transactMealLibraryEntryMedUtfall: vi.fn(),
  transactMealLibraryEntry: vi.fn(),
  createMealLibraryEntry: vi.fn(),
  slettMealLibraryEntryVersjonert: vi.fn(),
  raattBiblioteksgrunnlag: vi.fn(),
  subscribeMealLibrary: () => () => {},
}));
vi.mock("@data/meals.repository", () => ({ backfillMealLibraryIdAcrossWeeks: vi.fn() }));

const { useMealLibrary } = await import("./useMealLibrary");
const { aktivSesjon } = await import("@data/auth.repository");

let familie = "familie1";
const omslag = ({ children }: { children: ReactNode }) => (
  <FamilyIdProvider value={familie}>{children}</FamilyIdProvider>
);
const forsokFra = (kontekst: string) => ({
  kontekst,
  mealId: "m1",
  kilde: "Gammelt",
  sendt: "Nytt",
});

beforeEach(() => {
  skriv.mockReset().mockResolvedValue({ type: "lagret" });
  les.mockReset().mockResolvedValue({ type: "lest", eksport: { name: "Taco", notat: "Nytt" } });
  familie = "familie1";
  auth.currentUser = { uid: "u1" };
});

describe("useMealLibrary: notatkonteksten er sesjonen, ikke uid-en", () => {
  it("ny innlogging med SAMME uid gir ny kontekst; tokenfornyelse (samme objekt) gjør det ikke", () => {
    const { result } = renderHook(() => useMealLibrary(), { wrapper: omslag });
    const k1 = result.current.notatKontekst;
    settBruker(auth.currentUser); // tokenfornyelse: samme User-objekt
    expect(result.current.notatKontekst).toBe(k1);
    settBruker(null);
    settBruker({ uid: "u1" }); // ny innlogging, samme uid, nytt objekt
    expect(result.current.notatKontekst).not.toBe(k1);
    expect(result.current.erGjeldendeNotatKontekst(k1)).toBe(false);
  });

  it("et forsøk fra forrige sesjon sendes og kontrolleres aldri i den nye, heller ikke via en gammel funksjon før ny tegning", async () => {
    const { result } = renderHook(() => useMealLibrary(), { wrapper: omslag });
    const gammel = result.current;
    const k1 = gammel.notatKontekst;
    // Ny innlogging med samme uid, UTEN varsel: skjermen er ikke tegnet på nytt.
    auth.currentUser = { uid: "u1" };
    expect(await gammel.lagreNotat(k1, "m1", "Gammelt", "Nytt")).toBe("byttet");
    expect(await gammel.sjekkNotat(forsokFra(k1))).toBe("byttet");
    expect(gammel.erGjeldendeNotatKontekst(k1)).toBe(false);
    expect(skriv).not.toHaveBeenCalled();
    expect(les).not.toHaveBeenCalled();
  });

  it("i gjeldende sesjon sendes forsøket med sesjonen, så datalaget kan avvise et bytte", async () => {
    const { result } = renderHook(() => useMealLibrary(), { wrapper: omslag });
    const k = result.current.notatKontekst;
    expect(await result.current.lagreNotat(k, "m1", "Gammelt", "Nytt")).toBe("lagret");
    expect(skriv).toHaveBeenCalledWith("familie1", "m1", expect.any(Function), "mangler", {
      sesjon: aktivSesjon(),
    });
    expect(await result.current.sjekkNotat(forsokFra(k))).toBe("likSendt");
    expect(les).toHaveBeenCalledWith("familie1", "m1", { sesjon: aktivSesjon() });
  });

  it("familiebytte med samme mealId: gammel kontekst avvises, også fra en gammel funksjon; ny skriver i ny familie", async () => {
    const { result, rerender } = renderHook(() => useMealLibrary(), { wrapper: omslag });
    const gammel = result.current;
    const k1 = gammel.notatKontekst;
    familie = "familie2";
    rerender();
    const k2 = result.current.notatKontekst;
    expect(k2).not.toBe(k1);
    expect(await gammel.lagreNotat(k1, "m1", "Gammelt", "Nytt")).toBe("byttet");
    expect(await gammel.sjekkNotat(forsokFra(k1))).toBe("byttet");
    expect(await result.current.lagreNotat(k1, "m1", "Gammelt", "Nytt")).toBe("byttet");
    expect(skriv).not.toHaveBeenCalled();
    expect(les).not.toHaveBeenCalled();
    expect(await result.current.lagreNotat(k2, "m1", "Gammelt", "Nytt")).toBe("lagret");
    expect(skriv).toHaveBeenCalledWith("familie2", "m1", expect.any(Function), "mangler", {
      sesjon: aktivSesjon(),
    });
  });

  it("utlogget: ingen kontekst er gjeldende, og ingenting sendes", async () => {
    const { result } = renderHook(() => useMealLibrary(), { wrapper: omslag });
    const k1 = result.current.notatKontekst;
    settBruker(null);
    expect(await result.current.lagreNotat(k1, "m1", "Gammelt", "Nytt")).toBe("byttet");
    expect(
      await result.current.lagreNotat(result.current.notatKontekst, "m1", "Gammelt", "Nytt"),
    ).toBe("byttet");
    expect(skriv).not.toHaveBeenCalled();
  });
});
