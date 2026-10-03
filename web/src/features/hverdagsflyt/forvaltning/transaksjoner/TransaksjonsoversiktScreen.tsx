import { useTransaksjonsoversikt } from "@hooks/useTransaksjonsoversikt";
import styles from "./TransaksjonsoversiktScreen.module.css";
import { TransaksjonsoversiktView } from "./TransaksjonsoversiktView";

/**
 * Transaksjoner (§Issue #34 R3-les) — kun visning. Ikke koblet til
 * hovednavigasjonen; nåbar på `/forvaltning/transaksjoner`. Legacy-
 * Bankimport i `index.html` er urørt og forblir eneste skriver.
 */
export function TransaksjonsoversiktScreen() {
  const data = useTransaksjonsoversikt();
  if (data.transaksjoner.status !== "loaded") {
    return <div className={styles.laster}>Laster…</div>;
  }
  return (
    <TransaksjonsoversiktView
      transaksjoner={data.transaksjoner.data}
      hendelser={data.hendelser}
      receipts={data.receipts}
      rules={data.rules}
      budgetGroups={data.budgetGroups}
      incomeGroups={data.incomeGroups}
      sparingGroups={data.sparingGroups}
      skrivingAktiv={data.skrivingAktiv}
      onUtfor={data.utfor}
    />
  );
}
