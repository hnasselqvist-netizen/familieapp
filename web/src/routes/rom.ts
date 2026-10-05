/**
 * Hverdagsflyt-rom (Gangen, Kjøkken og Forvaltning). LegacyBridge-rutene
 * (Familie/Mer) eier fortsatt sitt eget uttrykk, se §AppLayout.module.css
 * sin `.room`-kommentar. Forvaltning ble et React-rom ved R3b-cutover og
 * fikk rombakgrunnen i #59 (produksjonsfeil 6001948623: «hvit bakgrunn»).
 */
export function isHverdagsflytRoom(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith("/mat") || pathname.startsWith("/forvaltning");
}
