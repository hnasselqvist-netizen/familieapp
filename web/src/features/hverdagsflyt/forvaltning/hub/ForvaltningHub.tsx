import { forsoningSkrivingAktiv } from "@hooks/forsoningAktivering";
import { useForvaltningOversikt } from "@hooks/useForvaltningOversikt";
import { LegacyBridge } from "@features/LegacyBridge";
import styles from "./ForvaltningHub.module.css";
import { ForvaltningOversiktView } from "./ForvaltningOversiktView";

/**
 * `/forvaltning` — Forvaltning-forsiden. Siden R3b-cutover er den en
 * handlingsflate (produktfase 1, #34 6000282907), ikke en modulmeny: se
 * `ForvaltningOversiktView`.
 *
 * Med forsoningsporten AV (rollback, `hooks/forsoningAktivering.ts`) er
 * `/forvaltning` igjen broen til legacy, fordi legacy da er eneste skriver
 * av forsoningsnodene. Navigasjon og skriving byttes i samme flagg.
 */
export function ForvaltningHub() {
  if (!forsoningSkrivingAktiv()) return <LegacyBridge label="Forvaltning" />;
  return <ForvaltningOversikt />;
}

function ForvaltningOversikt() {
  const data = useForvaltningOversikt();
  if (data.status !== "loaded") return <div className={styles.laster}>Laster…</div>;
  return <ForvaltningOversiktView {...data.data} />;
}
