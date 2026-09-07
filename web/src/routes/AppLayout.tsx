import { NavLink, Outlet } from "react-router-dom";
import styles from "./AppLayout.module.css";

const NAV_ITEMS = [
  { to: "/", label: "Hjem" },
  { to: "/mat/fryser", label: "Mat" },
  { to: "/forvaltning", label: "Forvaltning" },
  { to: "/hjem-familie", label: "Hjem & familie" },
  { to: "/verktoy", label: "Verktøy" },
];

const isPreview = import.meta.env.VITE_DEPLOY_TARGET === "preview";

/**
 * Rute-skallet for hele det tiltenkte rutetreet (§Fase 0, punkt 5) —
 * satt opp fra dag én selv om kun Fryser har en ekte skjerm bak seg i
 * dag. De andre lenkene går til LegacyBridge til de migreres.
 */
export function AppLayout() {
  return (
    <div className={styles.root}>
      {isPreview && (
        <div className={styles.previewBanner} role="status">
          PREVIEW — ekte produksjonsdata, ikke en sandkasse
        </div>
      )}
      <header className={styles.header}>
        <span className={styles.logo}>🏡 Hverdagsflyt</span>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? styles.navLinkActive : styles.navLink)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
