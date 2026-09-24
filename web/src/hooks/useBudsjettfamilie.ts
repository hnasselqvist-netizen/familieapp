import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addItem as repoAddItem,
  removeItem as repoRemoveItem,
  saveItemMeta as repoSaveItemMeta,
  subscribeBudsjettGrupper,
  updateItemMonth as repoUpdateItemMonth,
} from "@data/budsjettfamilie.repository";
import {
  subscribeBankHendelser,
  subscribeReceipts,
  subscribeTransaksjoner,
} from "@data/gangen.repository";
import {
  beregnFaktiskTotalerFraHendelser,
  budgetMonthKey,
  currentBudgetYear,
  nyPostMeta,
} from "@domain/budsjettfamilie/budsjettfamilie";
import type { BankHendelse, BankTransaksjon, Kvittering } from "@app-types/gangen";
import type { BudsjettfamilieNode, BudsjettGruppe, PostMeta } from "@app-types/budsjettfamilie";
import { type Loadable, loaded, loading, notLoaded } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface UseBudsjettfamilieResult {
  grupper: Loadable<BudsjettGruppe[]>;
  month: number;
  setMonth: (month: number) => void;
  monthKey: string;
  actualTotals: Record<string, number>;
  hendelser: BankHendelse[];
  transaksjoner: BankTransaksjon[];
  receipts: Kvittering[];
  gyldigeObservasjonIder: Set<string>;
  updateBudget: (groupId: string, itemId: string, value: number) => Promise<void>;
  updateSpent: (groupId: string, itemId: string, value: number) => Promise<void>;
  addNewItem: (
    groupId: string,
    fields: { name: string; budget: number; spent: number },
  ) => Promise<void>;
  removeExistingItem: (groupId: string, itemId: string) => Promise<void>;
  saveMeta: (groupId: string, itemId: string, meta: PostMeta, name?: string) => Promise<void>;
}

/**
 * React-binding for Budsjett/Inntekter/Sparing — delt av de tre
 * skjermene (§Issue #34, "Budsjett-familien... deler modell/
 * arbeidsflyt"), parametrisert på hvilken node som redigeres.
 *
 * `hendelser`/`transaksjoner`/`receipts` leses READ-ONLY via
 * `data/gangen.repository.ts` (samme repository Gangen allerede bruker
 * for disse tre nodene) — kun for Faktisk-beregning/drilldown, ALDRI
 * skrevet herfra. `month` er lokal skjerm-state (ikke en delt app-
 * bredde signatur slik legacy sin App() har, §Issue #34-kartlegging,
 * punkt 4) — hver skjerm starter på inneværende måned ved mount, en
 * bevisst, dokumentert forenkling siden de tre skjermene nå er egne
 * ruter, ikke faner i samme persisterte komponenttre.
 */
export function useBudsjettfamilie(node: BudsjettfamilieNode): UseBudsjettfamilieResult {
  const familyId = useFamilyId();
  const [grupper, setGrupper] = useState<Loadable<BudsjettGruppe[]>>(notLoaded);
  const [hendelser, setHendelser] = useState<BankHendelse[]>([]);
  const [transaksjoner, setTransaksjoner] = useState<BankTransaksjon[]>([]);
  const [receipts, setReceipts] = useState<Kvittering[]>([]);
  const [month, setMonth] = useState(() => new Date().getMonth());

  useEffect(() => {
    setGrupper(loading);
    return subscribeBudsjettGrupper(familyId, node, (g) => setGrupper(loaded(g)));
  }, [familyId, node]);

  useEffect(() => subscribeBankHendelser(familyId, setHendelser), [familyId]);
  useEffect(() => subscribeTransaksjoner(familyId, setTransaksjoner), [familyId]);
  useEffect(() => subscribeReceipts(familyId, setReceipts), [familyId]);

  const monthKey = useMemo(() => budgetMonthKey(currentBudgetYear(new Date()), month), [month]);

  const gyldigeObservasjonIder = useMemo(
    () => new Set([...transaksjoner.map((t) => t.id), ...receipts.map((r) => r.id)]),
    [transaksjoner, receipts],
  );

  const actualTotals = useMemo(
    () => beregnFaktiskTotalerFraHendelser(hendelser, monthKey, gyldigeObservasjonIder),
    [hendelser, monthKey, gyldigeObservasjonIder],
  );

  const updateBudget = useCallback(
    async (groupId: string, itemId: string, value: number) => {
      await repoUpdateItemMonth(familyId, node, groupId, itemId, month, "budget", value);
    },
    [familyId, node, month],
  );

  const updateSpent = useCallback(
    async (groupId: string, itemId: string, value: number) => {
      await repoUpdateItemMonth(familyId, node, groupId, itemId, month, "spent", value);
    },
    [familyId, node, month],
  );

  const addNewItem = useCallback(
    async (groupId: string, fields: { name: string; budget: number; spent: number }) => {
      await repoAddItem(familyId, node, groupId, {
        name: fields.name,
        budget: fields.budget,
        spent: fields.spent,
        monthIndex: month,
        meta: nyPostMeta(node, groupId),
      });
    },
    [familyId, node, month],
  );

  const removeExistingItem = useCallback(
    async (groupId: string, itemId: string) => {
      await repoRemoveItem(familyId, node, groupId, itemId);
    },
    [familyId, node],
  );

  const saveMeta = useCallback(
    async (groupId: string, itemId: string, meta: PostMeta, name?: string) => {
      await repoSaveItemMeta(familyId, node, groupId, itemId, meta, name);
    },
    [familyId, node],
  );

  return {
    grupper,
    month,
    setMonth,
    monthKey,
    actualTotals,
    hendelser,
    transaksjoner,
    receipts,
    gyldigeObservasjonIder,
    updateBudget,
    updateSpent,
    addNewItem,
    removeExistingItem,
    saveMeta,
  };
}
