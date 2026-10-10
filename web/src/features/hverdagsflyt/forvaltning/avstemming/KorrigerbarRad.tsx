import { useState } from "react";
import {
  type MotpartValg,
  erDublett,
  tilstandTekst,
  vurderAngring,
  vurderDublettMerking,
} from "@domain/avstemming/saldokorrigering";
import { kontoNavn } from "@domain/forsoning/regelsenter";
import { normaliserKonto } from "@domain/forsoning/bankimportParse";
import type { TransaksjonRecord } from "@app-types/forsoning";
import styles from "./Avstemming.module.css";
import { datoKort, krOre } from "./avstemmingTekst";
import type { Korrigeringshandlinger } from "./korrigeringTyper";

function beskrivelse(t: TransaksjonRecord): string {
  return `${datoKort(t.dato)} · ${t.tekst} · ${t.retning === "inn" ? "+" : "−"}${krOre(
    Math.round(Math.abs(t.belop) * 100),
  )}`;
}

function medKonto(t: TransaksjonRecord): string {
  return `${beskrivelse(t)} · ${kontoNavn(normaliserKonto(t))}`;
}

/**
 * Én transaksjon i avvikshjelpen med tilstanden sin og en direkte,
 * reversibel korrigering (#59, 6097079190 / 6097180478):
 * «Marker som dublett…» med eksplisitt valg for en koblet motpost, og
 * «Ikke dublett» som gjenoppretter forrige tilstand eller avklarer en
 * feilmerket dublett som ekte bevegelse.
 */
export function KorrigerbarRad({
  t,
  alle,
  handlinger,
}: {
  t: TransaksjonRecord;
  alle: readonly TransaksjonRecord[];
  handlinger: Korrigeringshandlinger;
}) {
  const [aapen, setAapen] = useState(false);
  const [valg, setValg] = useState<MotpartValg | null>(null);
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState(false);
  const dublett = erDublett(t);
  const aktivMerking = t.saldoKorrigering?.type === "dublett";

  const utfor = async (handling: () => Promise<void>) => {
    setLagrer(true);
    setFeil(false);
    try {
      await handling();
      setAapen(false);
      setValg(null);
    } catch (e) {
      console.error(e);
      setFeil(true);
    } finally {
      setLagrer(false);
    }
  };

  const navn = `${t.tekst} ${datoKort(t.dato)}`;
  return (
    <li className={styles.korrRad}>
      <span className={styles.korrLinje}>
        <span>{beskrivelse(t)}</span>
        <span className={styles.korrTilstand}>{tilstandTekst(t)}</span>
        {!aapen &&
          (dublett && !aktivMerking ? (
            <button
              type="button"
              className={styles.korrKnapp}
              disabled={lagrer}
              aria-label={`${navn} er ikke en dublett, men en ekte bankbevegelse`}
              onClick={() => void utfor(() => handlinger.omklassifiser(t.id, "bankbevegelse"))}
            >
              Ikke dublett
            </button>
          ) : (
            <button
              type="button"
              className={styles.korrKnapp}
              aria-label={dublett ? `${navn}: ikke dublett` : `Marker ${navn} som dublett`}
              onClick={() => setAapen(true)}
            >
              {dublett ? "Ikke dublett…" : "Marker som dublett…"}
            </button>
          ))}
      </span>
      {aapen && (dublett ? angrePanel() : merkPanel())}
      {feil && (
        <span className={styles.feil} role="alert">
          Kunne ikke lagre korrigeringen. Prøv igjen.
        </span>
      )}
    </li>
  );

  function avbrytKnapp() {
    return (
      <button
        type="button"
        className={styles.korrAvbryt}
        onClick={() => {
          setAapen(false);
          setValg(null);
        }}
      >
        Avbryt
      </button>
    );
  }

  function merkPanel() {
    const v = vurderDublettMerking(t, alle);
    if (!v.kan) {
      return (
        <div className={styles.korrPanel} role="group" aria-label={`Marker ${navn} som dublett`}>
          <p>{v.grunn}</p>
          {avbrytKnapp()}
        </div>
      );
    }
    const m = v.motpart;
    return (
      <div className={styles.korrPanel} role="group" aria-label={`Marker ${navn} som dublett`}>
        <p>
          Dubletten holdes utenfor saldoen. Ingenting slettes, og du kan angre etterpå.
          {m && " Den er koblet som intern overføring. Hva er motposten?"}
        </p>
        {m && (
          <fieldset className={styles.korrValg}>
            <legend className={styles.korrMotpart}>Motpost: {medKonto(m)}</legend>
            <label>
              <input
                type="radio"
                name={`motpart-${t.id}`}
                checked={valg === "frakoble"}
                onChange={() => setValg("frakoble")}
              />
              Motposten er ekte. Den beholdes som intern overføring og teller på sin konto, men
              koblingen fjernes.
            </label>
            <label>
              <input
                type="radio"
                name={`motpart-${t.id}`}
                checked={valg === "ogsaDublett"}
                onChange={() => setValg("ogsaDublett")}
              />
              Motposten er også en dublett. Begge holdes utenfor.
            </label>
          </fieldset>
        )}
        <span className={styles.korrHandlinger}>
          <button
            type="button"
            className={styles.lagre}
            disabled={lagrer || (!!m && !valg)}
            onClick={() => void utfor(() => handlinger.merkDublett(t.id, m ? valg : null))}
          >
            {lagrer ? "Lagrer…" : "Bekreft: marker som dublett"}
          </button>
          {avbrytKnapp()}
        </span>
      </div>
    );
  }

  function angrePanel() {
    const v = vurderAngring(t, alle);
    const tidligere = t.saldoKorrigering?.tidligere;
    return (
      <div className={styles.korrPanel} role="group" aria-label={`${navn}: ikke dublett`}>
        {v.kan && tidligere ? (
          <>
            <p>
              Blir{" "}
              {tilstandTekst({
                status: tidligere.status,
                behandlingstype: tidligere.behandlingstype ?? undefined,
                ignorertSom: tidligere.ignorertSom ?? undefined,
              })}{" "}
              igjen og teller i saldoen
              {v.motpart && v.gjenkobles && `, koblet til motposten ${medKonto(v.motpart)}`}.
            </p>
            <span className={styles.korrHandlinger}>
              <button
                type="button"
                className={styles.lagre}
                disabled={lagrer}
                onClick={() => void utfor(() => handlinger.angreDublett(t.id))}
              >
                {lagrer ? "Lagrer…" : "Bekreft: ikke dublett"}
              </button>
              {avbrytKnapp()}
            </span>
          </>
        ) : (
          <>
            <p>{v.kan ? "Fant ikke tilstanden før merkingen." : v.grunn}</p>
            {avbrytKnapp()}
          </>
        )}
      </div>
    );
  }
}
