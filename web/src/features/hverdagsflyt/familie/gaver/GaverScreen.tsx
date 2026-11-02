import { useGaver } from "@hooks/useGaver";
import { GaverView } from "./GaverView";
import styles from "./Gaver.module.css";

/** `/hjem-familie/gaver` (S1 julegaver). */
export function GaverScreen({ naa = () => new Date() }: { naa?: () => Date }) {
  const g = useGaver();
  if (g.status === "error") {
    return (
      <p className={styles.feil} role="alert">
        Kunne ikke laste gavene. Sjekk nettforbindelsen og last siden på nytt.
      </p>
    );
  }
  if (g.status !== "loaded") return <div className={styles.laster}>Laster…</div>;
  return <GaverView {...g.data} aar={naa().getFullYear()} handlinger={g.handlinger} />;
}
