/**
 * Handlingskortet for mellomværende (#95, review 5723280487) med den ekte
 * hooken mot et falskt datalag: skrivingen går med `applyLocally: false`,
 * og kortet står med beløp/feil til serveren har bekreftet (utsatt ack +
 * avvist skriving).
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HendelseRecord } from "@app-types/forsoning";
import type { Mellomvaerende } from "@app-types/mellomvaerende";
import {
  byggMellomvaerende,
  medKostnadHendelse,
  type NyttMellomvaerende,
} from "@domain/mellomvaerende/mellomvaerende";
import { MellomvaerendeHandlingskort } from "./MellomvaerendeHandlingskort";

// ── Falskt datalag ──────────────────────────────────────────────────
const db = {
  avtaler: new Map<string, Mellomvaerende>(),
  hendelser: [] as HendelseRecord[],
};
let hendelseLytter: ((h: HendelseRecord[]) => void) | null = null;
let avtaleLytter: ((a: Mellomvaerende[]) => void) | null = null;
/** Styrer neste hendelsesskriving: «ok» (straks), «feil», eller manuell ack. */
const skrivinger: { modus: "ok" | "feil" | "manuell" }[] = [];
let ventende: { ack: () => void; avvis: (e: Error) => void } | null = null;
const transact = vi.fn();

vi.mock("@hooks/forsoningAktivering", async (orig) => ({
  ...(await orig<typeof import("@hooks/forsoningAktivering")>()),
  forsoningSkrivingAktiv: () => true,
}));
vi.mock("@hooks/useFamilyId", () => ({ useFamilyId: () => "familie1" }));
vi.mock("@hooks/useAuthUser", () => ({
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
  ventende = null;
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
      if (modus === "ok") return commit();
      return new Promise((resolve, reject) => {
        ventende = { ack: () => resolve(commit()), avvis: reject };
      });
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

describe("handlingskortet: står til serveren har bekreftet", () => {
  const medKostnad = () => {
    const avtale = byggMellomvaerende(NY, "mv1", "Helen", "x");
    db.avtaler.set("mv1", avtale);
    db.hendelser = medKostnadHendelse([], avtale, "Helen", "x");
  };

  it("utsatt ack: kortet med justert beløp står til ack; avvist skriving beholder beløp og viser feil", async () => {
    const user = userEvent.setup();
    medKostnad();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31));
    render(
      <MemoryRouter>
        <MellomvaerendeHandlingskort />
      </MemoryRouter>,
    );
    const felt = screen.getByLabelText("Beløp");
    await user.clear(felt);
    await user.type(felt, "480");

    // Avvist skriving: kortet og beløpet står, feilen vises.
    skrivinger.push({ modus: "manuell" });
    await user.click(screen.getByRole("button", { name: "Bekreft oppgjør" }));
    expect(screen.getByRole("heading")).toHaveTextContent("oppgjør oktober 2026");
    await act(async () => ventende!.avvis(new Error("permission_denied")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kunne ikke lagre");
    expect(screen.getByLabelText("Beløp")).toHaveValue("480");

    // Utsatt ack: ingen lokal spekulasjon — kortet står til serveren svarer.
    skrivinger.push({ modus: "manuell" });
    await user.click(screen.getByRole("button", { name: "Bekreft oppgjør" }));
    expect(screen.getByLabelText("Beløp")).toHaveValue("480");
    expect(db.hendelser.some((h) => h.id === "mv-mv1-2026-10")).toBe(false);
    await act(async () => ventende!.ack());
    expect(screen.queryByRole("heading")).toBeNull();
    expect(db.hendelser.find((h) => h.id === "mv-mv1-2026-10")).toMatchObject({
      fordelinger: [{ belop: -480 }],
    });
    vi.useRealTimers();
  });
});
