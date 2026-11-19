import { useRef, useState } from "react";
import {
  type KommentarForsok,
  type KommentarKontroll,
  type KommentarMaal,
  type KommentarUtfall,
  kommentarAvsluttetTekst,
  kommentarNaatilstandTekst,
  kommentarTekst,
  lesKommentar,
  normaliserKommentar,
  nyttKommentarForsokTekst,
} from "@domain/forsoning/hendelseKommentar";
import type { HendelseRecord } from "@app-types/forsoning";
import styles from "./KorrigerHendelseModal.module.css";

export interface HendelseKommentarProps {
  /** Hendelsen slik abonnementet viser den nå. Må være en vanlig manuell hendelse. */
  hendelse: HendelseRecord;
  /** Familie og innloggingssesjon nye forsøk bindes til. */
  kontekst: string;
  /** Om en kontekst er den gjeldende AKKURAT NÅ. */
  erGjeldende: (kontekst: string) => boolean;
  lagre: (kontekst: string, maal: KommentarMaal, tekst: string) => Promise<KommentarUtfall>;
  sjekk: (forsok: KommentarForsok) => Promise<KommentarKontroll>;
  /** Uavklarte forsøk for hendelsen i denne konteksten, eldste først. */
  forsok: readonly KommentarForsok[];
  /** Endrer listen for forsøkets EGEN kontekst og hendelse. */
  oppdaterForsok: (
    kontekst: string,
    hendelseId: string,
    endre: (liste: readonly KommentarForsok[]) => readonly KommentarForsok[],
  ) => void;
}

interface Utkast {
  kilde: string | undefined;
  tekst: string;
}
type Melding = { tekst: string; feil: boolean };

/**
 * Kommentar på én vanlig manuell økonomisk hendelse (#59, ordre 7002365160,
 * #141). En egen handling, atskilt fra den økonomiske korrigeringen: bare
 * «Lagre kommentar» skriver, og bare kommentaren og `oppdatert` endres.
 *
 * Samme mønster som notatet på bibliotekmiddag (#185):
 * - utkastet husker kommentaren det startet fra; endret siden gir konflikt,
 *   og utkastet står;
 * - et tapt svar gir et uforanderlig forsøk. Så lenge et finnes, kan feltet
 *   ikke redigeres. Kontrollen viser nåtilstanden og avklarer ikke forsøket;
 * - «Lagre på nytt» er et nytt forsøk med eget resultat. Et sikkert avslag
 *   avgjør bare det nye; et nytt `ukjent` legges til;
 * - et svar etter et kontekstbytte vises aldri her.
 */
