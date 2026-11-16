import type { FeltPlan } from "@domain/shopping/handlelisteFelt";
import { type NavnUtkast, erFremmedNavneutkast, feltNokkel } from "./navnUtkast";
import styles from "./Innlegging.module.css";

/**
 * Navn og kategori på én rad (Mat #20, ordre 6921967679). Navneutkastet
 * holdes lokalt til Helen lagrer, bundet til varekoblingen og navnet hun så
 * da hun begynte å redigere. Kategorien lagres som et eksplisitt valg med
 * førverdi fra visningen.
 */

export interface FeltMelding {
  /** `${felt}:${id}` */
  nokkel: string;
  tekst: string;
  felt: FeltPlan["felt"];
  /** Satt så lenge utfallet er ukjent: «Sjekk» leser bare, lagring er sperret. */
  uavklart?: FeltPlan;
}

export function NavnFelt({
  navn,
  itemId,
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
  utkast: NavnUtkast | undefined;
  sperret: boolean;
  inputClassName?: string;
  onEndre: (verdi: string) => void;
  onLagre: () => void;
  onForkast: () => void;
  onBehold: () => void;
}) {
  const fremmed = utkast !== undefined && erFremmedNavneutkast(utkast, navn, itemId);
  const eget = fremmed ? undefined : utkast;
  const endretUnderveis = eget !== undefined && eget.foer !== navn;
  if (fremmed) {
    return (
      <>
        <input
          value={navn}
          disabled
          readOnly
          aria-label={`Navn for ${navn}`}
          autoComplete="off"
          className={inputClassName}
        />
        <div
          className={styles.feil}
          role="alert"
          aria-label={`Navneutkast for annen vare på ${navn}`}
        >
          <p className={styles.feilTekst}>
            {`Navneutkastet ditt («${utkast.verdi}») ble skrevet for «${utkast.foer}», men raden er nå «${navn}». Det kan ikke lagres på denne raden.`}
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
        value={eget?.verdi ?? navn}
        onChange={(e) => onEndre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && eget) {
            e.preventDefault();
            onLagre();
          }
        }}
        disabled={sperret}
        aria-label={`Navn for ${navn}`}
        autoComplete="off"
        className={inputClassName}
      />
      {eget && (
        <div className={styles.knapper}>
          <button type="button" className={styles.knapp} disabled={sperret} onClick={onLagre}>
            Lagre navn
          </button>
          <button type="button" className={styles.knapp} disabled={sperret} onClick={onForkast}>
            Angre
          </button>
        </div>
      )}
      {endretUnderveis && !sperret && (
        <div className={styles.feil} role="alert" aria-label={`Navn endret for ${navn}`}>
          <p className={styles.feilTekst}>
            {`Navnet er endret på en annen enhet fra «${eget.foer}» til «${navn}» mens du redigerte.`}
          </p>
          <div className={styles.knapper}>
            <button type="button" className={styles.knapp} onClick={onForkast}>
              {`Bruk «${navn}»`}
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

export function FeltMeldinger({
  meldinger,
  lagrer,
  onSjekk,
  onLukk,
}: {
  meldinger: readonly FeltMelding[];
  lagrer: ReadonlySet<string>;
  onSjekk: (plan: FeltPlan) => void;
  onLukk: (nokkel: string) => void;
}) {
  return (
    <>
      {meldinger.map((m) => {
        const { uavklart } = m;
        return (
          <div
            key={m.nokkel}
            className={styles.feil}
            role="alert"
            aria-label={m.felt === "name" ? "Navn" : "Kategori"}
          >
            <p className={styles.feilTekst}>{m.tekst}</p>
            <div className={styles.knapper}>
              {uavklart ? (
                <button
                  type="button"
                  className={styles.knapp}
                  disabled={lagrer.has(m.nokkel)}
                  onClick={() => onSjekk(uavklart)}
                >
                  {lagrer.has(m.nokkel) ? "Sjekker …" : "Sjekk"}
                </button>
              ) : (
                <button type="button" className={styles.knapp} onClick={() => onLukk(m.nokkel)}>
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

/** Navneutkast for rader som ikke lenger finnes på listen: synlige til de forkastes. */
export function NavneutkastUtenRad({
  utkast,
  lagrer,
  onForkast,
}: {
  utkast: readonly { id: string; utkast: NavnUtkast }[];
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
          aria-label={`Navneutkast uten rad: ${u.foer}`}
        >
          <p className={styles.feilTekst}>
            {`Ulagret navneutkast for «${u.foer}»: «${u.verdi}». Raden er ikke lenger på listen, så utkastet kan ikke lagres. Det står her til du forkaster det.`}
          </p>
          <div className={styles.knapper}>
            <button
              type="button"
              className={styles.knapp}
              disabled={lagrer.has(feltNokkel("name", id))}
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
