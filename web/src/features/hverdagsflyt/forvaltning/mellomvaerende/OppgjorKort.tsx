import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@components/Button";
import { Card } from "@components/Card";
import {
  type MellomvaerendeStatus,
  kronerTekst,
  maanedTekst,
  tolkKroner,
} from "@domain/mellomvaerende/mellomvaerende";
import { lagringsfeil } from "./lagringsfeil";
import styles from "./Mellomvaerende.module.css";

export interface OppgjorKortProps {
  status: MellomvaerendeStatus;
  onBekreft: (maaned: string, belopOre: number) => Promise<void>;
  onFullfor: () => Promise<void>;
}

/**
 * Handlingskortet (#95) for ETT mellomværende: eldste uoppgjorte måned,
 * foreslått beløp (kan justeres), restsaldo og «Bekreft oppgjør». Kortet
 * står til lagringen er bekreftet fra databasen — det forsvinner fordi
 * måneden ikke lenger er forfalt, ikke fordi knappen ble trykket.
 */
export function OppgjorKort({ status, onBekreft, onFullfor }: OppgjorKortProps) {
  const { avtale } = status;
  const maaned = status.forfalte[0];
  // Utkastet hører til måneden: ny måned gir nytt forslag.
  const [utkast, setUtkast] = useState<{ maaned?: string; tekst: string }>({
    maaned,
    tekst: String(status.forslagOre / 100).replace(".", ","),
  });
  const tekst =
    utkast.maaned === maaned ? utkast.tekst : String(status.forslagOre / 100).replace(".", ",");
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState<string | null>(null);

  if (!status.kostnadFort) {
    return (
      <section aria-label={`Mellomværende: ${avtale.navn}`}>
        <Card>
          <div className={styles.kort}>
            <h2 className={styles.kortTittel}>{avtale.navn}</h2>
            <span className={styles.dempet}>
              Registreringen ble ikke fullført: utlegget på {kronerTekst(avtale.opprinneligOre)} er
              ikke ført som kostnad.
            </span>
            {feil && (
              <p className={styles.feil} role="alert">
                {feil}
              </p>
            )}
            <div>
              <Button
                loading={lagrer}
                onClick={async () => {
                  setLagrer(true);
                  setFeil(null);
                  try {
                    await onFullfor();
                  } catch (e) {
                    setFeil(lagringsfeil(e));
                  } finally {
                    setLagrer(false);
                  }
                }}
              >
                Fullfør registrering
              </Button>
            </div>
          </div>
        </Card>
      </section>
    );
  }

  if (!maaned) return null;
  const belopOre = tolkKroner(tekst);
  const forStort = belopOre !== null && belopOre > status.restOre;
  const flere = status.forfalte.length - 1;

  return (
    <section aria-label={`Mellomværende: ${avtale.navn}`}>
      <Card>
        <div className={styles.kort}>
          <div className={styles.kortHode}>
            <h2 className={styles.kortTittel}>
              {avtale.navn}: oppgjør {maanedTekst(maaned)}
            </h2>
            <span className={styles.dempet}>
              Gjenstår <span className={styles.tall}>{kronerTekst(status.restOre)}</span>
            </span>
          </div>
          <span className={styles.dempet}>
            {avtale.motpart} betaler ikke {avtale.oppgjor.postNavn.toLowerCase()} denne måneden.
            Bekreft beløpet som motregnes.
            {flere > 0 && ` ${flere} måned${flere === 1 ? "" : "er"} til venter etter denne.`}
          </span>
          <div className={styles.belopRad}>
            <label className={styles.felt}>
              Beløp
              <input
                className={styles.input}
                inputMode="decimal"
                value={tekst}
                aria-invalid={belopOre === null || forStort}
                onChange={(e) => setUtkast({ maaned, tekst: e.target.value })}
              />
            </label>
            <Button
              loading={lagrer}
              disabled={belopOre === null || forStort}
              onClick={async () => {
                if (belopOre === null) return;
                setLagrer(true);
                setFeil(null);
                try {
                  await onBekreft(maaned, belopOre);
                } catch (e) {
                  setFeil(lagringsfeil(e));
                } finally {
                  setLagrer(false);
                }
              }}
            >
              Bekreft oppgjør
            </Button>
          </div>
          {forStort && (
            <span className={styles.dempet}>
              Maks {kronerTekst(status.restOre)} — det som gjenstår.
            </span>
          )}
          {feil && (
            <p className={styles.feil} role="alert">
              {feil}
            </p>
          )}
          <Link to="/forvaltning/mellomvaerende" className={styles.lenke}>
            Se oversikt og historikk
          </Link>
        </div>
      </Card>
    </section>
  );
}