export function HendelseKommentar({
  hendelse,
  kontekst,
  erGjeldende,
  lagre: lagreKommentar,
  sjekk: sjekkKommentar,
  forsok,
  oppdaterForsok,
}: HendelseKommentarProps) {
  const [utkast, setUtkast] = useState<Utkast | null>(null);
  const [melding, setMelding] = useState<Melding | null>(null);
  const [konflikt, setKonflikt] = useState(false);
  const [sperret, setSperret] = useState(false);
  const [kontroll, setKontroll] = useState<KommentarKontroll | null>(null);
  const [lagrer, setLagrer] = useState(false);
  const [sjekker, setSjekker] = useState(false);
  const opptatt = useRef(false);

  const tilstand = lesKommentar(hendelse as unknown as Record<string, unknown>);
  const gjeldendeTekst = tilstand.type === "tekst" ? tilstand.tekst : undefined;
  const forste = forsok[0];
  const iOppfolging = forste !== undefined;

  const nullstill = () => {
    setMelding(null);
    setKonflikt(false);
    setSperret(false);
    setKontroll(null);
  };
  const start = () => {
    if (iOppfolging || tilstand.type === "ugyldig") return;
    setUtkast({ kilde: gjeldendeTekst, tekst: gjeldendeTekst ?? "" });
    nullstill();
  };
  const avslutt = () => oppdaterForsok(kontekst, hendelse.id, () => []);

  /** Sender ett forsøk. `null` når konteksten er byttet mens svaret ble ventet på. */
  const kjor = async (nytt: KommentarForsok, tekst: string): Promise<KommentarUtfall | null> => {
    opptatt.current = true;
    setLagrer(true);
    setMelding(null);
    let r: KommentarUtfall;
    try {
      r = await lagreKommentar(nytt.kontekst, { id: nytt.hendelseId, kilde: nytt.kilde }, tekst);
    } catch (err) {
      console.error("[Kommentar] lagring feilet:", err);
      r = "ukjent";
    } finally {
      opptatt.current = false;
      setLagrer(false);
    }
    if (r === "ukjent") oppdaterForsok(nytt.kontekst, nytt.hendelseId, (l) => [...l, nytt]);
    if (!erGjeldende(nytt.kontekst)) return null;
    setKontroll(null);
    return r;
  };

  const lagre = async () => {
    if (!utkast || iOppfolging || opptatt.current) return;
    const { kilde, tekst } = utkast;
    const nytt: KommentarForsok = {
      kontekst,
      hendelseId: hendelse.id,
      kilde,
      sendt: normaliserKommentar(tekst),
    };
    const r = await kjor(nytt, tekst);
    if (r === null) return;
    if (r === "lagret" || r === "allerede" || r === "ukjent") {
      setUtkast(null);
      setKonflikt(false);
      setSperret(false);
      setMelding({ tekst: kommentarTekst(r), feil: r === "ukjent" });
      return;
    }
    setUtkast({ kilde, tekst });
    setKonflikt(r === "konflikt");
    setSperret(r === "mangler" || r === "tvetydig" || r === "ikkeBerettiget" || r === "ugyldig");
    setMelding({ tekst: kommentarTekst(r), feil: true });
  };

  const sjekk = async () => {
    if (!forste || opptatt.current) return;
    const maal = forste;
    opptatt.current = true;
    setSjekker(true);
    let o: KommentarKontroll;
    try {
      o = await sjekkKommentar(maal);
    } catch (err) {
      console.error("[Kommentar] kontroll feilet:", err);
      o = "ikkeLest";
    } finally {
      opptatt.current = false;
      setSjekker(false);
    }
    if (!erGjeldende(maal.kontekst)) return;
    setKontroll(o);
    setMelding({ tekst: kommentarNaatilstandTekst(o), feil: true });
  };

  const lagrePaaNytt = async () => {
    if (!forste || opptatt.current) return;
    const r = await kjor({ ...forste }, forste.sendt ?? "");
    if (r === null) return;
    if (r === "lagret" || r === "allerede") avslutt();
    setMelding({ tekst: nyttKommentarForsokTekst(r), feil: r !== "lagret" && r !== "allerede" });
  };
  const godta = () => {
    avslutt();
    nullstill();
    setMelding({ tekst: kommentarAvsluttetTekst("godta"), feil: false });
  };
  const brukGjeldende = () => {
    if (forste) {
      const tekst = forste.sendt ?? "";
      avslutt();
      setUtkast({ kilde: gjeldendeTekst, tekst });
      nullstill();
      setMelding({ tekst: kommentarAvsluttetTekst("grunnlag"), feil: false });
      return;
    }
    if (utkast) setUtkast({ ...utkast, kilde: gjeldendeTekst });
    nullstill();
  };
  const lukk = () => {
    avslutt();
    nullstill();
    setMelding({ tekst: kommentarAvsluttetTekst("lukk"), feil: false });
  };

  const gjeldende = (
    <div className={styles.seksjon}>
      <div className={styles.dempet}>Gjeldende kommentar</div>
      {gjeldendeTekst ? (
        <p className={styles.kommentarTekst}>{gjeldendeTekst}</p>
      ) : (
        <p className={styles.dempet}>Ingen kommentar.</p>
      )}
    </div>
  );

  return (
    <section aria-label="Kommentar" className={styles.kommentarSeksjon}>
      <div className={styles.dempet}>Kommentar</div>

      {forste && (
        <>
          <div className={styles.dempet}>Sendt, ikke avklart:</div>
          {forste.sendt !== undefined ? (
            <p className={styles.kommentarTekst} data-testid="sendt-kommentar">
              {forste.sendt}
            </p>
          ) : (
            <p className={styles.dempet} data-testid="sendt-kommentar">
              (tom kommentar — fjerning)
            </p>
          )}
          {forsok.length > 1 && (
            <p className={styles.dempet} data-testid="antall-forsok">
              {forsok.length} forsøk med denne teksten er sendt uten svar. Ingen av dem er avklart.
            </p>
          )}
          {(kontroll === "annet" || kontroll === "likKilde") && gjeldende}
          <div className={styles.knapper}>
            <button
              type="button"
              className={styles.sekundar}
              onClick={() => void sjekk()}
              disabled={sjekker || lagrer}
            >
              {sjekker ? "Sjekker…" : "Sjekk om kommentaren ble lagret"}
            </button>
            {kontroll === "likSendt" && (
              <button type="button" className={styles.primar} onClick={godta}>
                Godta nåtilstanden
              </button>
            )}
            {kontroll === "likKilde" && (
              <button
                type="button"
                className={styles.primar}
                onClick={() => void lagrePaaNytt()}
                disabled={lagrer}
              >
                {lagrer ? "Lagrer…" : "Lagre på nytt"}
              </button>
            )}
            {kontroll === "annet" && (
              <button type="button" className={styles.sekundar} onClick={brukGjeldende}>
                Bruk gjeldende kommentar som grunnlag
              </button>
            )}
            {(kontroll === "mangler" ||
              kontroll === "tvetydig" ||
              kontroll === "ikkeBerettiget" ||
              kontroll === "ugyldig") && (
              <button type="button" className={styles.sekundar} onClick={lukk}>
                Lukk
              </button>
            )}
          </div>
        </>
      )}

      {!iOppfolging && !utkast && (
        <>
          {tilstand.type === "ugyldig" ? (
            <p className={styles.dempet}>
              Kommentaren er lagret i en form appen ikke kan endre trygt.
            </p>
          ) : gjeldendeTekst ? (
            <p className={styles.kommentarTekst} data-testid="hendelse-kommentar">
              {gjeldendeTekst}
            </p>
          ) : (
            <p className={styles.dempet}>Ingen kommentar.</p>
          )}
          {tilstand.type !== "ugyldig" && (
            <button type="button" className={styles.sekundar} onClick={start}>
              {gjeldendeTekst ? "Rediger kommentar" : "Legg til kommentar"}
            </button>
          )}
        </>
      )}

      {!iOppfolging && utkast && (
        <>
          <textarea
            aria-label="Kommentar på hendelsen"
            value={utkast.tekst}
            onChange={(e) => setUtkast({ ...utkast, tekst: e.target.value })}
            rows={3}
            className={`${styles.felt} ${styles.kommentarFelt}`}
            disabled={lagrer}
          />
          <div className={styles.dempet}>
            Tom kommentar fjerner kommentaren. Bare kommentaren endres; beløp og plassering står.
          </div>
          {konflikt && (
            <>
              {gjeldende}
              <button type="button" className={styles.sekundar} onClick={brukGjeldende}>
                Bruk gjeldende kommentar som grunnlag
              </button>
            </>
          )}
          <div className={styles.knapper}>
            <button
              type="button"
              className={styles.sekundar}
              onClick={() => {
                setUtkast(null);
                nullstill();
              }}
              disabled={lagrer}
            >
              Avbryt
            </button>
            <button
              type="button"
              className={styles.primar}
              onClick={() => void lagre()}
              disabled={lagrer || konflikt || sperret}
            >
              {lagrer ? "Lagrer…" : "Lagre kommentar"}
            </button>
          </div>
        </>
      )}

      {melding && (
        <p
          className={melding.feil ? styles.feil : styles.dempet}
          role={melding.feil ? "alert" : "status"}
        >
          {melding.tekst}
        </p>
      )}
    </section>
  );
}
