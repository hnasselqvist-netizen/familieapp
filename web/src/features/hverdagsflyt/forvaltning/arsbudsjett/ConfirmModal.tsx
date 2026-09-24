import type { ReactNode } from "react";
import { Button } from "@components/Button";
import { Modal } from "@components/Modal";
import styles from "./ConfirmModal.module.css";

export interface ConfirmModalProps {
  title: string;
  body: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Delt bekreftelsesmodal — DRY-konsolidering av de tre strukturelt like
 * confirm/avbryt-dialogene i legacy sin `ArsbudsjettScreen` (§index.html
 * linje 14372–14474: "Bruk samme beløp resten av året", "Fjerne
 * detaljnivå?", "Bygge opp detaljbudsjettet på nytt?", "Hent manglende
 * detaljer?") — samme mønster som `PostMetaModal` sin konsolidering av
 * tre near-identiske meta-modaler i Budsjett-familien-sliven. Ren
 * DRY-endring, ingen funksjonell forskjell fra de fire separate
 * legacy-dialogene.
 */
export function ConfirmModal({
  title,
  body,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmModalProps) {
  return (
    <Modal title={title} onClose={onCancel}>
      <div className={styles.body}>{body}</div>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
}
