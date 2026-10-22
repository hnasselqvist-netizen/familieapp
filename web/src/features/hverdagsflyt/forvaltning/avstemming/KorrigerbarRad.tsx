import { useState } from "react";
import {
  MAKS_DATOFLYTT,
  type MotpartValg,
  erDublett,
  forventetDatoGyldig,
  gjeldendeForventetMotpost,
  kildeEndretGrunn,
  kildeavtrykk,
  plussDager,
  tilstandTekst,
  vurderAngring,
  vurderAngringForventet,
  vurderAvslutningForventet,
  vurderDublettMerking,
  vurderForventetMotpost,
  vurderNyBekreftelse,
} from "@domain/avstemming/saldokorrigering";
import { KONTOVILKAR_VALG, kontoNavn } from "@domain/forsoning/regelsenter";
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

type Panel = "dublett" | "motpost" | "bekreftPaaNytt" | "angreMotpost";

/**
 * Én transaksjon i avvikshjelpen med tilstanden sin og en direkte,
 * reversibel korrigering (#59, 6097079190 / 6097180478 / 6097196546):
 * «Marker som dublett…» med eksplisitt valg for en koblet motpost,
 * «Ikke dublett» som gjenoppretter forrige tilstand eller avklarer en
 * feilmerket dublett som ekte bevegelse, og «Motposten mangler…» som gjør
 * den til intern overføring med en avledet motpost på valgt konto.
 */
