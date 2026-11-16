import type { FjernPlan } from "@domain/shopping/handlelisteFjerning";
import styles from "./Innlegging.module.css";

/**
 * Utfallet av «Fjern» på én rad (Mat #20, ordre 6903150917). Vises over
 * listen, siden raden kan være borte når svaret kommer.
 */
export interface FjernMelding {
  id: string;
  tekst: string;
  /**
   * Satt så lenge utfallet er ukjent (review 5913786153 pkt. 2): «Prøv
   * igjen» sjekker skrivefritt om posten finnes, og «Fjern» på raden er
   * sperret. Lukkes ikke før det er avklart.
   */
  uavklart?: FjernPlan;
}

export function FjernMeldinger({
  meldinger,
  fjerner,
  onProvIgjen,
  onLukk,
}: {
  meldinger: readonly FjernMelding[];
  fjerner: ReadonlySet<string>;
  onProvIgjen: (plan: FjernPlan) => void;
  onLukk: (id: string) => void;
}) {
  return (
    <>
      {meldinger.map((m) => (
        <div key={m.id} className={styles.feil} role="alert" aria-label="Fjern">
          <p className={styles.feilTekst}>{m.tekst}</p>
          <div className={styles.knapper}>
            {m.uavklart ? (
              <button
                type="button"
                className={styles.knapp}
                disabled={fjerner.has(m.id)}
                onClick={() => m.uavklart && onProvIgjen(m.uavklart)}
              >
                {fjerner.has(m.id) ? "Sjekker …" : "Prøv igjen"}
              </button>
            ) : (
              <button type="button" className={styles.knapp} onClick={() => onLukk(m.id)}>
                Lukk
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
