import { Link, Outlet, useLocation } from "react-router-dom";
import { Icon } from "@components/Icon";
import { forsoningSkrivingAktiv } from "@hooks/forsoningAktivering";
import styles from "./ForvaltningLayout.module.css";
import { FORVALTNING_FANER, aktivFane } from "./forvaltningFaner";

/**
 * Forvaltning-rommets faste arbeidsbenk (#59), samme mønster som
 * Kjøkkenets `MatLayout`: en lavmælt fanerad rett over den globale
 * bunnmenyen, alltid på samme sted og uavhengig av hva som venter i
 * køene. Ulikt Kjøkkenet har fanene synlig navn under ikonet, fordi fem
 * økonomiske deler ikke er selvforklarende som ikoner alene på mobil.
 *
 * Følger forsoningsporten som forsiden: med porten av (rollback) er
 * Forvaltning broen til legacy, og da vises ingen fanerad.
 */
export function ForvaltningLayout() {
  const { pathname } = useLocation();
  if (!forsoningSkrivingAktiv()) return <Outlet />;
  const aktiv = aktivFane(pathname);
  return (
    <div>
      <nav className={styles.faner} aria-label="Forvaltning-navigasjon">
        {FORVALTNING_FANER.map((f) => {
          const erAktiv = f.til === aktiv;
          return (
            <Link
              key={f.til}
              to={f.til}
              className={erAktiv ? styles.faneAktiv : styles.fane}
              aria-current={erAktiv ? "page" : undefined}
            >
              <span className={styles.ikon} aria-hidden>
                <Icon name={f.ikon} size={18} />
              </span>
              <span className={styles.navn}>{f.navn}</span>
            </Link>
          );
        })}
      </nav>
      <div className={styles.innhold}>
        <Outlet />
      </div>
    </div>
  );
}
