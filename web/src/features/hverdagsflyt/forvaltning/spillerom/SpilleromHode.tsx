import { useState } from "react";
import styles from "./SpilleromRom.module.css";

const kr = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);
const kortDato = (d: string) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) : "";

export interface SpilleromHodeProps {
  saldo: number;
  harSaldo: boolean;
  innbetalinger: number;
  utbetalinger: number;
  spillerom: number;
  prognosisDate: string;
  /** Minutter siden saldoen ble oppdatert, eller null. */
  saldoAlderMin: number | null;
  onSaveSaldo: (saldo: number) => void;
}

/**
 * Spillerom-rommets hode (#59, Spillerom samlet til ett rom): ett tall —
 * spillerommet frem til prognosedatoen — og regnestykket bak det i klartekst.
 *
 * Erstatter de tre kortene «Disponibelt / Bundet / Spillerom». «Bundet»
 * (utbetalinger − innbetalinger) ble negativ så snart lønn kom før
 * prognosedatoen («Bundet −20 800 kr»), som ikke betyr noe for brukeren.
 * Nå vises inn og ut hver for seg: disponibelt + inn − ut = spillerom.
 */
export function SpilleromHode(p: SpilleromHodeProps) {
  const [redigerer, setRedigerer] = useState(false);
  const [tekst, setTekst] = useState("");

  const lagre = () => {
    const belop = Number.parseFloat(tekst.replace(/\s/g, "").replace(",", "."));
    if (Number.isFinite(belop)) p.onSaveSaldo(belop);
    setRedigerer(false);
  };

  return (
    <section className={styles.hode} aria-label="Spillerom">
      <span className={styles.hodeTittel}>
        Spillerom{p.prognosisDate ? ` til ${kortDato(p.prognosisDate)}` : ""}
      </span>
      <span className={`${styles.hodeTall} ${p.spillerom < 0 ? styles.negativ : styles.positiv}`}>
        {p.harSaldo ? kr(p.spillerom) : "–"}
      </span>

      <dl className={styles.regnestykke}>
        <dt>Disponibelt nå</dt>
        <dd>
          {redigerer ? (
            <input
              type="text"
              inputMode="decimal"
              enterKeyHint="done"
              aria-label="Disponibelt nå"
              className={styles.saldoFelt}
              value={tekst}
              autoFocus
              onFocus={(e) => e.target.select()}
              onChange={(e) => setTekst(e.target.value)}
              onBlur={lagre}
              onKeyDown={(e) => {
                if (e.key === "Enter") lagre();
                if (e.key === "Escape") setRedigerer(false);
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.saldoKnapp}
              aria-label={p.harSaldo ? "Endre disponibelt beløp" : "Sett disponibelt beløp"}
              onClick={() => {
                setTekst(p.harSaldo ? String(p.saldo) : "");
                setRedigerer(true);
              }}
            >
              {p.harSaldo ? kr(p.saldo) : "Sett beløp"}
            </button>
          )}
        </dd>
        <dt>Kommer inn</dt>
        <dd className={styles.inn}>+{kr(p.innbetalinger)}</dd>
        <dt>Skal ut</dt>
        <dd>−{kr(p.utbetalinger)}</dd>
      </dl>
      {p.saldoAlderMin !== null && !redigerer && (
        <span className={styles.alder}>
          Saldo oppdatert for {formaterAlder(p.saldoAlderMin)} siden
        </span>
      )}
    </section>
  );
}

function formaterAlder(min: number): string {
  if (min < 60) return `${min} min`;
  const timer = Math.round(min / 60);
  if (timer < 48) return `${timer} t`;
  return `${Math.round(timer / 24)} dager`;
}
