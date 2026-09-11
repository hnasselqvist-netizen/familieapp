import type { ReactNode } from "react";
import styles from "./Modal.module.css";

export interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Delt modal-atom — portert 1:1 fra dagens `const Modal` i index.html.
 *
 * **Reelt funn (Middagsplan v1, §Kontrolltårn-handoff, Issue #20):
 * manglet `role="dialog"`/tilgjengelig navn.** Oppdaget da `ActiveMealCard`
 * trengte en pålitelig måte å identifisere "et modal-kort er åpent" på i
 * e2e-tester — panelet var ren `<div>`, usynlig for skjermlesere og
 * rolle-baserte locators (`getByRole("dialog")`). Rettet her, ikke bare i
 * `ActiveMealCard`, siden dette er DET delte modal-atomet — retter
 * tilgjengeligheten for samtlige eksisterende bruk (`ShoppingGeneratorModal`,
 * `MealFeedbackModal`, `RecipeFormModal` m.fl.) samtidig, ingen visuell
 * endring.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
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
