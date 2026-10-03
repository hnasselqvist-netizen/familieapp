import { useEffect, useState } from "react";
import { subscribeBudsjettGrupper } from "@data/budsjettfamilie.repository";
import { useFamilyId } from "@hooks/useFamilyId";
import { useLiquidity } from "@hooks/useLiquidity";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import styles from "./SpilleromOversikt.module.css";
import { SpilleromOversiktView } from "./SpilleromOversiktView";

/**
 * Spillerom-dashbordet (§Issue #34, pre-cutover 1) på `/forvaltning/oversikt`
 * — inngangen «Spillerom» i Forvaltning, som legacy-fanen. Leser `liquidity`
 * og `budget`; saldo lagres med samme skriving som Spillerom-detaljene.
 * Måneden er inneværende (legacy deler appens måned med Budsjett, som også
 * starter på inneværende måned).
 */
export function SpilleromOversiktScreen() {
  const familyId = useFamilyId();
  const { liquidity, saveSaldo } = useLiquidity();
  const [budgetGroups, setBudgetGroups] = useState<BudsjettGruppe[]>([]);
  useEffect(() => subscribeBudsjettGrupper(familyId, "budget", setBudgetGroups), [familyId]);

  if (liquidity.status !== "loaded") return <div className={styles.laster}>Laster…</div>;
  const naa = new Date();
  return (
    <SpilleromOversiktView
      liquidity={liquidity.data}
      budgetGroups={budgetGroups}
      month={naa.getMonth()}
      idag={naa.toISOString().slice(0, 10)}
      onSaveSaldo={(saldo) => void saveSaldo(saldo)}
    />
  );
}
