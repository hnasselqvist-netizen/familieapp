import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@components/Icon";
import { RoomHeader } from "@components/RoomHeader";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import type { Liquidity } from "@app-types/liquidity";
import {
  type Niva,
  budsjettPerNiva,
  finnNesteStorreUtbetaling,
  spilleromOversikt,
} from "@domain/liquidity/oversikt";
import { okonomiLenke } from "../okonomi/okonomiLenke";
import styles from "./SpilleromOversikt.module.css";

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
const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);

const NIVAER: { niva: Niva; label: string; klasse: string | undefined }[] = [
  { niva: "beskytte", label: "Beskytte", klasse: styles.nivaBeskytte },
  { niva: "opprettholde", label: "Opprettholde", klasse: styles.nivaOpprettholde },
  { niva: "velge", label: "Velge", klasse: styles.nivaVelge },
];

export interface SpilleromOversiktViewProps {
  liquidity: Liquidity;
  budgetGroups: BudsjettGruppe[];
  /** Måneden budsjettet leses for (legacy: appens valgte måned). */
  month: number;
  /** ISO-dato for «i dag» (prognosens standard sluttdato). */
  idag: string;
  onSaveSaldo: (saldo: number) => void;
}

/**
 * Spillerom-dashbordet (§Issue #34, pre-cutover 1), portert fra legacy
 * `ForvaltningScreen` sin «Spillerom»-fane (`index.html` ~5338–5428): tre
 * beslutningskort, «muligheter», neste større planlagte utbetaling og
 * fordeling per nivå. Migrering, ikke redesign — samme innhold og tekster i
 * Hverdagsflyt-uttrykk.
 *
 * Avvik: «Bundet» åpner prognosedetaljene. Legacy går til en «poster»-
 * fane som ikke finnes (tom visning).
 */
export function SpilleromOversiktView({
  liquidity,
  budgetGroups,
  month,
  idag,
  onSaveSaldo,
}: SpilleromOversiktViewProps) {
  const o = spilleromOversikt(liquidity, idag);
  const neste = finnNesteStorreUtbetaling(budgetGroups, month);
  const [redigerer, setRedigerer] = useState(false);
  const [saldoTekst, setSaldoTekst] = useState("");
  const tone =
    o.harSaldo && o.harPoster ? (o.spillerom >= 0 ? styles.positiv : styles.negativ) : "";

  const lagreSaldo = () => {
    onSaveSaldo(parseFloat(saldoTekst) || 0);
    setRedigerer(false);
  };

  return (
    <div>
      <RoomHeader eyebrow="FORVALTNING" title="Spillerom" description="Oversikt" />

      <div className={styles.kort3}>
        <div className={styles.kort}>
          <span className={styles.kortTittel}>Disponibelt nå</span>
          {redigerer ? (
            <input
              type="number"
              inputMode="decimal"
              enterKeyHint="done"
              aria-label="Disponibelt nå"
              className={styles.saldoFelt}
              value={saldoTekst}
              autoFocus
              onFocus={(e) => e.target.select()}
              onChange={(e) => setSaldoTekst(e.target.value)}
              onBlur={lagreSaldo}
              onKeyDown={(e) => {
                if (e.key === "Enter") lagreSaldo();
              }}
            />
          ) : (
            <button
              type="button"
              className={styles.kortKnapp}
              aria-label={o.harSaldo ? "Endre disponibelt beløp" : "Sett disponibelt beløp"}
              onClick={() => {
                setSaldoTekst(String(liquidity.saldo || ""));
                setRedigerer(true);
              }}
            >
              <span className={styles.kortTall}>{o.harSaldo ? fmt(o.saldo) : "–"}</span>
            </button>
          )}
          <span className={styles.kortHint}>
            {redigerer
              ? "Enter for å lagre"
              : o.harSaldo
                ? "trykk for å endre"
                : "trykk for å sette"}
          </span>
        </div>
        <Link to="/forvaltning/spillerom" className={styles.kort}>
          <span className={styles.kortTittel}>Bundet</span>
          <span className={`${styles.kortTall} ${o.bundet > 0 ? styles.negativTekst : ""}`}>
            {o.harPoster ? fmt(o.bundet) : "–"}
          </span>
          <span className={styles.kortHint}>trykk for poster</span>
        </Link>
        <Link to="/forvaltning/spillerom" className={`${styles.kort} ${tone}`}>
          <span className={styles.kortTittel}>Spillerom</span>
          <span className={styles.kortTall}>
            {o.harSaldo && o.harPoster ? fmt(o.spillerom) : "–"}
          </span>
          <span className={styles.kortHint}>trykk for detaljer</span>
        </Link>
      </div>

      {o.muligheter.length > 0 && (
        <ul className={styles.muligheter} aria-label="Muligheter">
          {o.muligheter.map((m) => (
            <li
              key={m.tekst}
              className={m.type === "positiv" ? styles.mulighetPositiv : styles.mulighet}
            >
              <span aria-hidden>{m.type === "positiv" ? "✓" : "ℹ"}</span>
              <span>{m.tekst}</span>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.neste}>
        <Icon name="calendar" size={16} />
        <div>
          <div className={styles.nesteTittel}>Neste større planlagte utbetaling</div>
          {neste ? (
            <div>
              <strong>{neste.navn}</strong> — {fmt(neste.belop)} i {MONTHS[neste.maanedIndex]}
            </div>
          ) : (
            <div>Ingen større planlagte utbetalinger.</div>
          )}
        </div>
      </div>

      <div className={styles.seksjonTittel}>Fordeling</div>
      <div className={styles.kort3}>
        {NIVAER.map(({ niva, label, klasse }) => (
          <div key={niva} className={`${styles.kort} ${styles.nivaKort}`}>
            <span className={styles.kortTittel}>{label}</span>
            <span className={`${styles.kortTall} ${klasse}`}>
              {fmt(budsjettPerNiva(budgetGroups, niva, month))}
            </span>
          </div>
        ))}
      </div>

      <Link to={okonomiLenke("kostnader")} className={styles.lenke}>
        Se budsjettdetaljer →
      </Link>
    </div>
  );
}
