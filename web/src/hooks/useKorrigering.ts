import { useEffect, useState } from "react";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import {
  subscribeHendelser,
  subscribeKvitteringer,
  subscribeTransaksjonRecords,
} from "@data/forsoning.repository";
import { subscribeRules } from "@data/rules.repository";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import { forsoningSkrivingAktiv } from "./forsoningAktivering";
import { useFamilyId } from "./useFamilyId";
import { useForsoningSkriver } from "./useForsoningSkriver";

export interface UseKorrigeringResult {
  hendelser: HendelseRecord[];
  transaksjoner: TransaksjonRecord[];
  receipts: KvitteringRecord[];
  rules: RegelRecord[];
  budgetGroups: BudsjettGruppe[];
  incomeGroups: BudsjettGruppe[];
  sparingGroups: BudsjettGruppe[];
  /** Den felles forsoningsporten — `false` til R3b-cutover. */
  skrivingAktiv: boolean;
  utfor: (endring: Beslutningsendring) => Promise<void>;
}

/**
 * Data og skriver for korrigering fra postdetalj i Budsjett/Inntekter/
 * Sparing (§Issue #34 R3b-4). Leser forsoningsnodene i samme form som
 * transaksjonsoversikten; skriving er stengt bak forsoningsporten.
 */
export function useKorrigering(): UseKorrigeringResult {
  const familyId = useFamilyId();
  const [hendelser, setHendelser] = useState<HendelseRecord[]>([]);
  const [transaksjoner, setTransaksjoner] = useState<TransaksjonRecord[]>([]);
  const [receipts, setReceipts] = useState<KvitteringRecord[]>([]);
  const [rules, setRules] = useState<RegelRecord[]>([]);
  const [budgetGroups, setBudgetGroups] = useState<BudsjettGruppe[]>([]);
  const [incomeGroups, setIncomeGroups] = useState<BudsjettGruppe[]>([]);
  const [sparingGroups, setSparingGroups] = useState<BudsjettGruppe[]>([]);

  useEffect(() => subscribeHendelser(familyId, setHendelser), [familyId]);
  useEffect(() => subscribeTransaksjonRecords(familyId, setTransaksjoner), [familyId]);
  useEffect(() => subscribeKvitteringer(familyId, setReceipts), [familyId]);
  useEffect(() => subscribeRules(familyId, setRules), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "budget", setBudgetGroups), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "incomeGroups", setIncomeGroups), [familyId]);
  useEffect(
    () => subscribeBudsjettGrupper(familyId, "sparingGroups", setSparingGroups),
    [familyId],
  );

  const utfor = useForsoningSkriver();
  return {
    hendelser,
    transaksjoner,
    receipts,
    rules,
    budgetGroups,
    incomeGroups,
    sparingGroups,
    skrivingAktiv: forsoningSkrivingAktiv(),
    utfor,
  };
}
