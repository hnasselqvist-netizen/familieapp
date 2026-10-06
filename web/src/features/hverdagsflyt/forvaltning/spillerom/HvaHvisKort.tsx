import { useState } from "react";
import { Button } from "@components/Button";
import { Icon } from "@components/Icon";
import { hvaHvis } from "@domain/liquidity/hvaHvis";
import type { LiquidityPost } from "@app-types/liquidity";
import styles from "./HvaHvisKort.module.css";

const kr = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);
const kortDato = (d: string) =>
  new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" });

export interface HvaHvisKortProps {
  saldo: number;
  /** De aktive prognosepostene i perioden (samme liste som rommet bruker). */
  poster: readonly LiquidityPost[];
  /** ISO-dato for i dag. */
  idag: string;
  prognosisDate: string;
  /** Lagrer scenarioet som en vanlig «Ekstra»-post — bare når brukeren ber om det. */
  onLeggInn: (post: Omit<LiquidityPost, "id" | "kilde">) => void;
}

/**
 * «Hva hvis…?» i Spillerom (#59): prøv et beløp og se hva det gjør med
 * spillerommet og den laveste saldoen før prognosedatoen — uten å lagre
 * noe. Appen forbereder beslutningen; brukeren tar den («Legg inn som
 * post» er et eget, bevisst valg).
 */
export function HvaHvisKort({ saldo, poster, idag, prognosisDate, onLeggInn }: HvaHvisKortProps) {
  const [apen, setApen] = useState(false);
  const [retning, setRetning] = useState<"ut" | "inn">("ut");
  const [belopTekst, setBelopTekst] = useState("");
  const [dato, setDato] = useState(idag);
  const [navn, setNavn] = useState("");

  const belop = Number.parseFloat(belopTekst.replace(/\s/g, "").replace(",", "."));
  const gyldig = Number.isFinite(belop) && belop > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dato);
  const r = gyldig ? hvaHvis(saldo, poster, idag, prognosisDate, { belop, retning, dato }) : null;

  const nullstill = () => {
    setBelopTekst("");
    setNavn("");
    setDato(idag);
    setRetning("ut");
  };

  if (!apen) {
    return (
      <button type="button" className={styles.apne} onClick={() => setApen(true)}>
        <Icon name="sparkles" size={14} />
        Hva hvis…?
      </button>
    );
  }

  return (
    <section aria-label="Hva hvis" className={styles.kort}>
      <div className={styles.hode}>
        <h2 className={styles.tittel}>Hva hvis…?</h2>
        <button
          type="button"
          className={styles.lukk}
          aria-label="Lukk hva hvis"
          onClick={() => {
            nullstill();
            setApen(false);
          }}
        >
          <Icon name="x" size={14} />
        </button>
      </div>

      <div className={styles.valg} role="radiogroup" aria-label="Retning">
        {(
          [
            ["ut", "Vi bruker"],
            ["inn", "Vi får inn"],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={retning === v}
            className={retning === v ? styles.valgt : styles.ikkeValgt}
            onClick={() => setRetning(v)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.felter}>
        <label className={styles.felt}>
          <span>Beløp</span>
          <input
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={belopTekst}
            onChange={(e) => setBelopTekst(e.target.value)}
          />
        </label>
        <label className={styles.felt}>
          <span>Dato</span>
          <input type="date" value={dato} onChange={(e) => setDato(e.target.value)} />
        </label>
      </div>

      {r && (
        <div className={styles.svar} aria-live="polite">
          {r.utenforPerioden ? (
            <p>
              Datoen ligger utenfor prognosen (til {kortDato(prognosisDate)}) og endrer ikke
              spillerommet.
            </p>
          ) : (
            <>
              <p>
                Spillerommet blir <strong>{kr(r.etter.slutt)}</strong>{" "}
                <span className={styles.endring}>
                  ({r.endring >= 0 ? "+" : "−"}
                  {kr(Math.abs(r.endring))})
                </span>
              </p>
              {r.etter.laveste.saldo < 0 && r.etter.laveste.dato ? (
                <p className={styles.varsel}>
                  <Icon name="clock" size={14} />
                  Saldoen går under null {kortDato(r.etter.laveste.dato)} (
                  {kr(r.etter.laveste.saldo)}).
                </p>
              ) : (
                <p className={styles.rolig}>
                  Laveste saldo i perioden: {kr(r.etter.laveste.saldo)}
                  {r.etter.laveste.dato ? `, ${kortDato(r.etter.laveste.dato)}` : ""}.
                </p>
              )}
            </>
          )}

          <label className={styles.felt}>
            <span>Hva gjelder det? (valgfritt)</span>
            <input
              type="text"
              placeholder="F.eks. sykkel"
              value={navn}
              onChange={(e) => setNavn(e.target.value)}
            />
          </label>
          <Button
            size="compact"
            variant="secondary"
            onClick={() => {
              onLeggInn({
                name: navn.trim() || (retning === "ut" ? "Planlagt kjøp" : "Ekstra inntekt"),
                amount: belop,
                direction: retning === "inn" ? "in" : "out",
                date: dato,
                type: retning === "inn" ? "inn" : "extra",
              });
              nullstill();
              setApen(false);
            }}
          >
            Legg inn som post
          </Button>
        </div>
      )}
    </section>
  );
}
