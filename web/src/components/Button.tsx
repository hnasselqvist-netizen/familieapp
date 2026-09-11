import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "children"
> {
  children: ReactNode;
  /**
   * `primary` — solid `--color-hazel`, hvit tekst. Speiler dagens
   * `.saveButton` i `RecipeFormModal.tsx`/`QuickAddRecipeModal.tsx`.
   * `secondary` — hvit/kantet, `--color-stone`-tekst. Speiler dagens
   * `.cancelButton` i `MealFeedbackModal.tsx`. Standard `primary`.
   */
  variant?: "primary" | "secondary";
  /**
   * Aktiv async-handling. Tvinger `disabled` (kan ikke trykkes på nytt
   * mens forrige kall pågår, samme prinsipp som dagens `disabled={saving}`
   * i `MealFeedbackModal.tsx`) og viser en liten spinner ved siden av
   * teksten — den eneste faktisk NYE visuelle tilstanden i denne skiven,
   * resten av knappen er en samling av mønstre som allerede fantes flere
   * steder. Eksponeres tilgjengelig via `aria-busy` på selve knappen
   * (§Kontrolltårn-review, PR #22) — spinneren er fortsatt kun dekorativ
   * (`aria-hidden`), skjermleser skal ikke måtte tolke et visuelt ikon.
   */
  loading?: boolean;
}

/**
 * Delt knapp-atom — samler det som allerede var konsistent, spredt
 * på tvers av Mat-skjermenes egne `.saveButton`/`.cancelButton`/
 * `.generatorButton`-klasser (§Kontrolltårn-handoff, Issue #20) i ÉN
 * komponent, i stedet for at hver skjerm definerer sin egen kopi. Ingen
 * ny Mat-palett eller visuell identitet — kun eksisterende
 * `--color-*`-tokens som allerede var i bruk.
 *
 * `type="button"` alltid — ingen eksisterende bruk i Mat er en ekte
 * skjema-submit (alle skjermer/modaler bygger sitt eget lagre-kall via
 * `onClick`), så det er bevisst ikke eksponert som en prop her.
 */
export function Button({
  children,
  variant = "primary",
  loading = false,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const variantClass = variant === "primary" ? styles.primary : styles.secondary;
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={
        className
          ? `${styles.button} ${variantClass} ${className}`
          : `${styles.button} ${variantClass}`
      }
      {...rest}
      aria-busy={loading}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}
