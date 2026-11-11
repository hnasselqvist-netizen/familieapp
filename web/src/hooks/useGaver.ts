import { useEffect, useMemo, useState } from "react";
import type {
  Anledning,
  Endring,
  FastBudsjett,
  Gave,
  GaveStatus,
  Gruppe,
  GruppeId,
  Person,
} from "@app-types/gaver";
import { type Loadable, loadError, loaded, loading } from "@app-types/status";
import {
  endrePost,
  nyPostId,
  opprettNy,
  opprettPost,
  parseAnledning,
  registrerGaveOgAnledning,
  sammeVersjon,
  subscribeAnledninger,
  subscribeGaver,
  subscribeGrupper,
  subscribePersoner,
} from "@data/gaver.repository";
import {
  type GaveUtkast,
  type PersonUtkast,
  fjernMottakerEndring,
  gaveEndring,
  gruppeStandardEndring,
  leggTilMottakerEndring,
  mottakerBudsjettEndring,
  personEndring,
  tilVerdi,
} from "@domain/gaver/endringer";
import { nyJulAnledning } from "@domain/gaver/gaver";
import { bursdagVerdi, registreringsverdier } from "@domain/gaver/helaar";
import { useFamilyId } from "./useFamilyId";

export interface GaverData {
  grupper: Partial<Record<GruppeId, Gruppe>>;
  personer: Person[];
  anledninger: Anledning[];
  gaver: Gave[];
}

export type { GaveUtkast, PersonUtkast };

export interface GaverHandlinger {
  nyPersonId: () => string;
  nyGaveId: () => string;
  /** `grunn` = personen slik brukeren så den; `null` = ny person med `id`. */
  lagrePerson: (id: string, utkast: PersonUtkast, grunn: Person | null) => Promise<void>;
  arkiverPerson: (p: Person, arkiver: boolean) => Promise<void>;
  lagreGruppeStandard: (
    gruppe: GruppeId,
    jul: { aktiv: boolean; budsjett: FastBudsjett },
    grunnVersjon: number,
    /** Utelatt = gruppens bursdagsbudsjett røres ikke. */
    bursdagBudsjett?: FastBudsjett,
  ) => Promise<void>;
  /** Oppretter `jul-<år>` hvis den ikke finnes; ellers brukes den lagrede. */
  startJul: (aar: number) => Promise<void>;
  leggTilMottaker: (a: Anledning, p: Person) => Promise<void>;
  /** Myk fjerning: gavene beholdes, og mottakeren kan legges tilbake. */
  fjernMottaker: (a: Anledning, personId: string) => Promise<void>;
  settMottakerBudsjett: (a: Anledning, personId: string, b: FastBudsjett) => Promise<void>;
  lagreGave: (id: string, utkast: GaveUtkast, grunn: Gave | null) => Promise<void>;
  /**
   * Eksplisitt etterregistrering av en gave (helårsoversikten): gaven
   * først (create-if-absent, konfliktsjekk), deretter bursdagen
   * create-if-absent. Jul: gaven legges på `jul-<år>`; juleplanen
   * opprettes ikke herfra. Se `registrerGaveOgAnledning` i datalaget.
   */
  registrerGave: (
    id: string,
    utkast: Omit<GaveUtkast, "anledningId">,
    anledning: { type: "bursdag" | "jul"; aar: number },
  ) => Promise<void>;
  /**
   * Oppretter personens bursdag i `aar` (create-if-absent) når en gave er
   * lagret uten at bursdagen ble det (feil i registreringens andre steg).
   */
  fullforBursdag: (personId: string, aar: number) => Promise<void>;
  settGaveStatus: (g: Gave, status: GaveStatus) => Promise<void>;
  settValgt: (g: Gave, valgt: boolean) => Promise<void>;
  flyttGave: (g: Gave, anledningId: string | undefined) => Promise<void>;
}

const naaIso = () => new Date().toISOString();
const mottakerTilstand = (raa: Record<string, unknown> | null, personId: string) =>
  raa ? (parseAnledning("x", raa)?.mottakere[personId] ?? null) : null;

const sammeJson = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Gave- og relasjonsmodulen: registeret, anledningene og gavene. Modulen
 * leser ikke årsbudsjettet i Økonomi (roadmap Gaver punkt 5): gavebudsjettet
 * kommer fra personer, grupper og lagrede anledninger. Alle
 * skrivinger går per post med versjonsvakt (§data/gaver.repository.ts);
 * en avvist skriving kaster `EndretAvAndre`, og UI-et beholder utkastet.
 */
