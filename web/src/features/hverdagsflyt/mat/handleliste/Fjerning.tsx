import type { FjernPlan } from "@domain/shopping/handlelisteFjerning";
import styles from "./Innlegging.module.css";

/**
 * Utfallet av «Fjern» på én rad (Mat #20, ordre 6903150917). Vises over
 * listen, siden raden kan være borte når svaret kommer.
 */
export interface FjernMelding {
  id: string;
  tekst: string;
  /** Bare ved ukjent utfall: samme grunnlag kan sendes på nytt. */
  plan?: FjernPlan;
}

export function FjernMeldinger({
  meldinger,
  fjerner,
  onProvIgjen,
  onLukk,
}: {
  meldinger: readonly FjernMelding[];
  fjerner: ReadonlySet<string>;
  onProvIgjen: (m: FjernMelding) => void;
  onLukk: (id: string) => void;
}) {
  return (
    <>
      {meldinger.map((m) => (
        <div key={m.id} className={styles.feil} role="alert" aria-label="Fjern">
          <p className={styles.feilTekst}>{m.tekst}</p>
          <div className={styles.knapper}>
            {m.plan && (
              <button
                type="button"
                className={styles.knapp}
                disabled={fjerner.has(m.id)}
                onClick={() => onProvIgjen(m)}
              >
                Prøv igjen
              </button>
            )}
            <button
              type="button"
              className={styles.knapp}
              disabled={fjerner.has(m.id)}
              onClick={() => onLukk(m.id)}
            >
              Lukk
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
