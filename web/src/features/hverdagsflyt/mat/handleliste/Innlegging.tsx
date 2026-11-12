import type { Treff } from "@domain/shopping/handlelisteInnlegging";
import { vurderOkning } from "@domain/shopping/handlelisteInnlegging";
import styles from "./Innlegging.module.css";

const mengdeTekst = (m: string) => (m.trim() === "" ? "ingen mengde" : m);

/**
 * Varsel når en manuelt innlagt vare allerede står aktiv på listen (Mat
 * #20, ordre 6830803229). Viser raden(e) slik de var da varselet åpnet.
 * Bare to valg: «Øk antallet» på ÉN entydig målrad, eller «Avbryt» (ingen
 * endring). Flere treff → Helen må velge målrad; uklar mengde → ingen
 * økning tilbys, og det sies hvorfor.
 */
export function Innleggingsvarsel({
  navn,
  treff,
  tillegg,
  maalId,
  lagrer,
  onVelgMaal,
  onOk,
  onAvbryt,
}: {
  navn: string;
  treff: readonly Treff[];
  /** Mengden i utkastet (det som skal legges til). */
  tillegg: string;
  maalId: string | null;
  lagrer: boolean;
  onVelgMaal: (id: string) => void;
  onOk: () => void;
  onAvbryt: () => void;
}) {
  const flere = treff.length > 1;
  const maal = treff.find((t) => t.rad.id === maalId)?.rad ?? null;
  const vurdering = maal ? vurderOkning(maal.amount ?? "", tillegg) : null;
  const tittel = flere
    ? `«${navn}» kan være på listen flere ganger`
    : `«${navn}» står allerede på listen`;

  return (
    <div className={styles.panel} role="group" aria-label={tittel}>
      <p className={styles.tittel}>{tittel}</p>
      {flere && <p className={styles.hint}>Velg hvilken rad som skal økes.</p>}
      <ul className={styles.liste}>
        {treff.map(({ type, rad }) => {
          const tekst = `${rad.name} · ${mengdeTekst(rad.amount ?? "")} · ${rad.cat}`;
          const merke = type === "sterk" ? "Samme vare" : "Samme navn, kanskje en annen vare";
          return (
            <li key={rad.id} className={styles.rad}>
              {flere ? (
                <label className={styles.valg}>
                  <input
                    type="radio"
                    name="innlegging-maal"
                    checked={maalId === rad.id}
                    onChange={() => onVelgMaal(rad.id)}
                    aria-label={`Øk ${rad.name} (${mengdeTekst(rad.amount ?? "")})`}
                  />
                  <span>{tekst}</span>
                </label>
              ) : (
                <span>{tekst}</span>
              )}
              <span className={styles.merke}>{merke}</span>
            </li>
          );
        })}
      </ul>
      {maal && vurdering?.type === "sum" && (
        <p className={styles.resultat}>
          Nytt antall: {maal.amount} + {tillegg.trim()} = <strong>{vurdering.resultat}</strong>
        </p>
      )}
      {maal && vurdering?.type === "uklar" && <p className={styles.uklar}>{vurdering.grunn}</p>}
      <div className={styles.knapper}>
        <button
          type="button"
          className={styles.bekreft}
          disabled={lagrer || vurdering?.type !== "sum"}
          onClick={onOk}
        >
          {lagrer ? "Lagrer…" : "Øk antallet"}
        </button>
        <button type="button" className={styles.knapp} disabled={lagrer} onClick={onAvbryt}>
          Avbryt
        </button>
      </div>
    </div>
  );
}

export type InnleggingsStatus =
  | { type: "ok"; tekst: string }
  | { type: "konflikt"; tekst: string }
  /** Vi vet ikke om forrige forsøk ble lagret: «Prøv igjen» sender samme forsøk. */
  | { type: "ukjent"; tekst: string };

/** Utfallet av siste innlegging. Konflikt og ukjent vises som varsel; utkastet beholdes. */
export function InnleggingsMelding({
  status,
  lagrer,
  onProvIgjen,
  onSendSomNy,
}: {
  status: InnleggingsStatus;
  lagrer: boolean;
  onProvIgjen: () => void;
  onSendSomNy: () => void;
}) {
  if (status.type === "ok") {
    return (
      <p className={styles.ok} role="status">
        {status.tekst}
      </p>
    );
  }
  return (
    <div className={styles.feil} role="alert" data-innlegging-status={status.type}>
      <p className={styles.feilTekst}>{status.tekst}</p>
      {status.type === "ukjent" && (
        <div className={styles.knapper}>
          <button type="button" className={styles.knapp} disabled={lagrer} onClick={onProvIgjen}>
            Prøv igjen
          </button>
          <button type="button" className={styles.knapp} disabled={lagrer} onClick={onSendSomNy}>
            Send som ny
          </button>
        </div>
      )}
    </div>
  );
}
