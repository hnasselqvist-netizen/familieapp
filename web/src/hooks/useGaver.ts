import { useEffect, useMemo, useState } from "react";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  Anledning,
  FastBudsjett,
  Gave,
  GaveStatus,
  Gruppe,
  GruppeId,
  GruppeStandard,
  Person,
  PersonUnntak,
} from "@app-types/gaver";
import { type Loadable, loadError, loaded, loading } from "@app-types/status";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import {
  type Endring,
  endrePost,
  nyPostId,
  opprettPost,
  parseAnledning,
  sammeVersjon,
  subscribeAnledninger,
  subscribeGaver,
  subscribeGrupper,
  subscribePersoner,
} from "@data/gaver.repository";
import { leggTilMottaker, nyJulAnledning } from "@domain/gaver/gaver";
import { useFamilyId } from "./useFamilyId";

export interface GaverData {
  grupper: Partial<Record<GruppeId, Gruppe>>;
  personer: Person[];
  anledninger: Anledning[];
  gaver: Gave[];
  budsjett: BudsjettGruppe[];
}

export interface PersonUtkast {
  navn: string;
  gruppe: GruppeId;
  fodselsdato?: string;
  notat?: string;
  /** Unntak for jul; tomt objekt = arv alt fra gruppen. */
  jul: PersonUnntak;
}

export interface GaveUtkast {
  personId: string;
  anledningId?: string;
  tekst: string;
  status: GaveStatus;
  valgt?: boolean;
  planlagtOre?: number;
}

export interface GaverHandlinger {
  nyPersonId: () => string;
  nyGaveId: () => string;
  /** `grunn` = personen slik brukeren så den; `null` = ny person med `id`. */
  lagrePerson: (id: string, utkast: PersonUtkast, grunn: Person | null) => Promise<void>;
  arkiverPerson: (p: Person, arkiver: boolean) => Promise<void>;
  lagreGruppeStandard: (
    gruppe: GruppeId,
    jul: GruppeStandard,
    grunnVersjon: number,
  ) => Promise<void>;
  /** Oppretter `jul-<år>` hvis den ikke finnes; ellers brukes den lagrede. */
  startJul: (aar: number) => Promise<void>;
  leggTilMottaker: (a: Anledning, p: Person) => Promise<void>;
  /** Myk fjerning: gavene beholdes, og mottakeren kan legges tilbake. */
  fjernMottaker: (a: Anledning, personId: string) => Promise<void>;
  settMottakerBudsjett: (a: Anledning, personId: string, b: FastBudsjett) => Promise<void>;
  lagreGave: (id: string, utkast: GaveUtkast, grunn: Gave | null) => Promise<void>;
  settGaveStatus: (g: Gave, status: GaveStatus) => Promise<void>;
  settValgt: (g: Gave, valgt: boolean) => Promise<void>;
  flyttGave: (g: Gave, anledningId: string | undefined) => Promise<void>;
}

const naaIso = () => new Date().toISOString();
const tomt = (o: object) => Object.keys(o).length === 0;

/** Endringsfeltene for en person; `undefined` sletter. Bare `unntak/jul` røres. */
function personFelter(u: PersonUtkast): Endring {
  const jul: PersonUnntak = {};
  if (typeof u.jul.aktiv === "boolean") jul.aktiv = u.jul.aktiv;
  if (u.jul.budsjett && u.jul.budsjett.type !== "arv") jul.budsjett = u.jul.budsjett;
  return {
    navn: u.navn.trim(),
    gruppe: u.gruppe,
    fodselsdato: u.fodselsdato || undefined,
    notat: u.notat?.trim() || undefined,
    "unntak/jul": tomt(jul) ? undefined : jul,
  };
}

function gaveFelter(u: GaveUtkast): Endring {
  return {
    personId: u.personId,
    anledningId: u.anledningId || undefined,
    tekst: u.tekst.trim(),
    status: u.status,
    // En valgt idé; kjøpt/gitt er alltid i planen, så flagget trengs ikke der.
    valgt: u.status === "ide" && u.valgt ? true : undefined,
    planlagtOre: u.planlagtOre,
  };
}

