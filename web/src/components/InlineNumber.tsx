import { useState } from "react";
import styles from "./InlineNumber.module.css";

export interface InlineNumberProps {
  value: number;
  onChange: (value: number) => void;
  /** Rødfarget visning (over budsjett/negativ, avhengig av kalleren). */
  warn?: boolean;
  ariaLabel?: string;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 }).format(n || 0);

/**
 * Klikkbart, redigerbart tall — trykk for å skrive inn et nytt beløp,
 * blur/Enter lagrer. Port av legacy sin `InlineNum` (§index.html linje
 * 438–463), brukt av Budsjett/Inntekter/Sparing sine budsjett-/Faktisk-
 * kolonner.
 */
export function InlineNumber({ value, onChange, warn, ariaLabel }: InlineNumberProps) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState(String(value || 0));

  if (editing) {
    return (
      <input
        type="number"
        aria-label={ariaLabel}
        value={raw}
        autoFocus
        onFocus={(e) => e.target.select()}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={() => {
          onChange(Number.parseFloat(raw) || 0);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            onChange(Number.parseFloat(raw) || 0);
            setEditing(false);
          }
        }}
        className={styles.input}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={`${styles.display} ${warn ? styles.warn : ""}`}
      onClick={() => {
        setRaw(String(value || 0));
        setEditing(true);
      }}
    >
      {fmt(value)}
    </button>
  );
}
