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
} from "@domain/mellomvaerende/mellomvaerende";
import { ForsoningSkrivingStengt, forsoningSkrivingAktiv } from "./forsoningAktivering";
import { useAuthUser } from "./useAuthUser";
import { useFamilyId } from "./useFamilyId";

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
  rett: (avtale: Mellomvaerende, maaned: string, belopOre: number) => Promise<void>;
  angre: (avtale: Mellomvaerende, maaned: string) => Promise<void>;
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
      await transactForsoningNode<HendelseRecord>(familyId, "hendelser", (prev) => {
        const r = steg(prev, hvem, tid);
        // Siste kjøring (mot fersk serververdi) avgjør utfallet.
        utfall = r.utfall;
        return r.neste;
      });
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
        await opprettMellomvaerende(familyId, avtale);
        await transactForsoningNode<HendelseRecord>(familyId, "hendelser", (prev) =>
          medKostnadHendelse(prev, avtale, hvem, tid),
        );
      },
      fullforRegistrering: async (avtale) => {
        if (!forsoningSkrivingAktiv()) throw new ForsoningSkrivingStengt();
        const tid = new Date().toISOString();
        await transactForsoningNode<HendelseRecord>(familyId, "hendelser", (prev) =>
          medKostnadHendelse(prev, avtale, hvem, tid),
        );
      },
      bekreft: (avtale, maaned, belopOre) =>
        kjorOppgjor((prev, av, tid) => bekreftOppgjor(prev, avtale, maaned, belopOre, av, tid)),
      rett: (avtale, maaned, belopOre) =>
        kjorOppgjor((prev, av, tid) => rettOppgjor(prev, avtale, maaned, belopOre, av, tid)),
      angre: (avtale, maaned) =>
        kjorOppgjor((prev, av, tid) => angreOppgjor(prev, avtale, maaned, av, tid)),
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
