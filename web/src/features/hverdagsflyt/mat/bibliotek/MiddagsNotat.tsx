import { useRef, useState } from "react";
import { Button } from "@components/Button";
import {
  MAKS_NOTAT,
  type NotatForsok,
  type NotatNaatilstand,
  type NotatUtfall,
  naatilstandTekst,
  normaliserNotat,
  notatTekst,
} from "@domain/mealLibrary/notat";
import type { MealLibraryEntry } from "@app-types/shopping";
import styles from "./MealLibraryScreen.module.css";

type Kontroll = NotatNaatilstand | "avvist" | "byttet" | "ikkeLest";

interface Props {
  /** Middagen slik abonnementet viser den nå. */
  entry: MealLibraryEntry;
  /** Familie og innlogging (`familie:uid`) nye forsøk bindes til. */
  kontekst: string;
  lagreNotat: (mealId: string, kilde: string | undefined, utkast: string) => Promise<NotatUtfall>;
  sjekkNotat: (forsok: NotatForsok) => Promise<Kontroll>;
  /**
   * Et sendt forsøk med ukjent utfall for denne middagen og konteksten, eller
   * `null`. Eies av skjermen, så Avbryt, lukking og gjenåpning ikke glemmer det.
   */
  forsok: NotatForsok | null;
  settForsok: (forsok: NotatForsok | null) => void;
}

/** Utkastet: redigerbar tekst og notatet det startet fra. */
interface Utkast {
  kilde: string | undefined;
  tekst: string;
}

type Melding = { tekst: string; feil: boolean };

/**
 * Notat på én bibliotekmiddag (Mat #20, ordre 6998241717). Visning med
 * bevarte linjeskift, og redigering i et utkast som lagres bare med
 * «Lagre notat». Ingen autosave.
 *
 * - Utkastet husker notatet det startet fra (`kilde`). Er notatet endret
 *   siden, gir lagringen konflikt, og utkastet står. Brukeren kan da
 *   eksplisitt bruke det gjeldende notatet som nytt grunnlag.
 * - Et tapt svar (`ukjent`) gir et uforanderlig forsøk (review 5969230962):
 *   middag, kilde, sendt tekst og kontekst. Så lenge det finnes, kan feltet
 *   ikke redigeres og ingen ny lagring startes. Kontrollen leser alltid mot
 *   DETTE forsøket. Den viser nåtilstanden og avklarer ikke forsøket alene:
 *   bare et eksplisitt valg fra brukeren går videre.
 * - Én lagring om gangen; dobbeltklikk sender én gang.
 */
