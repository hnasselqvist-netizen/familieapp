import type { Treff } from "@domain/shopping/handlelisteInnlegging";
import { vurderOkning } from "@domain/shopping/handlelisteInnlegging";
import styles from "./Innlegging.module.css";
import { type Status, type Ventende, beskriv } from "./useInnlegging";

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

/** Utfallet av siste innlegging som ikke venter: lagret, eller ingenting lagret. */
export function InnleggingsStatus({ status }: { status: Status }) {
  return status.type === "ok" ? (
    <p className={styles.ok} role="status">
      {status.tekst}
    </p>
  ) : (
    <div className={styles.feil} role="alert" data-innlegging-status="konflikt">
      <p className={styles.feilTekst}>{status.tekst}</p>
    </div>
  );
}

/**
 * Forsøk med ukjent eller ubekreftet utfall — ett panel per forsøk. «Prøv
 * igjen» sender det samme forsøket (samme `opId`). «Send som ny» gjelder bare
 * forsøket den står på og krever et eget valg etter at listen er sjekket.
 */
export function VentendeForsok({
  ventende,
  lagrer,
  onProvIgjen,
  onSendSomNy,
  onBekreftSendSomNy,
}: {
  ventende: readonly Ventende[];
  lagrer: boolean;
  onProvIgjen: (opId: string) => void;
  onSendSomNy: (opId: string) => void;
  onBekreftSendSomNy: (opId: string) => void;
}) {
  return (
    <>
      {ventende.map((v) => {
        const opId = v.innsending.plan.opId;
        const hva = beskriv(v.innsending);
        return (
          <div
            key={opId}
            className={styles.feil}
            role="alert"
            aria-label={`Ikke bekreftet: ${hva}`}
            data-innlegging-status="ukjent"
          >
            <p className={styles.feilTekst}>{v.tekst}</p>
            {v.bekreftNy && (
              <p className={styles.feilTekst}>
                Sjekk handlelisten først. Står {hva} der allerede, ble forrige forsøk lagret — da
                skal du ikke sende på nytt.
              </p>
            )}
            <div className={styles.knapper}>
              {v.bekreftNy ? (
                <>
                  <button
                    type="button"
                    className={styles.knapp}
                    disabled={lagrer}
                    onClick={() => onBekreftSendSomNy(opId)}
                  >
                    Jeg har sjekket — send som ny
                  </button>
                  <button
                    type="button"
                    className={styles.knapp}
                    disabled={lagrer}
                    onClick={() => onSendSomNy(opId)}
                  >
                    Ikke send
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.knapp}
                    disabled={lagrer}
                    onClick={() => onProvIgjen(opId)}
                  >
                    Prøv igjen
                  </button>
                  <button
                    type="button"
                    className={styles.knapp}
                    disabled={lagrer}
                    onClick={() => onSendSomNy(opId)}
                  >
                    Send som ny
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
