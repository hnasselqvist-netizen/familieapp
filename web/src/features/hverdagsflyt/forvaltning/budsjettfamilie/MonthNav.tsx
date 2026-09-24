import { Icon } from "@components/Icon";
import styles from "./MonthNav.module.css";

const MONTHS = [
  "Januar",
  "Februar",
  "Mars",
  "April",
  "Mai",
  "Juni",
  "Juli",
  "August",
  "September",
  "Oktober",
  "November",
  "Desember",
];

export interface MonthNavProps {
  month: number;
  onChange: (month: number) => void;
}

/** Port av `MaanedsHeader` (§index.html linje 422–433) — forrige/neste måned. */
export function MonthNav({ month, onChange }: MonthNavProps) {
  return (
    <div className={styles.row}>
      <button
        type="button"
        className={styles.navButtonPrev}
        aria-label="Forrige måned"
        onClick={() => onChange((month + 11) % 12)}
      >
        <Icon name="chevron-right" size={14} />
      </button>
      <span className={styles.label}>{MONTHS[month]}</span>
      <button
        type="button"
        className={styles.navButton}
        aria-label="Neste måned"
        onClick={() => onChange((month + 1) % 12)}
      >
        <Icon name="chevron-right" size={14} />
      </button>
    </div>
  );
}
