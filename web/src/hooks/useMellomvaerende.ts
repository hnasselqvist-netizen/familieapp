import { useCallback, useEffect, useMemo, useState } from "react";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, MalPost } from "@app-types/forsoning";
import type { Mellomvaerende } from "@app-types/mellomvaerende";
import { type Loadable, loaded, loading } from "@app-types/status";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import { subscribeHendelser } from "@data/forsoning.repository";
import { transactForsoningNode } from "@data/forsoningSkriving.repository";
import { opprettMellomvaerende, subscribeMellomvaerender } from "@data/mellomvaerender.repository";
import { byggAlleMalPoster } from "@domain/forsoning/fordeling";
import {
  type MellomvaerendeStatus,
  type NyttMellomvaerende,
  type OppgjorResultat,
  type OppgjorUtfall,
  angreOppgjor,
  bekreftOppgjor,
  byggMellomvaerende,
  maanedFor,
  medKostnadHendelse,
  mellomvaerendeStatus,
  oppgjorForklaring,
  rettOppgjor,
  sammeAvtale,
} from "@domain/mellomvaerende/mellomvaerende";
import { ForsoningSkrivingStengt, forsoningSkrivingAktiv } from "./forsoningAktivering";
import { useAuthUser } from "./useAuthUser";
import { useFamilyId } from "./useFamilyId";

/**
 * En avtale med samme id er allerede lagret med andre verdier (retry etter
 * at skjemaet ble endret). Ingen kostnad skrives; den lagrede avtalen
 * fullføres fra oversikten (review 5723280487).
 */
export class MellomvaerendeAvvik extends Error {
  constructor() {
    super(
      "Dette mellomværendet ble allerede lagret med andre verdier. Ingenting nytt er skrevet — fullfør eller se det lagrede i oversikten.",
    );
    this.name = "MellomvaerendeAvvik";
  }
}

/** Oppgjøret ble ikke lagret fordi dataene sa nei (f.eks. allerede oppgjort). */
export class OppgjorAvvist extends Error {
  readonly utfall: Exclude<OppgjorUtfall, "lagret">;
  constructor(utfall: Exclude<OppgjorUtfall, "lagret">) {
    super(oppgjorForklaring(utfall));
    this.name = "OppgjorAvvist";
    this.utfall = utfall;
  }
}

export interface MellomvaerendeData {
  statuser: MellomvaerendeStatus[];
  /** Kostnadsposter å velge mellom ved registrering. */
  poster: MalPost[];
  naaMaaned: string;
}

export interface MellomvaerendeHandlinger {
  /** Registrerer avtalen og fører kostnaden. Samme `id` ved retry. */
  registrer: (ny: NyttMellomvaerende, id: string) => Promise<void>;
  /** Fører en manglende kostnad etter en avbrutt registrering. */
  fullforRegistrering: (avtale: Mellomvaerende) => Promise<void>;
  bekreft: (avtale: Mellomvaerende, maaned: string, belopOre: number) => Promise<void>;
  /** `forventetVersjon`: oppgjørslinjens versjon brukeren så (`OppgjorLinje.versjon`). */
  rett: (
    avtale: Mellomvaerende,
    maaned: string,
    belopOre: number,
    forventetVersjon: number,
  ) => Promise<void>;
  angre: (avtale: Mellomvaerende, maaned: string, forventetVersjon: number) => Promise<void>;
}

/**
 * Mellomværende (#95): avtalene, statusen avledet fra hendelsene, og
 * skrivehandlingene. Hver oppgjørshandling er ÉN helnode-transaksjon på
 * `hendelser` som validerer mot fersk serververdi; avviser dataene den
 * (allerede oppgjort, over restsaldo), kastes `OppgjorAvvist` og ingenting
 * skrives.
 */
