import type { CSSProperties } from "react";
import { ICON_ASSETS, type IconName } from "./icons";
import styles from "./Icon.module.css";

export interface IconProps {
  /** Kun navn fra det faktiske ikonregisteret (`icons.ts`) — et ukjent navn er en kompileringsfeil, aldri en runtime-404. */
  name: IconName;
  /** Kantlengde i px. Samme størrelse brukes for høyde og bredde — ingen av dagens ikoner er ikke-kvadratiske. */
  size?: number;
  /**
   * CSS-fargeverdi. Standard `currentColor` — ikonet arver da fargen til
   * sin nærmeste tekst-`color`, slik at samme komponent kan brukes i
   * Hjem/Mat/Handle uten at hvert kallested må sette en eksplisitt farge
   * (§Kontrolltårn-handoff, Issue #20). Produksjonens `Ikon` bruker en fast
   * standardfarge (`#3B352F`) — bevisst avvik her, siden `currentColor` er
   * riktigere for en komponent som skal brukes av flere, ennå ikke
   * fargesatte rom.
   */
  color?: string;
  className?: string;
  style?: CSSProperties;
  /**
   * Tilgjengelig navn — sett KUN når ikonet alene bærer mening (ingen
   * synlig tekst ved siden av, f.eks. et ikon-only-knapp). Når `label`
   * utelates (vanligst — de fleste ikoner her følger allerede synlig
   * tekst, se f.eks. `MatLayout`s fane-rader) skjules ikonet for
   * skjermleser (`aria-hidden`), samme prinsipp som produksjonens
   * `aria-hidden="true"` på `Ikon`/`Em`.
   */
  label?: string;
}

/**
 * Delt ikon-atom — porterer produksjonens `Ikon`-mønster (§index.html
 * linje 1966–1973: CSS-maskering mot en ekstern, urørt SVG-fil, farge
 * styrt via `background-color`) til `web/`, med et eksplisitt, typesikkert
 * navneregister i stedet for produksjonens kjøretids-strengmal
 * (`` url(assets/icons/${navn}.svg) ``, §Kontrolltårn-handoff, Issue #20).
 *
 * Ren infrastruktur — ingen Mat-skjerm bruker denne ennå, ingen emoji er
 * byttet ut. Se `icons.ts` for hvilke ikonnavn som faktisk finnes.
 */
export function Icon({
  name,
  size = 20,
  color = "currentColor",
  className,
  style,
  label,
}: IconProps) {
  // Sitatert URL — IKKE bare `url(${...})` (slik produksjonens Ikon gjør,
  // trygt der siden dens verdi alltid er en enkel relativ filsti uten
  // spesialtegn). Vite kan inline små SVG-er som `data:image/svg+xml,...`
  // — en verdi som ofte inneholder uescapede anførselstegn/spesialtegn
  // (SVG-attributter bruker `'`) som gjør en usitert `url()`-verdi
  // ugyldig per CSS-spec. Funnet ved at et jsdom-testmiljø (som validerer
  // strengt) forkastet HELE mask-image-deklarasjonen stille — samme
  // underliggende skjørhet ville også rammet ekte nettlesere avhengig av
  // SVG-ens faktiske innhold.
  const maskUrl = `url("${ICON_ASSETS[name]}")`;
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={className ? `${styles.icon} ${className}` : styles.icon}
      style={{
        width: size,
        height: size,
        backgroundColor: color,
        WebkitMaskImage: maskUrl,
        maskImage: maskUrl,
        ...style,
      }}
    />
  );
}