export function useGaver(): Loadable<GaverData> & { handlinger: GaverHandlinger } {
  const familyId = useFamilyId();
  const [grupper, setGrupper] = useState<GaverData["grupper"] | null>(null);
  const [personer, setPersoner] = useState<Person[] | null>(null);
  const [anledninger, setAnledninger] = useState<Anledning[] | null>(null);
  const [gaver, setGaver] = useState<Gave[] | null>(null);
  const [feil, setFeil] = useState<Error | null>(null);

  useEffect(() => subscribeGrupper(familyId, setGrupper, setFeil), [familyId]);
  useEffect(() => subscribePersoner(familyId, setPersoner, setFeil), [familyId]);
  useEffect(() => subscribeAnledninger(familyId, setAnledninger, setFeil), [familyId]);
  useEffect(() => subscribeGaver(familyId, setGaver, setFeil), [familyId]);

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

    const register = () => {
      if (!personer || !grupper) throw new Error("Registeret er ikke lastet ennå.");
      return { personer, grupper };
    };

    return {
      nyPersonId: () => nyPostId(familyId, "relasjoner"),
      nyGaveId: () => nyPostId(familyId, "gaver"),

      lagrePerson: async (id, utkast, grunn) => {
        const endring = personEndring(utkast);
        const tid = naaIso();
        if (grunn === null) {
          // Ny person. En retry godtas bare hvis den lagrede posten er
          // nøyaktig denne opprettingen, uendret; ellers EndretAvAndre
          // (review 5731352564 P1). Fersk versjon adopteres aldri.
          await opprettNy(familyId, "relasjoner", id, {
            ...tilVerdi(endring),
            versjon: 1,
            opprettet: tid,
            oppdatert: tid,
          });
          return;
        }
        await endrePost(familyId, "relasjoner", id, {
          vakt: sammeVersjon(grunn.versjon),
          endring,
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

      lagreGruppeStandard: async (gruppe, jul, grunnVersjon, bursdagBudsjett) => {
        await endrePost(familyId, "relasjonsgrupper", gruppe, {
          vakt: sammeVersjon(grunnVersjon),
          endring: gruppeStandardEndring(jul, bursdagBudsjett),
          grunn: String(grunnVersjon),
          tid: naaIso(),
        });
      },

      startJul: async (aar) => {
        if (!personer || !grupper) throw new Error("Registeret er ikke lastet ennå.");
        const { id, ...verdi } = nyJulAnledning(aar, personer, grupper, naaIso());
        // Finnes `jul-<år>` fra før (retry eller en annen enhet), brukes den
        // lagrede som den er: ingen reset.
        await opprettPost(familyId, "anledninger", id, verdi);
      },

      leggTilMottaker: (a, p) => {
        const sett = a.mottakere[p.id] ?? null;
        return endreAnledning(a, p.id, leggTilMottakerEndring(a, p, grupper ?? {}), (raa) =>
          sammeJson(mottakerTilstand(raa, p.id), sett),
        );
      },

      fjernMottaker: (a, personId) => {
        const sett = a.mottakere[personId];
        if (!sett || sett.fjernet) return Promise.resolve();
        return endreAnledning(a, personId, fjernMottakerEndring(personId, naaIso()), (raa) =>
          sammeJson(mottakerTilstand(raa, personId), sett),
        );
      },

      settMottakerBudsjett: (a, personId, b) => {
        const sett = a.mottakere[personId];
        if (!sett) return Promise.resolve();
        return endreAnledning(a, personId, mottakerBudsjettEndring(personId, b), (raa) =>
          sammeJson(mottakerTilstand(raa, personId), sett),
        );
      },

      lagreGave: async (id, utkast, grunn) => {
        const endring = gaveEndring(utkast);
        const tid = naaIso();
        if (grunn === null) {
          await opprettNy(familyId, "gaver", id, {
            ...tilVerdi(endring),
            versjon: 1,
            opprettet: tid,
            oppdatert: tid,
          });
          return;
        }
        await endrePost(familyId, "gaver", id, {
          vakt: sammeVersjon(grunn.versjon),
          endring,
          grunn: String(grunn.versjon),
          tid,
        });
      },

      // Gaven først, deretter bursdagen (review 5820769716): se
      // `registrerGaveOgAnledning` i datalaget.
      registrerGave: async (id, utkast, anledning) => {
        const v = registreringsverdier(register(), utkast, anledning, naaIso());
        await registrerGaveOgAnledning(familyId, id, v.gave, v.anledning);
      },

      fullforBursdag: async (personId, aar) => {
        const { personer: ps, grupper: gr } = register();
        const person = ps.find((p) => p.id === personId);
        if (!person) throw new Error("Personen finnes ikke i registeret.");
        const { id, verdi } = bursdagVerdi(person, aar, gr, naaIso());
        // Create-if-absent: en eksisterende bursdag endres aldri.
        await opprettPost(familyId, "anledninger", id, verdi);
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
    if (!grupper || !personer || !anledninger || !gaver) return loading;
    return loaded({ grupper, personer, anledninger, gaver });
  }, [feil, grupper, personer, anledninger, gaver]);

  return { ...data, handlinger };
}
