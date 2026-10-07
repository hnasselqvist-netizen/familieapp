import { forsoningSkrivingAktiv } from "@hooks/forsoningAktivering";
import { useForvaltningOversikt } from "@hooks/useForvaltningOversikt";
import { LegacyBridge } from "@features/LegacyBridge";
import styles from "./Lonnsdagsrunde.module.css";
import { LonnsdagsrundeView } from "./LonnsdagsrundeView";

/**
 * `/forvaltning/runde` — Lønnsdagsrunden (#59). Leser de samme dataene som
 * Forvaltning-forsiden (§useForvaltningOversikt) og skriver ingenting selv;
 * all skriving skjer i skjermene stegene åpner. Følger forsoningsporten
 * som forsiden: med porten av (rollback) er legacy eneste skriver.
 */
export function LonnsdagsrundeScreen() {
  if (!forsoningSkrivingAktiv()) return <LegacyBridge label="Forvaltning" />;
  return <Runde />;
}

function Runde() {
  const data = useForvaltningOversikt();
  if (data.status !== "loaded") return <div className={styles.laster}>Laster…</div>;
  const { runde, oppmerksomhet, spillerom, prognosisDate } = data.data;
  return (
    <LonnsdagsrundeView
      runde={runde}
      transaksjonsko={oppmerksomhet.transaksjonerAVurdere > 0 ? "vurdering" : "forslag"}
      spillerom={spillerom.spillerom}
      prognosisDate={prognosisDate}
    />
  );
}
