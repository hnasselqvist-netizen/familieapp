import { useSearchParams } from "react-router-dom";
import { GangenRetur } from "@components/GangenRetur";
import { type Seksjon, arbeidsko } from "@domain/forsoning/transaksjonsoversikt";
import { useTransaksjonsoversikt } from "@hooks/useTransaksjonsoversikt";
import styles from "./TransaksjonsoversiktScreen.module.css";
import { TransaksjonsoversiktView } from "./TransaksjonsoversiktView";

/**
 * Transaksjoner (§Issue #34 R3-les) — kun visning. Ikke koblet til
 * hovednavigasjonen; nåbar på `/forvaltning/transaksjoner`. Legacy-
 * Bankimport i `index.html` er urørt og forblir eneste skriver.
 */
const KOER: readonly Seksjon[] = ["vurdering", "forslag", "paavent"];

export function TransaksjonsoversiktScreen() {
  const data = useTransaksjonsoversikt();
  const ko = useSearchParams()[0].get("ko");
  const startSeksjon = KOER.find((s) => s === ko) ?? "vurdering";
  if (data.transaksjoner.status !== "loaded") {
    return <div className={styles.laster}>Laster…</div>;
  }
  const koer = arbeidsko(data.transaksjoner.data, data.hendelser, data.rules);
  return (
    <>
      <GangenRetur
        ferdig={koer.vurdering.length === 0 && koer.forslag.length === 0}
        ferdigTekst="Alt er vurdert."
      />
      <TransaksjonsoversiktView
        transaksjoner={data.transaksjoner.data}
        hendelser={data.hendelser}
        receipts={data.receipts}
        rules={data.rules}
        budgetGroups={data.budgetGroups}
        incomeGroups={data.incomeGroups}
        sparingGroups={data.sparingGroups}
        liquidityPosts={data.liquidityPosts}
        skrivingAktiv={data.skrivingAktiv}
        onUtfor={data.utfor}
        startSeksjon={startSeksjon}
      />
    </>
  );
}
