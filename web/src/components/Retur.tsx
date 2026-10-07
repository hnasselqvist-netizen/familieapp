import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import { FRA_PARAM, type Opphav } from "./fraLenke";
import styles from "./Retur.module.css";

/**
 * Veien tilbake dit brukeren kom fra (#59). Inngangene som sender brukeren
 * til en beslutning setter `?fra=<opphav>` på lenken, slik at rommet hun
 * lander i kan tilby returen:
 *  - `gangen`: Gangen som dagens ene inngang (retning 1);
 *  - `runde`: Lønnsdagsrunden, den ledede Forvaltning-ruten.
 */
const OPPHAV = {
  gangen: { til: "/", navn: "Gangen", ikon: "house-heart" },
  runde: { til: "/forvaltning/runde", navn: "Lønnsdagsrunden", ikon: "list-todo" },
} as const satisfies Record<Opphav, { til: string; navn: string; ikon: IconName }>;

export interface ReturProps {
  /**
   * Beslutningen brukeren ble sendt hit for, er tatt. Da blir den diskré
   * lenken et rolig «ferdig»-kort. Brukeren velger selv når hun går
   * tilbake; ingenting navigerer automatisk.
   */
  ferdig?: boolean;
  /** Teksten i ferdig-kortet, f.eks. «Middagen er planlagt.» */
  ferdigTekst?: string;
}

/** Vises bare når brukeren kom fra en kjent inngang. Ellers rendres ingenting. */
export function Retur({ ferdig = false, ferdigTekst = "Det er gjort." }: ReturProps) {
  const [params] = useSearchParams();
  const fra = params.get(FRA_PARAM);
  if (fra !== "gangen" && fra !== "runde") return null;
  const opphav = OPPHAV[fra];

  if (ferdig) {
    return (
      <div className={styles.ferdig} role="status">
        <span className={styles.check} aria-hidden>
          <Icon name="check" color="#ecdfc8" size={13} />
        </span>
        <span className={styles.ferdigTekst}>{ferdigTekst}</span>
        <Link to={opphav.til} className={styles.ferdigLenke}>
          Tilbake til {opphav.navn}
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
    );
  }

  return (
    <Link to={opphav.til} className={styles.lenke}>
      <Icon name={opphav.ikon} size={15} />
      {opphav.navn}
    </Link>
  );
}
