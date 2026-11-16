import type { MengdePlan } from "@domain/shopping/handlelisteMengde";
import styles from "./Innlegging.module.css";

/**
 * Manuell mengde på én rad (Mat #20, ordre 6914072575): et lokalt utkast
 * bundet til raden og mengden Helen så da hun begynte å redigere.
 */
export interface MengdeUtkast {
  /**
   * Radidentiteten utkastet ble skrevet for (review 5919852371 pkt. 1):
   * frosset når utkastet opprettes, så det aldri kan lagres på en annen
   * vare som er satt inn under samme nøkkel.
   */
  navn: string;
  itemId: string | null;
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
  itemId,
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
  itemId: string | null;
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
  // Utkastet hører til en annen vare enn raden som vises nå: det skal aldri
  // vises i, eller lagres fra, denne radens felt.
  const fremmed = utkast !== undefined && (utkast.navn !== navn || utkast.itemId !== itemId);
  const eget = fremmed ? undefined : utkast;
  const endretUnderveis = eget !== undefined && eget.foer !== synlig;
  if (fremmed) {
    return (
      <>
        <input
          value={synlig}
          disabled
          readOnly
          placeholder="Mengde"
          aria-label={`Mengde for ${navn}`}
          autoComplete="off"
          className={inputClassName}
        />
        <div className={styles.feil} role="alert" aria-label={`Utkast for annen vare på ${navn}`}>
          <p className={styles.feilTekst}>
            {`Utkastet ditt (${vis(utkast.verdi)}) ble skrevet for «${utkast.navn}», men raden er nå «${navn}». Det kan ikke lagres på denne raden.`}
          </p>
          <div className={styles.knapper}>
            <button type="button" className={styles.knapp} disabled={sperret} onClick={onForkast}>
              Forkast utkastet og start på nytt
            </button>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <input
        value={eget?.verdi ?? synlig}
        onChange={(e) => onEndre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && eget) {
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
      {eget && (
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

/**
 * Utkast for rader som ikke lenger finnes på listen (review 5922654566):
 * verdien står synlig til Helen uttrykkelig forkaster den, og kan ikke
 * lagres noe annet sted.
 */
export function UtkastUtenRad({
  utkast,
  lagrer,
  onForkast,
}: {
  utkast: readonly { id: string; utkast: MengdeUtkast }[];
  lagrer: ReadonlySet<string>;
  onForkast: (id: string) => void;
}) {
  return (
    <>
      {utkast.map(({ id, utkast: u }) => (
        <div
          key={id}
          className={styles.feil}
          role="alert"
          aria-label={`Utkast uten rad: ${u.navn}`}
        >
          <p className={styles.feilTekst}>
            {`Ulagret utkast for «${u.navn}»: ${vis(u.verdi)}. Raden er ikke lenger på listen, så utkastet kan ikke lagres. Det står her til du forkaster det.`}
          </p>
          <div className={styles.knapper}>
            <button
              type="button"
              className={styles.knapp}
              disabled={lagrer.has(id)}
              onClick={() => onForkast(id)}
            >
              Forkast utkastet
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
