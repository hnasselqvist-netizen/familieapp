import { forsoningSkrivingAktiv } from "@hooks/forsoningAktivering";
import { useAvstemming } from "@hooks/useAvstemming";
import { LegacyBridge } from "@features/LegacyBridge";
import styles from "./Avstemming.module.css";
import { AvstemmingView } from "./AvstemmingView";

/**
 * `/forvaltning/avstemming` — saldoavstemming per konto og kalendermåned
 * (#59). Følger forsoningsporten som resten av Forvaltning: med porten av
 * (rollback) er legacy eneste skriver, og siden er broen dit.
 */
export function AvstemmingScreen() {
  if (!forsoningSkrivingAktiv()) return <LegacyBridge label="Forvaltning" />;
  return <Avstemming />;
}

function Avstemming() {
  const { avstemming, lagreSaldo, avklarIgnorert, korrigering, visTidligereAar } = useAvstemming();
  if (avstemming.status !== "loaded") return <div className={styles.laster}>Laster…</div>;
  return (
    <AvstemmingView
      oversikt={avstemming.data.oversikt}
      onLagre={lagreSaldo}
      onAvklarIgnorert={avklarIgnorert}
      transaksjoner={avstemming.data.transaksjoner}
      korrigering={korrigering}
      onVisTidligereAar={visTidligereAar}
    />
  );
}
