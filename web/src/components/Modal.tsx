import type { ReactNode } from "react";
import styles from "./Modal.module.css";

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Delt modal-atom — portert 1:1 fra dagens `const Modal` i index.html. */
export function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button type="button" onClick={onClose} className={styles.closeButton} aria-label="Lukk">
            ✕
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
