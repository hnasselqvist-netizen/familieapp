import { useRef, useState } from "react";
import { Button } from "@components/Button";
import {
  MAKS_NOTAT,
  type NotatForsok,
  type NotatNaatilstand,
  type NotatUtfall,
  avsluttetTekst,
  naatilstandTekst,
  normaliserNotat,
  notatTekst,
  nyttForsokTekst,
} from "@domain/mealLibrary/notat";
import type { MealLibraryEntry } from "@app-types/shopping";
import styles from "./MealLibraryScreen.module.css";

type Kontroll = NotatNaatilstand | "avvist" | "byttet" | "ikkeLest";

interface Props {
  /** Middagen slik abonnementet viser den nå. */
  entry: MealLibraryEntry;
  /** Familie og innloggingssesjon nye forsøk bindes til. */
  kontekst: string;
  /** Om en kontekst er den gjeldende AKKURAT NÅ (ikke bare i siste tegning). */
  erGjeldende: (kontekst: string) => boolean;
  lagreNotat: (
    kontekst: string,
    mealId: string,
    kilde: string | undefined,
    utkast: string,
  ) => Promise<NotatUtfall>;
  sjekkNotat: (forsok: NotatForsok) => Promise<Kontroll>;
  /**
   * Alle sendte forsøk med ukjent utfall for denne middagen og konteksten,
   * eldste først. Eies av skjermen, så Avbryt, lukking og gjenåpning ikke
   * glemmer dem.
   */
  forsok: readonly NotatForsok[];
  /**
   * Endrer listen for `kontekst`/`mealId`, altså forsøkets EGEN kontekst,
   * aldri den som vises når svaret kommer.
   */
  oppdaterForsok: (
    kontekst: string,
    mealId: string,
    endre: (liste: readonly NotatForsok[]) => readonly NotatForsok[],
  ) => void;
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
 *   middag, kilde, sendt tekst og kontekst. Så lenge et finnes, kan feltet
 *   ikke redigeres og ingen ny lagring startes. Kontrollen leser alltid mot
 *   det sendte forsøket og avklarer det ikke alene.
 * - «Lagre på nytt» er et NYTT forsøk med eget, separat resultat (review
 *   5969643874). Et sikkert avslag avgjør bare det nye forsøket; et nytt
 *   `ukjent` legges til listen. Hva som avslutter oppfølgingen, står ved
 *   `NotatForsok`.
 * - Et svar som kommer etter at konteksten er byttet, vises aldri her. Et
 *   `ukjent` registreres likevel under forsøkets egen kontekst.
 * - Én lagring om gangen; dobbeltklikk sender én gang.
 */
export function MiddagsNotat({
  entry,
  kontekst,
  erGjeldende,
  lagreNotat,
  sjekkNotat,
  forsok,
  oppdaterForsok,
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
  const forste = forsok[0];
  const iOppfolging = forste !== undefined;

  const nullstill = () => {
    setMelding(null);
    setKonflikt(false);
    setMangler(false);
    setKontroll(null);
  };
  const start = () => {
    if (iOppfolging) return;
    setUtkast({ kilde: entry.notat, tekst: entry.notat ?? "" });
    nullstill();
  };
  const avbryt = () => {
    setUtkast(null);
    nullstill();
  };
  const avslutt = () => oppdaterForsok(kontekst, entry.id, () => []);

  /**
   * Sender ett versjonsbetinget forsøk. Et `ukjent` registreres alltid under
   * forsøkets egen kontekst. Gir `null` når konteksten er byttet mens svaret
   * ble ventet på: da anvendes ingenting på det som vises nå.
   */
  const kjor = async (nytt: NotatForsok, tekst: string): Promise<NotatUtfall | null> => {
    opptatt.current = true;
    setLagrer(true);
    setMelding(null);
    let r: NotatUtfall;
    try {
      r = await lagreNotat(nytt.kontekst, nytt.mealId, nytt.kilde, tekst);
    } catch (err) {
      console.error("[Middagsbibliotek] lagring av notat feilet:", err);
      r = "ukjent";
    } finally {
      opptatt.current = false;
      setLagrer(false);
    }
    if (r === "ukjent") oppdaterForsok(nytt.kontekst, nytt.mealId, (l) => [...l, nytt]);
    if (!erGjeldende(nytt.kontekst)) return null;
    setKontroll(null);
    return r;
  };

  /** «Lagre notat» fra utkastet. Finnes bare når ingen oppfølging pågår. */
  const lagre = async () => {
    if (!utkast || iOppfolging || opptatt.current) return;
    const { kilde, tekst } = utkast;
    const r = await kjor(
      { kontekst, mealId: entry.id, kilde, sendt: normaliserNotat(tekst) },
      tekst,
    );
    if (r === null) return;
    if (r === "ukjent") {
      // Uavklart: forsøket er fryst. Feltet viser det som ble sendt.
      setUtkast(null);
      setKonflikt(false);
      setMangler(false);
      setMelding({ tekst: notatTekst(r, navn), feil: true });
      return;
    }
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

  const sjekk = async () => {
    if (!forste || opptatt.current) return;
    const maal = forste; // uforanderlig: aldri dagens felt
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
    if (!erGjeldende(maal.kontekst)) return;
    setKontroll(o);
    setMelding({ tekst: naatilstandTekst(o, navn), feil: true });
  };

  // ── Eksplisitte, kontrollerte valg etter kontroll ─────────────────────

  /**
   * «Lagre på nytt»: et NYTT versjonsbetinget forsøk med samme kontekst, kilde
   * og tekst. Kan ikke overskrive blindt. Bare `lagret`/`allerede` avslutter
   * oppfølgingen; et sikkert avslag gjelder bare det nye forsøket.
   */
  const lagrePaaNytt = async () => {
    if (!forste || opptatt.current) return;
    const r = await kjor({ ...forste }, forste.sendt ?? "");
    if (r === null) return;
    if (r === "lagret" || r === "allerede") avslutt();
    setMelding({
      tekst: nyttForsokTekst(r, navn),
      feil: r !== "lagret" && r !== "allerede",
    });
  };
  /** `likSendt`: brukeren godtar nåtilstanden. */
  const godta = () => {
    avslutt();
    setUtkast(null);
    nullstill();
    setMelding({ tekst: avsluttetTekst("godta", navn), feil: false });
  };
  /** Gjeldende notat blir nytt grunnlag; den sendte teksten blir utkast. */
  const brukGjeldende = () => {
    if (forste) {
      const tekst = forste.sendt ?? "";
      avslutt();
      setUtkast({ kilde: entry.notat, tekst });
      nullstill();
      setMelding({ tekst: avsluttetTekst("grunnlag", navn), feil: false });
      return;
    }
    if (utkast) setUtkast({ ...utkast, kilde: entry.notat });
    nullstill();
  };
  const lukk = () => {
    avslutt();
    setUtkast(null);
    nullstill();
    setMelding({ tekst: avsluttetTekst("lukk", navn), feil: false });
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

      {forste && (
        <>
          <div className={styles.fieldHint}>Sendt, ikke avklart:</div>
          {forste.sendt !== undefined ? (
            <p className={styles.notatTekst} data-testid="sendt-notat">
              {forste.sendt}
            </p>
          ) : (
            <p className={styles.fieldHint} data-testid="sendt-notat">
              (tomt notat — fjerning)
            </p>
          )}
          {forsok.length > 1 && (
            <p className={styles.fieldHint} data-testid="antall-forsok">
              {forsok.length} forsøk med denne teksten er sendt uten svar. Ingen av dem er avklart.
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
              <Button
                size="compact"
                onClick={() => void lagrePaaNytt()}
                loading={lagrer}
                disabled={sjekker}
              >
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

      {!iOppfolging && !utkast && (
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

      {!iOppfolging && utkast && (
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
              onClick={() => void lagre()}
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
