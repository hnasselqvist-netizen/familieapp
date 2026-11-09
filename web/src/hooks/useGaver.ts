import { useEffect, useMemo, useState } from "react";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
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
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import {
  endrePost,
  nyPostId,
  opprettNy,
  opprettPost,
  parseAnledning,
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
import { julAnledningId, nyJulAnledning } from "@domain/gaver/gaver";
import { nyBursdagAnledning } from "@domain/gaver/helaar";
import { useFamilyId } from "./useFamilyId";

export interface GaverData {
  grupper: Partial<Record<GruppeId, Gruppe>>;
  personer: Person[];
  anledninger: Anledning[];
  gaver: Gave[];
  budsjett: BudsjettGruppe[];
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
   * Eksplisitt etterregistrering av en gave (helårsoversikten). Bursdag:
   * `bursdag-<personId>-<år>` opprettes create-if-absent med budsjettet fra
   * arven (finnes den, brukes den lagrede), deretter opprettes gaven som en
   * ny gave (`lagreGave` med `grunn = null`). Jul: gaven legges på
   * `jul-<år>`; juleplanen opprettes ikke herfra.
   */
  registrerGave: (
    id: string,
    utkast: Omit<GaveUtkast, "anledningId">,
    anledning: { type: "bursdag" | "jul"; aar: number },
  ) => Promise<void>;
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

    // Ny gave: create-if-absent med innholdsbasert skrive-ID (retry = «allerede»,
    // endret lagret post = EndretAvAndre). Felles for skjemaet og etterregistreringen.
    const opprettGave = async (id: string, utkast: GaveUtkast) => {
      const tid = naaIso();
      await opprettNy(familyId, "gaver", id, {
        ...tilVerdi(gaveEndring(utkast)),
        versjon: 1,
        opprettet: tid,
        oppdatert: tid,
      });
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
          await opprettGave(id, utkast);
          return;
        }
        await endrePost(familyId, "gaver", id, {
          vakt: sammeVersjon(grunn.versjon),
          endring,
          grunn: String(grunn.versjon),
          tid,
        });
      },

      registrerGave: async (id, utkast, { type, aar }) => {
        let anledningId: string;
        if (type === "bursdag") {
          if (!personer || !grupper) throw new Error("Registeret er ikke lastet ennå.");
          const person = personer.find((p) => p.id === utkast.personId);
          if (!person) throw new Error("Personen finnes ikke i registeret.");
          const { id: aid, ...verdi } = nyBursdagAnledning(person, aar, grupper, naaIso());
          // Finnes bursdagen fra før (en annen gave, retry, en annen enhet),
          // brukes den lagrede som den er: ingen reset av budsjettet.
          await opprettPost(familyId, "anledninger", aid, verdi);
          anledningId = aid;
        } else {
          anledningId = julAnledningId(aar);
        }
        await opprettGave(id, { ...utkast, anledningId });
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
