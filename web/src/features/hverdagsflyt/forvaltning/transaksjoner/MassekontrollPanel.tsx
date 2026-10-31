import { useEffect, useRef, useState } from "react";
import type { KontrollRad } from "@domain/forsoning/kontrollrader";
import {
  type FrossetTreff,
  type MasseResultat,
  type MasseUtfall,
  TOMT_RESULTAT,
  antallAllerede,
  frysTreff,
  leggTil,
  medBegrensetSamtidighet,
  vurderTreff,
} from "@domain/forsoning/massekontroll";
import styles from "./KontrollOversikt.module.css";

/** Antall samtidige skrivinger (kontrollert batching). */
const SAMTIDIG = 4;

export interface MassekontrollPanelProps {
  /** Treffene for dagens søk og filtre (samme som tabellen/kortene viser). */
  utvalg: readonly KontrollRad[];
  /** Alle rader nå — brukes til å vurdere hver frosset post før skriving. */
  rader: readonly KontrollRad[];
  /** Søk og aktive filtre, som tekst for bekreftelsen. */
  beskrivelse: string[];
  onKvalitetssikring: (rad: KontrollRad, kvalitetssikret: boolean) => Promise<void>;
}

type Fase =
  | { type: "hvile" }
  | { type: "bekreft"; frosne: FrossetTreff[]; allerede: number }
  | { type: "lagrer"; ferdig: number; totalt: number }
  | { type: "resultat"; r: MasseResultat };

/**
 * «Kvalitetssikre alle treff (N)» (#59, 6544393790). Viser antall og en
 * bekreftelse med søk/filtre; ved bekreftelse fryses settet, hver post
 * vurderes mot dagens data før skriving, og resultatet rapporteres ærlig
 * (kontrollert / allerede kontrollert / endret eller feilet). Ingen
 * masseoppheving.
 */
export function MassekontrollPanel({
  utvalg,
  rader,
  beskrivelse,
  onKvalitetssikring,
}: MassekontrollPanelProps) {
  const [fase, setFase] = useState<Fase>({ type: "hvile" });
  const naaRader = useRef(rader);
  useEffect(() => {
    naaRader.current = rader;
  }, [rader]);

  const lagrer = fase.type === "lagrer";
  const n = utvalg.length;
  // Ingen handling uten noe å gjøre: tomt treffsett, eller alle er allerede kvalitetssikret.
  const noeAGjore = n > antallAllerede(utvalg);
  if (!noeAGjore && fase.type === "hvile") return null;

  const kjor = async (frosne: FrossetTreff[]) => {
    let r: MasseResultat = TOMT_RESULTAT;
    let ferdig = 0;
    setFase({ type: "lagrer", ferdig, totalt: frosne.length });
    await medBegrensetSamtidighet(frosne, SAMTIDIG, async (f) => {
      const naa = naaRader.current.find((x) => x.id === f.rad.id);
      const vurdering = vurderTreff(f, naa);
      let utfall: MasseUtfall;
      if (vurdering === "skriv") {
        try {
          // Frossen rad: lagrer det bekreftede grunnlaget med den frosne
          // gjeldende kontrollen som samtidighetsvakt.
          await onKvalitetssikring(f.rad, true);
          utfall = "kontrollert";
        } catch (err) {
          console.error("[Kvalitetssikring] Massekontroll feilet for én post:", err);
          utfall =
            err instanceof Error && err.name === "KontrollEndretAvAndre" ? "endret" : "feilet";
        }
      } else {
        utfall = vurdering;
      }
      r = leggTil(r, f, utfall);
      ferdig += 1;
      setFase({ type: "lagrer", ferdig, totalt: frosne.length });
    });
    setFase({ type: "resultat", r });
  };

  return (
    <section className={styles.masse} aria-label="Kvalitetssikre alle treff">
      {(fase.type === "hvile" || fase.type === "resultat") && noeAGjore && (
        <button
          type="button"
          className={styles.masseKnapp}
          onClick={() =>
            setFase({
              type: "bekreft",
              frosne: frysTreff(utvalg),
              allerede: antallAllerede(utvalg),
            })
          }
        >
          Kvalitetssikre alle treff ({n})
        </button>
      )}

      {fase.type === "bekreft" && (
        <div className={styles.masseBekreft} role="group" aria-label="Bekreft kvalitetssikring">
          <strong>
            Kvalitetssikre {fase.frosne.length}{" "}
            {fase.frosne.length === 1 ? "transaksjon" : "transaksjoner"}?
          </strong>
          <span>
            {beskrivelse.length > 0
              ? `Treff for ${beskrivelse.join(" · ")}.`
              : "Alle transaksjoner (ingen søk eller filtre)."}
            {fase.allerede > 0 && ` ${fase.allerede} er allerede kvalitetssikret og hoppes over.`}
          </span>
          <span className={styles.masseKnapper}>
            <button
              type="button"
              className={styles.masseKnapp}
              onClick={() => void kjor(fase.frosne)}
            >
              Kvalitetssikre {fase.frosne.length}
            </button>
            <button
              type="button"
              className={styles.masseAvbryt}
              onClick={() => setFase({ type: "hvile" })}
            >
              Avbryt
            </button>
          </span>
        </div>
      )}

      {lagrer && (
        <span role="status" aria-live="polite">
          Lagrer {fase.ferdig} av {fase.totalt}…
        </span>
      )}

      {fase.type === "resultat" && (
        <div role="status" className={styles.masseResultat}>
          <span>
            {fase.r.kontrollert} kvalitetssikret · {fase.r.allerede} allerede kvalitetssikret
            {fase.r.endret > 0 && ` · ${fase.r.endret} endret siden forhåndsvisning`}
            {fase.r.feilet > 0 && ` · ${fase.r.feilet} ble ikke lagret`}
          </span>
          {fase.r.ikkeKontrollert.length > 0 && (
            <span className={styles.masseFeil}>
              Ikke kvalitetssikret:{" "}
              {fase.r.ikkeKontrollert
                .slice(0, 5)
                .map((x) => x.tekst)
                .join(", ")}
              {fase.r.ikkeKontrollert.length > 5 && ` og ${fase.r.ikkeKontrollert.length - 5} til`}.
              De står fortsatt uten hake og kan tas på nytt.
            </span>
          )}
          <button
            type="button"
            className={styles.masseAvbryt}
            onClick={() => setFase({ type: "hvile" })}
          >
            Lukk
          </button>
        </div>
      )}
    </section>
  );
}
