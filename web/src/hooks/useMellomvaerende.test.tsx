/**
 * Hook-/repository-flyten for mellomværende (#95, review 5723280487) mot et
 * falskt datalag i minnet:
 *  - retry av registrering etter at første kostnadsskriving feilet: endret
 *    beløp/post/måned/eier under samme id gir aldri kostnad fra skjemaet;
 *  - alle hendelsesskrivinger går med `applyLocally: false` (kortet testes i
 *    `MellomvaerendeHandlingskort.test.tsx`).
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HendelseRecord } from "@app-types/forsoning";
import type { Mellomvaerende } from "@app-types/mellomvaerende";
import type { NyttMellomvaerende } from "@domain/mellomvaerende/mellomvaerende";
import { MellomvaerendeAvvik, useMellomvaerende } from "./useMellomvaerende";

// ── Falskt datalag ──────────────────────────────────────────────────
const db = {
  avtaler: new Map<string, Mellomvaerende>(),
  hendelser: [] as HendelseRecord[],
};
let hendelseLytter: ((h: HendelseRecord[]) => void) | null = null;
let avtaleLytter: ((a: Mellomvaerende[]) => void) | null = null;
/** Styrer neste hendelsesskriving: «ok» eller «feil». */
const skrivinger: { modus: "ok" | "feil" }[] = [];
const transact = vi.fn();

vi.mock("./forsoningAktivering", async (orig) => ({
  ...(await orig<typeof import("./forsoningAktivering")>()),
  forsoningSkrivingAktiv: () => true,
}));
vi.mock("./useFamilyId", () => ({ useFamilyId: () => "familie1" }));
vi.mock("./useAuthUser", () => ({
  useAuthUser: () => ({ uid: "u", displayName: "Helen", email: null }),
}));
vi.mock("@data/budsjettfamilie.repository", () => ({
  subscribeBudsjettGrupper: (_f: string, _n: string, cb: (g: unknown[]) => void) => {
    cb([]);
    return () => {};
  },
}));
vi.mock("@data/forsoning.repository", () => ({
  subscribeHendelser: (_f: string, cb: (h: HendelseRecord[]) => void) => {
    hendelseLytter = cb;
    cb(db.hendelser);
    return () => {};
  },
}));
vi.mock("@data/mellomvaerender.repository", () => ({
  subscribeMellomvaerender: (_f: string, cb: (a: Mellomvaerende[]) => void) => {
    avtaleLytter = cb;
    cb([...db.avtaler.values()]);
    return () => {};
  },
  // Som repositoryet: overskriver aldri, returnerer den LAGREDE avtalen.
  opprettMellomvaerende: async (_f: string, a: Mellomvaerende) => {
    if (!db.avtaler.has(a.id)) db.avtaler.set(a.id, a);
    avtaleLytter?.([...db.avtaler.values()]);
    return db.avtaler.get(a.id)!;
  },
}));
vi.mock("@data/forsoningSkriving.repository", () => ({
  transactForsoningNode: (...args: unknown[]) => transact(...args),
}));

beforeEach(() => {
  db.avtaler.clear();
  db.hendelser = [];
  skrivinger.length = 0;
  transact.mockReset();
  // Serveren: kjør updateren mot «serververdien»; lyttere får bare det
  // bekreftede resultatet (applyLocally: false).
  transact.mockImplementation(
    async (
      _f: string,
      _node: string,
      updater: (p: HendelseRecord[]) => HendelseRecord[],
      valg?: { applyLocally?: boolean },
    ) => {
      expect(valg).toEqual({ applyLocally: false });
      const modus = skrivinger.shift()?.modus ?? "ok";
      if (modus === "feil") throw new Error("network");
      const commit = () => {
        db.hendelser = updater(db.hendelser);
        hendelseLytter?.(db.hendelser);
        return db.hendelser;
      };
      return commit();
    },
  );
});

const NY: NyttMellomvaerende = {
  navn: "Gave fra mamma",
  motpart: "Mamma",
  opprinneligOre: 329900,
  startMaaned: "2026-10",
  kostnad: {
    postId: "gaver",
    postNavn: "Gaver",
    plasseringType: "budget",
    eiere: [{ person: "Felles", prosent: 100 }],
  },
  oppgjor: {
    postId: "abonnementer",
    postNavn: "Abonnementer",
    plasseringType: "budget",
    eiere: [{ person: "Felles", prosent: 100 }],
  },
  standardBelopOre: 46700,
};

const kostnad = () => db.hendelser.find((h) => h.id === "mv-mv1-kostnad");

describe("registrering: retry bruker alltid den lagrede avtalen", () => {
  it.each([
    ["beløp", { opprinneligOre: 400000 }],
    ["post", { kostnad: { ...NY.kostnad, postId: "annet", postNavn: "Annet" } }],
    ["måned", { startMaaned: "2026-11" }],
    ["eier", { kostnad: { ...NY.kostnad, eiere: [{ person: "Helen", prosent: 100 }] } }],
  ] as const)(
    "første kostnadsskriving feiler; retry med endret %s avvises uten kostnad, og «Fullfør» fører den lagrede",
    async (_navn, endring) => {
      const { result } = renderHook(() => useMellomvaerende(() => new Date(2026, 9, 31)));
      skrivinger.push({ modus: "feil" });
      await act(async () => {
        await expect(result.current.handlinger.registrer(NY, "mv1")).rejects.toThrow("network");
      });
      expect(kostnad()).toBeUndefined();

      await act(async () => {
        await expect(
          result.current.handlinger.registrer({ ...NY, ...endring } as NyttMellomvaerende, "mv1"),
        ).rejects.toBeInstanceOf(MellomvaerendeAvvik);
      });
      expect(kostnad()).toBeUndefined();
      expect(db.avtaler.get("mv1")).toMatchObject({
        opprinneligOre: 329900,
        startMaaned: "2026-10",
      });

      // «Fullfør registrering» bruker avtalen fra abonnementet = den lagrede.
      const lagret = result.current.data!.statuser[0]!.avtale;
      expect(result.current.data!.statuser[0]!.kostnadFort).toBe(false);
      await act(async () => {
        await result.current.handlinger.fullforRegistrering(lagret);
      });
      expect(kostnad()).toMatchObject({
        fordelinger: [
          { plasseringId: "gaver", belop: 3299, eiere: [{ person: "Felles", prosent: 100 }] },
        ],
        dato: "2026-10-01",
      });
      expect(result.current.data!.statuser[0]).toMatchObject({
        kostnadFort: true,
        restOre: 329900,
      });
    },
  );

  it("retry med samme verdier etter feilet kostnad fører kostnaden én gang", async () => {
    const { result } = renderHook(() => useMellomvaerende(() => new Date(2026, 9, 31)));
    skrivinger.push({ modus: "feil" });
    await act(async () => {
      await expect(result.current.handlinger.registrer(NY, "mv1")).rejects.toThrow();
    });
    await act(async () => {
      await result.current.handlinger.registrer(NY, "mv1");
    });
    await act(async () => {
      await result.current.handlinger.registrer(NY, "mv1");
    });
    expect(db.hendelser.filter((h) => h.id === "mv-mv1-kostnad")).toHaveLength(1);
  });
});
