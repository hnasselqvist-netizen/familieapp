import { useLocation, Link } from "react-router-dom";
import { Icon } from "./Icon";
import type { IconName } from "./icons";
import styles from "./BottomNav.module.css";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Prefix matched against the current path to decide the active state — lets "Mat" stay lit across every /mat/* screen while itself linking to /mat/plan. */
  matchPrefix: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Hjem", icon: "house", matchPrefix: "/" },
  { to: "/mat/plan", label: "Mat", icon: "soup", matchPrefix: "/mat" },
  {
    to: "/forvaltning",
    label: "Forvaltning",
    icon: "badge-dollar-sign",
    matchPrefix: "/forvaltning",
  },
  {
    to: "/hjem-familie",
    label: "Hjem & familie",
    icon: "house-heart",
    matchPrefix: "/hjem-familie",
  },
  { to: "/verktoy", label: "Mer", icon: "ellipsis", matchPrefix: "/verktoy" },
];

/**
 * Global bunn-navigasjon for hele Hverdagsflyt-skallet — porterer
 * produksjonens `BottomNav` (§index.html linje 2218-2258) med visuell og
 * funksjonell paritet som mål, som ekte React Router-lenker i stedet for
 * `tab`/`setTab`-lokal state. Samme fem faner, samme ikoner
 * (`house`/`soup`/`badge-dollar-sign`/`house-heart`/`ellipsis`, alle
 * allerede i ikon-registeret — ingen nye assets), samme grønne
 * aktiv-tilstand og indikatorlinje.
 *
 * "Hjem" bruker eksakt prefiks-match (`/`) mens de andre bruker
 * `startsWith` — ellers ville "Hjem" lyst opp på alle andre ruter siden
 * enhver path starter med `/`. "Mat" er aktiv for HELE `/mat/*`-treet
 * (Plan/Bibliotek/Kokebok/Handle/Fryser), ikke bare når man faktisk står
 * på `/mat/plan` — `NavLink`s innebygde prefiks-matching alene dekker
 * ikke dette siden lenkemålet og aktiv-området er to forskjellige ting
 * her, derfor `useLocation()` + egen `matchPrefix` fremfor `NavLink`.
 *
 * **Design-review runde 3: komprimert ikonrad** (§Helen-review, PR #26):
 * synlig tekst under ikonene er fjernet — navnet lever nå kun som
 * `aria-label` på selve lenken, som fortsatt gir samme tilgjengelige navn
 * (`getByRole("link", {name: "Hjem"})` fungerer uendret). Målet er en
 * diskret global navigasjon som føles som appskall, ikke et stort møbel.
 */
export function BottomNav() {
  const location = useLocation();
  return (
    <nav className={styles.nav} aria-label="Hovednavigasjon">
      {NAV_ITEMS.map((item) => {
        const active =
          item.matchPrefix === "/"
            ? location.pathname === "/"
            : location.pathname.startsWith(item.matchPrefix);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={active ? styles.itemActive : styles.item}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
          >
            {active && <span className={styles.indicator} aria-hidden="true" />}
            <Icon name={item.icon} size={22} />
          </Link>
        );
      })}
    </nav>
  );
}
