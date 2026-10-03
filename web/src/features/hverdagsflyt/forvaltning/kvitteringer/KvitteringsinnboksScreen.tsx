import { useKvitteringsinnboks } from "@hooks/useKvitteringsinnboks";
import styles from "./KvitteringsinnboksScreen.module.css";
import { KvitteringsinnboksView } from "./KvitteringsinnboksView";

/**
 * Kvitteringsinnboks (§Issue #34 R2, skrivende handlinger R3b-3 bak
 * forsoningsporten). Ikke koblet til hovednavigasjonen; nåbar på
 * `/forvaltning/kvitteringer`. Til R3b-cutover er porten av og legacy-
 * innboksen i `index.html` eneste skriver.
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
      poster={inn.poster}
      skrivingAktiv={inn.skrivingAktiv}
      onUtfor={inn.utfor}
    />
  );
}
