import type { ReactNode } from "react";
import styles from "./RoomHeader.module.css";

export interface RoomHeaderProps {
  /**
   * Valgfritt romnavn over tittelen (f.eks. "MAT"). Rent visningsvalg
   * eid av kallestedet — komponenten har ingen anelse om hvilket rom
   * den faktisk rendres i, og setter ingen standardtekst selv.
   */
  eyebrow?: string;
  title: string;
  /** Valgfri støttetekst under tittelen. */
  description?: string;
  /**
   * Høyrejustert handlingsrad — dekker det reelle behovet i dagens
   * `PlanScreen.module.css` sin `.header`/`.headerActions` (tittel til
   * venstre, knapper til høyre). Kallestedet eier selve knappene (typisk
   * `Button`-instanser); denne komponenten kjenner ikke til dem.
   */
  actions?: ReactNode;
}

/**
 * Delt header-atom for en skjerm/et rom — eyebrow + tittel + valgfri
 * støttetekst + valgfri handlingsrad (§Kontrolltårn-handoff, Issue #20).
 * Erstatter INGEN skjerm ennå; ingen Mat-skjerm bruker denne i denne
 * skiven. Bruker eksisterende, nøytrale `--color-*`-typografitokens —
 * ingen ny Mat-palett eller tetthetsarkitektur er introdusert her.
 */
export function RoomHeader({ eyebrow, title, description, actions }: RoomHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.text}>
        {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
        <div className={styles.title}>{title}</div>
        {description && <div className={styles.description}>{description}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
