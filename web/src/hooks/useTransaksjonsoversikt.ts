import { useCallback, useEffect, useState } from "react";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import {
  subscribeHendelser,
  subscribeKvitteringer,
  subscribeTransaksjonRecords,
} from "@data/forsoning.repository";
import { subscribeLiquidity } from "@data/liquidity.repository";
import { subscribeRules } from "@data/rules.repository";
import {
  skrivTransaksjonskontroll,
  subscribeTransaksjonskontroller,
} from "@data/transaksjonskontroller.repository";
import { medKvalitetssikring, utenKvalitetssikring } from "@domain/forsoning/kvalitetssikring";
import type { KontrollMerke, Transaksjonskontroll } from "@app-types/kvalitetssikring";
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
import { useAuthUser } from "./useAuthUser";
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
  /** «Kvalitetssikret» per stabil transaksjons-ID (#59, 6542594363). */
  kontroller: Map<string, Transaksjonskontroll>;
  /**
   * Merker/opphever kvalitetssikring for én transaksjon mot grunnlaget
   * brukeren så. `forventet` er den gjeldende kontrollen brukeren så;
   * avviker serveren, avvises skrivingen (`KontrollEndretAvAndre`).
   */
  settKvalitetssikring: (
    transaksjonId: string,
    grunnlag: string,
    forventet: KontrollMerke | null,
    kvalitetssikret: boolean,
  ) => Promise<void>;
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
  const [kontroller, setKontroller] = useState<Map<string, Transaksjonskontroll>>(() => new Map());
  const bruker = useAuthUser();

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

  useEffect(() => subscribeTransaksjonskontroller(familyId, setKontroller), [familyId]);

  const utfor = useForsoningSkriver();

  const settKvalitetssikring = useCallback(
    async (
      transaksjonId: string,
      grunnlag: string,
      forventet: KontrollMerke | null,
      kvalitetssikret: boolean,
    ) => {
      if (!bruker) throw new Error("Ikke innlogget — kontrollen ble ikke lagret.");
      const handling = {
        grunnlag,
        tid: new Date().toISOString(),
        av: bruker.uid,
        avNavn: bruker.displayName || bruker.email || bruker.uid,
        sporId: `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      };
      await skrivTransaksjonskontroll(familyId, transaksjonId, forventet, (forrige) =>
        kvalitetssikret
          ? medKvalitetssikring(forrige, transaksjonId, handling)
          : utenKvalitetssikring(forrige, transaksjonId, handling),
      );
    },
    [bruker, familyId],
  );

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
    kontroller,
    settKvalitetssikring,
  };
}