/** Fjerner `undefined`-felt (til oppretting) og løser «a/b»-stier til objekter. */
function tilVerdi(felter: Endring): Record<string, unknown> {
  const ut: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(felter)) {
    if (v === undefined) continue;
    const [forste, ...resten] = k.split("/");
    if (resten.length === 0) ut[forste!] = v;
    else ut[forste!] = { ...((ut[forste!] as object) ?? {}), [resten.join("/")]: v };
  }
  return ut;
}

const mottakerTilstand = (raa: Record<string, unknown> | null, personId: string) =>
  raa ? (parseAnledning("x", raa)?.mottakere[personId] ?? null) : null;

const sammeJson = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Gave- og relasjonsmodulen (S1 julegaver): registeret, anledningene og
 * gavene, pluss budsjettgruppene som bare leses til sammenligning. Alle
 * skrivinger går per post med versjonsvakt (§data/gaver.repository.ts);
 * en avvist skriving kaster `EndretAvAndre`, og UI-et beholder utkastet.
 */
export function useGaver(): Loadable<GaverData> & { handlinger: GaverHandlinger } {
  const familyId = useFamilyId();
  const [grupper, setGrupper] = useState<GaverData["grupper"] | null>(null);
  const [personer, setPersoner] = useState<Person[] | null>(null);
  const [anledninger, setAnledninger] = useState<Anledning[] | null>(null);
  const [gaver, setGaver] = useState<Gave[] | null>(null);
  const [budsjett, setBudsjett] = useState<BudsjettGruppe[] | null>(null);
  const [feil, setFeil] = useState<Error | null>(null);

  useEffect(() => subscribeGrupper(familyId, setGrupper, setFeil), [familyId]);
  useEffect(() => subscribePersoner(familyId, setPersoner, setFeil), [familyId]);
  useEffect(() => subscribeAnledninger(familyId, setAnledninger, setFeil), [familyId]);
  useEffect(() => subscribeGaver(familyId, setGaver, setFeil), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "budget", setBudsjett), [familyId]);

  const handlinger = useMemo<GaverHandlinger>(() => {
    const endreAnledning = (
      a: Anledning,
      personId: string,
      endring: Endring,
      vakt: (raa: Record<string, unknown> | null) => boolean,
    ) =>
      endrePost(familyId, "anledninger", a.id, {
        vakt,
        endring,
        grunn: `mottaker:${personId}:${JSON.stringify(a.mottakere[personId] ?? null)}`,
        tid: naaIso(),
      }).then(() => undefined);

    return {
      nyPersonId: () => nyPostId(familyId, "relasjoner"),
      nyGaveId: () => nyPostId(familyId, "gaver"),

      lagrePerson: async (id, utkast, grunn) => {
        const felter = personFelter(utkast);
        const tid = naaIso();
        if (grunn === null) {
          const { lagret, opprettet } = await opprettPost(familyId, "relasjoner", id, {
            ...tilVerdi(felter),
            versjon: 1,
            opprettet: tid,
            oppdatert: tid,
          });
          // Retry etter en lagring som ikke ble bekreftet: posten er vår
          // (klientgenerert id). Bring den i samsvar med utkastet.
          if (!opprettet) {
            const v = (lagret as { versjon?: number }).versjon ?? 0;
            await endrePost(familyId, "relasjoner", id, {
              vakt: sammeVersjon(v),
              endring: felter,
              grunn: String(v),
              tid,
            });
          }
          return;
        }
        await endrePost(familyId, "relasjoner", id, {
          vakt: sammeVersjon(grunn.versjon),
          endring: felter,
          grunn: String(grunn.versjon),
          tid,
        });
      },

      arkiverPerson: async (p, arkiver) => {
        await endrePost(familyId, "relasjoner", p.id, {
          vakt: sammeVersjon(p.versjon),
          endring: { arkivert: arkiver ? naaIso() : undefined },
          grunn: `${p.versjon}:${arkiver}`,
          tid: naaIso(),
        });
      },

      lagreGruppeStandard: async (gruppe, jul, grunnVersjon) => {
        const verdi: GruppeStandard = {};
        if (typeof jul.aktiv === "boolean") verdi.aktiv = jul.aktiv;
        if (jul.budsjett) verdi.budsjett = jul.budsjett;
        await endrePost(familyId, "relasjonsgrupper", gruppe, {
          vakt: sammeVersjon(grunnVersjon),
          endring: { "standard/jul": tomt(verdi) ? undefined : verdi },
          grunn: String(grunnVersjon),
          tid: naaIso(),
        });
      },

      startJul: async (aar) => {
        if (!personer || !grupper) throw new Error("Registeret er ikke lastet ennå.");
        const { id, ...verdi } = nyJulAnledning(aar, personer, grupper, naaIso());
        await opprettPost(familyId, "anledninger", id, verdi);
      },

      leggTilMottaker: (a, p) => {
        const seen = a.mottakere[p.id] ?? null;
        return endreAnledning(
          a,
          p.id,
          { [`mottakere/${p.id}`]: leggTilMottaker(a, p, grupper ?? {}) },
          (raa) => sammeJson(mottakerTilstand(raa, p.id), seen),
        );
      },

      fjernMottaker: (a, personId) => {
        const seen = a.mottakere[personId];
        if (!seen || seen.fjernet) return Promise.resolve();
        return endreAnledning(a, personId, { [`mottakere/${personId}/fjernet`]: naaIso() }, (raa) =>
          sammeJson(mottakerTilstand(raa, personId), seen),
        );
      },

      settMottakerBudsjett: (a, personId, b) => {
        const seen = a.mottakere[personId];
        if (!seen) return Promise.resolve();
        return endreAnledning(a, personId, { [`mottakere/${personId}/budsjett`]: b }, (raa) =>
          sammeJson(mottakerTilstand(raa, personId), seen),
        );
      },

      lagreGave: async (id, utkast, grunn) => {
        const felter = gaveFelter(utkast);
        const tid = naaIso();
        if (grunn === null) {
          const { lagret, opprettet } = await opprettPost(familyId, "gaver", id, {
            ...tilVerdi(felter),
            versjon: 1,
            opprettet: tid,
            oppdatert: tid,
          });
          if (!opprettet) {
            const v = (lagret as { versjon?: number }).versjon ?? 0;
            await endrePost(familyId, "gaver", id, {
              vakt: sammeVersjon(v),
              endring: felter,
              grunn: String(v),
              tid,
            });
          }
          return;
        }
        await endrePost(familyId, "gaver", id, {
          vakt: sammeVersjon(grunn.versjon),
          endring: felter,
          grunn: String(grunn.versjon),
          tid,
        });
      },

      settGaveStatus: async (g, status) => {
        const endring: Endring = { status, valgt: status === "ide" ? g.valgt : undefined };
        await endrePost(familyId, "gaver", g.id, {
          vakt: sammeVersjon(g.versjon),
          endring,
          grunn: String(g.versjon),
          tid: naaIso(),
        });
      },

      settValgt: async (g, valgt) => {
        await endrePost(familyId, "gaver", g.id, {
          vakt: sammeVersjon(g.versjon),
          endring: { valgt: valgt ? true : undefined },
          grunn: String(g.versjon),
          tid: naaIso(),
        });
      },

      flyttGave: async (g, anledningId) => {
        await endrePost(familyId, "gaver", g.id, {
          vakt: sammeVersjon(g.versjon),
          endring: { anledningId },
          grunn: String(g.versjon),
          tid: naaIso(),
        });
      },
    };
  }, [familyId, personer, grupper]);

  const data = useMemo<Loadable<GaverData>>(() => {
    if (feil) return loadError(feil);
    if (!grupper || !personer || !anledninger || !gaver || !budsjett) return loading;
    return loaded({ grupper, personer, anledninger, gaver, budsjett });
  }, [feil, grupper, personer, anledninger, gaver, budsjett]);

  return { ...data, handlinger };
}
