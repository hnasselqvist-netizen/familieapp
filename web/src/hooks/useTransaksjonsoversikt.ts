import { useEffect, useState } from "react";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import {
  subscribeHendelser,
  subscribeKvitteringer,
  subscribeTransaksjonRecords,
} from "@data/forsoning.repository";
import { subscribeLiquidity } from "@data/liquidity.repository";
import { subscribeRules } from "@data/rules.repository";
import type { Beslutningsendring } from "@domain/forsoning/beslutning";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type {
  HendelseRecord,
  KvitteringRecord,
  RegelRecord,
  TransaksjonRecord,
} from "@app-types/forsoning";
import type { LiquidityPost } from "@app-types/liquidity";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { forsoningSkrivingAktiv } from "./forsoningAktivering";
import { useForsoningSkriver } from "./useForsoningSkriver";
import { useFamilyId } from "./useFamilyId";

export interface UseTransaksjonsoversiktResult {
  transaksjoner: Loadable<TransaksjonRecord[]>;
  hendelser: HendelseRecord[];
  receipts: KvitteringRecord[];
  rules: RegelRecord[];
  budgetGroups: BudsjettGruppe[];
  incomeGroups: BudsjettGruppe[];
  sparingGroups: BudsjettGruppe[];
  /** Likviditetsprognosens poster — importens «forslag til match» (R3b-2). */
  liquidityPosts: LiquidityPost[];
  /** Den felles forsoningsporten — `false` til R3b-cutover. */
  skrivingAktiv: boolean;
  /**
   * Skriver en Bankimport-beslutning (R3b-1): hendelser → transaksjoner →
   * rules, hver som én helnode-transaksjon. Avvises med
   * `ForsoningSkrivingStengt` til R3b-cutover.
   */
  utfor: (endring: Beslutningsendring) => Promise<void>;
}

/**
 * Transaksjonsoversikten (§Issue #34 R3-les) med Bankimport-beslutningene
 * fra R3b-1 (`utfor`) — skriving er stengt bak forsoningsporten til
 * R3b-cutover (ADR 0002); til da er skjermen ren visning.
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
  const [liquidityPosts, setLiquidityPosts] = useState<LiquidityPost[]>([]);

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

  useEffect(
    () => subscribeLiquidity(familyId, (l) => setLiquidityPosts(Object.values(l.posts || {}))),
    [familyId],
  );

  const utfor = useForsoningSkriver();

  return {
    transaksjoner,
    hendelser,
    receipts,
    rules,
    budgetGroups,
    incomeGroups,
    sparingGroups,
    liquidityPosts,
    skrivingAktiv: forsoningSkrivingAktiv(),
    utfor,
  };
}
