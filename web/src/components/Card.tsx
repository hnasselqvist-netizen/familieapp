import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import styles from "./Card.module.css";

export interface CardProps {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
  /** Venstre aksentkant i valgfri farge — matcher dagens `accent`-prop. */
  accent?: string;
  /**
   * `warm` (standard) — Hverdagsflyt-møbelet: varm overflate
   * (`--g-furniture`), `--g-line`-kant, myk radius, diskret skygge
   * (§docs/produktfasit/visuelt-designsystem.md §6, §Kontrolltårn-
   * review, PR #26). `neutral` — den forrige, nøytrale hvite/`--color-*`-
   * flaten, for skjermer som eksplisitt trenger en annen semantisk
   * flate enn et Hverdagsflyt-rom (ingen slik bruk finnes i dag — kun
   * eksponert fordi designsystemet eksplisitt ber om et eksplisitt valg
   * fremfor at "nøytralt" er standard).
   */
  variant?: "warm" | "neutral";
}

/**
 * Delt kort-atom — opprinnelig 1:1-port fra dagens `const Card` i
 * index.html, nå oppgradert til det låste designsystemets standard
 * Hverdagsflyt-møbel som default (§Kontrolltårn-review, PR #26).
 */
export function Card({ children, style, onClick, accent, variant = "warm" }: CardProps) {
  const variantClass = variant === "warm" ? styles.warm : styles.neutral;
  return (
    <div
      onClick={onClick}
      className={`${styles.card} ${variantClass}`}
      style={{
        borderLeft: accent ? `3px solid ${accent}` : undefined,
        cursor: onClick ? "pointer" : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
