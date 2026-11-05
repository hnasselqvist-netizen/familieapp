import { Link } from "react-router-dom";
import { Card } from "@components/Card";
import type { ForfallsdagMangel, PrognoseKildeType } from "@domain/liquidity/forfallsdag";
import type { Loadable } from "@app-types/status";
import { okonomiLenke } from "../okonomi/okonomiLenke";
import styles from "./ForfallsdagVarsel.module.css";

const TYPE_NAVN: Record<PrognoseKildeType, string> = {
  inntekter: "Inntekt",
  kostnader: "Kostnad",
  sparing: "Sparing",
};

/**
 * Presist om standardgenereringen (review 5790655651): varselet vet ikke om
 * en faktisk prognosepost finnes — beløp, periode og manuelt overstyrte
 * poster avgjør det — så det sier bare hva generatoren kan gjøre med
 * dagen, og at eksisterende overstyrte poster står uendret.
 */
function statusTekst(m: ForfallsdagMangel): string {
  const verdi = m.verdi.trim() ? `Ugyldig forfallsdag «${m.verdi}»` : "Mangler forfallsdag";
  return m.status === "utelatt"
    ? `${verdi} – generatoren kan ikke lage standardposter for denne. Manuelt overstyrte poster står uendret og kan være med i prognosen.`
    : `${verdi} – generatoren tolker dagen når den lager standardposter. Kontroller dagen.`;
}

/**
 * Funn F (#59): automatiske prognosekilder uten gyldig forfallsdag.
 * Skrivefri: viser bare hva som mangler og lenker til postens eksisterende
 * detaljredigering i Økonomi. Ingen utfylling, deaktivering eller retting.
 * Viser aldri «alt klart» — mens kildene lastes eller ved feil står det
 * eksplisitt at grunnlaget ikke er kontrollert.
 */
export function ForfallsdagVarsel({ mangler }: { mangler: Loadable<ForfallsdagMangel[]> }) {
  if (mangler.status === "not_loaded" || mangler.status === "loading") {
    return (
      <p role="status" className={styles.dempet}>
        Kontrollerer forfallsdager i prognosegrunnlaget…
      </p>
    );
  }
  if (mangler.status === "error") {
    return (
      <p role="alert" className={styles.feil}>
        Kunne ikke kontrollere forfallsdager i prognosegrunnlaget. Prognosen kan mangle poster.
      </p>
    );
  }
  if (mangler.data.length === 0) return null;
  const antall = mangler.data.length;
  return (
    <section aria-labelledby="forfallsdag-varsel" className={styles.seksjon}>
      <Card accent="var(--color-clay)" style={{ padding: "10px 12px" }}>
        <h2 id="forfallsdag-varsel" className={styles.tittel}>
          Prognosegrunnlag ufullstendig
        </h2>
        <p className={styles.ingress}>
          {antall === 1
            ? "1 automatisk post trenger forfallsdag."
            : `${antall} automatiske poster trenger forfallsdag.`}
        </p>
        <ul className={styles.liste}>
          {mangler.data.map((m) => (
            <li key={`${m.type}/${m.gruppeId}/${m.postId}`} className={styles.rad}>
              <div className={styles.navn}>
                {TYPE_NAVN[m.type]} · {m.gruppeNavn} · {m.postNavn}
              </div>
              <div className={styles.status}>{statusTekst(m)}</div>
              {m.iOkonomi ? (
                <Link
                  className={styles.lenke}
                  to={okonomiLenke(m.type, { gruppeId: m.gruppeId, postId: m.postId })}
                  aria-label={`Rett forfallsdag for ${m.postNavn} (${TYPE_NAVN[m.type].toLowerCase()}, ${m.gruppeNavn}) i Økonomi`}
                >
                  Rett i Økonomi
                </Link>
              ) : (
                <div className={styles.status}>
                  Gruppen «{m.gruppeId}» vises ikke i Økonomi og kan ikke rettes her.
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
