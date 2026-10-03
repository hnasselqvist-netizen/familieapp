import type React from "react";
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
  /** Korriger hendelsen bak raden (R3b-4). Kun satt når forsoningsporten er på. */
  onVelgHendelse?: (hendelseId: string) => void;
  /** Rediger kvitteringen bak raden (R3b-4). Kun satt når forsoningsporten er på. */
  onVelgKvittering?: (receiptId: string) => void;
}

/**
 * Port av `HendelseDrillDownModal` (§index.html linje 10936). Viser
 * hendelsene/kvitteringene bak et Faktisk-tall. Uten `onVelgHendelse`/
 * `onVelgKvittering` er den ren visning (som før R3b-4); med dem — kun
 * når forsoningsporten er på (`PostDrilldown`) — er radene klikkbare som
 * i legacy: bankplassering/manuell → korriger, kvittering → rediger.
 */
export function DrilldownModal({
  tittel,
  rader,
  onClose,
  onVelgHendelse,
  onVelgKvittering,
}: DrilldownModalProps) {
  return (
    <Modal title={tittel} onClose={onClose}>
      {rader.length === 0 ? (
        <div className={styles.empty}>Ingen hendelser bidrar til dette tallet denne måneden.</div>
      ) : (
        <div className={styles.list}>
          {rader.map((r) => {
            const klikkbar = r.erKvittering
              ? !!(onVelgKvittering && r.receiptId)
              : !!onVelgHendelse;
            const velg = () => {
              if (r.erKvittering) {
                if (onVelgKvittering && r.receiptId) onVelgKvittering(r.receiptId);
              } else if (onVelgHendelse) onVelgHendelse(r.hendelseId);
            };
            return (
              <div
                key={r.hendelseId}
                {...(klikkbar
                  ? {
                      role: "button",
                      tabIndex: 0,
                      onClick: velg,
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          velg();
                        }
                      },
                    }
                  : {})}
                className={klikkbar ? `${styles.row} ${styles.rowKlikkbar}` : styles.row}
              >
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
                {klikkbar && (
                  <span className={styles.hint}>
                    {r.erKvittering
                      ? "Trykk for å redigere kvitteringen ›"
                      : "Trykk for å korrigere ›"}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