export function KorrigerbarRad({
  t,
  alle,
  handlinger,
  foreslattKonto,
}: {
  t: TransaksjonRecord;
  alle: readonly TransaksjonRecord[];
  handlinger: Korrigeringshandlinger;
  /** Kontoen som foreslås for motposten (kontoen avviket vises på). */
  foreslattKonto?: string;
}) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [valg, setValg] = useState<MotpartValg | null>(null);
  const [motkonto, setMotkonto] = useState("");
  const [motdato, setMotdato] = useState(t.dato.slice(0, 10));
  const [lagrer, setLagrer] = useState(false);
  const [feil, setFeil] = useState(false);
  const dublett = erDublett(t);
  const aktivMerking = t.saldoKorrigering?.type === "dublett";
  const avledet = t.saldoKorrigering?.type === "forventet_motpost";
  const avledetEndret = avledet && vurderAvslutningForventet(t).kan;
  const forventet = gjeldendeForventetMotpost(t);
  const kildeEndret = kildeEndretGrunn(t);
  const kanBekreftesPaaNytt = vurderNyBekreftelse(t).kan;
  const kanFaMotpost = vurderForventetMotpost(t).kan;

  const lukk = () => {
    setPanel(null);
    setValg(null);
  };

  const aapneMotpost = () => {
    const v = vurderForventetMotpost(t);
    const kilde = v.kan ? v.kildekonto : null;
    setMotkonto(foreslattKonto && foreslattKonto !== kilde ? foreslattKonto : "");
    setMotdato(t.dato.slice(0, 10));
    setPanel("motpost");
  };

  const aapneNyBekreftelse = () => {
    const kilde = normaliserKonto(t);
    setMotkonto(forventet && forventet.konto !== kilde ? forventet.konto : "");
    setMotdato(
      forventet && forventetDatoGyldig(t, forventet.dato) ? forventet.dato : t.dato.slice(0, 10),
    );
    setPanel("bekreftPaaNytt");
  };

  const utfor = async (handling: () => Promise<void>) => {
    setLagrer(true);
    setFeil(false);
    try {
      await handling();
      lukk();
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
        <span className={styles.korrTilstand}>
          {tilstandTekst(t)}
          {forventet && ` · avledet på ${kontoNavn(forventet.konto)} ${datoKort(forventet.dato)}`}
          {forventet && kildeEndret && ` · teller ikke: ${kildeEndret}`}
        </span>
        {!panel && (
          <span className={styles.korrKnapper}>
            {avledet ? (
              <button
                type="button"
                className={styles.korrKnapp}
                aria-label={`${navn}: ${avledetEndret ? "avslutt" : "angre"} avledet motpost`}
                onClick={() => setPanel("angreMotpost")}
              >
                {avledetEndret ? "Avslutt avledet motpost…" : "Angre avledet motpost…"}
              </button>
            ) : dublett && !aktivMerking ? (
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
                onClick={() => setPanel("dublett")}
              >
                {dublett ? "Ikke dublett…" : "Marker som dublett…"}
              </button>
            )}
            {kanBekreftesPaaNytt && (
              <button
                type="button"
                className={styles.korrKnapp}
                aria-label={`${navn}: bekreft avledet motpost på nytt`}
                onClick={aapneNyBekreftelse}
              >
                Bekreft på nytt…
              </button>
            )}
            {kanFaMotpost && (
              <button
                type="button"
                className={styles.korrKnapp}
                aria-label={`${navn}: intern overføring, motposten mangler`}
                onClick={aapneMotpost}
              >
                Motposten mangler…
              </button>
            )}
          </span>
        )}
      </span>
      {panel === "dublett" && (dublett ? angrePanel() : merkPanel())}
      {panel === "motpost" && motpostPanel(false)}
      {panel === "bekreftPaaNytt" && motpostPanel(true)}
      {panel === "angreMotpost" && angreMotpostPanel()}
      {feil && (
        <span className={styles.feil} role="alert">
          Kunne ikke lagre korrigeringen. Prøv igjen.
        </span>
      )}
    </li>
  );

  function avbrytKnapp() {
    return (
      <button type="button" className={styles.korrAvbryt} onClick={lukk}>
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

  /** Ny avledet motpost, eller (`paaNytt`) ny bekreftelse etter at kilden er endret. */
  function motpostPanel(paaNytt: boolean) {
    const v = paaNytt ? vurderNyBekreftelse(t) : vurderForventetMotpost(t);
    const tittel = paaNytt
      ? `${navn}: bekreft avledet motpost på nytt`
      : `${navn}: intern overføring, motposten mangler`;
    if (!v.kan) {
      return (
        <div className={styles.korrPanel} role="group" aria-label={tittel}>
          <p>{v.grunn}</p>
          {avbrytKnapp()}
        </div>
      );
    }
    const kildekonto = normaliserKonto(t);
    const kilde = kontoNavn(kildekonto);
    const mot = motkonto ? kontoNavn(motkonto) : "…";
    const [fra, til] = t.retning === "ut" ? [kilde, mot] : [mot, kilde];
    const gyldig = !!motkonto && forventetDatoGyldig(t, motdato);
    return (
      <div className={styles.korrPanel} role="group" aria-label={tittel}>
        {paaNytt && kildeEndret && (
          <p>
            {kildeEndret} Den avledede motposten teller ikke før du bekrefter den mot kilden slik
            den er nå.
          </p>
        )}
        <p>
          Overføring {fra} → {til}, {krOre(Math.round(Math.abs(t.belop) * 100))}, {datoKort(t.dato)}
          .{t.status === "ignorert" && ` Den teller da som ekte bevegelse på ${kilde}.`}
        </p>
        <label className={styles.korrFelt}>
          <span>Motkonto</span>
          <select value={motkonto} onChange={(e) => setMotkonto(e.target.value)}>
            <option value="">Velg konto</option>
            {KONTOVILKAR_VALG.filter((k) => k.id !== kildekonto).map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.korrFelt}>
          <span>Dato på motkontoen</span>
          <input
            type="date"
            value={motdato}
            min={t.dato.slice(0, 10)}
            max={plussDager(t.dato, MAKS_DATOFLYTT)}
            onChange={(e) => setMotdato(e.target.value)}
          />
        </label>
        <p className={styles.hint}>
          Motposten er ikke bankimportert. Den regnes inn på {mot} som avledet, og saldoen der vises
          aldri som bankverifisert avstemt bare på grunn av den. Når den ekte motposten importeres,
          kobler du den. Du kan angre.
        </p>
        <span className={styles.korrHandlinger}>
          <button
            type="button"
            className={styles.lagre}
            disabled={lagrer || !gyldig}
            onClick={() =>
              void utfor(() =>
                paaNytt
                  ? handlinger.bekreftMotpostPaaNytt(t.id, motkonto, motdato, kildeavtrykk(t))
                  : handlinger.leggTilMotpost(t.id, motkonto, motdato, kildeavtrykk(t)),
              )
            }
          >
            {lagrer
              ? "Lagrer…"
              : paaNytt
                ? "Bekreft på nytt: avledet motpost"
                : "Bekreft: intern overføring med avledet motpost"}
          </button>
          {avbrytKnapp()}
        </span>
      </div>
    );
  }

  function angreMotpostPanel() {
    if (avledetEndret) return avsluttMotpostPanel();
    const v = vurderAngringForventet(t);
    const tidligere = t.saldoKorrigering?.tidligere;
    const tittel = `${navn}: angre avledet motpost`;
    return (
      <div className={styles.korrPanel} role="group" aria-label={tittel}>
        {v.kan && tidligere ? (
          <>
            <p>
              Den avledede motposten
              {forventet && ` på ${kontoNavn(forventet.konto)}`} fjernes, og transaksjonen blir{" "}
              {tilstandTekst({
                status: tidligere.status,
                behandlingstype: tidligere.behandlingstype ?? undefined,
                ignorertSom: tidligere.ignorertSom ?? undefined,
              })}{" "}
              igjen.
            </p>
            <span className={styles.korrHandlinger}>
              <button
                type="button"
                className={styles.lagre}
                disabled={lagrer}
                onClick={() => void utfor(() => handlinger.angreMotpost(t.id))}
              >
                {lagrer ? "Lagrer…" : "Bekreft: angre avledet motpost"}
              </button>
              {avbrytKnapp()}
            </span>
          </>
        ) : (
          <>
            <p>{v.kan ? "Fant ikke tilstanden før endringen." : v.grunn}</p>
            {avbrytKnapp()}
          </>
        )}
      </div>
    );
  }

  function avsluttMotpostPanel() {
    const f = t.forventetMotpost;
    const tittel = `${navn}: avslutt avledet motpost`;
    return (
      <div className={styles.korrPanel} role="group" aria-label={tittel}>
        <p>
          Transaksjonen er endret i Transaksjoner etter at motposten ble avledet, så den kan ikke
          angres. Avslutter du, slutter den avledede motposten
          {f && ` på ${kontoNavn(f.konto)}`} å telle. Transaksjonen beholder tilstanden den har nå (
          {tilstandTekst(t)}), og forrige tilstand lagres i korrigeringsloggen.
        </p>
        <span className={styles.korrHandlinger}>
          <button
            type="button"
            className={styles.lagre}
            disabled={lagrer}
            onClick={() => void utfor(() => handlinger.avsluttMotpost(t.id))}
          >
            {lagrer ? "Lagrer…" : "Bekreft: avslutt avledet motpost"}
          </button>
          {avbrytKnapp()}
        </span>
      </div>
    );
  }
}
