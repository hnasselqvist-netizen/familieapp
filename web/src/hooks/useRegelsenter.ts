import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import { subscribeHendelser, subscribeTransaksjonRecords } from "@data/forsoning.repository";
import { transactForsoningNode } from "@data/forsoningSkriving.repository";
import { subscribeRules, transactRules } from "@data/rules.repository";
import { type BrukKjorReglerUtfall, brukKjorRegler } from "@domain/forsoning/brukKjorRegler";
import type { EndringsplanLinje } from "@domain/forsoning/regler";
import {
  oppdaterRegel,
  type RegelFelt,
  type RegelGrupper,
  slaSammenRegler,
  slettRegel,
} from "@domain/forsoning/regelsenter";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, RegelRecord, TransaksjonRecord } from "@app-types/forsoning";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { ForsoningSkrivingStengt, forsoningSkrivingAktiv } from "./forsoningAktivering";
import { RegelsenterSkrivingStengt, regelsenterSkrivingAktiv } from "./regelsenterAktivering";
import { useFamilyId } from "./useFamilyId";

export interface UseRegelsenterResult {
  regler: Loadable<RegelRecord[]>;
  grupper: RegelGrupper;
  /** Hele transaksjonsnoden — «Treffer i dag» og «Kjør regler»-forhåndsvisningen. */
  transaksjoner: TransaksjonRecord[];
  /** `false` til første snapshot av `transaksjoner` er mottatt. */
  transaksjonerLastet: boolean;
  /** For forhåndsvisningen: transaksjoner med ferdig hendelse vurderes ikke. */
  hendelser: HendelseRecord[];
  /** Fra `regelsenterAktivering.ts` — `false` til R3b-cutover. */
  skrivingAktiv: boolean;
  oppdater: (id: string, felt: RegelFelt) => Promise<void>;
  slett: (id: string) => Promise<void>;
  slaSammen: (aId: string, bId: string) => Promise<void>;
  /**
   * «Kjør regler» → «Bruk resultatet» med planen brukeren godkjente
   * (`domain/forsoning/brukKjorRegler.ts`). Avvises med
   * `ForsoningSkrivingStengt` til R3b-cutover.
   */
  brukKjorReglerResultat: (godkjentPlan: EndringsplanLinje[]) => Promise<BrukKjorReglerUtfall>;
}

/**
 * React-binding for RegelSenter (§Issue #34 R1). Leser `rules` og de tre
 * budsjettnodene (for nivå-/sparegruppering, som legacy), og
 * `transaksjoner` + `hendelser` (for «Treffer i dag» og «Kjør
 * regler»-forhåndsvisningen, kun lesing — planen skrives aldri herfra).
 *
 * Skrivefunksjonene kjører de rene updaterne fra
 * `domain/forsoning/regelsenter.ts` i én helnode-transaksjon på `rules`
 * (`data/rules.repository.ts`), men **avvises** så lenge
 * aktiveringsporten er av — se `regelsenterAktivering.ts`.
 */
const INGEN: TransaksjonRecord[] = [];

export function useRegelsenter(): UseRegelsenterResult {
  const familyId = useFamilyId();
  const [regler, setRegler] = useState<Loadable<RegelRecord[]>>(notLoaded);
  const [budgetGroups, setBudgetGroups] = useState<BudsjettGruppe[]>([]);
  const [incomeGroups, setIncomeGroups] = useState<BudsjettGruppe[]>([]);
  const [sparingGroups, setSparingGroups] = useState<BudsjettGruppe[]>([]);
  const [transaksjoner, setTransaksjoner] = useState<Loadable<TransaksjonRecord[]>>(notLoaded);
  const [hendelser, setHendelser] = useState<HendelseRecord[]>([]);

  useEffect(() => {
    setRegler(loading);
    return subscribeRules(familyId, (r) => setRegler(loaded(r)));
  }, [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "budget", setBudgetGroups), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "incomeGroups", setIncomeGroups), [familyId]);
  useEffect(
    () => subscribeBudsjettGrupper(familyId, "sparingGroups", setSparingGroups),
    [familyId],
  );
  useEffect(
    () => subscribeTransaksjonRecords(familyId, (t) => setTransaksjoner(loaded(t))),
    [familyId],
  );
  useEffect(() => subscribeHendelser(familyId, setHendelser), [familyId]);

  const grupper = useMemo(
    () => ({ budgetGroups, incomeGroups, sparingGroups }),
    [budgetGroups, incomeGroups, sparingGroups],
  );

  const skriv = useCallback(
    async (updater: (prev: RegelRecord[]) => RegelRecord[]) => {
      if (!regelsenterSkrivingAktiv()) throw new RegelsenterSkrivingStengt();
      await transactRules(familyId, updater);
    },
    [familyId],
  );

  const oppdater = useCallback(
    (id: string, felt: RegelFelt) =>
      skriv((prev) => oppdaterRegel(prev, id, felt, new Date().toISOString())),
    [skriv],
  );
  const slett = useCallback((id: string) => skriv((prev) => slettRegel(prev, id)), [skriv]);
  const slaSammen = useCallback(
    (aId: string, bId: string) =>
      skriv((prev) => slaSammenRegler(prev, aId, bId, new Date().toISOString())),
    [skriv],
  );

  const brukKjorReglerResultat = useCallback(
    async (godkjentPlan: EndringsplanLinje[]) => {
      if (!forsoningSkrivingAktiv()) throw new ForsoningSkrivingStengt();
      return brukKjorRegler(
        godkjentPlan,
        {
          transaksjoner: transaksjoner.status === "loaded" ? transaksjoner.data : INGEN,
          hendelser,
          rules: regler.status === "loaded" ? regler.data : [],
          budgetGroups,
          incomeGroups,
          sparingGroups,
        },
        {
          transactHendelser: (u) => transactForsoningNode(familyId, "hendelser", u),
          transactTransaksjoner: (u) => transactForsoningNode(familyId, "transaksjoner", u),
          newId: () => crypto.randomUUID(),
          naa: new Date().toISOString(),
        },
      );
    },
    [familyId, transaksjoner, hendelser, regler, budgetGroups, incomeGroups, sparingGroups],
  );

  return {
    regler,
    grupper,
    transaksjoner: transaksjoner.status === "loaded" ? transaksjoner.data : INGEN,
    transaksjonerLastet: transaksjoner.status === "loaded",
    hendelser,
    skrivingAktiv: regelsenterSkrivingAktiv(),
    oppdater,
    slett,
    slaSammen,
    brukKjorReglerResultat,
  };
}
