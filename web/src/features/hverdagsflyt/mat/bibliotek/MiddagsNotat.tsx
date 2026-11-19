import { useRef, useState } from "react";
import { Button } from "@components/Button";
import {
  MAKS_NOTAT,
  type NotatOppfolging,
  type NotatUtfall,
  normaliserNotat,
  notatTekst,
  oppfolgingTekst,
} from "@domain/mealLibrary/notat";
import type { MealLibraryEntry } from "@app-types/shopping";
import styles from "./MealLibraryScreen.module.css";

interface Props {
  /** Middagen slik abonnementet viser den nå. Komponenten nøkles på `entry.id`. */
  entry: MealLibraryEntry;
  lagreNotat: (mealId: string, kilde: string | undefined, utkast: string) => Promise<NotatUtfall>;
  sjekkNotat: (
    mealId: string,
    kilde: string | undefined,
    utkast: string,
  ) => Promise<NotatOppfolging | "avvist" | "byttet" | "ikkeLest">;
}

/** Utkastet er bundet til middagen og notatet det startet fra. */
interface Utkast {
  mealId: string;
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
 * - Ved et tapt svar (`ukjent`) er «Lagre notat» sperret til en skrivefri
 *   kontroll har avklart om notatet ble lagret. Ingen blind ny skriving.
 * - Én lagring om gangen; dobbeltklikk sender én gang.
 */
export function MiddagsNotat({ entry, lagreNotat, sjekkNotat }: Props) {
  const [utkast, setUtkast] = useState<Utkast | null>(null);
  const [melding, setMelding] = useState<Melding | null>(null);
  const [uavklart, setUavklart] = useState(false);
  const [konflikt, setKonflikt] = useState(false);
  const [mangler, setMangler] = useState(false);
  const [lagrer, setLagrer] = useState(false);
  const [sjekker, setSjekker] = useState(false);
  const opptatt = useRef(false);

  const navn = entry.name;
  const aktivtUtkast = utkast && utkast.mealId === entry.id ? utkast : null;

  const start = () => {
    setUtkast({ mealId: entry.id, kilde: entry.notat, tekst: entry.notat ?? "" });
    setMelding(null);
    setKonflikt(false);
    setMangler(false);
    setUavklart(false);
  };
  const avbryt = () => {
    setUtkast(null);
    setMelding(null);
    setKonflikt(false);
    setMangler(false);
    setUavklart(false);
  };

  const ferdig = (tekst: string) => {
    setUtkast(null);
    setKonflikt(false);
    setUavklart(false);
    setMelding({ tekst, feil: false });
  };

  const lagre = async () => {
    if (!aktivtUtkast || opptatt.current || uavklart) return;
    opptatt.current = true;
    setLagrer(true);
    setMelding(null);
    let r: NotatUtfall;
    try {
      r = await lagreNotat(aktivtUtkast.mealId, aktivtUtkast.kilde, aktivtUtkast.tekst);
    } catch (err) {
      console.error("[Middagsbibliotek] lagring av notat feilet:", err);
      r = "ukjent";
    } finally {
      opptatt.current = false;
      setLagrer(false);
    }
    if (r === "lagret" || r === "allerede") {
      ferdig(notatTekst(r, navn));
      return;
    }
    setKonflikt(r === "konflikt");
    setMangler(r === "mangler");
    setUavklart(r === "ukjent");
    setMelding({ tekst: notatTekst(r, navn), feil: true });
  };

  const sjekk = async () => {
    if (!aktivtUtkast || opptatt.current) return;
    opptatt.current = true;
    setSjekker(true);
    let o: NotatOppfolging | "avvist" | "byttet" | "ikkeLest";
    try {
      o = await sjekkNotat(aktivtUtkast.mealId, aktivtUtkast.kilde, aktivtUtkast.tekst);
    } catch (err) {
      console.error("[Middagsbibliotek] kontroll av notat feilet:", err);
      o = "ikkeLest";
    } finally {
      opptatt.current = false;
      setSjekker(false);
    }
    if (o === "lagret") {
      ferdig(oppfolgingTekst(o, navn));
      return;
    }
    // Avklart at notatet IKKE ble lagret: nytt forsøk er trygt.
    if (o === "ikkeLagret" || o === "endret" || o === "mangler" || o === "ugyldig") {
      setUavklart(false);
    }
    setKonflikt(o === "endret");
    setMangler(o === "mangler");
    setMelding({ tekst: oppfolgingTekst(o, navn), feil: true });
  };

  /** Eksplisitt valg etter konflikt: det gjeldende notatet blir nytt grunnlag, utkastet står. */
  const nyttGrunnlag = () => {
    if (!aktivtUtkast) return;
    setUtkast({ ...aktivtUtkast, kilde: entry.notat });
    setKonflikt(false);
    setMelding(null);
  };

  const utkastNormalisert = aktivtUtkast ? normaliserNotat(aktivtUtkast.tekst) : undefined;
  const forLangt = (utkastNormalisert?.length ?? 0) > MAKS_NOTAT;

  return (
    <section aria-label={`Notat for ${navn}`} className={styles.notatSeksjon}>
      <div className={styles.formLabel}>
        Notat <span className={styles.optional}>(valgfritt)</span>
      </div>

      {!aktivtUtkast && (
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

      {aktivtUtkast && (
        <>
          <textarea
            aria-label={`Notat for ${navn}`}
            value={aktivtUtkast.tekst}
            onChange={(e) => setUtkast({ ...aktivtUtkast, tekst: e.target.value })}
            rows={4}
            maxLength={MAKS_NOTAT}
            className={styles.notatInput}
            disabled={lagrer}
          />
          <div className={styles.fieldHint}>
            Tomt notat fjerner notatet. Høyst {MAKS_NOTAT} tegn.
          </div>
          {konflikt && (
            <div className={styles.notatGjeldende}>
              <div className={styles.formLabel}>Gjeldende notat</div>
              {entry.notat ? (
                <p className={styles.notatTekst}>{entry.notat}</p>
              ) : (
                <p className={styles.fieldHint}>Ingen notat.</p>
              )}
              <Button variant="secondary" size="compact" onClick={nyttGrunnlag}>
                Bruk gjeldende notat som grunnlag
              </Button>
            </div>
          )}
          <div className={styles.notatHandlinger}>
            <Button
              size="compact"
              onClick={() => void lagre()}
              loading={lagrer}
              disabled={uavklart || mangler || konflikt || sjekker || forLangt}
            >
              Lagre notat
            </Button>
            {uavklart && (
              <Button
                variant="secondary"
                size="compact"
                onClick={() => void sjekk()}
                loading={sjekker}
              >
                Sjekk om notatet ble lagret
              </Button>
            )}
            <Button
              variant="secondary"
              size="compact"
              onClick={avbryt}
              disabled={lagrer || sjekker}
            >
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
