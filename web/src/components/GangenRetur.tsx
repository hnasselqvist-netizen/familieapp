import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "./Icon";
import styles from "./GangenRetur.module.css";

/**
 * Søkeparameteret Gangen setter på lenkene sine (`?fra=gangen`), slik at
 * rommet brukeren lander i vet at hun kom fra Gangen og kan tilby veien
 * tilbake (#59, retning 1: «naturlig retur til Gangen etter fullført
 * handling»).
 */
export const FRA_PARAM = "fra";
export const FRA_GANGEN = "gangen";

export interface GangenReturProps {
  /**
   * Beslutningen Gangen sendte brukeren hit for, er tatt. Da blir den
   * diskré lenken et rolig «ferdig»-kort. Brukeren velger selv når hun går
   * tilbake; ingenting navigerer automatisk.
   */
  ferdig?: boolean;
  /** Teksten i ferdig-kortet, f.eks. «Middagen er planlagt.» */
  ferdigTekst?: string;
}

/** Vises bare når brukeren kom fra Gangen. Ellers rendres ingenting. */
export function GangenRetur({ ferdig = false, ferdigTekst = "Det er gjort." }: GangenReturProps) {
  const [params] = useSearchParams();
  if (params.get(FRA_PARAM) !== FRA_GANGEN) return null;

  if (ferdig) {
    return (
      <div className={styles.ferdig} role="status">
        <span className={styles.check} aria-hidden>
          <Icon name="check" color="#ecdfc8" size={13} />
        </span>
        <span className={styles.ferdigTekst}>{ferdigTekst}</span>
        <Link to="/" className={styles.ferdigLenke}>
          Tilbake til Gangen
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
    );
  }

  return (
    <Link to="/" className={styles.lenke}>
      <Icon name="house-heart" size={15} />
      Gangen
    </Link>
  );
}
