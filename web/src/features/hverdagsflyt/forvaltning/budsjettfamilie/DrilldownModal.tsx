import { Modal } from "@components/Modal";
import type { HendelseDrillDownRad } from "@domain/budsjettfamilie/budsjettfamilie";
import styles from "./DrilldownModal.module.css";

const fmt = (n: number) =>
  new Intl.NumberFormat("nb-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(n);
const fmtDate = (d: string) =>
  d ? new Date(d).toLocaleDateString("nb-NO", { day: "numeric", month: "short" }) : "";

export interface DrilldownModalProps {
  tittel: string;
  rader: HendelseDrillDownRad[];
  onClose: () => void;
}

/**
 * READ-ONLY port av `HendelseDrillDownModal` (§index.html linje 10936).
 * Viser hendelsene/kvitteringene bak et Faktisk-tall, men uten
 * `onVelgHendelse`/`onVelgKvittering` — korrigering er bevisst utenfor
 * denne sliven (§Issue #34, Kontrolltårn-beslutning 5815438614: "ingen
 * skriving til hendelser/receipts/rules i denne sliven").
 */
export function DrilldownModal({ tittel, rader, onClose }: DrilldownModalProps) {
  return (
    <Modal title={tittel} onClose={onClose}>
      {rader.length === 0 ? (
        <div className={styles.empty}>Ingen hendelser bidrar til dette tallet denne måneden.</div>
      ) : (
        <div className={styles.list}>
          {rader.map((r) => (
            <div key={r.hendelseId} className={styles.row}>
              <div className={styles.rowTop}>
                <span className={styles.tekst}>{r.tekst}</span>
                <span className={styles.belop}>{fmt(r.belop)}</span>
              </div>
              <div className={styles.meta}>
                {fmtDate(r.dato)}
                {r.eiere.length > 0 &&
                  " · " +
                    r.eiere
                      .map((e) => e.person + (e.prosent < 100 ? ` ${e.prosent}%` : ""))
                      .join(", ")}
              </div>
              <span
                className={`${styles.badge} ${r.erKvittering ? styles.badgeKvittering : r.erManuell ? styles.badgeManuell : ""}`}
              >
                {r.erKvittering
                  ? "Kvittering"
                  : r.erManuell
                    ? "Manuelt registrert"
                    : "Bankplassering"}
              </span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
