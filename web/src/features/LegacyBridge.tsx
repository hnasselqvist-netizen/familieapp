import styles from "./LegacyBridge.module.css";

const LEGACY_APP_URL =
  import.meta.env.VITE_LEGACY_APP_URL ?? "https://hnasselqvist-netizen.github.io/familieapp/";

export interface LegacyBridgeProps {
  /** Navnet på fanen/området slik brukeren kjenner det, f.eks. "Kokebok". */
  label: string;
}

/**
 * Midlertidig bro til dagens produksjons-app for områder som ennå ikke er
 * migrert (§migreringsfase 2 — "ikke-flyttede faner lenker eksternt til
 * index.html"). Dette er IKKE et permanent arkitekturmønster — hvert
 * område denne peker til forsvinner herfra i det den migreres som sin
 * egen vertikale skive, og bygges da som en ekte route, ikke en lenke.
 */
export function LegacyBridge({ label }: LegacyBridgeProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.icon}>🚧</div>
      <div className={styles.text}>
        <strong>{label}</strong> er ikke migrert til den nye grunnmuren ennå.
      </div>
      <a href={LEGACY_APP_URL} className={styles.link}>
        Åpne i dagens app →
      </a>
    </div>
  );
}
