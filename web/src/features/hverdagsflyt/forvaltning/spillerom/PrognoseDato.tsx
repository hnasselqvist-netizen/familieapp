import { useState } from "react";
import { Icon } from "@components/Icon";
import { effektivPrognosedato, erPrognosedatoPassert } from "@domain/liquidity/liquidity";
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
 *
 * Funn H (#59): uten lagret dato vises standarddatoen generatoren og
 * Spillerom faktisk bruker (`effektivPrognosedato`), rolig merket
 * «standard», i stedet for «Velg dato». Å åpne og forlate feltet uten å
 * endre noe lagrer ingenting (verken standarddatoen eller et forslag for en
 * passert dato); ✓ eller Enter bekrefter forslaget eksplisitt.
 */
export function PrognoseDato({ prognosisDate, onSave, idag = new Date() }: PrognoseDatoProps) {
  const [redigerer, setRedigerer] = useState(false);
  const [verdi, setVerdi] = useState("");
  const [startverdi, setStartverdi] = useState("");
  const passert = erPrognosedatoPassert(prognosisDate, idag);
  const prognose = effektivPrognosedato(prognosisDate, idag);
  const standard = effektivPrognosedato("", idag).dato;

  const start = () => {
    const forslag = passert || !prognosisDate ? standard : prognosisDate;
    setVerdi(forslag);
    setStartverdi(forslag);
    setRedigerer(true);
  };

  /**
   * `bekreftet`: ✓ eller Enter — et eksplisitt valg, også av forslaget.
   * Ellers (feltet forlater fokus): lagre bare når brukeren har endret
   * verdien siden åpning.
   */
  const lagre = (bekreftet: boolean) => {
    const gyldig = !!verdi && /^\d{4}-\d{2}-\d{2}$/.test(verdi);
    if (gyldig && verdi !== prognosisDate && (bekreftet || verdi !== startverdi)) onSave(verdi);
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
          onBlur={() => lagre(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") lagre(true);
            if (e.key === "Escape") setRedigerer(false);
          }}
          className={styles.input}
        />
        <button
          type="button"
          // mousedown før blur: lagre her, så klikket ikke går tapt når feltet lukkes.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => lagre(true)}
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
      aria-label={`Endre prognosedato, nå ${fmtDate(prognose.dato)}${prognose.standard ? " (standard, ikke lagret)" : ""}${passert ? " (passert)" : ""}`}
      onClick={start}
    >
      {fmtDate(prognose.dato)}
      {prognose.standard && <span className={styles.standard}> · standard</span>}
      {passert && <span className={styles.passert}> · passert</span>}
    </button>
  );
}
