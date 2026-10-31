/**
 * Hverdagsflyt-rom (Gangen, Kjøkken, Forvaltning og Mer). LegacyBridge-
 * ruten (Familie) eier fortsatt sitt eget uttrykk, se §AppLayout.module.css
 * sin `.room`-kommentar. Forvaltning ble et React-rom ved R3b-cutover og
 * fikk rombakgrunnen i #59 (produksjonsfeil 6001948623: «hvit bakgrunn»);
 * Mer ble et React-rom i #59 (6001954968).
 */
const ROM = ["/mat", "/forvaltning", "/verktoy"];

export function isHverdagsflytRoom(pathname: string): boolean {
  return pathname === "/" || ROM.some((r) => pathname.startsWith(r));
}

/**
 * Ruter med bred arbeidsflate på PC (#59, PC-1). Alle andre beholder den
 * smale mobilkolonnen — ingen skjerm strekkes uten at den er laget for det.
 */
const BRED = ["/forvaltning/transaksjoner"];

export function erBredFlate(pathname: string): boolean {
  return BRED.includes(pathname.replace(/\/+$/, ""));
}
