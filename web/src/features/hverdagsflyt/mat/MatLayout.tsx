import { NavLink, Outlet } from "react-router-dom";
import styles from "./MatLayout.module.css";

const TABS = [
  { to: "/mat/plan", emoji: "📅", label: "Plan" },
  { to: "/mat/bibliotek", emoji: "📚", label: "Bibliotek" },
  { to: "/mat/kokebok", emoji: "📖", label: "Kokebok" },
  { to: "/mat/handle", emoji: "🛍️", label: "Handle" },
  { to: "/mat/fryser", emoji: "❄️", label: "Fryser" },
];

/**
 * Intern fane-navigasjon for Mat-området — portert fra `MatScreen` sin
 * fanebar (index.html linje ~2266–2309), som ekte ruter i stedet for
 * lokal `sub`-tilstand. Rekkefølgen er uendret. Fanene som ennå ikke er
 * migrert (`Plan`/`Bibliotek`/`Handle`) peker til `LegacyBridge` inntil
 * de får sin egen skjerm.
 */
export function MatLayout() {
  return (
    <div>
      <nav className={styles.tabs}>
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => (isActive ? styles.tabActive : styles.tab)}
          >
            <span className={styles.tabEmoji}>{tab.emoji}</span>
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
