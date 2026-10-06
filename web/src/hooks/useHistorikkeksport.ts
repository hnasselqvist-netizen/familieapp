import { useEffect, useMemo, useState } from "react";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import {
  subscribeHendelser,
  subscribeKvitteringer,
  subscribeTransaksjonRecords,
} from "@data/forsoning.repository";
import {
  type HistorikkRad,
  type HistorikkSammendrag,
  byggHistorikkEksport,
  historikkSammendrag,
} from "@domain/forsoning/historikkeksport";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { HendelseRecord, KvitteringRecord, TransaksjonRecord } from "@app-types/forsoning";
import { type Loadable, loaded, loading } from "@app-types/status";
import { useFamilyId } from "./useFamilyId";

export interface Historikkeksport {
  rader: HistorikkRad[];
  sammendrag: HistorikkSammendrag;
}

/**
 * Data til Historikkeksport (#59). Rent lesende: samme noder som legacy
 * `HistorikkEksportScreen` leste, og samme rene funksjon.
 */
export function useHistorikkeksport(): Loadable<Historikkeksport> {
  const familyId = useFamilyId();
  const [hendelser, setHendelser] = useState<HendelseRecord[] | null>(null);
  const [transaksjoner, setTransaksjoner] = useState<TransaksjonRecord[] | null>(null);
  const [kvitteringer, setKvitteringer] = useState<KvitteringRecord[] | null>(null);
  const [budgetGroups, setBudgetGroups] = useState<BudsjettGruppe[] | null>(null);
  const [incomeGroups, setIncomeGroups] = useState<BudsjettGruppe[] | null>(null);
  const [sparingGroups, setSparingGroups] = useState<BudsjettGruppe[] | null>(null);

  useEffect(() => subscribeHendelser(familyId, setHendelser), [familyId]);
  useEffect(() => subscribeTransaksjonRecords(familyId, setTransaksjoner), [familyId]);
  useEffect(() => subscribeKvitteringer(familyId, setKvitteringer), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "budget", setBudgetGroups), [familyId]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "incomeGroups", setIncomeGroups), [familyId]);
  useEffect(
    () => subscribeBudsjettGrupper(familyId, "sparingGroups", setSparingGroups),
    [familyId],
  );

  return useMemo(() => {
    if (
      !hendelser ||
      !transaksjoner ||
      !kvitteringer ||
      !budgetGroups ||
      !incomeGroups ||
      !sparingGroups
    ) {
      return loading;
    }
    const rader = byggHistorikkEksport(
      hendelser,
      transaksjoner,
      kvitteringer,
      budgetGroups,
      incomeGroups,
      sparingGroups,
    );
    return loaded({ rader, sammendrag: historikkSammendrag(hendelser, rader) });
  }, [hendelser, transaksjoner, kvitteringer, budgetGroups, incomeGroups, sparingGroups]);
}
