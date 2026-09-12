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
 * Bruker nå det låste `--g-*`-designsystemet
 * (§docs/produktfasit/visuelt-designsystem.md, §Kontrolltårn-review,
 * PR #26) — eyebrow i romfarge, H1 28px/600 Instrument Sans. Se
 * `RoomHeader.module.css` sin toppkommentar for mobilkomposisjonen.
 *
 * Tittelen er et semantisk `<h1>` (§Kontrolltårn-review, PR #22) — dette
 * er et side-/romnivå-atom ment å erstatte dagens skjermtitler, ikke en
 * dekorativ tekstblokk. Ingen `<h1>`/`<h2>`/`<h3>` finnes ennå noe sted i
 * `src/features/` (verifisert ved grep) — ingen reelt observert behov
 * for et konfigurerbart nivå, så det er bevisst IKKE eksponert som prop
 * her. Legg det til typesikkert den dagen et faktisk skjermhierarki
 * krever det, ikke før.
 */
export function RoomHeader({ eyebrow, title, description, actions }: RoomHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.text}>
        {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
        <h1 className={styles.title}>{title}</h1>
        {description && <div className={styles.description}>{description}</div>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}
