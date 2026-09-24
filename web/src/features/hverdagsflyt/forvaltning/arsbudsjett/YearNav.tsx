import { Icon } from "@components/Icon";
import styles from "./YearNav.module.css";

export interface YearNavProps {
  valgtAar: number;
  currentBudgetYear: number;
  onForrige: () => void;
  onNeste: () => void;
}

/**
 * Enkel årsvelger — valgt år alltid synlig, minst ett år bakover, flere
 * fremover (§index.html linje 13799–13824: klemt til `[currentBudgetYear
 * -1, currentBudgetYear+5]`). Samme rotert-`chevron-right`-mønster som
 * `MonthNav` bruker for "forrige" (ingen `chevron-left` i ikonregisteret).
 */
export function YearNav({ valgtAar, currentBudgetYear, onForrige, onNeste }: YearNavProps) {
  const forrigeDeaktivert = valgtAar <= currentBudgetYear - 1;
  const nesteDeaktivert = valgtAar >= currentBudgetYear + 5;
  return (
    <div className={styles.row}>
      <button
        type="button"
        onClick={onForrige}
        disabled={forrigeDeaktivert}
        aria-label="Forrige år"
        className={styles.navButtonPrev}
      >
        <Icon name="chevron-right" size={16} />
      </button>
      <div className={styles.label}>{valgtAar}</div>
      <button
        type="button"
        onClick={onNeste}
        disabled={nesteDeaktivert}
        aria-label="Neste år"
        className={styles.navButton}
      >
        <Icon name="chevron-right" size={16} />
      </button>
      {valgtAar !== currentBudgetYear && (
        <span className={styles.hint}>(inneværende år er {currentBudgetYear})</span>
      )}
    </div>
  );
}
