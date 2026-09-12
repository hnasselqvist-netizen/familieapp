import { NavLink, Outlet } from "react-router-dom";
import { Icon } from "@components/Icon";
import type { IconName } from "@components/icons";
import styles from "./MatLayout.module.css";

const TABS: { to: string; icon: IconName; label: string }[] = [
  { to: "/mat/plan", icon: "calendar-days", label: "Plan" },
  // "folder-open" er valgt fra det eksisterende ikon-registeret som
  // nærmeste semantiske treff for "familiens repertoar" — Bibliotek har
  // ingen egen, bespoke Lucide-asset ennå (§Kontrolltårn-handoff, Issue
  // #20, "hovedløft": "et lite antall... når et reelt hull finnes,
  // særlig Bibliotek"). Rapportert som observasjon i PR-en fremfor å
  // hånd-lage en ny SVG uten en pålitelig kilde å verifisere den mot.
  { to: "/mat/bibliotek", icon: "folder-open", label: "Bibliotek" },
  { to: "/mat/kokebok", icon: "book-open", label: "Kokebok" },
  { to: "/mat/handle", icon: "shopping-cart", label: "Handle" },
  { to: "/mat/fryser", icon: "snowflake", label: "Fryser" },
];

/**
 * Intern Kjøkken-navigasjon for Mat-området (§Kontrolltårn-handoff,
 * Issue #20, "hovedløft: ... gjør Mat til Kjøkkenet visuelt, på
 * ordentlig") — erstatter den forrige emoji-/pille-baserte fanebaren
 * med samme Lucide-ikonfamilie som resten av Hverdagsflyt (`Icon`,
 * §components/Icon.tsx), i `--g-*`-paletten. Strukturen (fem faste
 * faner, ekte ruter) og rekkefølgen er uendret fra forrige skive — kun
 * det visuelle uttrykket er byttet.
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
            <Icon name={tab.icon} size={18} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}
