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
