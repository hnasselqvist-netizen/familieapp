import { Link } from "react-router-dom";
import { Icon } from "@components/Icon";
import { RoomHeader } from "@components/RoomHeader";
import type { Runde } from "@domain/lonnsdagsrunde/lonnsdagsrunde";
import styles from "./Lonnsdagsrunde.module.css";
import { STEG_IKON, STEG_TITTEL, datoTekst, kr, stegLenke, stegStatus } from "./rundeTekst";

export interface LonnsdagsrundeViewProps {
  runde: Runde;
  /** Hvilken transaksjonskø vurderingssteget åpner (forslag når bare de venter). */
  transaksjonsko: "vurdering" | "forslag";
  /** Spillerom og prognosedato til avslutningen. */
  spillerom: number;
  prognosisDate: string;
}

/**
 * Lønnsdagsrunden (#59): den månedlige Forvaltning-jobben som én ledet
 * rute. Hvert steg viser hva som er gjort eller hva som gjenstår, og
 * åpner skjermen der jobben gjøres. Det aktive steget (første som ikke er
 * gjort) er tydelig; de andre kan likevel åpnes i hvilken som helst
 * rekkefølge. Når alt er gjort, avsluttes runden med et rolig ferdig-kort.
 *
 * Status er utledet av eksisterende data (§domain/lonnsdagsrunde), så
 * runden kan avbrytes og gjenopptas uten at noe lagres.
 */
export function LonnsdagsrundeView({
  runde,
  transaksjonsko,
  spillerom,
  prognosisDate,
}: LonnsdagsrundeViewProps) {
  const gjort = runde.steg.length - runde.gjenstar;
  return (
    <div className={styles.side}>
      <RoomHeader
        eyebrow="FORVALTNING"
        title="Lønnsdagsrunden"
        description={`Lønnsperioden fra ${datoTekst(runde.periodeStart)}`}
      />

      {runde.ferdig ? (
        <section className={styles.ferdig} aria-label="Runden er ferdig">
          <span className={styles.ferdigIkon} aria-hidden>
            <Icon name="check" color="#ecdfc8" size={16} />
          </span>
          <div className={styles.ferdigTekst}>
            <h2 className={styles.ferdigTittel}>Ferdig for denne lønnsperioden</h2>
            <p>
              Spillerom frem til {datoTekst(prognosisDate)}: <strong>{kr(spillerom)}</strong>
            </p>
            <p className={styles.dempet}>Neste runde: {datoTekst(runde.nesteLonnsdag)}.</p>
          </div>
        </section>
      ) : (
        <p className={styles.fremdrift} aria-live="polite">
          {gjort} av {runde.steg.length} steg gjort
        </p>
      )}

      <ol className={styles.steg} aria-label="Steg i runden">
        {runde.steg.map((s, i) => {
          const aktiv = s.id === runde.aktivt;
          return (
            <li key={s.id}>
              <Link
                to={stegLenke(s.id, transaksjonsko)}
                className={[styles.rad, aktiv && styles.aktiv, s.ferdig && styles.gjort]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={aktiv ? "step" : undefined}
              >
                <span className={styles.nummer} aria-hidden>
                  {s.ferdig ? <Icon name="check" size={14} /> : i + 1}
                </span>
                <span className={styles.tekst}>
                  <span className={styles.tittel}>
                    {STEG_TITTEL[s.id]}
                    {s.ferdig && <span className={styles.srOnly}> (gjort)</span>}
                  </span>
                  <span className={styles.status}>{stegStatus(s, runde.periodeStart)}</span>
                </span>
                <span className={styles.ikon} aria-hidden>
                  <Icon name={aktiv ? "chevron-right" : STEG_IKON[s.id]} size={16} />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      <Link to="/forvaltning" className={styles.tilbake}>
        Til Forvaltning
      </Link>
    </div>
  );
}
