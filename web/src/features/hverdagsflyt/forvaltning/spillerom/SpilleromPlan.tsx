import { Link } from "react-router-dom";
import { Icon } from "@components/Icon";
import type { BudsjettGruppe } from "@app-types/budsjettfamilie";
import {
  type Mulighet,
  type Niva,
  budsjettPerNiva,
  finnNesteStorreUtbetaling,
} from "@domain/liquidity/oversikt";
import { okonomiLenke } from "../okonomi/okonomiLenke";
import styles from "./SpilleromRom.module.css";

const MAANEDER = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
];
const kr = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);

const NIVAER: { niva: Niva; label: string }[] = [
  { niva: "beskytte", label: "Beskytte" },
  { niva: "opprettholde", label: "Opprettholde" },
  { niva: "velge", label: "Velge" },
];

/** Muligheter — rolige linjer under hodet (legacy-dashbordets ordlyd). */
export function SpilleromMuligheter({ muligheter }: { muligheter: readonly Mulighet[] }) {
  if (muligheter.length === 0) return null;
  return (
    <ul className={styles.muligheter} aria-label="Muligheter">
      {muligheter.map((m) => (
        <li
          key={m.tekst}
          className={m.type === "positiv" ? styles.mulighetPositiv : styles.mulighet}
        >
          <Icon
            name={m.type === "positiv" ? "circle-check-big" : "circle-question-mark"}
            size={14}
          />
          <span>{m.tekst}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * «Neste større planlagte utbetaling» (låst i designboken §2m: én
 * informasjonslinje i Spillerom) og budsjettets fordeling per nivå,
 * flyttet hit fra den tidligere Spillerom-oversikten.
 */
export function SpilleromPlan({
  budgetGroups,
  month,
}: {
  budgetGroups: readonly BudsjettGruppe[];
  month: number;
}) {
  const neste = finnNesteStorreUtbetaling(budgetGroups, month);
  return (
    <>
      <div className={styles.neste}>
        <Icon name="calendar" size={16} />
        <div>
          <div className={styles.nesteTittel}>Neste større planlagte utbetaling</div>
          {neste ? (
            <div>
              <strong>{neste.navn}</strong> — {kr(neste.belop)} i {MAANEDER[neste.maanedIndex]}
            </div>
          ) : (
            <div>Ingen større planlagte utbetalinger.</div>
          )}
        </div>
      </div>

      <section aria-label="Fordeling per nivå" className={styles.fordeling}>
        <h2 className={styles.seksjonTittel}>Budsjettet denne måneden</h2>
        <dl className={styles.nivaer}>
          {NIVAER.map(({ niva, label }) => (
            <div key={niva}>
              <dt>{label}</dt>
              <dd>{kr(budsjettPerNiva(budgetGroups, niva, month))}</dd>
            </div>
          ))}
        </dl>
        <Link to={okonomiLenke("kostnader")} className={styles.lenke}>
          Se budsjettdetaljer →
        </Link>
      </section>
    </>
  );
}
