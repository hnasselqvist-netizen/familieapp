import type { MengdePlan } from "@domain/shopping/handlelisteMengde";
import styles from "./Innlegging.module.css";

/**
 * Manuell mengde på én rad (Mat #20, ordre 6914072575): et lokalt utkast
 * bundet til raden og mengden Helen så da hun begynte å redigere.
 */
export interface MengdeUtkast {
  /** Mengden slik den var da redigeringen begynte (normalisert). */
  foer: string;
  verdi: string;
}

export interface MengdeMelding {
  id: string;
  tekst: string;
  /** Satt så lenge utfallet er ukjent: «Sjekk» leser bare, lagring er sperret. */
  uavklart?: MengdePlan;
}

const vis = (m: string) => (m === "" ? "tom" : `«${m}»`);

export function MengdeFelt({
  navn,
  synlig,
  utkast,
  sperret,
  inputClassName,
  onEndre,
  onLagre,
  onForkast,
  onBehold,
}: {
  navn: string;
  /** Mengden slik raden vises nå. */
  synlig: string;
  utkast: MengdeUtkast | undefined;
  sperret: boolean;
  inputClassName?: string;
  onEndre: (verdi: string) => void;
  onLagre: () => void;
  onForkast: () => void;
  onBehold: () => void;
}) {
  const endretUnderveis = utkast !== undefined && utkast.foer !== synlig;
  return (
    <>
      <input
        value={utkast?.verdi ?? synlig}
        onChange={(e) => onEndre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && utkast) {
            e.preventDefault();
            onLagre();
          }
        }}
        disabled={sperret}
        placeholder="Mengde"
        aria-label={`Mengde for ${navn}`}
        autoComplete="off"
        className={inputClassName}
      />
      {utkast && (
        <div className={styles.knapper}>
          <button type="button" className={styles.knapp} disabled={sperret} onClick={onLagre}>
            Lagre mengde
          </button>
          <button type="button" className={styles.knapp} disabled={sperret} onClick={onForkast}>
            Angre
          </button>
        </div>
      )}
      {endretUnderveis && !sperret && (
        <div className={styles.feil} role="alert" aria-label={`Mengde endret for ${navn}`}>
          <p className={styles.feilTekst}>
            Mengden er endret på en annen enhet til {vis(synlig)} mens du redigerte.
          </p>
          <div className={styles.knapper}>
            <button type="button" className={styles.knapp} onClick={onForkast}>
              Bruk {vis(synlig)}
            </button>
            <button type="button" className={styles.knapp} onClick={onBehold}>
              Behold utkastet mitt
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function MengdeMeldinger({
  meldinger,
  lagrer,
  onSjekk,
  onLukk,
}: {
  meldinger: readonly MengdeMelding[];
  lagrer: ReadonlySet<string>;
  onSjekk: (plan: MengdePlan) => void;
  onLukk: (id: string) => void;
}) {
  return (
    <>
      {meldinger.map((m) => {
        const { uavklart } = m;
        return (
          <div key={m.id} className={styles.feil} role="alert" aria-label="Mengde">
            <p className={styles.feilTekst}>{m.tekst}</p>
            <div className={styles.knapper}>
              {uavklart ? (
                <button
                  type="button"
                  className={styles.knapp}
                  disabled={lagrer.has(m.id)}
                  onClick={() => onSjekk(uavklart)}
                >
                  {lagrer.has(m.id) ? "Sjekker …" : "Sjekk"}
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