export function useMellomvaerende(
  naa: () => Date = () => new Date(),
): Loadable<MellomvaerendeData> & { handlinger: MellomvaerendeHandlinger } {
  const familyId = useFamilyId();
  const bruker = useAuthUser();
  const [avtaler, setAvtaler] = useState<Mellomvaerende[] | null>(null);
  const [hendelser, setHendelser] = useState<HendelseRecord[] | null>(null);
  const [budgetGroups, setBudgetGroups] = useState<BudsjettGruppe[] | null>(null);

  useEffect(() => subscribeMellomvaerender(familyId, setAvtaler), [familyId]);
  useEffect(() => subscribeHendelser(familyId, setHendelser), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "budget", setBudgetGroups), [familyId]);

  const hvem = bruker ? bruker.displayName || bruker.email || bruker.uid : "ukjent";

  const kjorOppgjor = useCallback(
    async (
      steg: (prev: HendelseRecord[], av: string, tid: string) => OppgjorResultat,
    ): Promise<void> => {
      if (!forsoningSkrivingAktiv()) throw new ForsoningSkrivingStengt();
      const tid = new Date().toISOString();
      let utfall: OppgjorUtfall = "lagret";
      await transactForsoningNode<HendelseRecord>(
        familyId,
        "hendelser",
        (prev) => {
          const r = steg(prev, hvem, tid);
          // Siste kjøring (mot fersk serververdi) avgjør utfallet.
          utfall = r.utfall;
          return r.neste;
        },
        // Kortet forsvinner først når serveren har bekreftet lagringen.
        { applyLocally: false },
      );
      if (utfall !== "lagret") throw new OppgjorAvvist(utfall);
    },
    [familyId, hvem],
  );

  const handlinger = useMemo<MellomvaerendeHandlinger>(
    () => ({
      registrer: async (ny, id) => {
        if (!forsoningSkrivingAktiv()) throw new ForsoningSkrivingStengt();
        const tid = new Date().toISOString();
        const avtale = byggMellomvaerende(ny, id, hvem, tid);
        // Den LAGREDE avtalen er grunnlaget for kostnaden, aldri skjemaet.
        const lagret = await opprettMellomvaerende(familyId, avtale);
        if (!sammeAvtale(lagret, avtale)) throw new MellomvaerendeAvvik();
        await transactForsoningNode<HendelseRecord>(
          familyId,
          "hendelser",
          (prev) => medKostnadHendelse(prev, lagret, hvem, tid),
          { applyLocally: false },
        );
      },
      fullforRegistrering: async (avtale) => {
        if (!forsoningSkrivingAktiv()) throw new ForsoningSkrivingStengt();
        const tid = new Date().toISOString();
        // `avtale` kommer fra abonnementet: den lagrede avtalen.
        await transactForsoningNode<HendelseRecord>(
          familyId,
          "hendelser",
          (prev) => medKostnadHendelse(prev, avtale, hvem, tid),
          { applyLocally: false },
        );
      },
      bekreft: (avtale, maaned, belopOre) =>
        kjorOppgjor((prev, av, tid) => bekreftOppgjor(prev, avtale, maaned, belopOre, av, tid)),
      rett: (avtale, maaned, belopOre, forventetVersjon) =>
        kjorOppgjor((prev, av, tid) =>
          rettOppgjor(prev, avtale, maaned, belopOre, forventetVersjon, av, tid),
        ),
      angre: (avtale, maaned, forventetVersjon) =>
        kjorOppgjor((prev, av, tid) =>
          angreOppgjor(prev, avtale, maaned, forventetVersjon, av, tid),
        ),
    }),
    [familyId, hvem, kjorOppgjor],
  );

  const naaMaaned = maanedFor(naa());
  const data = useMemo(() => {
    if (!avtaler || !hendelser || !budgetGroups) return loading;
    return loaded<MellomvaerendeData>({
      statuser: avtaler.map((a) => mellomvaerendeStatus(a, hendelser, naaMaaned)),
      poster: byggAlleMalPoster(budgetGroups, []),
      naaMaaned,
    });
  }, [avtaler, hendelser, budgetGroups, naaMaaned]);

  return { ...data, handlinger };
}
