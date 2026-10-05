import { useState } from "react";
import { Icon } from "@components/Icon";
import { beregnStandardPrognosisDate, erPrognosedatoPassert } from "@domain/liquidity/liquidity";
import styles from "./SpilleromScreen.module.css";

const fmtDate = (d: string) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) : "";

export interface PrognoseDatoProps {
  /** Lagret prognosedato (ISO), eller tom. */
  prognosisDate: string;
  onSave: (prognosisDate: string) => void;
  /** «I dag» — injisert for testbarhet. */
  idag?: Date;
}

/**
 * «Prognose frem til» med redigering (Forvaltning produktfase, #59 —
 * produksjonsfeil 6001944213: datoen «hoppet tilbake til 31. august»).
 *
 * Rotårsak: datoen ble bare lagret via den lille ✓-knappen. Å velge dato i
 * telefonens datovelger og trykke «Ferdig», eller å trykke et annet sted,
 * lagret ingenting — feltet viste da igjen den lagrede (gamle) datoen.
 * Nå lagres et gyldig, endret valg også når feltet forlater fokus og ved
 * Enter. Datovelgeren skriver bare når brukeren er ferdig, ikke for hvert
 * hjulsteg.
 *
 * En lagret dato som allerede er passert vises som «passert», og
 * redigeringen starter da på neste lønningsdag i stedet for den gamle
 * datoen. Ingenting lagres før brukeren selv velger.
 */
export function PrognoseDato({ prognosisDate, onSave, idag = new Date() }: PrognoseDatoProps) {
  const [redigerer, setRedigerer] = useState(false);
  const [verdi, setVerdi] = useState("");
  const passert = erPrognosedatoPassert(prognosisDate, idag);

  const start = () => {
    setVerdi(passert || !prognosisDate ? beregnStandardPrognosisDate(idag) : prognosisDate);
    setRedigerer(true);
  };

  const lagre = () => {
    if (verdi && /^\d{4}-\d{2}-\d{2}$/.test(verdi) && verdi !== prognosisDate) onSave(verdi);
    setRedigerer(false);
  };

  if (redigerer) {
    return (
      <div className={styles.editRow}>
        <input
          type="date"
          autoFocus
          aria-label="Prognose frem til"
          value={verdi}
          onChange={(e) => setVerdi(e.target.value)}
          onBlur={lagre}
          onKeyDown={(e) => {
            if (e.key === "Enter") lagre();
            if (e.key === "Escape") setRedigerer(false);
          }}
          className={styles.input}
        />
        <button
          type="button"
          // mousedown før blur: lagre her, så klikket ikke går tapt når feltet lukkes.
          onMouseDown={(e) => e.preventDefault()}
          onClick={lagre}
          className={styles.iconButton}
          aria-label="Lagre dato"
        >
          <Icon name="check" size={16} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={styles.prognosisDateButton}
      aria-label={`Endre prognosedato, nå ${prognosisDate ? fmtDate(prognosisDate) : "ikke satt"}${passert ? " (passert)" : ""}`}
      onClick={start}
    >
      {prognosisDate ? fmtDate(prognosisDate) : "Velg dato"}
      {passert && <span className={styles.passert}> · passert</span>}
    </button>
  );
}
