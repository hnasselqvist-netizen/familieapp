/**
 * Søkeparameteret inngangene setter når de sender brukeren til en
 * beslutning (#59), slik at rommet kan vise veien tilbake
 * (§components/Retur.tsx).
 */
export const FRA_PARAM = "fra";

export type Opphav = "gangen" | "runde";

/** `sti` med `fra=<opphav>` lagt til, uansett om stien allerede har søkeparametere. */
export function fraLenke(sti: string, opphav: Opphav): string {
  return `${sti}${sti.includes("?") ? "&" : "?"}${FRA_PARAM}=${opphav}`;
}
