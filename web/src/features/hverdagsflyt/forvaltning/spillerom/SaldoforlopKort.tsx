import { useState } from "react";
import { Icon } from "@components/Icon";
import type { Saldoforlop } from "@domain/liquidity/saldoforlop";
import styles from "./SaldoforlopKort.module.css";

const kr = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);
const dato = (d: string) =>
  new Date(d).toLocaleDateString("nb-NO", { weekday: "short", day: "numeric", month: "short" });
const kortDato = (d: string) =>
  new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });

/**
 * Prognosen som forløp (Forvaltning produktfase, #59): hvor lavt
 * disponibelt beløp går før prognosedatoen, i én rolig setning, og dag for
 * dag ved behov. Spillerommet sier hva som står igjen på slutten; dette
 * kortet sier om det blir trangt på veien.
 */
export function SaldoforlopKort({ forlop }: { forlop: Saldoforlop }) {
  const [apen, setApen] = useState(false);
  if (forlop.dager.length === 0) return null;

  const { laveste } = forlop;
  const underNull = laveste.saldo < 0 && laveste.dato !== null;

  return (
    <section aria-label="Saldoforløp" className={styles.kort}>
      <p className={underNull ? styles.varsel : styles.rolig}>
        <Icon name={underNull ? "clock" : "calendar-days"} size={16} />
        <span>
          {underNull ? (
            <>
              Saldoen går under null {kortDato(laveste.dato!)} ({kr(laveste.saldo)})
              {forlop.slutt >= 0 ? " før den tar seg opp igjen." : "."}
            </>
          ) : laveste.dato ? (
            <>
              Laveste saldo i perioden: <strong>{kr(laveste.saldo)}</strong>,{" "}
              {kortDato(laveste.dato)}.
            </>
          ) : (
            <>Saldoen går ikke under dagens nivå i perioden.</>
          )}
        </span>
      </p>

      <button
        type="button"
        className={styles.vis}
        aria-expanded={apen}
        onClick={() => setApen((a) => !a)}
      >
        <Icon name={apen ? "chevron-up" : "chevron-down"} size={14} />
        {apen ? "Skjul dag for dag" : "Vis dag for dag"}
      </button>

      {apen && (
        <ol className={styles.dager} aria-label="Dag for dag">
          {forlop.dager.map((d) => (
            <li
              key={d.dato}
              className={`${styles.dag} ${d.dato === laveste.dato ? styles.lavest : ""}`}
            >
              <span className={styles.dagDato}>{dato(d.dato)}</span>
              <span className={styles.dagPoster}>{d.poster.map((p) => p.name).join(", ")}</span>
              <span className={d.netto >= 0 ? styles.inn : styles.ut}>
                {d.netto >= 0 ? "+" : "−"}
                {kr(Math.abs(d.netto))}
              </span>
              <span className={d.saldoEtter < 0 ? styles.saldoNegativ : styles.saldo}>
                {kr(d.saldoEtter)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