export function MiddagsNotat({
  entry,
  kontekst,
  lagreNotat,
  sjekkNotat,
  forsok,
  settForsok,
}: Props) {
  const [utkast, setUtkast] = useState<Utkast | null>(null);
  const [melding, setMelding] = useState<Melding | null>(null);
  const [konflikt, setKonflikt] = useState(false);
  const [mangler, setMangler] = useState(false);
  const [kontroll, setKontroll] = useState<Kontroll | null>(null);
  const [lagrer, setLagrer] = useState(false);
  const [sjekker, setSjekker] = useState(false);
  const opptatt = useRef(false);

  const navn = entry.name;

  const nullstill = () => {
    setMelding(null);
    setKonflikt(false);
    setMangler(false);
    setKontroll(null);
  };
  const start = () => {
    if (forsok) return;
    setUtkast({ kilde: entry.notat, tekst: entry.notat ?? "" });
    nullstill();
  };
  const avbryt = () => {
    setUtkast(null);
    nullstill();
  };

  /** Sender ett versjonsbetinget forsøk og håndterer utfallet. */
  const send = async (kilde: string | undefined, tekst: string) => {
    if (opptatt.current) return;
    const nytt: NotatForsok = {
      kontekst,
      mealId: entry.id,
      kilde,
      sendt: normaliserNotat(tekst),
    };
    opptatt.current = true;
    setLagrer(true);
    setMelding(null);
    let r: NotatUtfall;
    try {
      r = await lagreNotat(nytt.mealId, nytt.kilde, tekst);
    } catch (err) {
      console.error("[Middagsbibliotek] lagring av notat feilet:", err);
      r = "ukjent";
    } finally {
      opptatt.current = false;
      setLagrer(false);
    }
    setKontroll(null);
    if (r === "ukjent") {
      // Uavklart: forsøket fryses. Feltet viser det som ble sendt.
      settForsok(nytt);
      setUtkast(null);
      setKonflikt(false);
      setMangler(false);
      setMelding({ tekst: notatTekst(r, navn), feil: true });
      return;
    }
    // Avgjort av serveren (eller stoppet før noe ble sendt): et eventuelt
    // tidligere uavklart forsøk er erstattet av dette.
    settForsok(null);
    if (r === "lagret" || r === "allerede") {
      setUtkast(null);
      setKonflikt(false);
      setMangler(false);
      setMelding({ tekst: notatTekst(r, navn), feil: false });
      return;
    }
    setUtkast({ kilde, tekst });
    setKonflikt(r === "konflikt");
    setMangler(r === "mangler");
    setMelding({ tekst: notatTekst(r, navn), feil: true });
  };

  const lagre = () => {
    if (!utkast || forsok) return;
    void send(utkast.kilde, utkast.tekst);
  };

  const sjekk = async () => {
    if (!forsok || opptatt.current) return;
    const maal = forsok; // uforanderlig: aldri dagens felt
    opptatt.current = true;
    setSjekker(true);
    let o: Kontroll;
    try {
      o = await sjekkNotat(maal);
    } catch (err) {
      console.error("[Middagsbibliotek] kontroll av notat feilet:", err);
      o = "ikkeLest";
    } finally {
      opptatt.current = false;
      setSjekker(false);
    }
    setKontroll(o);
    setMelding({ tekst: naatilstandTekst(o, navn), feil: true });
  };

  // ── Eksplisitte, kontrollerte valg etter kontroll ─────────────────────

  /** Nåtilstanden er slik brukeren ville ha den: brukeren godtar den. */
  const godta = () => {
    settForsok(null);
    setUtkast(null);
    nullstill();
    setMelding({ tekst: `Notatet på «${navn}» står slik du ville ha det.`, feil: false });
  };
  /** Nytt versjonsbetinget forsøk med samme kilde og tekst. Kan ikke overskrive blindt. */
  const lagrePaaNytt = () => {
    if (!forsok) return;
    void send(forsok.kilde, forsok.sendt ?? "");
  };
  /** Gjeldende notat blir nytt grunnlag; den sendte teksten blir utkast. */
  const brukGjeldende = () => {
    if (forsok) {
      const tekst = forsok.sendt ?? "";
      settForsok(null);
      setUtkast({ kilde: entry.notat, tekst });
    } else if (utkast) {
      setUtkast({ ...utkast, kilde: entry.notat });
    }
    nullstill();
  };
  const lukk = () => {
    settForsok(null);
    setUtkast(null);
    nullstill();
  };

  const forLangt = (normaliserNotat(utkast?.tekst ?? "")?.length ?? 0) > MAKS_NOTAT;
  const gjeldende = (
    <div className={styles.notatGjeldende}>
      <div className={styles.formLabel}>Gjeldende notat</div>
      {entry.notat ? (
        <p className={styles.notatTekst}>{entry.notat}</p>
      ) : (
        <p className={styles.fieldHint}>Ingen notat.</p>
      )}
    </div>
  );

  return (
    <section aria-label={`Notat for ${navn}`} className={styles.notatSeksjon}>
      <div className={styles.formLabel}>
        Notat <span className={styles.optional}>(valgfritt)</span>
      </div>

      {forsok && (
        <>
          <div className={styles.fieldHint}>Sendt, ikke avklart:</div>
          {forsok.sendt !== undefined ? (
            <p className={styles.notatTekst} data-testid="sendt-notat">
              {forsok.sendt}
            </p>
          ) : (
            <p className={styles.fieldHint} data-testid="sendt-notat">
              (tomt notat — fjerning)
            </p>
          )}
          {(kontroll === "annet" || kontroll === "likKilde") && gjeldende}
          <div className={styles.notatHandlinger}>
            <Button
              variant="secondary"
              size="compact"
              onClick={() => void sjekk()}
              loading={sjekker}
              disabled={lagrer}
            >
              Sjekk om notatet ble lagret
            </Button>
            {kontroll === "likSendt" && (
              <Button size="compact" onClick={godta} disabled={sjekker}>
                Godta nåtilstanden
              </Button>
            )}
            {kontroll === "likKilde" && (
              <Button size="compact" onClick={lagrePaaNytt} loading={lagrer} disabled={sjekker}>
                Lagre på nytt
              </Button>
            )}
            {kontroll === "annet" && (
              <Button
                variant="secondary"
                size="compact"
                onClick={brukGjeldende}
                disabled={sjekker || lagrer}
              >
                Bruk gjeldende notat som grunnlag
              </Button>
            )}
            {(kontroll === "mangler" || kontroll === "ugyldig") && (
              <Button variant="secondary" size="compact" onClick={lukk} disabled={sjekker}>
                Lukk
              </Button>
            )}
          </div>
        </>
      )}

      {!forsok && !utkast && (
        <>
          {entry.notat ? (
            <p className={styles.notatTekst} data-testid="middagsnotat">
              {entry.notat}
            </p>
          ) : (
            <p className={styles.fieldHint}>Ingen notat.</p>
          )}
          <Button variant="secondary" size="compact" onClick={start}>
            {entry.notat ? "Rediger notat" : "Legg til notat"}
          </Button>
        </>
      )}

      {!forsok && utkast && (
        <>
          <textarea
            aria-label={`Notat for ${navn}`}
            value={utkast.tekst}
            onChange={(e) => setUtkast({ ...utkast, tekst: e.target.value })}
            rows={4}
            maxLength={MAKS_NOTAT}
            className={styles.notatInput}
            disabled={lagrer}
          />
          <div className={styles.fieldHint}>
            Tomt notat fjerner notatet. Høyst {MAKS_NOTAT} tegn.
          </div>
          {konflikt && (
            <>
              {gjeldende}
              <div className={styles.notatHandlinger}>
                <Button variant="secondary" size="compact" onClick={brukGjeldende}>
                  Bruk gjeldende notat som grunnlag
                </Button>
              </div>
            </>
          )}
          <div className={styles.notatHandlinger}>
            <Button
              size="compact"
              onClick={lagre}
              loading={lagrer}
              disabled={mangler || konflikt || forLangt}
            >
              Lagre notat
            </Button>
            <Button variant="secondary" size="compact" onClick={avbryt} disabled={lagrer}>
              Avbryt
            </Button>
          </div>
        </>
      )}

      {melding && (
        <p
          className={melding.feil ? styles.feil : styles.fieldHint}
          role={melding.feil ? "alert" : "status"}
        >
          {melding.tekst}
        </p>
      )}
    </section>
  );
}
