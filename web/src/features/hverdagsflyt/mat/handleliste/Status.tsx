import type { StatusPlan } from "@domain/shopping/handlelisteStatus";
import styles from "./Innlegging.module.css";

/**
 * Utfallet av «Merk som fullført»/«Merk som ikke fullført» på én rad (Mat
 * #20, ordre 6908431056). Vises over listen, siden raden kan ha flyttet
 * seg mellom aktive og fullførte når svaret kommer.
 */
export interface StatusMelding {
  id: string;
  tekst: string;
  /**
   * Satt så lenge utfallet er ukjent: «Prøv igjen» leser bare statusen,
   * og raden er sperret. Lukkes ikke før det er avklart.
   */
  uavklart?: StatusPlan;
}

export function StatusMeldinger({
  meldinger,
  lagrer,
  onProvIgjen,
  onLukk,
}: {
  meldinger: readonly StatusMelding[];
  lagrer: ReadonlySet<string>;
  onProvIgjen: (plan: StatusPlan) => void;
  onLukk: (id: string) => void;
}) {
  return (
    <>
      {meldinger.map((m) => {
        const { uavklart } = m;
        return (
          <div key={m.id} className={styles.feil} role="alert" aria-label="Status">
            <p className={styles.feilTekst}>{m.tekst}</p>
            <div className={styles.knapper}>
              {uavklart ? (
                <button
                  type="button"
                  className={styles.knapp}
                  disabled={lagrer.has(m.id)}
                  onClick={() => onProvIgjen(uavklart)}
                >
                  {lagrer.has(m.id) ? "Sjekker …" : "Prøv igjen"}
                </button>
              ) : (
                <button type="button" className={styles.knapp} onClick={() => onLukk(m.id)}>
                  Lukk
                </button>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
