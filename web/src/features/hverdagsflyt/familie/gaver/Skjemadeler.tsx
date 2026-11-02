import { useId } from "react";
import type { BudsjettUtkast } from "./budsjettUtkast";
import { Button } from "@components/Button";
import styles from "./Gaver.module.css";

export function BudsjettFelt({
  etikett,
  verdi,
  onChange,
  arvTekst,
}: {
  etikett: string;
  verdi: BudsjettUtkast;
  onChange: (v: BudsjettUtkast) => void;
  /** Tekst for «arv»-valget; utelatt = arv er ikke et valg (gruppenivå, anledning). */
  arvTekst?: string;
}) {
  const id = useId();
  return (
    <div className={styles.felt}>
      <label htmlFor={`${id}-type`}>{etikett}</label>
      <div className={styles.handlinger}>
        <select
          id={`${id}-type`}
          className={styles.select}
          value={verdi.type}
          onChange={(e) => onChange({ ...verdi, type: e.target.value as BudsjettUtkast["type"] })}
        >
          {arvTekst !== undefined && <option value="arv">{arvTekst}</option>}
          <option value="ikke_satt">Ikke satt</option>
          <option value="belop">Beløp</option>
        </select>
        {verdi.type === "belop" && (
          <input
            className={`${styles.input} ${styles.belopInput}`}
            inputMode="decimal"
            aria-label={`${etikett}, beløp i kroner`}
            placeholder="kr"
            value={verdi.tekst}
            onChange={(e) => onChange({ ...verdi, tekst: e.target.value })}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Feil- og konfliktmelding under et skjema. Ved konflikt får brukeren
 * velge: lagre sitt eget utkast over den nye versjonen, eller forkaste det.
 */
export function Lagringsmelding({
  feil,
  konflikt,
  lagrer,
  onLagreLikevel,
  onForkast,
}: {
  feil: string | null;
  konflikt: boolean;
  lagrer: boolean;
  onLagreLikevel?: () => void;
  onForkast?: () => void;
}) {
  if (!feil) return null;
  return (
    <div className={styles.feil} role="alert">
      <p className={styles.tekst}>{feil}</p>
      {konflikt && (onLagreLikevel || onForkast) && (
        <div className={styles.handlinger} style={{ marginTop: 8 }}>
          {onLagreLikevel && (
            <Button variant="secondary" onClick={onLagreLikevel} disabled={lagrer}>
              Lagre min versjon likevel
            </Button>
          )}
          {onForkast && (
            <button type="button" className={styles.tekstKnapp} onClick={onForkast}>
              Forkast det jeg skrev
            </button>
          )}
        </div>
      )}
    </div>
  );
}
