import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "children"
> {
  children: ReactNode;
  /**
   * `primary` — solid `--g-green`, hvit tekst. Speiler dagens
   * `.saveButton` i `RecipeFormModal.tsx`/`QuickAddRecipeModal.tsx`.
   * `secondary` — varm materialflate (`--g-bg`), `--g-text-soft`-tekst,
   * `--g-line`-kant. Speiler dagens `.cancelButton` i
   * `MealFeedbackModal.tsx`. `destructive` — terrakotta-familien
   * (§docs/produktfasit/visuelt-designsystem.md §5), ny i denne
   * runden — ingen eksisterende bruk trengte den før nå. Standard
   * `primary`.
   */
  variant?: "primary" | "secondary" | "destructive";
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
  /**
   * `"compact"` (§Kontrolltårn-review, PR #26, design-review runde 3, §6:
   * "Lag en eksplisitt kompakt Button-variant dersom det gir et ryddig
   * system fremfor per-skjerm overstyring") — lavere høyde/mindre skrift
   * enn dagens 44px standardhandling, for skjermer som trenger flere
   * handlinger på samme headerlinje som tittelen (først i bruk på
   * Middagsplan, §PlanScreen.tsx). Beholder ≥36px berøringshøyde — en
   * ekte, trykkbar knapp, ikke en tekstlenke. Standard `"default"`
   * (dagens 44px-knapp, uendret for alle eksisterende kallesteder).
   */
  size?: "default" | "compact";
}

/**
 * Delt knapp-atom — samler det som allerede var konsistent, spredt
 * på tvers av Mat-skjermenes egne `.saveButton`/`.cancelButton`/
 * `.generatorButton`-klasser (§Kontrolltårn-handoff, Issue #20) i ÉN
 * komponent. Bruker nå det låste `--g-*`-designsystemet
 * (§docs/produktfasit/visuelt-designsystem.md, §Kontrolltårn-review,
 * PR #26) — samme farger på tvers av Gangen og Kjøkkenet. Minimum
 * ca. 44px berøringshøyde per designsystemets §5.
 *
 * `type="button"` alltid — ingen eksisterende bruk i Mat er en ekte
 * skjema-submit (alle skjermer/modaler bygger sitt eget lagre-kall via
 * `onClick`), så det er bevisst ikke eksponert som en prop her.
 */
export function Button({
  children,
  variant = "primary",
  size = "default",
  loading = false,
  disabled,
  className,
  ...rest
}: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? styles.primary
      : variant === "destructive"
        ? styles.destructive
        : styles.secondary;
  const sizeClass = size === "compact" ? styles.compact : "";
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={[styles.button, variantClass, sizeClass, className].filter(Boolean).join(" ")}
      {...rest}
      aria-busy={loading}
    >
      {loading && <span className={styles.spinner} aria-hidden="true" />}
      {children}
    </button>
  );
}
