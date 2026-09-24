import { useState } from "react";
import { Button } from "@components/Button";
import { Modal } from "@components/Modal";
import styles from "./ConfirmModal.module.css";
import inputStyles from "./FordelArModal.module.css";

export interface FordelArModalProps {
  /** "kostnad" | "inntekt" | "sparing" — kun for tekstvalg, se `label`. */
  typeLabel: string;
  postName: string;
  onClose: () => void;
  onFordel: (totalBelop: number) => void;
}

/**
 * "Fordel år"-modalen — skriv inn et totalbeløp, fordeles jevnt på 12
 * måneder med avrundingsdifferanse på desember. Speiler §index.html
 * linje 14345–14370. Kun for poster UTEN detaljer (knappen som åpner
 * denne er skjult når posten har detaljer, se `PostTable`).
 */
export function FordelArModal({ typeLabel, postName, onClose, onFordel }: FordelArModalProps) {
  const [verdi, setVerdi] = useState("");
  return (
    <Modal title={`Fordel ${typeLabel} — ${postName}`} onClose={onClose}>
      <div className={styles.body}>
        Skriv inn total {typeLabel} for hele året. Beløpet fordeles jevnt på 12 måneder, med
        eventuell avrundingsdifferanse lagt på desember.
      </div>
      <input
        type="number"
        autoFocus
        value={verdi}
        onChange={(e) => setVerdi(e.target.value)}
        onFocus={(e) => e.target.select()}
        placeholder={`Total ${typeLabel}`}
        className={inputStyles.input}
      />
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onClose}>
          Avbryt
        </Button>
        <Button onClick={() => onFordel(Number.parseFloat(verdi) || 0)}>Fordel</Button>
      </div>
    </Modal>
  );
}
