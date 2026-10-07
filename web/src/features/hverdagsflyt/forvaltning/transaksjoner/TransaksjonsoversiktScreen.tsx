import { useSearchParams } from "react-router-dom";
import { Retur } from "@components/Retur";
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
  const [params] = useSearchParams();
  const ko = params.get("ko");
  const startSeksjon = KOER.find((s) => s === ko) ?? "vurdering";
  if (data.transaksjoner.status !== "loaded") {
    return <div className={styles.laster}>Laster…</div>;
  }
  const startMedImport = params.get("verktoy") === "import";
  const koer = arbeidsko(data.transaksjoner.data, data.hendelser, data.rules);
  // Kom brukeren for å importere, er en tom kø ikke «ferdig» — da har hun
  // bare ikke importert ennå. Returen er da en vanlig lenke.
  const vurdert = koer.vurdering.length === 0 && koer.forslag.length === 0;
  return (
    <>
      <Retur ferdig={!startMedImport && vurdert} ferdigTekst="Alt er vurdert." />
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
        startMedImport={startMedImport}
      />
    </>
  );
}
