import { useKvitteringsinnboks } from "@hooks/useKvitteringsinnboks";
import styles from "./KvitteringsinnboksScreen.module.css";
import { KvitteringsinnboksView } from "./KvitteringsinnboksView";

/**
 * Kvitteringsinnboks (§Issue #34 R2) — kun visning. Ikke koblet til
 * hovednavigasjonen; nåbar på `/forvaltning/kvitteringer`. Legacy-
 * innboksen i `index.html` er urørt og forblir eneste skriver.
 */
export function KvitteringsinnboksScreen() {
  const inn = useKvitteringsinnboks();
  if (inn.kvitteringer.status !== "loaded") {
    return <div className={styles.laster}>Laster…</div>;
  }
  return (
    <KvitteringsinnboksView
      alle={inn.kvitteringer.data}
      aktive={inn.aktive}
      transaksjoner={inn.transaksjoner}
      hendelser={inn.hendelser}
    />
  );
}
