import { useId } from "react";
import styles from "./KontoVilkarValg.module.css";

export interface KontoVilkarValgProps {
  /** Visningsnavnet til kontoen betalingen er gjort fra (f.eks. «Helen»). */
  kontoNavn: string;
  bareKonto: boolean;
  onChange: (bareKonto: boolean) => void;
}

/**
 * Valget under «Lær denne koblingen» (#59, avanserte regler): skal regelen
 * gjelde betalinger fra alle kontoer, eller bare fra kontoen denne betalingen
 * er gjort fra? «Bare fra …» gir en sammensatt regel der både teksten og
 * kontoen må stemme. Standard er «alle kontoer», som før.
 */
export function KontoVilkarValg({ kontoNavn, bareKonto, onChange }: KontoVilkarValgProps) {
  const navn = useId();
  return (
    <fieldset className={styles.valg}>
      <legend className={styles.tittel}>Hvilke betalinger skal regelen gjelde?</legend>
      <div className={styles.knapper}>
        <label className={bareKonto ? styles.knapp : styles.knappAktiv}>
          <input type="radio" name={navn} checked={!bareKonto} onChange={() => onChange(false)} />
          Fra alle kontoer
        </label>
        <label className={bareKonto ? styles.knappAktiv : styles.knapp}>
          <input type="radio" name={navn} checked={bareKonto} onChange={() => onChange(true)} />
          Bare fra {kontoNavn}
        </label>
      </div>
      {bareKonto && (
        <p className={styles.hint}>Regelen treffer bare når både teksten og kontoen stemmer.</p>
      )}
    </fieldset>
  );
}
