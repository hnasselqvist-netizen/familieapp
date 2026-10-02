import { useCallback, useEffect, useMemo, useState } from "react";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import { subscribeTransaksjoner } from "@data/gangen.repository";
import { subscribeRules, transactRules } from "@data/rules.repository";
import {
  oppdaterRegel,
  type RegelFelt,
  type RegelGrupper,
  slaSammenRegler,
  slettRegel,
} from "@domain/forsoning/regelsenter";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { RegelRecord } from "@app-types/forsoning";
import type { BankTransaksjon } from "@app-types/gangen";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { RegelsenterSkrivingStengt, regelsenterSkrivingAktiv } from "./regelsenterAktivering";
import { useFamilyId } from "./useFamilyId";

export interface UseRegelsenterResult {
  regler: Loadable<RegelRecord[]>;
  grupper: RegelGrupper;
  transaksjoner: BankTransaksjon[];
  /** Fra `regelsenterAktivering.ts` — `false` til R3b-cutover. */
  skrivingAktiv: boolean;
  oppdater: (id: string, felt: RegelFelt) => Promise<void>;
  slett: (id: string) => Promise<void>;
  slaSammen: (aId: string, bId: string) => Promise<void>;
}

/**
 * React-binding for RegelSenter (§Issue #34 R1). Leser `rules` og de tre
 * budsjettnodene (for nivå-/sparegruppering, som legacy) og
 * `transaksjoner` (for «Treffer i dag», kun lesing).
 *
 * Skrivefunksjonene kjører de rene updaterne fra
 * `domain/forsoning/regelsenter.ts` i én helnode-transaksjon på `rules`
 * (`data/rules.repository.ts`), men **avvises** så lenge
 * aktiveringsporten er av — se `regelsenterAktivering.ts`.
 */
export function useRegelsenter(): UseRegelsenterResult {
  const familyId = useFamilyId();
  const [regler, setRegler] = useState<Loadable<RegelRecord[]>>(notLoaded);
  const [budgetGroups, setBudgetGroups] = useState<BudsjettGruppe[]>([]);
  const [incomeGroups, setIncomeGroups] = useState<BudsjettGruppe[]>([]);
  const [sparingGroups, setSparingGroups] = useState<BudsjettGruppe[]>([]);
  const [transaksjoner, setTransaksjoner] = useState<BankTransaksjon[]>([]);

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
  useEffect(() => subscribeTransaksjoner(familyId, setTransaksjoner), [familyId]);

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

  return {
    regler,
    grupper,
    transaksjoner,
    skrivingAktiv: regelsenterSkrivingAktiv(),
    oppdater,
    slett,
    slaSammen,
  };
}
