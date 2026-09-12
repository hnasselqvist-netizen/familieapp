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
 * Intern Kjøkken-navigasjon for Mat-området — leses som en lavmælt
 * arbeidsbenk/hylle i rommet, ikke en administrativ fanebar
 * (§docs/produktfasit/visuelt-designsystem.md §7, §Kontrolltårn-review,
 * PR #26). Samme Lucide-ikonfamilie (`Icon`, §components/Icon.tsx) som
 * resten av Hverdagsflyt, i `--g-*`-paletten, med en myk, organisk
 * aktivmarkør bak selve ikonet i stedet for forrige segmenterte
 * "boks"-uttrykk. Strukturen (fem faste faner, ekte ruter) og
 * rekkefølgen er uendret.
 *
 * **Design-review runde 3: flyttet til bunnen, ikon-only**
 * (§Helen-review, PR #26): navigasjonen lå tidligere øverst i rommet —
 * flyttet nå til en fast, sekundær ikonrad RETT OVER den globale
 * `BottomNav`, slik at toppen av Kjøkkenet er fri til at rom/dato/
 * tittel/hovedmøbel dominerer. Synlig tekst under ikonene er fjernet —
 * navnet lever som `aria-label`. `.outlet` gir Kjøkken-innholdet nok
 * bunnpadding til å aldri havne bak denne sekundære raden, i tillegg
 * til `AppLayout.main` sin egen klaring for den globale raden under.
 */
export function MatLayout() {
  return (
    <div>
      <nav className={styles.tabs} aria-label="Kjøkken-navigasjon">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) => (isActive ? styles.tabActive : styles.tab)}
            aria-label={tab.label}
          >
            <span className={styles.iconWrap}>
              <Icon name={tab.icon} size={19} />
            </span>
          </NavLink>
        ))}
      </nav>
      <div className={styles.outlet}>
        <Outlet />
      </div>
    </div>
  );
}
