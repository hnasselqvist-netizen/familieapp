import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import styles from "./Card.module.css";

export interface CardProps {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: MouseEventHandler<HTMLDivElement>;
  /** Venstre aksentkant i valgfri farge — matcher dagens `accent`-prop. */
  accent?: string;
}

/** Delt kort-atom — portert 1:1 fra dagens `const Card` i index.html. */
export function Card({ children, style, onClick, accent }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={styles.card}
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
