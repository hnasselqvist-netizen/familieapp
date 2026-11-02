/**
 * Hverdagsflyt-rom (Gangen, Kjøkken, Forvaltning og Mer). LegacyBridge-
 * ruten (Familie) eier fortsatt sitt eget uttrykk, se §AppLayout.module.css
 * sin `.room`-kommentar. Forvaltning ble et React-rom ved R3b-cutover og
 * fikk rombakgrunnen i #59 (produksjonsfeil 6001948623: «hvit bakgrunn»);
 * Mer ble et React-rom i #59 (6001954968). Gavedelen av Familie
 * (`/hjem-familie/gaver`, S1) er et React-rom; resten av Familie er det ikke.
 */
const ROM = ["/mat", "/forvaltning", "/verktoy", "/hjem-familie/gaver"];

export function isHverdagsflytRoom(pathname: string): boolean {
  return pathname === "/" || ROM.some((r) => pathname.startsWith(r));
}

/**
 * Ruter med bred arbeidsflate på PC (#59, PC-1). Alle andre beholder den
 * smale mobilkolonnen — ingen skjerm strekkes uten at den er laget for det.
 * Avstemmingen fikk sin PC-flate i AV-1 (6572970205).
 */
const BRED = ["/forvaltning/transaksjoner", "/forvaltning/avstemming", "/hjem-familie/gaver"];

export function erBredFlate(pathname: string): boolean {
  return BRED.includes(pathname.replace(/\/+$/, ""));
}
