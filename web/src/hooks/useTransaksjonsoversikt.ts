import { useEffect, useState } from "react";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import {
  subscribeHendelser,
  subscribeKvitteringer,
  subscribeTransaksjonRecords,
} from "@data/forsoning.repository";
import { subscribeRules } from "@data/rules.repository";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseTransaksjonsoversiktResult {
  transaksjoner: Loadable<TransaksjonRecord[]>;
  hendelser: HendelseRecord[];
  receipts: KvitteringRecord[];
  rules: RegelRecord[];
  budgetGroups: BudsjettGruppe[];
  incomeGroups: BudsjettGruppe[];
  sparingGroups: BudsjettGruppe[];
}

/**
 * Transaksjonsoversikten, kun lesing (§Issue #34 R3-les). Ingen
 * skrivefunksjoner finnes: import, plassering, på vent, intern
 * overføring, ignorering, kvittering, korrigering og «Kjør regler» skjer
 * fortsatt i legacy til R3b-cutover (ADR 0002).
 */
export function useTransaksjonsoversikt(): UseTransaksjonsoversiktResult {
  const familyId = useFamilyId();
  const [transaksjoner, setTransaksjoner] = useState<Loadable<TransaksjonRecord[]>>(notLoaded);
  const [hendelser, setHendelser] = useState<HendelseRecord[]>([]);
  const [receipts, setReceipts] = useState<KvitteringRecord[]>([]);
  const [rules, setRules] = useState<RegelRecord[]>([]);
  const [budgetGroups, setBudgetGroups] = useState<BudsjettGruppe[]>([]);
  const [incomeGroups, setIncomeGroups] = useState<BudsjettGruppe[]>([]);
  const [sparingGroups, setSparingGroups] = useState<BudsjettGruppe[]>([]);

  useEffect(() => {
    setTransaksjoner(loading);
    return subscribeTransaksjonRecords(familyId, (t) => setTransaksjoner(loaded(t)));
  }, [familyId]);
  useEffect(() => subscribeHendelser(familyId, setHendelser), [familyId]);
  useEffect(() => subscribeKvitteringer(familyId, setReceipts), [familyId]);
  useEffect(() => subscribeRules(familyId, setRules), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "budget", setBudgetGroups), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "incomeGroups", setIncomeGroups), [familyId]);
  useEffect(
    () => subscribeBudsjettGrupper(familyId, "sparingGroups", setSparingGroups),
    [familyId],
  );

  return {
    transaksjoner,
    hendelser,
    receipts,
    rules,
    budgetGroups,
    incomeGroups,
    sparingGroups,
  };
}
